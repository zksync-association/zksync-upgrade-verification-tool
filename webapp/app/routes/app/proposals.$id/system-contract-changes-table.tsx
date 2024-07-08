import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayAddress, displayBytecodeHash } from "@/routes/app/proposals.$id/common-tables";
import type { SystemContractUpgrade } from "validate-cli/src/lib";

export default function SystemContractChangesTable({
  className,
  data,
}: { className?: string; data: SystemContractUpgrade[] }) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="text-base hover:bg-transparent">
          <TableHead>System Contract</TableHead>
          <TableHead className="px-0">Address</TableHead>
          <TableHead className="px-0">Bytecode hash</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((diff, i) => (
          <>
            {/* biome-ignore lint/suspicious/noArrayIndexKey: <explanation> */}
            <TableRow key={`a${i}`} className="hover:bg-transparent">
              <TableCell className="pr-4" rowSpan={2}>
                {diff.name}
              </TableCell>
              <TableCell className="px-0" rowSpan={2}>
                {displayAddress(diff.address)}
              </TableCell>
              <TableCell className="px-0">
                Current: {displayBytecodeHash(diff.currentBytecodeHash ?? "")}
              </TableCell>
            </TableRow>
            {/* biome-ignore lint/suspicious/noArrayIndexKey: <explanation> */}
            <TableRow key={`b${i}`} className="hover:bg-transparent">
              <TableCell className="px-0">
                Proposed: {displayBytecodeHash(diff.proposedBytecodeHash ?? "")}
              </TableCell>
            </TableRow>
          </>
        ))}
      </TableBody>
    </Table>
  );
}
