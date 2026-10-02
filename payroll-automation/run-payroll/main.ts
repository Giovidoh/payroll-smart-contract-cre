import {
  CronCapability,
  EVMClient,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  handler,
  prepareReportRequest,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";

/**
 * Triggers the payroll of a Payroll contract on a schedule.
 *
 * The contract alone decides whether a payroll is due: `runPayroll()` reverts
 * before the interval has elapsed. The workflow reads the same two values
 * first so that a trigger arriving too early sends nothing and costs nothing.
 *
 * CRE does not call arbitrary functions: it delivers a signed report to a
 * receiver contract through the Chainlink Forwarder. The receiver (a relay
 * deployed next to the Payroll contract) then calls `runPayroll()`.
 */

const address = z.string().refine(
  (value) => isAddress(value) && value.toLowerCase() !== zeroAddress,
  "expected a non-zero address",
);

const shared = {
  schedule: z.string().regex(/^\S+( \S+){5}$/, "CRE cron needs six fields"),
  chainSelectorName: z.string().min(1),
  payrollAddress: address,
};

const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local-simulation"), ...shared }).strict(),
  z
    .object({
      mode: z.literal("production"),
      ...shared,
      receiverAddress: address,
      gasLimit: z.string().regex(/^[1-9]\d*$/),
    })
    .strict(),
]);

export type Config = z.infer<typeof configSchema>;

const payrollAbi = parseAbi([
  "function getLastPayrollTimestamp() view returns (uint256)",
  "function getPayrollInterval() view returns (uint256)",
]);

const evmClientFor = (runtime: Runtime<Config>): EVMClient => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  });
  if (!network) {
    throw new Error(`Unknown chain selector: ${runtime.config.chainSelectorName}`);
  }
  return new EVMClient(network.chainSelector.selector);
};

const readUint = (
  runtime: Runtime<Config>,
  client: EVMClient,
  functionName: "getLastPayrollTimestamp" | "getPayrollInterval",
): bigint => {
  const reply = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.payrollAddress as Address,
        data: encodeFunctionData({ abi: payrollAbi, functionName }),
      }),
      // Latest rather than finalized: on Sepolia finality lags by minutes,
      // longer than a demonstration interval. The contract re-checks the
      // interval on execution, so a stale read can only cause a revert.
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({
    abi: payrollAbi,
    functionName,
    data: bytesToHex(reply.data),
  });
};

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const client = evmClientFor(runtime);
  const lastPayroll = readUint(runtime, client, "getLastPayrollTimestamp");
  const interval = readUint(runtime, client, "getPayrollInterval");

  const now = BigInt(runtime.now().getTime()) / 1000n;
  const dueAt = lastPayroll + interval;
  const due = now >= dueAt;

  const outcome = {
    mode: runtime.config.mode,
    now: now.toString(),
    dueAt: dueAt.toString(),
    due,
  };

  if (!due) {
    runtime.log(`NOT_DUE: payroll due in ${dueAt - now} s`);
    return JSON.stringify({ ...outcome, status: "NOT_DUE" });
  }

  if (runtime.config.mode === "local-simulation") {
    // Stops before any report or write: this target can never send a transaction.
    runtime.log("DUE: local simulation, no report sent");
    return JSON.stringify({ ...outcome, status: "WOULD_RUN" });
  }

  const report = runtime
    .report(
      prepareReportRequest(
        encodeAbiParameters(parseAbiParameters("uint256 requestedAt"), [now]),
      ),
    )
    .result();

  const write = client
    .writeReport(runtime, {
      receiver: runtime.config.receiverAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(write.errorMessage ?? `write status ${write.txStatus}`);
  }
  if (!write.txHash) {
    throw new Error("write succeeded without a transaction hash");
  }

  const txHash = bytesToHex(write.txHash);
  runtime.log(`PAID: ${txHash}`);
  return JSON.stringify({ ...outcome, status: "PAID", txHash });
};

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCronTrigger),
];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
