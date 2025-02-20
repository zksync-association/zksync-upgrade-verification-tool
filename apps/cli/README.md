![CoverImage](zkSyncEraUpgradeToolCover.png)

# Upgrade Verification Tool

This CLI tool is designed to **verify protocol upgrades in the ZKSync governance process**, assisting guardians &
security council members in thoroughly reviewing and validating the protocol upgrades they're approving.

## **Prerequisites: Command Inputs**

Every command of the CLI tool **takes an upgrade as input** and **then outputs data about that upgrade**. To define this
input, is necessary:

### 1. Raw Upgrade

This can be obtained from the app **(formatted as JSON) and is used as a parameter**. The CLI is designed to work in
conjunction with the governance web app. To support this, the governance web app can display upgrades in a format that
can be fed directly into the CLI that can be found in the JSON tab of each upgrade.

> [!TIP]
> The structure of the object it’s the same as used by the Protocol Upgrade
> Handler (https://github.com/zksync-association/zk-governance/blob/master/l1-contracts/src/interfaces/IProtocolUpgradeHandler.sol#L54).
> To verify this raw upgrade data, anyone can take this data from the events published by this contract 
> and then format it in a JSON-like structure.

### 2. Reference to a commit

The reference can be a **branch, a tag, or a commit ID**. This is used to recompile system contracts and check that
deployed versions are correct.
Usually, this reference is going to be provided to the guardians and security council via a secure communication
channel.

## 🔍 **Prerequisites: Dependencies**

### **1. Node.js, pnpm & yarn**

```bash
node --version  # Checks the installed version of Node.js
pnpm --version  # Checks the installed version of pnpm
yarn --version  # Checks the installed version of yarn
```

If you do not have Node.js installed, please install it
from [nodejs.org](https://nodejs.org/en/download/package-manager). For example:

```bash
brew install node
```

If you do not have `pnpm` installed, please install it from [pnpm installation guide](https://pnpm.io/installation). For
example:

```bash
npm install -g pnpm
```

If you do not have `yarn` installed, please install it
from [yarn installation guide](https://classic.yarnpkg.com/en/docs/install). For example:

```bash
npm install -g yarn
```

### **2. Install Foundry**

In order to simulate transactions the network is forked using Foundry. Foundry needs to be installed before running any
command:
https://book.getfoundry.sh/getting-started/installation

## Verification CLI

### 🏃 **Set up**

#### **1. Clone repository**

```bash
git clone git@github.com:zksync-association/zksync-upgrade-verification-tool.git
```

#### **2. Install dependencies & build**

```bash
cd zksync-upgrade-verification-tool
pnpm install
pnpm build
```

### 🛠️ **Usage**

The zkSync Era Upgrade Verification Tool provides a range of commands for interacting with and verifying zkSync protocol
upgrade data.

> **[*JSON protocol upgrade file](#1-raw-upgrade) & [reference to a commit](#2-reference-to-a-commit)** are required
> inputs.

#### **`id -f <rawUpgradeDir>`**

Uses the raw protocol upgrade file as an input and calculates and prints the ID for a given upgrade.

```bash
pnpm validate id -f <rawUpgradeDir>
```

```bash
pnpm validate id -f test/data/sample-upgrade.json

0xa480e5d6840457671b6aca4a836af548f8d62a8586043aaedeee0f538625cac7 #Example of id command with the reference to an upgrade directory containing the raw upgrade information. 
```

> [!TIP]
> When users attempt to approve an upgrade with their wallets, the only data displayed is the upgrade ID. To ensure
> they're approving the correct upgrade, users must recalculate the ID locally and verify that it matches the one shown in
> their wallets. This is why id is a standalone command in the CLI tool.

#### **`check -f <rawUpgradeDir> --ref=<commitRef>`**

This command checks that the upgrade can be executed. Then, it summarizes the changes produced by the upgrade. The
output has several sections:

- **Metadata:** General information about the upgrade
- **Facet changes**: Summary of facet changes for the main ZKsync diamond.
- **Property changes:** Shows changes in the most important properties of the main diamond.
- **System contract changes:** Lists system contracts being modified by the upgrade.

```bash
pnpm validate check -f <rawUpgradeDir> --ref=<commitRef>
```

```bash
pnpm validate check -f test/data/sample-upgrade.json --ref=main

✔ Locally compiling system contracts
✔ Gathering current zksync state
✔ Simulating upgrade
✔ Generating report

[...]
```

#### **`storage-diff -f <rawUpgradeDir> --ref=<commitRef>`**

This command simulates the upgrade and then shows how the storage of the main diamond gets modified by the upgrade.

```bash
pnpm validate storage-diff -f <rawUpgradeDir> --ref=<commitRef>
```

```bash
pnpm validate storage-diff -f test/data/sample-upgrade.json --ref=main

✔ Gathering current zksync state
✔ Forking network
✔ Simulating upgrade
✔ Gathering final state
✔ Calculating report

[...]
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

   _Note: Depending on the specific upgrade referenced, the `--ref` option might be necessary. For more info, please
   refer to [--ref in options section.](#options)_

2. **Navigate to Directory:** After running the command, navigate to the `<targetSourceCodeDir>` directory.

3. **Use Your Preferred Diff Tool:** Once in the `<targetSourceCodeDir>`, you can use your preferred diff tool to
   compare the 'old' (_current_) versus 'new' (_upgrade_) directory structure or specific files.
    - _For example:_
        - `diff -r old new`
        - `meld old new`
        - `vimdiff old new`

### **Options**

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

```bash
cp env.example test/.env
vim .env # complete with real api keys
```

Once it's completed you can run the integration tests with:

```test
pnpm run --filter=./test test
```

Lastly, this command will execute all automated tests associated with the tool:

```bash
pnpm test
```