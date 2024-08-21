import { getActiveL2Proposals } from "@/.server/service/l2-governor-proposals";
import { useLoaderData } from "@remix-run/react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export async function loader() {
  return getActiveL2Proposals()
}

export default function NewL2GovernorVeto() {
  const data = useLoaderData()

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead >ID</TableHead>
            <TableHead >Description</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(row => (

          ))}
          <TableRow>
            <TableCell>
              data[0]
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <pre>{JSON.stringify(data, null, 2)} </pre>
      <Button>Create</Button>
    </div>
  )
};