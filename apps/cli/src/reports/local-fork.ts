import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Network } from "@repo/common/ethereum";
import { basePackageDir } from "../util/base-package-dir";
import { RpcClient } from "../ethereum/rpc-client";
import {
  type Address,
  bytesToHex,
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
import { mnemonicToAccount } from "viem/accounts";

const CLI_ANVIL_MNEMONIC =
  "draw drastic exercise toilet stove bone grit clutch any stand phone ten";
const account = mnemonicToAccount(CLI_ANVIL_MNEMONIC, { accountIndex: 0 });
const FUNDED_PRIVATE_KEY = bytesToHex(account.getHdKey().privateKey as Uint8Array);
const FUNDED_ADDRESS = account.address;

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
    this.port = port;

    this.spawned = spawn(
      "anvil",
      ["--port", port.toString(), "-f", baseUrl, "-m", CLI_ANVIL_MNEMONIC, "-a", "1"],
      {
        cwd: baseDir,
        detached: false,
        env: {
          ...process.env,
          RICH_PRIVATE_KEY: FUNDED_PRIVATE_KEY,
        },
      }
    );
  }

  static async create(baseUrl: string, network: Network, port = 9090) {
    const localFork = new LocalFork(baseUrl, network, port);
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
        const res = (await response.json()) as any;
        if (res.result === undefined) {
          continue;
        }
        return;
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Network was not ready on time");
  }

  async tearDown() {
    const prom = new Promise((resolve) => this.spawned.on("exit", () => resolve(null)));
    this.spawned.kill("SIGKILL");
    return prom;
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
      key: FUNDED_PRIVATE_KEY,
      chain: this.network === "mainnet" ? mainnet : sepolia,
    })
      .extend(publicActions)
      .extend(testActions({ mode: "anvil" }));

    const txid = await wallet.sendTransaction({
      account: FUNDED_ADDRESS,
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
      key: FUNDED_PRIVATE_KEY,
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
