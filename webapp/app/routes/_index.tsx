import { json, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  ZksyncEraState,
  ZkSyncEraDiff,
  BlockExplorerClient,
  RpcClient,
  FileSystem,
  UpgradeImporter,
  CheckReport,
  GitContractsRepo
} from "validate-cli"
import { hexToBytes } from "viem";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export async function loader() {
  return json({text: "report"})
}

export default function Index() {
  const data = useLoaderData<typeof loader>()
  return (
    <main className="font-sans p-4">
      <pre>
        {data.text}
      </pre>
    </main>
  );
}
