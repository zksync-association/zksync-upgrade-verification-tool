import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type State, WagmiProvider, cookieStorage, createStorage } from "wagmi";
import { mainnet } from "wagmi/chains";

export const web3ModalConfig = (projectId: string) =>
  getDefaultConfig({
    appName: "zkSync Upgrade Verification Tool",
    chains: [mainnet],
    projectId,
    ssr: true,
    storage: createStorage({
      storage: cookieStorage,
    }),
  });

const queryClient = new QueryClient();

export function WalletProvider({
  children,
  initialState,
  projectId,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string;
}) {
  return (
    <WagmiProvider config={web3ModalConfig(projectId)} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
