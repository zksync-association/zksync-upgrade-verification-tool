import Avatar from "@/components/connect-button/avatar";
import WalletAuthProvider from "@/components/providers/wallet-auth-provider";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { defineChain } from "viem";
import { type State, WagmiProvider, cookieStorage, createStorage } from "wagmi";
import { mainnet } from "wagmi/chains";

const devChain = defineChain({
  id: 31337,
  name: "EthereumDev",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
  contracts: {},
});

const queryClient = new QueryClient();

export function WalletProvider({
  children,
  initialState,
  projectId,
  devNetwork,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string;
  devNetwork: boolean;
}) {
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: devNetwork ? [devChain] : [mainnet],
      projectId,
      ssr: true,
      storage: createStorage({
        storage: cookieStorage,
      }),
    });
  }, [projectId, devNetwork]);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <WalletAuthProvider>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: "#1755F4",
              borderRadius: "large",
            })}
            avatar={Avatar}
          >
            {children}
          </RainbowKitProvider>
        </WalletAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
