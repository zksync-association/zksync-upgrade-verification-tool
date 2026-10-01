import Avatar from "@/components/connect-button/avatar";
import {
  RainbowKitProvider,
  connectorsForWallets,
  getDefaultConfig,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { type Chain, custom, defineChain } from "viem";
import { type State, WagmiProvider, cookieStorage, createConfig, createStorage } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const queryClient = new QueryClient();

// The browser never talks to an RPC of its own: chain reads happen on the server through the
// user's RPC, and signing/sending go through the connected wallet. Without this, wagmi would send
// lookups for the connected account (e.g. ENS) to a public third-party RPC.
const noBrowserRpc = custom({
  request: async ({ method }) => {
    throw new Error(`${method}: this app reads the chain on its server, not from the browser`);
  },
});

function chainFor(chainId: number, label: string): Chain {
  if (chainId === mainnet.id) return mainnet;
  if (chainId === sepolia.id) return sepolia;
  return defineChain({
    id: chainId,
    name: label,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
}

// A wallet is only needed to sign (a member Safe over WalletConnect) or to send a transaction.
// Without a WalletConnect project id, browser wallets still work for sending; signing as a Safe
// needs WalletConnect (from Safe{Wallet}).
export function WalletProvider({
  children,
  initialState,
  projectId,
  chainId,
  chainLabel,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string | null;
  chainId: number;
  chainLabel: string;
}) {
  const config = useMemo(() => {
    const chain = chainFor(chainId, chainLabel);
    const common = {
      chains: [chain] as [Chain],
      transports: { [chain.id]: noBrowserRpc },
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
    };
    if (projectId) {
      return getDefaultConfig({ appName: "ZKsync Governance", projectId, ...common });
    }
    return createConfig({
      ...common,
      connectors: connectorsForWallets(
        [{ groupName: "Browser wallet", wallets: [injectedWallet] }],
        {
          appName: "ZKsync Governance",
          projectId: "",
        }
      ),
    });
  }, [projectId, chainId, chainLabel]);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#0C18EC", borderRadius: "large", fontStack: "system" })}
          avatar={Avatar}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
