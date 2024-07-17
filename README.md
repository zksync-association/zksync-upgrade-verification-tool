![CoverImage](zkSyncEraUpgradeToolCover.png)

# 🔍 zkSync Era Upgrade Verification Tool

The zkSync Era Upgrade Verification Tool is composed of a **CLI and Web App tool crafted to decode and present zkSync Era upgrade proposals in a human-readable format**.  

## 🌟 **Features**

 > 🏗️ `Work In Progress` : This repo is being actively developed and does not represent final quality of the tool!

- **_[L1]_ Facets**: Identifies contract upgrades including additions or removals of functions.
- **_[L1]_ Verifier** : Detects upgrades and parameter changes in contracts.
- **_[L2]_ System Contracts**: Lists changes and validates bytecode hashes.
- **_[L2]_ Bootloader and DefaultAccount**: Validates bytecode hash.
- **Solidity Diff Tool**: Compares current contracts with upgrade proposals for verification. _Currently available for Facets, Verifier & System Contracts.  

## 🔍 **Prerequisites**

### **1. Node.js, pnpm & yarn**

```bash
node --version  # Checks the installed version of Node.js
pnpm --version  # Checks the installed version of pnpm
yarn --version  # Checks the installed version of yarn
```

If you do not have Node.js installed, please install it from [nodejs.org](https://nodejs.org/en/download/package-manager). For example:

```bash
brew install node
```

If you do not have `pnpm` installed, please install it from [pnpm installation guide](https://pnpm.io/installation). For example:

```bash
npm install -g pnpm
```

If you do not have `yarn` installed, please install it from [yarn installation guide](https://classic.yarnpkg.com/en/docs/install). For example:

```bash
npm install -g yarn
```

### **2. Access to Upgrade Directory**

For the `<upgradeDir>` parameter, you need access to a upgrade directory. For example, [zksync-era upgrades directory](https://github.com/matter-labs/zksync-era/tree/main/etc/upgrades)

You can clone [zkSync Era Repo](https://github.com/matter-labs/zksync-era) to access this directory:

```bash
git clone https://github.com/matter-labs/zksync-era.git
```

Later you can define the target `<upgradeDir>` in tool commands using the path to a specific upgrade, for example:

```bash
path-to-directory/zksync-era/etc/upgrades/1699353977-boojum
```

## CLI

### 🏃 **Set up**

#### **1. Clone repository**

```bash
git clone https://github.com/Moonsong-Labs/zksync-upgrade-verification-tool.git
```

#### **2. Install dependencies & build**

```bash
cd zksync-upgrade-verification-tool
pnpm install
pnpm build
```

#### **3. Etherscan Key setup**  

> You can create an Etherscan API key at [Etherscan API Key](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics).  

##### _**Option 1: Environment Variables**_

```bash
export ETHERSCAN_API_KEY="<your_etherscan_api_key>"
```

##### _**Option 2: Configuration Files**_

Alternatively, you can copy  env.example file and complete it with your keys:

```bash
cp env.example .env
```

This file should contain the following entries:

```bash
# .env
ETHERSCAN_API_KEY=your_etherscan_api_key
```

##### _**Option 3: CLI Argument**_

 You can also specify your API keys directly as command line arguments when running commands that require them. For example:

```bash
pnpm validate --ethscanApiKey=your_etherscan_api_key
```

### 🛠️ **Usage**

The zkSync Era Upgrade Verification Tool provides a range of commands for interacting with and verifying zkSync protocol upgrade data.

>*_Etherscan API Key required._

#### **`check <upgradeDir>`**

Checks the validity of the upgrade and prints a summary of the changes.

```bash
pnpm validate check <upgradeDir>
```

```bash
pnpm validate check ../zksync-era/etc/upgrades/1699353977-boojum #Example of check command with Boojum upgrade.
```
  

#### **`facet-diff <upgradeDir> <facetName>`**

Shows the proposed changes in a specified facet.

```bash
pnpm validate show-diff <upgradeDir> <facetName>
```

```bash
pnpm validate facet-diff ../zksync-era/etc/upgrades/1699353977-boojum GettersFacet --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0 #Example with GettersFacet in Boojum upgrade with specific commit reference.
```
  
#### **`verifier-diff <upgradeDir>`**

Shows the proposed changes between current verifier source code and the proposed one.

```bash
pnpm validate verifier-diff <upgradeDir>
```

```bash
pnpm validate verifier-diff ../zksync-era/etc/upgrades/1699353977-boojum #Example of verifier-diff command for Boojum upgrade.
```
  
#### **`download-diff <upgradeDir> <targetSourceCodeDir>`**

Downloads both the current and proposed versions of each contract being upgraded for comparison.

1. **Run the Command:**

    ```bash
      pnpm validate download-diff <upgradeDir> <targetSourceCodeDir>
    ```

    `<targetSourceCodeDir>`: The directory where you wish to save the downloaded differences.

   _Note: Depending on the specific upgrade referenced, the `--ref` option might be necessary. For more info, please refer to [--ref in options section.](#🎛️-options)_

2. **Navigate to Directory:** After running the command, navigate to the `<targetSourceCodeDir>` directory.
  
3. **Use Your Preferred Diff Tool:** Once in the `<targetSourceCodeDir>`, you can use your preferred diff tool to compare the 'old' (_current_) versus 'new'  (_upgrade_) directory structure or specific files.
    - _For example:_
        - ```diff -r old new```
        - ```meld old new```
        - ```vimdiff old new```
  
### 🎛️ **Options**

The following options are available to configure the zkSync Era Upgrade Verification Tool:

#### `-n`, `--network`

Specifies the target network where the tool will perform the checks.

- **Values**: `mainnet`, `sepolia`
- **Default**: `mainnet`
- **Example**: _Protodanksharding upgrade in sepolia_

```bash
pnpm validate check ../zksync-era/etc/upgrades/1709067445-protodanksharding --network=sepolia
```

#### `--rpc` , `--rpcUrl`

Specifies the Ethereum RPC URL to be used for connecting to the blockchain.

- **Default**:
  - `mainnet`: `https://ethereum-rpc.publicnode.com`
  - `sepolia`: `https://ethereum-sepolia-rpc.publicnode.com`

#### `--ref`

Specifies the GitHub commit reference from which the L2 code will be downloaded.

- **Default**: The last commit on the `main` branch.
- **Example**: `--ref` to commit (related to `boojum` upgrade in `download_dif` command).

  ```bash
  pnpm validate download-diff ../zksync-era/etc/upgrades/1699353977-boojum boojumDiff --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0
  ```

### ❓ **Help**

**`help`**: Provides usage information and displays help for all commands.

```bash
pnpm validate help
```

### 🧪 **Testing**

Unit tests are located inside the cli package. To run:

```bash
pnpm run --filter=./cli test
```

Integration tests are inside "test" package. In order to run them
it's important to config api keys for testing. That can be done with
a dotenv file inside the test directory:

``` bash
cp env.example test/.env
vim .env # complete with real api keys
```

Once it's completed you can run the integration tests with:

``` test
pnpm run --filter=./test test
```

Lastly, this command will execute all automated tests associated with the tool:

```bash
pnpm test
```

### 🔮 **Future Improvements**

- **Extended Support for L2 Upgrades**: We plan to expand the capabilities of the Solidity Diff Tool to include Bootloader and DefaultAccount contracts.

- **Improve Error Handling**: We plan to improve error messages and handling throughout the tool.

- **Add HTML File Output Option**: Implementing HTML file output option to improve diff visualization and user experience.

We welcome community feedback and suggestions which can be submitted via our GitHub repository.

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
export NODE_ENV="production"
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
- `ETHERSCAN_API_KEY`: The Etherscan API key. You can get one at  [Etherscan API Key](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics).
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

## 📄 **License**

This project is licensed under the MIT License. For more details, see the LICENSE file in the repository.
