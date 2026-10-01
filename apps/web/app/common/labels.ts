import type { Address } from "viem";

// Display names from docs.zknation.io (Schedules 3 and 4). Labels only: membership itself always
// comes from SecurityCouncil.members() / Guardians.members() on-chain.
const NAMES: Record<string, string> = {
  // Security Council
  "0x34ea62d4b9bbb8ad927efb6ab31e3ab3474ac93a": "OpenZeppelin",
  "0x35ea56fd9ead2567f339eb9564b6940b9dd5653f": "Cyfrin",
  "0x69462a81ba94d64c404575f1899a464f123497a2": "Nethermind",
  "0x84bf0ac41eeb74373ddddae8b7055bf2bd3ce6e0": "ChainLight",
  "0x9b8be3278b7f0168d82059eb6bac5991dcdfa803": "Spearbit",
  "0xb7ac3a79a23b148c85fba259712c5a1e7ad0ca44": "Dedaub",
  "0xc3abc9f9aa75be8341e831482cda0125a7b1a23e": "Matter Labs",
  "0xfb90da9dc45378a1b50775beb03ad10c7e8dc231": "PeckShield",
  "0x9b39ea22e838b316ea7d74e7c4b07d91d51cca88": "aleph_v",
  "0x725065b4eb99294baae57adda9c32e42f453fa8a": "Mariano Conti",
  "0x13f07d9bf17615f6a17f272fe1a913168c275a66": "Yev Broshevan",
  "0x3888777686f0b0d8c3108fc22ad8de9e049be26f": "Yoav Weiss",
  // Guardians
  "0x55c671bce13120387ded710a1d1b80c0e3d8e857": "Juan Benet",
  "0x6d26874130a174839b9cd8cb87ed4e09d0c1a5f0": "Alex Gluchowski",
  "0x015318c16ae443a20de0a776db06a59f0d279057": "Bartek Kiepuszewski",
  "0xce7a3dfcc35602155809920ff65e093aa726f6cf": "pcaversaccio",
  "0x178d8eb1a1fb81b5102808a83318bb04c6a9fc6d": "Gabriel Shapiro",
  "0x2a90830083c5ca1f18d7aa7fcdc2998f93475384": "Awa Sun Yin",
  "0x590926dbcdfd19627c3bbd2a6eb96dec7a3abf69": "Aleksandr Vlasov",
  "0x538612f6eba6ff80fbd95d60dcdee16b8fff2c0f": "Eric Wall",
  // ZKsync Foundation
  "0xbc1653bd3829dfec575afc3816d4899cd103b51c": "ZKsync Foundation",
};

export function memberLabel(address: Address): string | null {
  return NAMES[address.toLowerCase()] ?? null;
}
