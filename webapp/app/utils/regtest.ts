import { defineChain } from "viem";

export const regtest = defineChain({
  id: 11155111,
  name: "Sepolia",
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  testnet: true,
});