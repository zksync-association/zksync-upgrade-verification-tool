import zksync from "@/images/zksync-logo-dark.svg";

export default function Logo({ className }: { className?: string }) {
  return <img className={className} src={zksync} alt="ZKsync" width={130} height={32} />;
}
