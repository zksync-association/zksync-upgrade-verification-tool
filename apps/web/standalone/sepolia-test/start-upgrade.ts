// Starts an upgrade on the Sepolia test handler (deployment.json): the ZKsync stub proves any L2
// message, so any proposal starts. The proposal is a JSON file in the emergency payload format:
// {"salt":"0x…","calls":[{"target":"0x…","value":"0","data":"0x…"}],"executor":"0x…"} (executor
// optional: anyone may execute). Sent from the deployer key, like deploy.ts.
//
//   corepack pnpm exec tsx standalone/sepolia-test/start-upgrade.ts proposal.json
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { upgradeHandlerAbi } from "../../app/common/abis";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const file = process.argv[2];
if (!file) throw new Error("usage: start-upgrade.ts <proposal.json>");
const raw = JSON.parse(readFileSync(file, "utf8"));
const proposal = {
  calls: (raw.calls as { target: Address; value: string; data: Hex }[]).map((c) => ({
    target: c.target,
    value: BigInt(c.value),
    data: c.data,
  })),
  executor: (raw.executor ?? zeroAddress) as Address,
  salt: raw.salt as Hex,
};
const handler: Address = JSON.parse(readFileSync(at("./deployment.json"), "utf8")).contracts
  .protocolUpgradeHandler;
// Public RPCs answer bursts with 429: retried, backing off.
const RETRY = { retryCount: 8, retryDelay: 1_000 };
const transport = http(
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  RETRY
);
const client = createPublicClient({ chain: sepolia, transport });
const key = readFileSync(
  process.env.DEPLOYER_KEY_FILE ?? at("../../.cache/sepolia-test/deployer.key"),
  "utf8"
).trim() as Hex;
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: sepolia, transport });

const id = keccak256(
  encodeAbiParameters(
    parseAbiParameters(
      "((address target, uint256 value, bytes data)[] calls, address executor, bytes32 salt)"
    ),
    [proposal]
  )
);
const hash = await wallet.writeContract({
  address: handler,
  abi: upgradeHandlerAbi,
  functionName: "startUpgrade",
  args: [0n, 0n, 0, [], proposal],
});
const receipt = await client.waitForTransactionReceipt({ hash });
console.log(`Upgrade ${id}: ${receipt.status} in ${hash} (block ${receipt.blockNumber})`);
