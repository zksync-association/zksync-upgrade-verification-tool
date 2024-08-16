# End-to-End: zkSync Era Upgrade Verification Tool

## Run a full network

> [!TIP]  
> Make sure your `.env` files are present and correct in `/webapp` and `/e2e` folders respectively.

In the root directory of repo:

```sh
pnpm docker:build
```

Back in the `/e2e` folder:

```sh
pnpm fullenv:up
```

You should now be able to open the webapp at: [http://localhost:3000](http://localhost:3000)

## Perform tests

### Testing zk Governance deployment

```sh
pnpm test:local
```

### End-to-End Tests

```sh
pnpm test:e2e
```