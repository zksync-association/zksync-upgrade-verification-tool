# End-to-end tests

- `suites/web`: Playwright tests of the web app's production build. They run against an anvil fork of mainnet
  (block 26089400, upgrade 0x77d5… waiting for approval) and a local mock of the Safe Transaction Service
  serving recorded mainnet messages. `global-setup.ts` starts all three. Needs `anvil` (Foundry) and network
  access to fork from (`FORK_URL` overrides the default public archive RPC).
- `suites/cli`: the CLI's end-to-end tests (needs `ETHERSCAN_API_KEY` in `.env`, see `.env.example`).

```bash
corepack pnpm --filter web build          # from the repo root
corepack pnpm test:web                    # in packages/e2e (PW_CHANNEL=chrome to use an installed Chrome)
corepack pnpm test:cli
```
