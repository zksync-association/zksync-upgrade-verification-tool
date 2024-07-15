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
} from "@/routes/app/proposals.$id/common-tables";
import { cn } from "@/utils/cn";
import type { ContractFieldChange } from "validate-cli";

export default function FieldChangesTable({
  className,
  data,
}: { className?: string; data: ContractFieldChange[] }) {
  return (
    <Table className={cn("w-full table-fixed", className)}>
      <colgroup>
        <col style={{ width: "40%" }} />
        <col style={{ width: "60%" }} />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="px-0">Values</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((diff) => {
          const value = displayValue(diff);
          const current = value.current;
          const proposed = value.proposed;

          return (
            <>
              <TableRow key={diff.name}>
                <TableCell className="break-words pr-4" rowSpan={2}>
                  {diff.name}
                </TableCell>
                <TableCell className="px-0">Current: {current}</TableCell>
              </TableRow>
              <TableRow key={diff.proposed}>
                <TableCell className="px-0">Proposed: {proposed}</TableCell>
              </TableRow>
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}

function displayValue(value: ContractFieldChange) {
  switch (value.type) {
    case "address":
      return {
        current: value.current === null ? displayEmpty() : displayAddress(value.current),
        proposed: value.proposed === null ? displayEmpty() : displayAddress(value.proposed),
      };
    case "bytes32":
      return {
        current: value.current === null ? displayEmpty() : displayBytes32(value.current),
        proposed: value.proposed === null ? displayEmpty() : displayBytes32(value.proposed),
      };
    case "number":
      return {
        current: value.current === null ? displayEmpty() : value.current,
        proposed: value.proposed === null ? displayEmpty() : value.proposed,
      };
  }
}
