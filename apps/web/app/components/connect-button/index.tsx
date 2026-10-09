import { useStatusIfRead } from "@/components/governance-context";
import Avatar from "@/components/connect-button/avatar";
import { Button } from "@/components/ui/button";
import type { SignerGroup } from "@/common/typed-data";
import { shortHex } from "@/utils/format";
import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";
import { type Dispatch, type SetStateAction, createContext, useContext, useEffect } from "react";
import { type Address, isAddressEqual } from "viem";
import { useAccount } from "wagmi";

const GROUP_LABEL: Record<SignerGroup, string> = {
  securityCouncil: "Security Council",
  guardians: "Guardian",
  zkFoundation: "ZKsync Foundation",
};

/**
 * Which signer groups the connected account is a member Safe of (read from chain via the root
 * loader). Never waits for the root status: until it is read (or when it could not be), `known` is
 * false and `groups` is empty.
 */
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

export const WalletOfferContext = createContext<Dispatch<SetStateAction<number>> | null>(null);

/** Call from a component that needs a wallet (Sign, Send): while it is shown, the header offers one. */
export function useOfferWallet() {
  const setOffers = useContext(WalletOfferContext);
  useEffect(() => {
    if (!setOffers) return;
    setOffers((n) => n + 1);
    return () => setOffers((n) => n - 1);
  }, [setOffers]);
}

/**
 * The connected account, or (while `offer` is set: something on the page can be signed or
 * executed) a button to connect one. Checking never needs a wallet.
 */
export default function ConnectButton({ offer }: { offer: boolean }) {
  const { groups } = useConnectedGroups();
  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return offer ? <div className="h-10 w-[104px]" aria-hidden /> : null;
        if (!account || !chain) {
          if (!offer) return null;
          return (
            <Button
              variant="secondary"
              onClick={openConnectModal}
              data-testid="connect-wallet"
              title="Only needed to sign as a member Safe or to send a transaction. Checking needs no wallet."
            >
              <span className="xl:hidden">Connect</span>
              <span className="hidden xl:inline">Connect to sign or execute</span>
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button variant="destructive" onClick={openChainModal}>
              Wrong network
            </Button>
          );
        }
        return (
          <Button
            variant="outline"
            onClick={openAccountModal}
            className="pr-3 pl-2"
            data-testid="connected-account"
          >
            <Avatar
              address={account.address}
              ensImage={account.ensAvatar}
              size={22}
              className="text-slate-600"
            />
            <span className="mono">{shortHex(account.address)}</span>
            <span className="hidden font-normal text-slate-600 text-xs lg:inline">
              {groups.length > 0 ? groups.map((g) => GROUP_LABEL[g]).join(" · ") : "not a member"}
            </span>
            <ChevronDown className="text-slate-600" />
          </Button>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}

export { GROUP_LABEL };
