import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2Icon } from "@radix-ui/react-icons";
import { useActionData, useNavigation, useRevalidator } from "@remix-run/react";
import { add } from "date-fns";
import { useState } from "react";
import type { action } from "./_route";
import type { FreezeProposalsType } from "@/common/freeze-proposal-type";
import { Form, FormInput, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PlusIcon } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export function CreateFreezeProposalModal({
  type,
  testNamespace,
}: {
  type: FreezeProposalsType | null;
  testNamespace: string;
}) {
  const actionResult = useActionData<typeof action>();
  const [date, setDate] = useState<Date>(add(new Date(), { days: 7 }));
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  let title: string;
  switch (type) {
    case "SOFT_FREEZE":
      title = "Create Soft Freeze Proposal";
      break;
    case "HARD_FREEZE":
      title = "Create Hard Freeze Proposal";
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      title = "Create Set Soft Freeze Threshold Proposal";
      break;
    case "UNFREEZE":
      title = "Create Unfreeze Proposal";
      break;
    default:
      title = "";
      break;
  }

  const handleOpenChange = () => {
    if (actionResult !== null && actionResult !== undefined) {
      revalidator.revalidate();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" data-testid={`${testNamespace}-create-btn`}>
          <PlusIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="mb-4 flex w-full items-center justify-between">
            {title}
          </DialogTitle>
          <DialogDescription>
            <VisuallyHidden>{title}</VisuallyHidden>
          </DialogDescription>
        </DialogHeader>
        <Form method="POST">
          <FormItem name="validUntil" className="space-y-4">
            <FormLabel>Valid Until</FormLabel>
            <DateTimePicker
              date={date}
              setDate={setDate}
              timeFormat="12H"
              dayPicker={{
                disabled: { before: new Date() },
              }}
            />
            <FormInput type="hidden" value={date?.toISOString()} />
            {actionResult?.error_type === "form_error" && actionResult.errors.validUntil && (
              <p className="text-red-500 text-sm">{actionResult.errors.validUntil}</p>
            )}
          </FormItem>
          {type === "SET_SOFT_FREEZE_THRESHOLD" && (
            <FormItem name="threshold">
              <FormLabel>Threshold</FormLabel>
              <FormInput type="number" min={1} max={9} />
              {actionResult?.error_type === "form_error" && actionResult.errors.threshold && (
                <FormMessage>{actionResult.errors.threshold}</FormMessage>
              )}
            </FormItem>
          )}

          {actionResult?.error_type === "general_error" && (
            <p className="text-red-500 text-sm">{actionResult.error}</p>
          )}

          <Input name="type" type="hidden" value={type ?? undefined} />

          <div className="mt-4 flex">
            <div className="flex-1" />
            <Button type="submit" loading={navigation.state === "submitting"} className="w-36">
              <Share2Icon className="mr-2 h-4 w-4" /> Create
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
