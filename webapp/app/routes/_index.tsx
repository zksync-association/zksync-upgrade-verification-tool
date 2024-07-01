import type { MetaFunction } from "@remix-run/node";
import zksync from "@/images/zksync.svg";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export function loader() {
  throw new Error("AAAAAAAAAAA");
}

export default function Index() {
  return (
    <main>
      <img src={zksync} alt="zkSync" className="w-64 h-64 mx-auto" />
    </main>
  );
}
