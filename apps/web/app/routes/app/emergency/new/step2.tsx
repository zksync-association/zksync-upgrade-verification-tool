import { type Call, formCallSchema } from "@/common/calls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DisplayCalls } from "@/routes/app/emergency/new/display-calls";
import { DisplayStep1 } from "@/routes/app/emergency/new/displayStep1";
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
  onNext: (data: Call[]) => void;
  calls: Call[];
};

export function NewEmergencyProposalStep2(props: NewEmergencyProposalStep2Props) {
  const [calls, setCalls] = useState<Call[]>(props.calls);
  const form = useForm<Call>({
    resolver: zodResolver(formCallSchema),
    defaultValues: defaultValue as Call,
  });

  const submit = (newCall: Call) => {
    setCalls([...calls, newCall]);
    form.reset();
  };

  const onNext = useCallback(() => {
    props.onNext(calls);
  }, [calls, props.onNext]);

  const removeCall = (index: number) => {
    setCalls(calls.filter((_, i) => i !== index));
  };

  return (
    <div>
      <h2 className="mb-10 font-bold text-2xl">Define upgrade calls</h2>

      <DisplayStep1 {...props.step1} />

      <DisplayCalls calls={calls} removeCall={removeCall} />

      <Card className="mb-10">
        <CardHeader>
          <CardTitle>New Call</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <CardContent>
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
            </CardContent>
            <CardFooter>
              <Button type="submit">Add call</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
      <div className="flex gap-5">
        <Button disabled={calls.length === 0} onClick={onNext}>
          Next
        </Button>

        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
