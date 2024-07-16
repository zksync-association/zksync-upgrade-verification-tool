import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { removeFunctionParams } from "@/routes/app/proposals/$id/common-tables";
import { cn } from "@/utils/cn";
import type { FacetDataReportDiff } from "validate-cli";

export default function FacetChangesTable({ data }: { data: FacetDataReportDiff[] }) {
  return (
    <div className="flex flex-col space-y-2">
      {data.map((diff, i) => (
        <div key={diff.name}>
          <div className="space-y-6">
            <h3 className="font-semibold text-muted-foreground">{diff.name}</h3>
            <div>
              <h4 className="mb-1 text-sm">OLD ADDRESS</h4>
              <p className="text-xl">{diff.oldAddress}</p>
            </div>

            <div>
              <h4 className="mb-1 text-sm">NEW ADDRESS</h4>
              <p className="text-xl">{diff.newAddress}</p>
            </div>

            <Accordion className="" type="multiple">
              <AccordionItem value="item-1">
                <AccordionTrigger
                  className={cn(
                    "py-0 font-normal text-sm",
                    diff.removedFunctions.length === 0 && "opacity-50 hover:no-underline"
                  )}
                  disabled={diff.removedFunctions.length === 0}
                >
                  REMOVED FUNCTIONS
                </AccordionTrigger>
                <AccordionContent>
                  {diff.removedFunctions.map((fn) => (
                    <div key={fn} className="mt-4 rounded-2xl border p-4">
                      {removeFunctionParams(fn)}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger
                  className={cn(
                    "py-0 pt-8 font-normal text-sm",
                    diff.addedFunctions.length === 0 && "opacity-50 hover:no-underline"
                  )}
                  disabled={diff.addedFunctions.length === 0}
                >
                  ADDED FUNCTIONS
                </AccordionTrigger>
                <AccordionContent>
                  {diff.addedFunctions.map((fn) => (
                    <div key={fn} className="mt-4 rounded-2xl border p-4">
                      {removeFunctionParams(fn)}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {i !== data.length - 1 && <Separator className="my-10 bg-gray-500" />}
        </div>
      ))}
    </div>
  );
}
