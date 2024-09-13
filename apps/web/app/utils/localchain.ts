import { defineChain } from "viem";

export const localchain = (port: number) => {
  if (port === 0) {
    throw new Error("Missing port for local chain");
  }
  return defineChain({
    id: 11155111,
    name: "Sepolia",
    rpcUrls: {
      default: {
        http: [`http://localhost:${port}`],
      },
    },
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    testnet: true,
  });
};
