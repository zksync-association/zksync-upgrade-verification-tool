export function removeFunctionParams(fn: string) {
  return fn.replace(/\(.*\)/, "(...)");
}

export function displayAddress(address: string) {
  return `${address.slice(0, 12)}...${address.slice(-10)}`;
}

export function displayBytes32(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-10)}`;
}

export function displayEmpty() {
  return "-";
}
