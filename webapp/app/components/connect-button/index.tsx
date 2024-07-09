import Avatar from "@/components/connect-button/avatar";
import { Button } from "@/components/ui/button";
import Loading from "@/components/ui/loading";
import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";

export default function ConnectButton({ loading }: { loading?: boolean }) {
  return (
    <RainbowConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain && authenticationStatus === "authenticated";

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              className: "opacity-0 pointer-events-none user-select-none",
            })}
          >
            {(() => {
              if (!connected) {
                return <Button onClick={openConnectModal}>Connect Wallet</Button>;
              }
              if (chain.unsupported) {
                return <Button onClick={openChainModal}>Wrong network</Button>;
              }
              if (loading) {
                return (
                  <Button disabled>
                    <Loading className="mr-2 h-5 w-5" />
                    Loading...
                  </Button>
                );
              }
              return (
                <Button onClick={openAccountModal} type="button" className="px-5 font-bold">
                  <Avatar
                    className="mr-2"
                    address={account.address}
                    ensImage={account.ensAvatar}
                    size={24}
                  />
                  {account.displayName}
                  <ChevronDown className="ml-2" />
                </Button>
              );
            })()}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}
