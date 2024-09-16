import Avatar from "@/components/connect-button/avatar";
import { localchain } from "@/utils/localchain";
import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { cookieStorage, createStorage, type State, WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const queryClient = new QueryClient();

const NETWORKS = {
  mainnet: (_n: number) => mainnet,
  sepolia: (_n: number) => sepolia,
  local: localchain,
};

export function WalletProvider({
  children,
  initialState,
  projectId,
  network: networkName,
  chainPort,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string;
  network: "mainnet" | "sepolia" | "local";
  chainPort: number;
}) {
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: [NETWORKS[networkName](chainPort)],
      projectId,
      ssr: true,
      storage: createStorage({
        storage: cookieStorage,
      }),
    });
  }, [projectId, networkName, chainPort]);

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
