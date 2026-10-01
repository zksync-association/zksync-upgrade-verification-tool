import { useStatus } from "@/components/app-shell";
import Avatar from "@/components/connect-button/avatar";
import { Button } from "@/components/ui/button";
import type { SignerGroup } from "@/common/typed-data";
import { shortHex } from "@/utils/format";
import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";
import { type Address, isAddressEqual } from "viem";
import { useAccount } from "wagmi";

const GROUP_LABEL: Record<SignerGroup, string> = {
  securityCouncil: "Security Council",
  guardians: "Guardian",
  zkFoundation: "ZKsync Foundation",
};

/** Which signer groups the connected account is a member Safe of (read from chain via the root loader). */
export function useConnectedGroups(): { address: Address | undefined; groups: SignerGroup[] } {
  const { address } = useAccount();
  const { governance } = useStatus();
  if (!address) return { address, groups: [] };
  const groups: SignerGroup[] = [];
  if (governance.securityCouncil.members.some((m) => isAddressEqual(m as Address, address)))
    groups.push("securityCouncil");
  if (governance.guardians.members.some((m) => isAddressEqual(m as Address, address)))
    groups.push("guardians");
  if (isAddressEqual(governance.emergencyUpgradeBoard.zkFoundation as Address, address))
    groups.push("zkFoundation");
  return { address, groups };
}

export default function ConnectButton() {
  const { groups } = useConnectedGroups();
  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return <div className="h-10 w-[104px]" aria-hidden />;
        if (!account || !chain) {
          return (
            <Button variant="secondary" onClick={openConnectModal} data-testid="connect-wallet">
              Connect
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
              className="text-slate-500"
            />
            <span className="mono">{shortHex(account.address)}</span>
            <span className="hidden font-normal text-slate-600 text-xs lg:inline">
              {groups.length > 0 ? groups.map((g) => GROUP_LABEL[g]).join(" · ") : "not a member"}
            </span>
            <ChevronDown className="text-slate-500" />
          </Button>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}

export { GROUP_LABEL };
