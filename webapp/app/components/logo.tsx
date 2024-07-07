import zksync from "@/images/zksync.svg";

export default function Logo({ className }: { className?: string }) {
  return <img className={className} src={zksync} alt="Zksync Logo" />;
}
