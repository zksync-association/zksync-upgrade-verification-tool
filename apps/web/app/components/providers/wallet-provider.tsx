import Avatar from "@/components/connect-button/avatar";
import {
  type DisclaimerComponent,
  RainbowKitProvider,
  connectorsForWallets,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { type Chain, custom, defineChain } from "viem";
import { type State, WagmiProvider, cookieStorage, createConfig, createStorage } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const queryClient = new QueryClient();
const walletTheme = lightTheme({
  accentColor: "hsl(var(--primary))",
  accentColorForeground: "hsl(var(--primary-foreground))",
  borderRadius: "large",
  fontStack: "system",
});
// RainbowKit defaults dim text with alpha; keep wallet dialogs as readable as the app.
Object.assign(walletTheme.colors, {
  modalBackground: "hsl(var(--popover))",
  modalText: "hsl(var(--popover-foreground))",
  modalTextDim: "hsl(var(--muted-foreground))",
  modalTextSecondary: "hsl(var(--muted-foreground))",
  closeButton: "hsl(var(--muted-foreground))",
  connectButtonText: "hsl(var(--foreground))",
  error: "hsl(var(--destructive))",
});

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

/** True inside an iframe, e.g. when Safe{Wallet} opens the app as a Safe App. */
export const isFramed = () => typeof window !== "undefined" && window.parent !== window;

// A wallet is only needed to sign as a member Safe or to send a transaction, and is reached only
// over WalletConnect (a project id in Settings): members connect their Safe from Safe{Wallet}, and
// anyone can connect a wallet app to send. Browser extensions cannot connect to the single-file
// build (they talk to the page through window.postMessage, which browsers drop on file:// pages), so
// installed ones are not discovered either: listed, they would hang at "Confirm in the extension".
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
    return createConfig({
      chains: [chain] as [Chain],
      transports: { [chain.id]: noBrowserRpc },
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
      multiInjectedProviderDiscovery: false,
      // RainbowKit refuses an empty wallet list: without a project id there is no wallet.
      connectors: projectId
        ? connectorsForWallets([{ groupName: "WalletConnect", wallets: [walletConnectWallet] }], {
            appName: "ZKsync Governance",
            projectId,
          })
        : [],
    });
  }, [projectId, chainId, chainLabel]);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={walletTheme}
          avatar={Avatar}
          modalSize="compact"
          appInfo={{ appName: "ZKsync Governance", disclaimer: WalletNote }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

const WalletNote: DisclaimerComponent = ({ Text }) => (
  <Text>
    Wallets connect over WalletConnect: your Safe from Safe{"{"}Wallet{"}"}, or a wallet app such as
    Rabby Mobile. Browser extensions (Rabby, MetaMask) cannot connect to a page opened from a file.
  </Text>
);
