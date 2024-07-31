import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Form as RemixForm } from "@remix-run/react";
import { useState } from "react";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { isAddress } from "viem";

const formSchema = z.object({
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
  value: z
    .string()
    .regex(/^\d*\.?\d*$/, "Value must be a positive number")
    .refine((value) => Number.parseFloat(value) >= 0, {
      message: "Value must be a positive number",
    }),
});

export function CreateEmergencyProposalModal({
  isOpen,
  errors,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
  errors: { targetAddress?: string; status: "success" | "error" };
}) {
  const [step, setStep] = useState(1);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      targetAddress: "0x",
      calldata: "0x",
      value: "0",
    },
  });

  const handleVerify = () => {
    if (form.formState.isValid) {
      setStep(2);
    } else {
      form.trigger();
    }
  };

  const handleCreate = () => {
    if (form.formState.isValid) {
      console.log("Creating emergency proposal:", form.getValues());
    }
  };

  const handleBack = () => {
    setStep(1);
    form.clearErrors();
    form.reset(form.getValues());
  };

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader className="flex flex-row items-center justify-between">
          <AlertDialogTitle>Create Emergency Upgrade Proposal</AlertDialogTitle>
          {step === 1 && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-4 w-4 p-0">
              <Cross2Icon className="h-4 w-4" />
            </Button>
          )}
        </AlertDialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreate)}>
              {step === 1 ? (
                <>
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
                          <FormMessage />
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
                            {" "}
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
                    <FormField
                      control={form.control}
                      name="value"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Value (eth)</FormLabel>
                          <FormControl>
                            <Input placeholder="0" {...field} />
                          </FormControl>
                          <FormDescription>
                            The amount of Ether (in ether) to be sent along with the call.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <AlertDialogFooter>
                    <Button type="button" onClick={handleVerify}>
                      Verify
                    </Button>
                  </AlertDialogFooter>
                </>
              ) : (
                <>
        <RemixForm method="post">
                  <div className="py-4">
                    <h3 className="mb-4 font-semibold">Proposal Details</h3>
                    <div className="space-y-2">
                      <p>
                        <span className="font-medium">Title:</span> {form.getValues("title")}
                      </p>
                      <p>
                        <span className="font-medium">Target Address:</span>{" "}
                        {form.getValues("targetAddress")}
                        {errors?.targetAddress ? <em>{errors?.targetAddress}</em> : null}
                      </p>
                      <p>
                        <span className="font-medium">Calldata:</span> {form.getValues("calldata")}
                      </p>
                      <p>
                        <span className="font-medium">Value:</span> {form.getValues("value")} eth
                      </p>
                    </div>
                  </div>
                  <AlertDialogFooter>
                    <Button type="button" variant="outline" onClick={handleBack}>
                      Back
                    </Button>
                    <Button type="submit">Create</Button>
                  </AlertDialogFooter>
                  </RemixForm>
                </>
              )}
            </form>
          </Form>
      
      </AlertDialogContent>
    </AlertDialog>
  );
}
