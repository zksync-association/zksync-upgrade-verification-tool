import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayAddress, displayBytes32, displayEmpty } from "@/utils/common-tables";
import { cn } from "@/utils/cn";
import type { ExtractedValue } from "@repo/ethereum-reports/reports/obj-storage-visitor";
import type { FieldStorageChange } from "@repo/ethereum-reports/reports/object-storage-change-report";

export default function FieldStorageChangesTable({
  className,
  data,
}: { className?: string; data: FieldStorageChange[] }) {
  return (
    <Table className={cn("table-fixed", className)}>
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
          const current = displayExtractedValue(diff.currentValue);
          const proposed = displayExtractedValue(diff.proposedValue);

          return (
            <>
              <TableRow key={diff.name}>
                <TableCell className="whitespace-pre-wrap break-words" rowSpan={2}>
                  {diff.name}
                  {"\n\n"}
                  Description: {diff.description}
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

function displayExtractedValue(value: ExtractedValue): string {
  switch (value.type) {
    case "address":
      return displayAddress(value.value);
    case "array":
      return `[${value.value.map(displayExtractedValue).join(", ")}]`;
    case "blob":
      return displayBytes32(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "empty":
      return displayEmpty();
    case "mapping":
      return `(${value.entries
        .map((value) => `${value.key} => ${displayExtractedValue(value.value)}`)
        .join(", ")})`;
    case "numeric":
      return value.value;
    case "struct":
      return `{ ${value.fields
        .map((field) => `${field.key}: ${displayExtractedValue(field.value)}`)
        .join(", ")} }`;
  }
}
