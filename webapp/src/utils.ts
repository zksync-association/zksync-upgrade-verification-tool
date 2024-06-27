export function etherscanApiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) {
    throw new Error('ETHERSCAN_API_KEY is required');
  }
  return key
}