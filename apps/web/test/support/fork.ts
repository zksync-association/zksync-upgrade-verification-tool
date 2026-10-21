// Anvil fork of mainnet for write-path tests. Writes happen only on this local fork: member Safes
// get a well-known anvil test key as an extra owner (via impersonation), so tests can produce
// real Safe signatures that the real deployed contracts accept, on the fork only.
import { type ChildProcess, spawn } from "node:child_process";
import {
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

// Before the Security Council approved upgrade 0x77d5… (tx 0x1defa4f7…, block 26089415).
export const FORK_BLOCK = 26_089_400n;

// anvil's first default dev key (public; never holds value).
export const TEST_OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);

export async function startFork({
  port,
  forkUrl = process.env.FORK_URL || "https://mainnet.gateway.tenderly.co",
}: { port: number; forkUrl?: string }) {
  const child: ChildProcess = spawn(
    "anvil",
    [
      "--fork-url",
      forkUrl,
      "--fork-block-number",
      FORK_BLOCK.toString(),
      "--port",
      String(port),
      "--silent",
    ],
    { stdio: "ignore" }
  );
  const url = `http://127.0.0.1:${port}`;
  const publicClient = createPublicClient({ chain: mainnet, transport: http(url) });
  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 120) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return {
    url,
    stop: () => child.kill(),
    ...forkActions(url),
  };
}

const safeAdmin = parseAbi(["function addOwnerWithThreshold(address owner, uint256 _threshold)"]);

export function forkActions(url: string) {
  const test = createTestClient({ chain: mainnet, mode: "anvil", transport: http(url) });
  const publicClient = createPublicClient({ chain: mainnet, transport: http(url) });

  /** Sends a transaction as `from` (impersonated) and waits for it. */
  async function sendAs(from: Address, to: Address, data: Hex, value = 0n) {
    await test.setBalance({ address: from, value: parseEther("100") + value });
    await test.impersonateAccount({ address: from });
    const wallet = createWalletClient({ chain: mainnet, transport: http(url), account: from });
    const hash = await wallet.sendTransaction({ to, data, value });
    await test.stopImpersonatingAccount({ address: from });
    return publicClient.waitForTransactionReceipt({ hash });
  }

  return {
    publicClient,
    test,
    sendAs,
    snapshot: () => test.snapshot(),
    revert: (id: Hex) => test.revert({ id }),
    /** Makes TEST_OWNER a 1-of-n signer of `safe` on the fork (the Safe calls itself). */
    async takeOver(safe: Address) {
      const receipt = await sendAs(
        safe,
        safe,
        encodeFunctionData({
          abi: safeAdmin,
          functionName: "addOwnerWithThreshold",
          args: [TEST_OWNER.address, 1n],
        })
      );
      if (receipt.status !== "success") throw new Error(`takeover of ${safe} failed`);
    },
  };
}

/** TEST_OWNER's signature over `safe`'s SafeMessage for a governance digest. */
export function signAsSafeOwner(safe: Address, digest: Hex, chainId = 1) {
  return TEST_OWNER.signTypedData({
    domain: { chainId, verifyingContract: safe },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "SafeMessage",
    message: { message: digest },
  });
}
