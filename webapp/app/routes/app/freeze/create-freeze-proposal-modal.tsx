import type { FreezeProposalsType } from "@/.server/db/schema";
import { DateTimePicker } from "@/components/date-time-picker";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { action } from "@/routes/app/freeze/_route";
import { Cross2Icon, Share2Icon } from "@radix-ui/react-icons";
import { Form, useActionData, useNavigation, useRevalidator } from "@remix-run/react";
import { add } from "date-fns";
import { useState } from "react";

export function CreateFreezeProposalModal({
  type,
  onClose,
}: {
  type: FreezeProposalsType | null;
  onClose: () => void;
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

  const handleClose = () => {
    if (actionResult !== null && actionResult !== undefined) {
      revalidator.revalidate();
    }
    onClose();
  };

  return (
    <AlertDialog open={type !== null}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-center justify-between">
          <AlertDialogTitle className="mb-4 flex w-full items-center justify-between">
            {title}
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8 p-0">
              <Cross2Icon className="h-4 w-4" />
            </Button>
          </AlertDialogTitle>
        </AlertDialogHeader>
        <Form method="post">
          <div className="flex flex-col space-y-6">
            <div className="flex flex-col space-y-4">
              <Label>Valid Until</Label>
              <DateTimePicker
                date={date}
                setDate={setDate}
                timeFormat="12H"
                dayPicker={{
                  disabled: { before: new Date() },
                }}
              />
              <Input name="validUntil" type="hidden" value={date?.toISOString()} />
              {actionResult?.error_type === "form_error" && actionResult.errors.validUntil && (
                <p className="text-red-500 text-sm">{actionResult.errors.validUntil}</p>
              )}
            </div>
            {type === "SET_SOFT_FREEZE_THRESHOLD" && (
              <div className="flex flex-col space-y-4">
                <Label>Threshold</Label>
                <Input name="threshold" type="number" min={1} max={9} />
                {actionResult?.error_type === "form_error" && actionResult.errors.threshold && (
                  <p className="text-red-500 text-sm">{actionResult.errors.threshold}</p>
                )}
              </div>
            )}

            {actionResult?.error_type === "general_error" && (
              <p className="text-red-500 text-sm">{actionResult.error}</p>
            )}
          </div>

          <Input name="type" type="hidden" value={type ?? undefined} />

          <div className="mt-4 flex">
            <div className="flex-1" />
            <Button type="submit" loading={navigation.state === "submitting"} className="w-36">
              <Share2Icon className="mr-2 h-4 w-4" /> Create
            </Button>
          </div>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
