import type { EthNetwork } from "@/common/eth-network-enum";
import Avatar from "@/components/connect-button/avatar";
import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { cookieStorage, createStorage, type State, WagmiProvider } from "wagmi";
import { localhost, mainnet, sepolia } from "wagmi/chains";

const queryClient = new QueryClient();

const Networks = {
  mainnet: (rpcUrl: string) => ({
    ...mainnet,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    }
  }),
  sepolia: (rpcUrl: string) => ({
    ...sepolia,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    }
  }),
  local: (rpcUrl: string) => ({
    ...localhost,
    id: 11155111,
    rpcUrls: {
      default: {
        http: [
          rpcUrl
        ]
      },
    },
  }),
};

export function WalletProvider({
  children,
  initialState,
  projectId,
  rpcUrl,
  network: networkName,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string;
  network: EthNetwork;
  rpcUrl: string;
}) {
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: [Networks[networkName](rpcUrl)],
      projectId,
      ssr: true,
      storage: createStorage({
        storage: cookieStorage,
      }),
    });
  }, [projectId, networkName, rpcUrl]);

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
