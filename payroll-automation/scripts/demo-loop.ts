/**
 * Runs the CRE workflow every 30 seconds from this machine, with real Sepolia
 * transactions (--broadcast), for the thesis defense. It plays the role the
 * CRE network would play once the workflow is deployed: same code, local
 * executor. Stop with Ctrl+C; nothing keeps running afterwards.
 *
 * This file runs under Bun on the host, not inside the workflow's WASM runtime.
 */

const PERIOD_MS = 30_000;

const command = [
  "cre", "workflow", "simulate", "run-payroll",
  "--target", "staging-settings",
  "--non-interactive", "--trigger-index", "0",
  "--broadcast",
];

const OUTCOME = /\[USER LOG\] (NOT_DUE|DUE|PAID|REVERTED)[^\r\n]*/;

let run = 0;

while (true) {
  const startedAt = Date.now();
  run += 1;

  const child = Bun.spawn(command, {
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;

  const time = new Date().toISOString().slice(11, 19);
  const outcome = OUTCOME.exec(stdout)?.[0].replace("[USER LOG] ", "");
  if (outcome) {
    console.log(`${time} #${run} ${outcome}`);
  } else {
    // No workflow log: the simulation itself failed (RPC, login, compilation).
    const reason = (stderr || stdout).trim().split(/\r?\n/).slice(-1)[0];
    console.log(`${time} #${run} FAILED (exit ${code}): ${reason}`);
  }

  const wait = PERIOD_MS - (Date.now() - startedAt);
  if (wait > 0) await Bun.sleep(wait);
}
