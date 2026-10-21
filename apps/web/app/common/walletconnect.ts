// The app's own WalletConnect (Reown) project id: a public identifier, as in every dapp's bundle.
// A project id saved in Settings replaces it.
export const DEFAULT_WALLET_CONNECT_PROJECT_ID = "7f8e4ad2a719840f3816fcd192e713b6";

// Extension transport does not work for the serverless HTML opened from disk.
export function supportsDesktopWallet(_protocol: string | undefined): boolean {
  return _protocol === "http:" || _protocol === "https:";
}
