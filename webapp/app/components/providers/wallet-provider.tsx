import Avatar from "@/components/connect-button/avatar";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { defineChain } from "viem";
import { type State, WagmiProvider, cookieStorage, createStorage } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const regtest = defineChain({
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

const queryClient = new QueryClient();

const NETWORKS = {
  mainnet: mainnet,
  sepolia: sepolia,
  regtest: regtest,
};

export function WalletProvider({
  children,
  initialState,
  projectId,
  network: networkName,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string;
  network: "mainnet" | "sepolia" | "regtest";
}) {
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: [NETWORKS[networkName]],
      projectId,
      ssr: true,
      storage: createStorage({
        storage: cookieStorage,
      }),
    });
  }, [projectId, networkName]);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#1755F4",
            borderRadius: "large",
          })}
          avatar={Avatar}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
