# 🔍 Upgrade Verification Tool - zkSync Era

> 🏗️ `Work In Progress` : This repo is being actively developed and does not represent final quality of the tool!

<br>

## 📝 **Description**

The zkSync Era Upgrade Verification Tool is a CLI tool crafted to decode and present zkSync Era upgrade proposals in a human-readable format.

## 🌟 **Features**

### **L1 Upgrades:**
  - **Facets**: Identifies contract upgrades including additions or removals of functions.
  - **Verifier**: Detects upgrades and parameter changes in contracts.
  - **Solidity Diff Tool**: Compares current contracts with upgrade proposals for verification.

### **L2 Upgrades:**
  - **System Contracts**: Lists changes and verifies bytecode hashes.
  - **Bootloader and DefaultAccount**: Validates bytecode hash.
  - **Solidity Diff Tool**: Compares current contracts with upgrade proposals for verification (only available for system contracts for now).

<br>

## 🔍 **Prerequisites**

### **1. Installing Node.js & pnpm**

```bash
node --version  # Checks the installed version of Node.js
pnpm --version  # Checks the installed version of pnpm
```


If you do not have Node.js installed, please install it from [nodejs.org](https://nodejs.org/en/download/package-manager). For example: 

```bash
brew install node
```

If you do not have `pnpm` installed, please install it from [pnpm installation guide](https://pnpm.io/installation). For example:

```bash
npm install -g pnpm
```

### **2. Clone repository**

```bash
git clone https://github.com/Moonsong-Labs/era-l1-upgrade-checker.git
```

### **3. Install dependencies in tool repository**

```bash
cd era-l1-upgrade-checker
```

```bash
pnpm install
```

```bash
pnpm build
```

### **4. Etherscan & Github API Key Setup**
<br>

>You can create an Etherscan API key at [Etherscan API Key](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics).

> You can create an Github API key (access token) at [Github API Key](https://github.com/settings/tokens).

<br>

#### ***Option 1: Environment Variables***

```bash
export ETHERSCAN_API_KEY="<your_etherscan_api_key>"
```
```bash
export GITHUB_API_KEY="<your_github_api_key>"
```

#### ***Option 2: Configuration Files***

Alternatively, you can set up your API keys in a .env file located in the root directory of the project. This file should contain the following entries:

```bash
ETHERSCAN_API_KEY=your_etherscan_api_key
GITHUB_API_KEY=your_github_api_key
```

#### ***Option 3: CLI Argument***

 You can also specify your API keys directly as command line arguments when running commands that require them. For example:

```bash
pnpm validate --ethscankey=your_etherscan_api_key --githubkey=your_github_api_key
```
<br>

### **5. Download Upgrades Directory**

To use the `<upgradeDir>` parameter, you need access to the upgrades directory from the zkSync Era repository. You can [find "Upgrades" directory](https://github.com/matter-labs/zksync-era/tree/main/etc/upgrades) at the following relative path:

```bash
../zksync-era/etc/upgrades
````

For example, you can clone [zkSync Era Repo](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics) to access this directory: 

```bash
git clone https://github.com/matter-labs/zksync-era.git
```

And define the target `<upgradeDir>` in tool commands using the relative path:

```bash
../zksync-era/etc/upgrades/1699353977-boojum
````


## 🛠️ **Usage**
The zkSync Era Upgrade Verification Tool provides a range of commands for interacting with and verifying zkSync protocol upgrade data.

<br>

`version`: Displays the current version of the tool.

```bash
pnpm validate version
```

`help`: Provides usage information and displays help for all commands.

```bash
pnpm validate help
```

`check <upgradeDir>`: Prints on the terminal the changes applied for a specified upgrade. 

**Etherscan API Key required.*

```bash
pnpm validate check <upgradeDir>
```

`show-diff <upgradeDir> <facetName>`: Prints on the terminal the code differences for a particular contract facet. `<facetName>` refers to the specific contract facet to compare.

 **Etherscan & Github API Key required.*

```bash
pnpm validate show-diff <upgradeDir> <facetName>
```

`download-diff <upgradeDir> <targetSourceCodeDir>` : To download the code differences between the current contracts and the upgrade proposal.

 **Etherscan & Github API  Key required.*

1. **Run the Command:**
    ```bash
      pnpm validate download-diff <upgradeDir> <targetSourceCodeDir>
    ```
    `<targetSourceCodeDir>`: The directory where you wish to save the downloaded differences. If this directory does not already exist, download-diff will create it for you inside the directory you are at. 

<br>

2. **Navigate to Directory:** After running the command, navigate to the `<targetSourceCodeDir>` directory.

<br>

3. **Use Your Preferred Diff Tool:** Once in the `<targetSourceCodeDir>`, you can use your preferred diff tool to compare the 'old' (*current*) versus 'new'  (*upgrade*) directory structure or specific files.
    - *For example:* 
        - ```diff -r old new```
        - ```meld old new```
        - ```vimdiff old new```


## 🧪 Testing

This command will execute all automated tests associated with the tool, verifying that all components operate as expected.

```bash
pnpm test
```
## 📄 **License**

This project is licensed under the MIT License. For more details, see the LICENSE file in the repository.

 ![Static Badge](https://img.shields.io/badge/zkZync_Era_upgrade_verification_tool%20-%20black?style=for-the-badge&label=moonsong%20labs)                                                                               