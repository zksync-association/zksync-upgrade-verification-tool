import { checkReport } from "@/.server/service/reports";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export async function loader() {
  return json(await checkReport(""))
}

export default function Index() {
  const report = useLoaderData<typeof loader>()

  return <pre>
    {JSON.stringify(report, null, 2)}
  </pre>
}