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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEther, hexToBigInt } from "viem";
import { Trash2 } from "lucide-react";

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

  const removeCall = (index: number) => {
    setCalls(calls.filter((c, i) => i !== index));
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-10">Define upgrade calls</h2>

      <div className="rounded-md bg-muted p-4 mb-8">
        <p className="mb-1">
          <span className="font-medium text-muted-foreground text-sm">Title:</span><span>{props.step1.title}</span>
        </p>
        <p className="mb-1">
          <span className="font-medium text-muted-foreground text-sm">Salt:</span><span>{props.step1.salt}</span>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-x-4 pb-10">
        {calls.map((call, i) => (
          <div key={call.target + call.data + call.value} className="rounded-md bg-muted p-4 flex align-middle">
            <div className="grid grid-cols-4">
              <div className="font-medium text-muted-foreground text-sm col-span-1">
                target:
              </div>
              <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
                {call.target}
              </div>

              <div className="font-medium text-muted-foreground text-sm col-span-1">
                data:
              </div>
              <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
                {call.data}
              </div>

              <div className="font-medium text-muted-foreground text-sm col-span-1">
                value:
              </div>
              <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
                {formatEther(hexToBigInt(call.value))}
              </div>
            </div>
            <div className="px-3">
              <div className="aspect-square border-2 rounded-md p-1 cursor-pointer" onClick={() => removeCall(i)}>
                <Trash2 size={15}/>
              </div>
            </div>
          </div>
        ))}
      </div>

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
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Target Address</FormLabel>
                      <FormControl>
                        <Input placeholder="0x..." {...field} />
                      </FormControl>
                      <FormDescription>Target address for upgrade transaction</FormDescription>
                      <FormMessage data-testid="title-error"/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="data"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Calldata</FormLabel>
                      <FormControl>
                        <Textarea placeholder="0x..." {...field} />
                      </FormControl>
                      <FormDescription>Calldata use in the upgrade transaction</FormDescription>
                      <FormMessage/>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="value"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Value</FormLabel>
                      <FormControl>
                        <Input placeholder="0x..." {...field} />
                      </FormControl>
                      <FormDescription>Calldata use in the upgrade transaction</FormDescription>
                      <FormMessage/>
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

        <Button variant="outline" onClick={props.onBack}>
          Back
        </Button>
      </div>

    </div>
  );
}
