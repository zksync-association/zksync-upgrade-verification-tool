import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FieldStorageChange } from "validate-cli";
import type { ExtractedValue } from "validate-cli/dist/lib/reports/obj-storage-visitor";

export default function FieldStorageChangesTable({
  className,
  data,
}: { className?: string; data: FieldStorageChange[] }) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Current value</TableHead>
          <TableHead>Proposed value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((diff) => (
          <TableRow key={diff.name}>
            <TableCell>{diff.name}</TableCell>
            <TableCell>{diff.description}</TableCell>
            <TableCell>{displayExtractedValue(diff.currentValue)}</TableCell>
            <TableCell>{displayExtractedValue(diff.proposedValue)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function displayExtractedValue(value: ExtractedValue): string {
  switch (value.type) {
    case "address":
      return value.value;
    case "array":
      return value.value.map(displayExtractedValue).join("\n");
    case "blob":
      return value.value;
    case "boolean":
      return value.value.toString();
    case "empty":
      return "-";
    case "mapping":
      return value.entries
        .map((value) => `${value.key}: ${displayExtractedValue(value.value)}`)
        .join("\n");
    case "numeric":
      return value.value;
    case "struct":
      return value.fields
        .map((field) => `${field.key}: ${displayExtractedValue(field.value)}`)
        .join("\n");
  }
}
