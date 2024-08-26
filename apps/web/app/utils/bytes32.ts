export function displayBytes32(bytes32: string) {
  return `${bytes32.slice(0, 6)}...${bytes32.slice(-6)}`;
}
