-include .env

.PHONY: all build test install

# Defense demo: run the workflow every 30 s with real transactions. Ctrl+C to stop.
demo-loop:
	bun run scripts/demo-loop.ts

simulate-workflow:
	cre workflow simulate run-payroll --target staging-settings --non-interactive --trigger-index 0 --broadcast