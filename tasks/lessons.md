# LESSONS

| Date       | What went wrong                 | Rule to apply                          |
|------------|---------------------------------|----------------------------------------|
| 2026-10-02 | The workflow logged `PAID` for a broadcast whose relay reverted: the forwarder transaction succeeds and only records the receiver failure in `ReportProcessed`. | After `writeReport`, check `receiverContractExecutionStatus` as well as `txStatus` and the hash; confirm a payment on chain (`PayrollCompleted`, `getLastPayrollTimestamp`), never from the workflow log alone. |
