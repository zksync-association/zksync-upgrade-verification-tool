import type { Step1 } from "@/routes/app/emergency/new/step1";

export function DisplayStep1({title, salt}: Step1) {
  return (
    <div className="rounded-md bg-muted p-4 mb-8">
      <p className="mb-1">
        <span className="font-medium text-muted-foreground text-sm">Title:</span> <span>{title}</span>
      </p>
      <p className="mb-1">
        <span className="font-medium text-muted-foreground text-sm">Salt:</span> <span>{salt}</span>
      </p>
    </div>
  )
}