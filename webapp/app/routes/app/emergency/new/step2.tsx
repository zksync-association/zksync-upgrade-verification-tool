import { type FormCall, formCallSchema } from "@/common/calls";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";

const defaultValue = {
  target: "",
  data: "",
  value: "0",
};

export type NewEmergencyProposalStep2Props = {
  step1: Step1;
  onBack: () => void;
  onNext: (data: FormCall[]) => void;
  calls: FormCall[];
};

export function NewEmergencyProposalStep2(props: NewEmergencyProposalStep2Props) {
  const [calls, setCalls] = useState<FormCall[]>(props.calls);
  const form = useForm<FormCall>({
    resolver: zodResolver(formCallSchema),
    defaultValues: defaultValue as FormCall,
  });

  const submit = (newCall: FormCall) => {
    setCalls([...calls, newCall]);
    form.reset();
  };

  const onNext = useCallback(() => {
    props.onNext(calls);
  }, [calls, props.onNext]);

  return (
    <div>
      <h3 className="mb-4 font-semibold text-lg">Define upgrade calls</h3>

      <div>
        <p>
          <b>Title:</b> {props.step1.title}
        </p>
        <p>
          <b>Salt:</b> {props.step1.salt}
        </p>
      </div>

      <div>
        {calls.map((call) => (
          <div key={call.target + call.data + call.value}>
            <p>
              <b>target:</b> {call.target}
            </p>
            <p>
              <b>data:</b> {call.data}
            </p>
            <p>
              <b>value:</b> {call.value}
            </p>
          </div>
        ))}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)}>
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="target"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Address</FormLabel>
                  <FormControl>
                    <Input placeholder="0x..." {...field} />
                  </FormControl>
                  <FormDescription>Target address for upgrade transaction</FormDescription>
                  <FormMessage data-testid="title-error" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="data"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Calldata</FormLabel>
                  <FormControl>
                    <Textarea placeholder="0x..." {...field} />
                  </FormControl>
                  <FormDescription>Calldata use in the upgrade transaction</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Value</FormLabel>
                  <FormControl>
                    <Input placeholder="0x..." {...field} />
                  </FormControl>
                  <FormDescription>Calldata use in the upgrade transaction</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Button type="submit">Add call</Button>
        </form>
      </Form>

      <Button variant="outline" onClick={props.onBack}>
        Back
      </Button>

      <Button disabled={calls.length === 0} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
