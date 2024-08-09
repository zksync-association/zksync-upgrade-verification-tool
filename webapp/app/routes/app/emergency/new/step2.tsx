import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { getAddress, Hex, padHex, parseEther } from "viem";
import { Step1 } from "@/routes/app/emergency/new/step1";
import { useCallback, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

export const formCallSchema = z.object({
  target: z.string()
    .regex(/^0x[a-fA-F0-9]*$/, "Must be a hex string starting with 0x")
    .length(42, "Address have to be 20 bytes long")
    .transform(str => getAddress(str)),
  data: z.string()
    .regex(/^0x[a-fA-F0-9]*$/, "Must be a hex string starting with 0x")
    .refine(str => str.length % 2 === 0, "Length of hex string should be even"),
  value: z.string()
    .refine(str => !isNaN(parseFloat(str)), "Should be a valid number")
})

export type FormCall = z.infer<typeof formCallSchema>

const defaultValue: FormCall = {
  target: "0x",
  data: "",
  value: "0"
}

export type NewEmergencyProposalStep2Props = {
  step1: Step1,
  onBack: () => void,
  onNext: (data: FormCall[]) => void
}

export function NewEmergencyProposalStep2 (props: NewEmergencyProposalStep2Props) {
  const [calls, setCalls] = useState<FormCall[]>([])
  const form = useForm<FormCall>({
    resolver: zodResolver(formCallSchema),
    defaultValues: defaultValue
  })

  const submit = (newCall: FormCall) => {
    setCalls([...calls, newCall])
    form.reset()
  }

  const onNext = useCallback(() => {
    props.onNext(calls)
  }, [calls])

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
        {calls.map((call, index) => (
          <div key={index}>
            <p><b>target:</b> {call.target}</p>
            <p><b>data:</b> {call.data}</p>
            <p><b>value:</b> {call.value}</p>
          </div>
        ))}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)}>
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
                  <FormDescription>
                    Target address for upgrade transaction
                  </FormDescription>
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
                  <FormDescription>
                    Calldata use in the upgrade transaction
                  </FormDescription>
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
                  <FormDescription>
                    Calldata use in the upgrade transaction
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />
          </div>

          <Button type="submit">
            Add call
          </Button>
        </form>
      </Form>

      <Button onClick={props.onBack}>
        Back
      </Button>

      <Button disabled={calls.length === 0} onClick={onNext}>
        Next
      </Button>
    </div>
  )
}