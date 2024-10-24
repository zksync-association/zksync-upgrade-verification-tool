
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
export ALLOW_INDEXING="false"
export DATABASE_URL="postgresql://user:password@localhost:5432/webapp"
export LOG_LEVEL="info"
export WALLET_CONNECT_PROJECT_ID=":placeholder:"
export L1_RPC_URL=":placeholder:"
export ETHERSCAN_API_KEY=":placeholder:"
export ETH_NETWORK="mainnet"
```

- `ALLOW_INDEXING`: If set to `false`, the Web App will add headers to prevent indexing by search engines.
- `DATABASE_URL`: The URL to the Postgres database.
- `LOG_LEVEL`: The log level for the Web App, can be `info`, `debug`, `warn`, `error`.
- `NODE_ENV`: The environment the Web App is running in, can be `production`, `development`, `test`.
- `WALLET_CONNECT_PROJECT_ID`: The WalletConnect project ID. You can get one by registering at [WalletConnect](https://cloud.walletconnect.com/app).
- `L1_RPC_URL`: The RPC URL for the L1 network. The selected RPC must be able to execute `debug_traceCall`. A good free option is [Tenderly](https://tenderly.co/).
- `ETHERSCAN_API_KEY`: The Etherscan API key. You can get one at [Etherscan API Key](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics).
- `ETH_NETWORK`: The Ethereum network the Web App is running on, can be `mainnet`, `sepolia`.

## 🛠️ **WebApp: Usage**

To start using the web app, simply build it and start it:

```shell
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