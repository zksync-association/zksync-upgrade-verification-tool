import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContractFieldChange } from "validate-cli/src/lib";

export default function FieldChangesTable({
  className,
  data,
}: { className?: string; data: ContractFieldChange[] }) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="text-base hover:bg-transparent">
          <TableHead>Field name</TableHead>
          <TableHead className="px-0">Values</TableHead>
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
              <TableCell className="px-0">Current: {diff.current}</TableCell>
            </TableRow>
            {/* biome-ignore lint/suspicious/noArrayIndexKey: <explanation> */}
            <TableRow key={`b${i}`} className="hover:bg-transparent">
              <TableCell className="px-0">Proposed: {diff.proposed ?? "No changes."}</TableCell>
            </TableRow>
          </>
        ))}
      </TableBody>
    </Table>
  );
}
