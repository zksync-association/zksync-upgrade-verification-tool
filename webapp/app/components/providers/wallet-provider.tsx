import Avatar from "@/components/connect-button/avatar";
import WalletAuthProvider from "@/components/providers/wallet-auth-provider";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { type State, WagmiProvider, cookieStorage, createStorage } from "wagmi";
import { mainnet } from "wagmi/chains";

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
  const config = useMemo(() => {
    return getDefaultConfig({
      appName: "zkSync Upgrade Verification Tool",
      chains: [mainnet],
      projectId,
      ssr: true,
      storage: createStorage({
        storage: cookieStorage,
      }),
    });
  }, [projectId]);

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
