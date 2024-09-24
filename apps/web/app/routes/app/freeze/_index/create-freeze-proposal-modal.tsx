import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import { Share2Icon } from "@radix-ui/react-icons";
import { useActionData, useNavigation, useRevalidator } from "@remix-run/react";
import { add } from "date-fns";
import { useState } from "react";
import type { action } from "./_route";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FreezeProposalsTypeEnum, type FreezeProposalsType } from "@/common/freeze-proposal-type";
import { Label } from "@/components/ui/label";

export function CreateFreezeProposalModal() {
  const actionResult = useActionData<typeof action>();
  const [date, setDate] = useState<Date>(add(new Date(), { days: 7 }));
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [proposalType, setProposalType] = useState<FreezeProposalsType | undefined>(undefined);

  const handleOpenChange = () => {
    if (actionResult !== null && actionResult !== undefined) {
      revalidator.revalidate();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon">
          <PlusIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Proposal</DialogTitle>
          <DialogDescription>
            <VisuallyHidden>Create Proposal</VisuallyHidden>
          </DialogDescription>
        </DialogHeader>
        <Form method="POST">
          <Label>Proposal Type</Label>
          <Select
            name="type"
            value={proposalType}
            onValueChange={setProposalType as (value: string) => void}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Proposal Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FreezeProposalsTypeEnum.Values.SOFT_FREEZE}>
                Soft Freeze
              </SelectItem>
              <SelectItem value={FreezeProposalsTypeEnum.Values.HARD_FREEZE}>
                Hard Freeze
              </SelectItem>
              <SelectItem value={FreezeProposalsTypeEnum.Values.UNFREEZE}>Unfreeze</SelectItem>
              <SelectItem value={FreezeProposalsTypeEnum.Values.SET_SOFT_FREEZE_THRESHOLD}>
                Set Soft Freeze Threshold
              </SelectItem>
            </SelectContent>
          </Select>

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
          {proposalType === "SET_SOFT_FREEZE_THRESHOLD" && (
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

          {/* <Input name="type" type="hidden" value={type ?? undefined} /> */}

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
