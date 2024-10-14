import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Network } from "@repo/common/ethereum";
import { basePackageDir } from "../util/base-package-dir";
import { RpcClient } from "../ethereum/rpc-client";
import {
  type Address,
  createWalletClient,
  type Hex,
  http,
  parseEther,
  publicActions,
  testActions,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { z } from "zod";
import { addressSchema, hexSchema } from "@repo/common/schemas";

const RICH_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RICH_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const debugInfoSchema = z
  .object({
    result: z.array(
      z.object({
        type: z.string(),
        depth: z.number(),
        from: addressSchema,
        to: addressSchema,
        value: hexSchema,
        input: hexSchema,
      })
    ),
  })
  .transform((obj) => obj.result);
export type DebugCallInfo = z.infer<typeof debugInfoSchema>;

export class LocalFork {
  private spawned: ChildProcessWithoutNullStreams;
  private network: Network;
  private port: number;

  private constructor(baseUrl: string, network: Network, port = 9090) {
    this.network = network;
    const baseDir = basePackageDir();
    // const hardhatBin = `${baseDir}/node_modules/.bin/hardhat`
    this.port = port

    this.spawned = spawn("anvil", ["--port", port.toString(), "-f", baseUrl], {
      cwd: baseDir,
      detached: false,
      env: {
        ...process.env,
        RICH_PRIVATE_KEY: RICH_PRIVATE_KEY
      },
    });

    // this.spawned.stdout.on("data", (data) => console.log(data.toString()))
    // this.spawned.stderr.on("data", (data) => console.log(data.toString()))
  }

  static async create(baseUrl: string, network: Network) {
    const localFork = new LocalFork(baseUrl, network);
    await localFork.waitForReady();
    return localFork;
  }

  async waitForReady() {
    let i = 0;
    while (i < 100) {
      i += 1;
      try {
        const response = await fetch(this.url(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"id":1,"jsonrpc":"2.0","method":"net_version","params":[]}',
        });
        const res = await response.json() as any;
        if (res.result === undefined) {
          continue
        }
        return;
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Network was not ready on time");
  }

  async tearDown() {
    const prom = new Promise(resolve => this.spawned.on("exit", () => resolve(null )))
    this.spawned.kill("SIGKILL");
    return prom
  }

  url() {
    return `http://localhost:${this.port}`;
  }

  rpc(): RpcClient {
    return new RpcClient(this.url());
  }

  async fund(someAddress: Address, value: bigint) {
    const wallet = createWalletClient({
      transport: http(this.url()),
      key: RICH_PRIVATE_KEY,
      chain: this.network === "mainnet" ? mainnet : sepolia,
    })
      .extend(publicActions)
      .extend(testActions({ mode: "anvil" }));

    const txid = await wallet.sendTransaction({
      account: RICH_ADDRESS,
      to: someAddress,
      value,
    });

    await wallet.waitForTransactionReceipt({ hash: txid });
    await wallet.mine({ blocks: 10, interval: 0 });
  }

  async execDebugTx(
    from: Address,
    to: Address,
    data: Hex,
    value: bigint
  ): Promise<[Hex, DebugCallInfo]> {
    const wallet = createWalletClient({
      transport: http(this.url()),
      key: RICH_PRIVATE_KEY,
      chain: this.network === "mainnet" ? mainnet : sepolia,
    })
      .extend(publicActions)
      .extend(testActions({ mode: "anvil" }));

    // First put some eth to pay fees.
    await this.fund(from, parseEther("1"));

    await wallet.setCode({ address: from, bytecode: "0x" });
    await wallet.impersonateAccount({ address: from });

    const txid = await wallet.sendTransaction({
      account: from,
      to,
      data,
      value,
    });

    await wallet.stopImpersonatingAccount({ address: from });

    const debugInfo = await this.rpc().rawCall("ots_traceTransaction", [txid]);

    return [txid, debugInfoSchema.parse(debugInfo)];
  }
}
