import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  displayAddress,
  displayBytes32,
  displayEmpty,
} from "@/routes/app/proposals/$id/common-tables";
import type { SystemContractUpgrade } from "validate-cli";

export default function SystemContractChangesTable({
  className,
  data,
}: { className?: string; data: SystemContractUpgrade[] }) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>System Contract</TableHead>
          <TableHead className="px-0">Address</TableHead>
          <TableHead className="px-0">Bytecode hash</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((diff) => {
          const address = displayAddress(diff.address);
          const current = diff.currentBytecodeHash
            ? displayBytes32(diff.currentBytecodeHash)
            : displayEmpty();
          const proposed = diff.proposedBytecodeHash
            ? displayBytes32(diff.proposedBytecodeHash)
            : displayEmpty();

          return (
            <>
              <TableRow key={diff.name}>
                <TableCell className="pr-4" rowSpan={2}>
                  {diff.name}
                </TableCell>
                <TableCell className="px-0" rowSpan={2}>
                  {address}
                </TableCell>
                <TableCell className="px-0">Current: {current}</TableCell>
              </TableRow>
              <TableRow key={proposed}>
                <TableCell className="px-0">Proposed: {proposed}</TableCell>
              </TableRow>
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}
