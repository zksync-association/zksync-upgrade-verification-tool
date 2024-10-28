
## Web App

## 🏃 **Web App: Set up**

> [!NOTE]  
> Running `pnpm i` and `pnpm build` at the root level in previous steps will have built the webapp for you already.

### **1. Run Postgres Database**

The Web App uses a Postgres database to store the upgrade data. You can run a Postgres database through Docker running our provided script in the webapp folder:

```bash
./scripts/init_db.sh
```

### **2. Environment keys setup**

Before running the Web App, you need to set up the environment keys:

```bash
export ALLOW_INDEXING=false
export ALLOW_PRIVATE_ACTIONS="0x"
export DATABASE_URL=postgresql://user:password@localhost:5432/webapp
export ETH_NETWORK="mainnet"
export L1_RPC_URL=":placeholder:"
export LOG_LEVEL=info
export NODE_ENV=development
export TALLY_BASE_URL="https://tally.xyz/gov/zksync"
export UPGRADE_HANDLER_ADDRESS="0x"
export WALLET_CONNECT_PROJECT_ID=:placeholder:
export ZK_ADMIN_ADDRESS="0x"
export ZK_GOV_OPS_GOVERNOR_ADDRESS="0x"
export ZK_PROTOCOL_GOVERNOR_ADDRESS="0x"
export ZK_TOKEN_GOVERNOR_ADDRESS="0x"
```

- `ALLOW_INDEXING`: If set to `false`, the Web App will add headers to prevent indexing by search engines.
- `ALLOW_PRIVATE_ACTIONS`: If true the app allow to do emergency upgrades, freezes and vetos.
- `DATABASE_URL`: The URL to the Postgres database.
- `ETH_NETWORK`: The Ethereum network the Web App is running on, can be `mainnet`, `sepolia` or `local`. Local is for development only.
- `L1_RPC_URL`: The RPC URL for the L1 network. A good option with a nice free tier is [Tenderly](https://tenderly.co/).
- `LOG_LEVEL`: The log level for the Web App, can be `info`, `debug`, `warn`, `error`.
- `NODE_ENV`: The environment the Web App is running in, can be `production`, `development`, `test`.
- `TALLY_BASE_URL`: Tally url for zksync. For example, in mainnet is `https://tally.xyz/gov/zksync`
- `UPGRADE_HANDLER_ADDRESS`: Address for the `ProtocolUpgradeHandler` contract.
- `WALLET_CONNECT_PROJECT_ID`: The WalletConnect project ID. You can get one by registering at [WalletConnect](https://cloud.walletconnect.com/app).
- `ZK_ADMIN_ADDRESS`: List of addresses that can archive proposals
- `ZK_GOV_OPS_GOVERNOR_ADDRESS`: Address for gov ops governor (l2).
- `ZK_PROTOCOL_GOVERNOR_ADDRESS`: Address for protocol governor (l2).
- `ZK_TOKEN_GOVERNOR_ADDRESS`: Address for token governor (l2).

## 🛠️ **WebApp: Usage**

To start using the web app, simply build it and start it:

```shell
pnpm install
pnpm build
pnpm start
```

### 🔎 Development

In order to run the Web App in development mode, you can use the following commands:

```bash
pnpm dev
```

## 🧪 **WebApp: Testing**

### Unit Testing

- Component level - verifies logic of react components
- Uses `vitest` `testing-library`

### E2E Testing

- End-to-End - hosts the site locally and verifies via browser interactions
- Uses `vitest` `playwright` `remix`

## Docker

Included is a Dockerfile for making images. A sample stack has been provided, but should be customized for production usecases.

### **1. Build the Docker Image**

First, build the Docker image using the following command:

```sh
pnpm docker:build
```

### **2. Run the Compose stack**

Then run the app with:

```sh
pnpm docker:run
```

> [!TIP]  
> Make sure your `webapp/.env` file exists and has the values you expect!

---