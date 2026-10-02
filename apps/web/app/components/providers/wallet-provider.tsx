import Avatar from "@/components/connect-button/avatar";
import {
  RainbowKitProvider,
  type Wallet,
  connectorsForWallets,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { injectedWallet, safeWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type Chain, custom, defineChain } from "viem";
import {
  type State,
  WagmiProvider,
  cookieStorage,
  createConfig,
  createConnector,
  createStorage,
  useAccount,
  useConnect,
} from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { safe } from "wagmi/connectors";

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

/** True inside an iframe, e.g. when Safe{Wallet} opens the app as a Safe App. */
export const isFramed = () => typeof window !== "undefined" && window.parent !== window;

const exactOrigin = (origin: string) =>
  new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

// RainbowKit's Safe entry (shown only inside Safe{Wallet}), except that the Safe Apps SDK accepts
// messages only from the configured Safe{Wallet} origins.
function safeAppWallet(origins: string[]) {
  return (): Wallet => ({
    ...safeWallet(),
    createConnector: (details) =>
      createConnector((config) => ({
        ...safe({ allowedDomains: origins.map(exactOrigin), unstable_getInfoTimeout: 1000 })(
          config
        ),
        ...details,
      })),
  });
}

// Inside Safe{Wallet}, connect to the open Safe straight away, even if another wallet was used
// on this origin before.
function ConnectSafeApp() {
  const { connector, status } = useAccount();
  const { connectors, connect } = useConnect();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !isFramed() || status === "connecting" || status === "reconnecting")
      return;
    const safeConnector = connectors.find((c) => c.id === "safe");
    if (!safeConnector || connector?.id === "safe") return;
    tried.current = true;
    connect({ connector: safeConnector });
  }, [connector, connectors, connect, status]);
  return null;
}

// A wallet is only needed to sign as a member Safe or to send a transaction. Members sign by
// opening the app inside Safe{Wallet} (a Safe App), or over WalletConnect when a project id is
// set. Any browser wallet can send a transaction.
export function WalletProvider({
  children,
  initialState,
  projectId,
  safeWalletOrigins,
  chainId,
  chainLabel,
}: {
  children: ReactNode;
  initialState?: State;
  projectId: string | null;
  safeWalletOrigins: string[];
  chainId: number;
  chainLabel: string;
}) {
  const origins = safeWalletOrigins.join(",");
  const config = useMemo(() => {
    const chain = chainFor(chainId, chainLabel);
    const memberSafe = [
      safeAppWallet(origins.split(",").filter(Boolean)),
      ...(projectId ? [walletConnectWallet] : []),
    ];
    return createConfig({
      chains: [chain] as [Chain],
      transports: { [chain.id]: noBrowserRpc },
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
      connectors: connectorsForWallets(
        [
          { groupName: "Member Safe", wallets: memberSafe },
          { groupName: "Browser wallet", wallets: [injectedWallet] },
        ],
        { appName: "ZKsync Governance", projectId: projectId ?? "" }
      ),
    });
  }, [projectId, origins, chainId, chainLabel]);

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#0C18EC", borderRadius: "large", fontStack: "system" })}
          avatar={Avatar}
          modalSize="compact"
        >
          <ConnectSafeApp />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
