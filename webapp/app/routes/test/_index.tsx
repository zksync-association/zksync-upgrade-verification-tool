import { queryNewUpgrades } from "@/.server/service/reports";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export async function loader() {
  return json(await queryNewUpgrades());
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
