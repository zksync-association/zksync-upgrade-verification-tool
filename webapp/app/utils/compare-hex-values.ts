import { Hex, hexToBigInt } from "viem";

export function compareHexValues(hex1: Hex, hex2: Hex): number {
  const n1 = hexToBigInt(hex1)
  const n2 = hexToBigInt(hex2)
  if (n1 < n2) {
    return -1;
  }
  if (n1 > n2) {
    return 1;
  }
  return 0
}