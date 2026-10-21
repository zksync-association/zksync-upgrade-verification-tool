import { useStatusIfRead } from "@/components/governance-context";
import Avatar from "@/components/connect-button/avatar";
import { Button } from "@/components/ui/button";
import type { SignerGroup } from "@/common/typed-data";
import { shortHex } from "@/utils/format";
import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";
import { toast } from "react-hot-toast";
import { type Address, isAddressEqual } from "viem";
import { useAccount, useConfig, useConnect, useSwitchChain } from "wagmi";

const GROUP_LABEL: Record<SignerGroup, string> = {
  securityCouncil: "Security Council",
  guardians: "Guardian",
  zkFoundation: "ZKsync Foundation",
};

// Which signer groups the connected account is a member Safe of (from the root loader). Never waits
// for the root status: until it is read (or when it could not be), `known` is false.
export function useConnectedGroups(): {
  address: Address | undefined;
  groups: SignerGroup[];
  known: boolean;
} {
  const { address } = useAccount();
  const status = useStatusIfRead();
  if (!status) return { address, groups: [], known: false };
  const { governance } = status;
  if (!address) return { address, groups: [], known: true };
  const groups: SignerGroup[] = [];
  if (governance.securityCouncil.members.some((m) => isAddressEqual(m as Address, address)))
    groups.push("securityCouncil");
  if (governance.guardians.members.some((m) => isAddressEqual(m as Address, address)))
    groups.push("guardians");
  if (isAddressEqual(governance.emergencyUpgradeBoard.zkFoundation as Address, address))
    groups.push("zkFoundation");
  return { address, groups, known: true };
}

/** Prefer the discovered MetaMask provider; retain WalletConnect for member Safes. */
export function useConnectWallet() {
  const { connectors, connect, isPending } = useConnect({
    mutation: {
      onError: (error) => {
        if (error.name !== "UserRejectedRequestError")
          toast.error(error.message.split("\n")[0] ?? "Could not connect", { id: "connect" });
      },
    },
  });
  const metamask =
    connectors.find((c) => c.id === "io.metamask") ?? connectors.find((c) => c.id === "metaMask");
  const walletConnect = connectors.find((c) => c.id === "walletConnect");
  const connector = metamask ?? walletConnect;
  return {
    connect: connector ? () => connect({ connector }) : undefined,
    connectMetaMask: metamask ? () => connect({ connector: metamask }) : undefined,
    connectWalletConnect: walletConnect ? () => connect({ connector: walletConnect }) : undefined,
    isPending,
  };
}

/**
 * Asks the connected wallet to move to this page's chain. Refused or impossible (a wallet whose
 * session lacks the chain and cannot add it), it says what to do instead.
 */
function useSwitchToPageChain() {
  const [chain] = useConfig().chains;
  const { switchChain, isPending } = useSwitchChain({
    mutation: {
      // Asked for by a click: said whether refused or impossible (wagmi reports both as a rejection).
      onError: () => {
        toast.error(
          `Your wallet did not switch to ${chain.name}.${chain.testnet ? " If it hides test networks, turn them on in its settings, then disconnect" : " Disconnect"} here and connect again.`,
          { id: "switch-chain", duration: 10_000 }
        );
      },
    },
  });
  return { name: chain.name, switch: () => switchChain({ chainId: chain.id }), isPending };
}

/** The connected account, or a button to connect one (always shown; checking never needs it). */
export default function ConnectButton() {
  const { groups } = useConnectedGroups();
  const wallet = useConnectWallet();
  const toChain = useSwitchToPageChain();
  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openAccountModal, mounted }) => {
        if (!mounted) return <div className="h-10 w-[104px]" aria-hidden />;
        if (!account || !chain) {
          return (
            <div className="flex gap-2">
              <Button
                variant="default"
                className="px-3.5"
                onClick={wallet.connectMetaMask}
                disabled={!wallet.connectMetaMask}
                loading={wallet.isPending}
                data-testid="connect-wallet"
                title="Connect MetaMask in your desktop browser. Serve single-file builds on localhost."
              >
                Connect MetaMask
              </Button>
              {wallet.connectWalletConnect && (
                <Button
                  variant="outline"
                  onClick={wallet.connectWalletConnect}
                  loading={wallet.isPending}
                >
                  WalletConnect
                </Button>
              )}
            </div>
          );
        }
        if (chain.unsupported) {
          return (
            <Button
              variant="destructive"
              onClick={toChain.switch}
              loading={toChain.isPending}
              title={`Your wallet is on another network. This page is for ${toChain.name}.`}
              data-testid="switch-chain"
            >
              Switch to {toChain.name}
            </Button>
          );
        }
        return (
          <Button
            variant="outline"
            onClick={openAccountModal}
            className="pr-3 pl-2"
            title={account.address}
            data-testid="connected-account"
          >
            <Avatar
              address={account.address}
              ensImage={account.ensAvatar}
              size={22}
              className="text-slate-600"
            />
            {/* The full address where the header has room for it (its two-line layout, lg); in the
                one-line bar (xl) and on a phone, short, the full one in the tooltip. */}
            <span className="mono lg:hidden">{shortHex(account.address)}</span>
            <span className="hidden flex-col items-start leading-tight lg:flex">
              <span className="mono text-[13px]">
                <span className="xl:hidden">{account.address}</span>
                <span className="hidden xl:inline">{shortHex(account.address)}</span>
              </span>
              <span className="font-normal text-[11px] text-slate-600">
                {groups.length > 0 ? groups.map((g) => GROUP_LABEL[g]).join(" · ") : "not a member"}
              </span>
            </span>
            <ChevronDown className="text-slate-600" />
          </Button>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}

export { GROUP_LABEL };
