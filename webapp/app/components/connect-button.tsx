import { Button } from "@/components/ui/button";
import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";

export default function ConnectButton({
  authorized,
  loading,
}: { authorized: boolean; loading?: boolean }) {
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
                return <Button disabled>Loading...</Button>;
              }
              if (!authorized) {
                return <Button disabled>Unauthorized</Button>;
              }
              return <Button onClick={openAccountModal}>Authorized</Button>;
            })()}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}
