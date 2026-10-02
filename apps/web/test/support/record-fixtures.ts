// Records real mainnet data for offline tests (run manually; output is committed):
//   pnpm tsx test/support/record-fixtures.ts
// Read-only: Safe Transaction Service GETs and eth_getTransaction.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseGovernanceTypedData } from "@/common/typed-data";
import { createPublicClient, http, getAddress, type Hex } from "viem";

const RPC = process.env.L1_RPC_URL ?? "https://mainnet.gateway.tenderly.co";
const SAFE = "https://api.safe.global/tx-service/eth";
const VERIFIERS = [
  "0x59195219d1176E42f8e607e9AC114926D47f9035", // SecurityCouncil
  "0x600dA620Ab29F41ABC6596a15981e14cE58c86b8", // Guardians
  "0xF73a7dCfa68E52030ec39E41a23DCA51F3aAa111", // EmergencyUpgradeBoard
].map((a) => a.toLowerCase());
const SAFES = [
  "0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a",
  "0x35eA56fd9eAd2567F339Eb9564B6940b9DD5653F",
  "0x69462a81ba94D64c404575f1899a464F123497A2",
  "0x84BF0Ac41Eeb74373Ddddae8b7055Bf2bD3CE6E0",
  "0x9B8Be3278B7F0168D82059eb6BAc5991DcdfA803",
  "0xB7aC3A79A23B148c85fba259712c5A1e7ad0ca44",
  "0xc3Abc9f9AA75Be8341E831482cdA0125a7B1A23e",
  "0xFB90Da9DC45378A1B50775Beb03aD10C7E8DC231",
  "0x015318c16AE443a20DE0A776dB06a59F0D279057",
  "0x178D8Eb1A1fb81B5102808A83318Bb04C6a9fC6D",
  "0x2A90830083C5Ca1f18d7AA7fCDC2998f93475384",
  "0x538612F6eba6ff80FBD95D60dCDee16b8FfF2c0f",
  "0x55c671BcE13120387Ded710A1d1b80C0e3d8E857",
  "0x590926dBCDfD19627c3BbD2A6Eb96DeC7a3AbF69",
  "0x6D26874130A174839b9cd8CB87Ed4E09D0c1a5f0",
  "0xCe7a3dFcc35602155809920Ff65e093aa726f6cf",
  "0xbC1653bd3829dfEc575AfC3816D4899cd103B51c",
];
const TXS: Hex[] = [
  "0x1defa4f7f06a4c8a5066ea56f2a27b00a2beeb016cec336692e39460c3f55e11", // SC approval of 0x77d5…
  "0xb5b9c800a5df2db38d237f6ce4ee144b2079fdfcc1ea717566f80094e5a439dd", // emergency 0xb1660380…
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const messages: Record<string, unknown[]> = {};
  for (const safe of SAFES) {
    const all: { message: unknown }[] = [];
    for (let offset = 0; ; offset += 100) {
      await sleep(600);
      const res = await fetch(
        `${SAFE}/api/v1/safes/${safe}/messages/?limit=100&offset=${offset}&ordering=-created`
      );
      if (!res.ok) throw new Error(`${safe}: HTTP ${res.status}`);
      const body = (await res.json()) as { count: number; results: { message: unknown }[] };
      all.push(...body.results);
      if (all.length >= body.count || body.results.length < 100) break;
    }
    messages[getAddress(safe)] = all.filter((m) => {
      const td = parseGovernanceTypedData(m.message, 1);
      return td !== null && VERIFIERS.includes(td.domain.verifyingContract.toLowerCase());
    });
    console.log(safe, all.length, "messages,", messages[getAddress(safe)]?.length, "governance");
  }
  const client = createPublicClient({ transport: http(RPC) });
  const txs: Record<string, { to: string | null; input: Hex; blockNumber: string }> = {};
  for (const hash of TXS) {
    const tx = await client.getTransaction({ hash });
    txs[hash] = { to: tx.to, input: tx.input, blockNumber: (tx.blockNumber ?? 0n).toString() };
  }
  const dir = path.join(import.meta.dirname, "../fixtures");
  writeFileSync(
    path.join(dir, "safe-messages.mainnet.json"),
    `${JSON.stringify(messages, null, 1)}\n`
  );
  writeFileSync(path.join(dir, "transactions.mainnet.json"), `${JSON.stringify(txs, null, 1)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
