import type { EthNetwork } from "@/common/eth-network-enum";
import Avatar from "@/components/connect-button/avatar";
import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { cookieStorage, createStorage, type State, WagmiProvider } from "wagmi";
import { localhost, mainnet, sepolia } from "wagmi/chains";

const queryClient = new QueryClient();

const Networks = {
  mainnet: () => mainnet,
  sepolia: () => sepolia,
  local: (port: number) => ({
    ...localhost,
    id: 11155111,
    rpcUrls: {
      default: { http: [`http://127.0.0.1:${port}`] },
    },
  }),
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
  network: EthNetwork;
  chainPort: number;
}) {
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: [Networks[networkName](chainPort)],
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
