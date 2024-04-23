# 🔍 Upgrade Verification Tool - zkSync Era

> 🏗️ `Work In Progress` : This repo is being actively developed and does not represent final quality of the tool!

##  🗂️ Table of Contents

- [Description](#Description)
    - [Features](#features)
- [Prerequisites](#prerequisites)
    - [PNPM Installation](#installation)
    - [Clone Repository](#Clone-repository)
    - [Install Dependencies](#Install-dependencies)
- [Tool Usage](#usage)
  - [Run](#run-the-tool)
  - [Command List](#commands)
    - [General](#general)
    - [Upgrade Verification](#upgrade-verification)
  - [Etherscan API Key](#etherscan-api-key-requirement)
  - [Download Diff Details](#download-diff-detailed-command-usage)
  - [Examples](#command-examples)
- [Testing](#testing)
- [License](#license)
- [Contact](#contact)
- [FAQs / Troubleshooting](#faqs--troubleshooting)
- [Versioning and Changelog](#versioning-and-changelog)

<br>

## 📝 **Description**

The zkSync Era Upgrade Verification Tool is a CLI tool crafted to decode and present zkSync Era upgrade proposals in a human-readable format.

By enabling a deeper understanding of the changes proposed in each upgrade to L1 and L2 contracts, this tool is integral to informed decision-making, voting, and security reviews of proposed upgrades in the spirit of community-driven governance.

<br>

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

Before installing the tool, you need to ensure that you have `pnpm` installed, as it is required to manage the project's dependencies.

<br>

### **1. Installing Node.js & pnpm**

`pnpm` is a fast, disk space-efficient package manager for JavaScript that works by creating a single version of a module and linking it in multiple projects if needed.

To install `pnpm`, you need to have Node.js installed on your system. If you do not have Node.js installed, you can download it from [nodejs.org](https://nodejs.org/).

With Node.js installed, you can install `pnpm` using the following command:

```bash
npm install -g pnpm
```

To check if npm is correctly installed in your system you can use command:

```bash
npm -v
```

For other ways of installing pnpm or troubleshooting errors, please visit: [pnpm installation guide](https://pnpm.io/installation).

<br>

### **2. Clone repository**

```bash
git clone <repository-url>
cd <era-l1-upgrade-checker>
```

### **3. Install dependencies**

```bash
pnpm install
pnpm build
```

To check if pnpm is correctly installed in your repository you can use command:

```bash
pnpm -v
```

<br>

## 🛠️ **Usage**
The zkSync Era Upgrade Verification Tool provides a range of commands for interacting with and verifying zkSync protocol upgrade data. Below are the available commands and their descriptions:

<br>

### **Run the Tool**

```bash
pnpm validate
```

### **Commands**
The zkSync Era Upgrade Verification Tool is equipped with several commands to interact with and verify zkSync protocol upgrades effectively. Here is how to utilize these commands:

#### **General**

- `version`: Displays the current version number of the tool.
- `help`: Provides usage information and displays help for all commands.

#### **Upgrade Verification**

- `list`: To list all available upgrades that the tool can verify. `[CHECK IF PERSISTS]`
- `check <upgradeDir>`: To retrieve the current state of contracts for a specified upgrade.
- `show-diff <upgradeDir> <facetName>`: To display the code differences for a particular contract facet.
- `download-diff <upgradeDir> <targetSourceCodeDir>` : To download the code differences between the current contracts and the upgrade proposal. For more info, [please refer here](#download-diff-guide)

<br>

### **Etherscan API Key Requirement**

For all upgrade verification commands, you must specify your Etherscan API key using the `--ethscankey` option:

```bash
--ethscankey=YOUR_ETHERSCAN_API_KEY
 ```

If not explicitly defined, the tool will check for the environment variable `ETHERSCAN_API_KEY` or fail to retrieve upgrade data. You can create an Etherscan API key at [Etherscan API Key](https://docs.etherscan.io/getting-started/viewing-api-usage-statistics).

<br>

### **Parameters Info**

<br>

- `<upgradeDir>`: The directory path containing upgrade information. This is required for the `check` and `download-diff` commands.
- `<facetName>`: The specific contract facet to compare. This is used with the `show-diff` command.
- `<targetSourceCodeDir>`: The directory where the downloaded code differences will be saved. This is required for the `download-diff` command.

<br>

### **`download-diff` Detailed Command Usage**

The `download-diff` command facilitates the comparison of source code differences between contract versions. Here's how to use it:

```bash
pnpm validate download-diff <upgradeDir> <targetSourceCodeDir>
```
### **Steps to Use download-diff**

<br>

1. **Specify Directories:**
    - `<upgradeDir>`: The directory containing the upgrade information.
    - `<targetSourceCodeDir>`: The directory where you wish to save the downloaded differences. If this directory does not already exist, download-diff will create it for you inside the directory you are at. 

2. **Navigate to Directory:**
    - After running the command, navigate to the `<targetSourceCodeDir>` directory.

3. **Use Your Preferred Diff Tool:**
    - Once in the `<targetSourceCodeDir>`, you can use your preferred diff tool to compare the 'old' (*current*) versus 'new'  (*upgrade*) directory structure or specific files.
    - *For example:* 
        - ```diff -r old new```
        - ```meld old new```
        - ```vimdiff old new```


<br>

### **Command Examples**

*Check the current state of contracts using your Etherscan API key:*

```bash
pnpm validate --ethscankey=YOUR_ETHERSCAN_API_KEY check <upgradeDirectory>
```

*Download code differences for a given upgrade proposal:*

```bash
pnpm validate download-diff <upgradeDir> <targetSourceCodeDir>
```

<br>

## 🧪 Testing

This command will execute all automated tests associated with the tool, verifying that all components operate as expected.

```bash
pnpm test
```
## 📄 **License**

[Placeholder] This project is licensed under the MIT License. For more details, see the LICENSE file in the repository.

## 📬 **Contact**

[Placeholder]
For support, inquiries, or contributions, please contact us at [Check Contact]. You can also raise an issue directly in the GitHub repository for any bugs or feature requests.

<br>

## ❓ **FAQs / Troubleshooting**

[Placeholder]

<br>

<details> 
    <summary> 
      Question 1
    </summary>
Question 1 Info
</details>
<br>
<details> 
    <summary> 
      Question 2
    </summary>
Question 2 Info
</details>
<br>

## 📌 **Versioning and Changelog**
[Placeholder]

We adhere to Semantic Versioning (SemVer) for this project. The changelog is regularly updated and can be found in the CHANGELOG.md file. Each release also includes detailed notes on the additions, changes, and fixes made to the software.

To view the versions available, visit the Releases section of our GitHub repository.

<br>

 ![Static Badge](https://img.shields.io/badge/zkZync_Era_upgrade_verification_tool%20-%20black?style=for-the-badge&label=moonsong%20labs)                                                                               
