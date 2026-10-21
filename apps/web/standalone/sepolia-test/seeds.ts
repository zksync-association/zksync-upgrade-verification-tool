import { type Address, type Hex, decodeEventLog, keccak256, toBytes } from "viem";
import { upgradeHandlerAbi } from "../../app/common/abis";

// Upgrades the deploy script starts on the test handler, so there is something to sign at once.
// Each is a mainnet upgrade's content, read from its UpgradeStarted log, with a salt of its own (so
// an id of its own, never mainnet's). "retarget" sends every call to the ZKsync stub instead, which
// accepts any call: that upgrade can run to the end. Without it the calls go to mainnet's addresses,
// which hold no code on Sepolia: such an upgrade can be signed and approved but not executed.
export type Seed = { title: string; from: { id: Hex; block: bigint }; retarget: boolean };

export const SEEDS: Seed[] = [
  {
    title: "Copy of mainnet upgrade 0x5451e3aa… (31 calls; signs, does not execute)",
    from: {
      id: "0x5451e3aa34aba5b9bd71b567e38be4d075915705d110a37a2d851945be2c4d43",
      block: 23_524_867n,
    },
    retarget: false,
  },
  {
    title: "Mainnet upgrade 0x77d5461c…'s call, sent to the stub (executes)",
    from: {
      id: "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa",
      block: 26_050_400n,
    },
    retarget: true,
  },
  {
    title: "Mainnet upgrade 0x2d891fb5…'s call, sent to the stub (executes)",
    from: {
      id: "0x2d891fb5e539de72ae9ea8cbec41aa1b2bd49e77afb1cfcbdee95432216c1122",
      block: 23_524_879n,
    },
    retarget: true,
  },
];

export const MAINNET_HANDLER: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";

type Proposal = {
  calls: readonly { target: Address; value: bigint; data: Hex }[];
  executor: Address;
  salt: Hex;
};

/** The seed's proposal: mainnet's calls and executor, this seed's salt, its calls' new target. */
export function seedProposal(
  seed: Seed,
  index: number,
  mainnetLog: { data: Hex; topics: [Hex, ...Hex[]] },
  stub: Address
): Proposal {
  const { args } = decodeEventLog({
    abi: upgradeHandlerAbi,
    eventName: "UpgradeStarted",
    data: mainnetLog.data,
    topics: mainnetLog.topics,
  });
  const { calls, executor } = args._proposal;
  return {
    calls: seed.retarget ? calls.map((c) => ({ ...c, target: stub })) : calls,
    executor,
    salt: keccak256(toBytes(`zksync-governance-verifier/sepolia-test/seed/${index}`)),
  };
}
