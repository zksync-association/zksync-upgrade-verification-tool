import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { NET_VERSIONS, type Network } from "@repo/common/ethereum";
import { basePackageDir } from "../util/base-package-dir";
import { RpcClient } from "../ethereum/rpc-client";
import { type Address, createWalletClient, type Hex, http, parseEther, publicActions, testActions } from "viem";
import { mainnet, sepolia } from "viem/chains";

const FORK_PORT = "9090";
const RICH_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RICH_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export class LocalFork {
  // private baseUrl: string;
  private spawned: ChildProcessWithoutNullStreams;
  private network: Network;

  private constructor(baseUrl: string, network: Network) {
    // this.baseUrl = baseUrl;
    this.network = network
    const baseDir = basePackageDir();
    const hardhatBin = `${baseDir}/node_modules/.bin/hardhat`

    this.spawned = spawn(
      hardhatBin,
      [
        "node",
        "--port",
        FORK_PORT,
        "--fork",
        baseUrl
      ], {
        cwd: baseDir,
        detached: false,
        env: {
          ...process.env,
          RICH_PRIVATE_KEY: RICH_PRIVATE_KEY,
          CHAIN_ID: NET_VERSIONS[network]
        }
      })

    // this.spawned.stdout.on("data", (data) => console.log(data.toString()))
    // this.spawned.stderr.on("data", (data) => console.log(data.toString()))
  }

  static async create(baseUrl: string, network: Network) {
    const localFork = new LocalFork(baseUrl, network);
    await localFork.waitForReady()
    return localFork;
  }

  async waitForReady() {
    let i = 0
    while (i < 100) {
      i += 1;
      try {
        const response = await fetch(this.url(), {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: '{"id":1,"jsonrpc":"2.0","method":"net_version","params":[]}'
        });
        await response.json();
        return
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Network was not ready on time")
  }

  async tearDown() {
    this.spawned.kill("SIGKILL")
  }

  url() {
    return `http://localhost:${FORK_PORT}`;
  }


  rpc(): RpcClient {
    return new RpcClient(this.url())
  }

  async fund(someAddress: Address, value: bigint) {
    const wallet = createWalletClient({
      transport: http(this.url()),
      key: RICH_PRIVATE_KEY,
      chain: this.network === "mainnet" ? mainnet : sepolia
    }).extend(publicActions).extend(testActions({mode: "hardhat"}))

    const txid = await wallet.sendTransaction({
      account: RICH_ADDRESS,
      to: someAddress,
      value
    })

    await wallet.waitForTransactionReceipt({hash: txid})
    await wallet.mine({blocks: 10, interval: 0})
  }

  async execDebugTx(from: Address, to: Address, data: Hex, value: bigint): Promise<void> {
    const wallet = createWalletClient({
      transport: http(this.url()),
      key: RICH_PRIVATE_KEY,
      chain: this.network === "mainnet" ? mainnet : sepolia
    }).extend(publicActions).extend(testActions({mode: "hardhat"}))

    // First put some eth to pay fees.
    await this.fund(from, parseEther("1"))

    await wallet.setCode({ address: from, bytecode: "0x" })
    await wallet.impersonateAccount({ address: from })

    await wallet.sendTransaction({
      account: from,
      to,
      data,
      value
    })

    await wallet.stopImpersonatingAccount({ address: from })
  }
}