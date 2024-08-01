import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { action } from "@/routes/app/emergency/_route";
import { EMERGENCY_BOARD, calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronDownIcon,
  Cross2Icon,
  MagnifyingGlassIcon,
  ResetIcon,
  Share2Icon,
} from "@radix-ui/react-icons";
import { useFetcher } from "@remix-run/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type Hash, isAddress, padHex, parseEther } from "viem";
import { z } from "zod";
import { StepIndicator } from "./step-indicator";

export const emergencyPropSchema = z.object({
  title: z.string().min(1, "Title is required"),
  targetAddress: z.string().refine((value) => isAddress(value), {
    message: "Invalid Ethereum address",
  }),
  calldata: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Calldata must be a hex string starting with 0x")
    .refine((value) => value.length % 2 === 0, {
      message: "Calldata must be valid hex-encoded bytes",
    }),
  salt: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Salt must be a hex string starting with 0x")
    .refine((value) => value.length === 66, {
      message: "Salt must be a 32-byte hex string (64 characters)",
    })
    .default(padHex("0x0")),
  value: z
    .string()
    .regex(/^\d*\.?\d*$/, "Value must be a positive number")
    .refine((value) => Number.parseFloat(value) >= 0, {
      message: "Value must be a positive number",
    }),
  proposer: z
    .string()
    .refine((value) => isAddress(value), {
      message: "Invalid proposer address",
    })
    .optional(),
});

export type EmergencyProp = z.infer<typeof emergencyPropSchema>;

export function CreateEmergencyProposalModal({
  isOpen,
  errors,
  status,
  onClose,
  proposerAddress,
}: {
  isOpen: boolean;
  onClose: () => void;
  errors: object;
  status?: string;
  proposerAddress?: `0x${string}`;
}) {
  const [step, setStep] = useState(1);
  const [extId, setExtId] = useState("");
  const fetcher = useFetcher<typeof action>();

  const defaultFormValues = {
    title: "",
    targetAddress: "0x" as Hash,
    calldata: "0x",
    value: "0",
    salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  const form = useForm<EmergencyProp>({
    resolver: zodResolver(emergencyPropSchema),
    defaultValues: defaultFormValues,
  });

  const handleCreate = (data: EmergencyProp) => {
    if (form.formState.isValid) {
      fetcher.submit({ ...data, proposer: proposerAddress ?? "" }, { method: "post" });
      onClose();
      setStep(1);
      form.reset(defaultFormValues);
    }
  };

  const handleVerify = async () => {
    if (form.formState.isValid) {
      setStep(2);
      const derivedExternalId = calculateUpgradeProposalHash(
        [
          {
            value: parseEther(form.getValues("value")),
            data: form.getValues("calldata") as Hash,
            target: form.getValues("targetAddress"),
          },
        ],
        form.getValues("salt") as Hash,
        EMERGENCY_BOARD
      );
      setExtId(derivedExternalId);
    } else {
      await form.trigger();
    }
  };

  const handleClose = () => {
    onClose();
    setStep(1);
    form.reset(defaultFormValues);
  };

  const handleBack = () => {
    setStep(1);
    form.clearErrors();
    form.reset(form.getValues());
  };

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className={step === 2 ? "sm:max-w-[66vw]" : "sm:max-w-[425px]"}>
        <AlertDialogHeader className="flex flex-row items-center justify-between">
          <AlertDialogTitle className="mb-4 flex w-full items-center justify-between">
            <StepIndicator currentStep={step} totalSteps={2} />
            {step === 1 && (
              <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8 p-0">
                <Cross2Icon className="h-4 w-4" />
              </Button>
            )}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleCreate)}>
            {step === 1 ? (
              <>
                <h3 className="mb-4 font-semibold text-lg">Define Emergency Proposal</h3>
                <div className="grid gap-4 py-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="..." {...field} />
                        </FormControl>
                        <FormDescription>
                          This is to help voters identify which proposal this is.
                        </FormDescription>
                        <FormMessage data-testid="title-error" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="targetAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target address</FormLabel>
                        <FormControl>
                          <Input placeholder="0x..." {...field} />
                        </FormControl>
                        <FormDescription>
                          The address to which the call will be made.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="calldata"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Calldata</FormLabel>
                        <FormControl>
                          <Textarea placeholder="0x..." {...field} />
                        </FormControl>
                        <FormDescription>
                          The calldata to be executed on the `target` address.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-2 text-sm hover:bg-muted">
                      <span>Value (optional)</span>
                      <ChevronDownIcon className="h-4 w-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <FormField
                        control={form.control}
                        name="value"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder="0"
                                  {...field}
                                  className="pr-12"
                                  data-testid="value-input"
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
                                  ETH
                                </span>
                              </div>
                            </FormControl>
                            <FormDescription>
                              The amount of Ether to be sent along with the call.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                  <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-2 text-sm hover:bg-muted">
                      <span>Salt (optional)</span>
                      <ChevronDownIcon className="h-4 w-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <FormField
                        control={form.control}
                        name="salt"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="0x..." {...field} />
                            </FormControl>
                            <FormDescription>
                              A bytes32 value used for creating unique upgrade proposal hashes.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                <AlertDialogFooter>
                  <Button type="button" onClick={handleVerify} data-testid="verify-button">
                    <MagnifyingGlassIcon className="mr-2 h-4 w-4" />
                    Verify
                  </Button>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <div className="py-4">
                  <h3 className="mb-4 font-semibold text-lg">Emergency Proposal Details</h3>
                  <div className="space-y-4">
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">Title</p>
                      <p className="text-sm">{form.getValues("title")}</p>
                    </div>
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">
                        Target Address
                      </p>
                      <p className="break-all text-sm">{form.getValues("targetAddress")}</p>
                    </div>
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">Calldata</p>
                      <ScrollArea className="h-24">
                        <p className="break-all text-sm">{form.getValues("calldata")}</p>
                      </ScrollArea>
                    </div>
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">
                        External ID (derived)
                      </p>
                      <p className="break-all text-sm">{extId}</p>
                    </div>
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">Salt</p>
                      <p className="break-all text-sm">{form.getValues("salt")}</p>
                    </div>
                    <div className="rounded-md bg-muted p-4">
                      <p className="mb-1 font-medium text-muted-foreground text-sm">Value</p>
                      <span className="text-sm">
                        {form.getValues("value")}{" "}
                        <Badge variant="outline" className="font-semibold text-xs">
                          ETH
                        </Badge>
                      </span>
                    </div>
                  </div>
                </div>
                <AlertDialogFooter>
                  <Button type="button" variant="outline" onClick={handleBack}>
                    <ResetIcon className="mr-2 h-4 w-4" />
                    Back
                  </Button>

                  <Button type="submit">
                    <Share2Icon className="mr-2 h-4 w-4" /> Create
                  </Button>
                </AlertDialogFooter>
              </>
            )}
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
