# 🔍 Upgrade Verification Tool - zkSync Era

> 🏗️ `Work In Progress` : This repo is being actively developed and does not represent final quality of the tool!

## 📝 **Description**

The zkSync Era Upgrade Verification Tool is a CLI tool crafted to decode and present zkSync Era upgrade proposals in a human-readable format.

## 🌟 **Features**

  - **_[L1]_ Facets**: Identifies contract upgrades including additions or removals of functions. 
  - **_[L1]_ Verifier** : Detects upgrades and parameter changes in contracts.
  - **_[L2]_ System Contracts**: Lists changes and validates bytecode hashes. 
 - **_[L2]_ Bootloader and DefaultAccount**: Validates bytecode hash.
 - **Solidity Diff Tool**: Compares current contracts with upgrade proposals for verification. *Currently available for Facets, Verifier & System Contracts.*
 

## 🔍 **Prerequisites**

### **1. Node.js & pnpm**

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

### **5. Access to Upgrades Directory**

For the `<upgradeDir>` parameter, you need access to a upgrade directory. For example, [zksync-era upgrades directory](https://github.com/matter-labs/zksync-era/tree/main/etc/upgrades)

You can clone [zkSync Era Repo](https://github.com/matter-labs/zksync-era) to access this directory: 

```bash
git clone https://github.com/matter-labs/zksync-era.git
```

Later you can define the target `<upgradeDir>` in tool commands using the path to a specific upgrade, for example:

```bash
path-to-directory/zksync-era/etc/upgrades/1699353977-boojum
````

## 🏃 **Set up**

### **2. Clone repository**

```bash
git clone https://github.com/Moonsong-Labs/era-l1-upgrade-checker.git && cd era-l1-upgrade-checker
```

### **3. Install dependencies & build**

```bash
pnpm install
```

```bash
pnpm build
```

### **4. Etherscan & Github API Key Setup **
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

Alternatively, you can copy  env.example file and complete it with your keys:

```bash
cp env.example .env
```
This file should contain the following entries:
```bash
# .env
ETHERSCAN_API_KEY=your_etherscan_api_key
GITHUB_API_KEY=your_github_api_key
```

#### ***Option 3: CLI Argument***

 You can also specify your API keys directly as command line arguments when running commands that require them. For example:

```bash
pnpm validate --ethscanApiKey=your_etherscan_api_key --githubApiKey=your_github_api_key
```

## 🛠️ **Usage**
The zkSync Era Upgrade Verification Tool provides a range of commands for interacting with and verifying zkSync protocol upgrade data.

>**Etherscan & Github API Key required.*

<br>

**`check <upgradeDir>`**: Prints on the terminal the changes applied for a specified upgrade. 

```bash
pnpm validate check <upgradeDir>
```

<br>

**`show-diff <upgradeDir> <facetName>`**: Prints on the terminal the code differences for a particular contract facet. `<facetName>` refers to the specific contract facet to compare.


```bash
pnpm validate show-diff <upgradeDir> <facetName>
```
<br>

**`download-diff <upgradeDir> <targetSourceCodeDir>`** : To download the code differences between the current contracts and the upgrade proposal.


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

<br>


## ❓ Help

**`help`**: Provides usage information and displays help for all commands.

```bash
pnpm validate help
```

## 🧪 Testing

This command will execute all automated tests associated with the tool, verifying that all components operate as expected.

```bash
pnpm test
```
## 📄 **License**

This project is licensed under the MIT License. For more details, see the LICENSE file in the repository.
