import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Hex, padHex } from "viem";

export const step1Schema = z.object({
  title: z.string().min(1, "Cannot be empty"),
  salt: z.string()
    .regex(/^0x[a-fA-F0-9]*$/, "Salt must be a hex string starting with 0x")
    .refine(a => a.length <= 66, "Should be 32 byte number")
    .transform(str => str as Hex)
    .transform(str => padHex(str, { size: 32 }))
})

export type Step1 = z.infer<typeof step1Schema>

const step1Default: Step1 = {
  title: "",
  salt: `0x${'0'.repeat(64)}`
}

export type NewEmergencyProposalStep1Props = {
  callback: (data: Step1) => void
}

export function NewEmergencyProposalStep1 (props: NewEmergencyProposalStep1Props) {
  const form = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: step1Default
  })

  const step1Submit = (data: Step1) => {
    props.callback(data)
  }

  return (
    <div>
      <h3 className="mb-4 font-semibold text-lg">Define upgrade basic data</h3>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(step1Submit)}>
          <div className="grid gap-4 py-4">
            <FormField
              control={form.control}
              name="title"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="..." {...field} />
                  </FormControl>
                  <FormDescription>
                    This is to help voters identify which proposal this is.
                  </FormDescription>
                  <FormMessage data-testid="title-error"/>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="salt"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Salt</FormLabel>
                  <FormControl>
                    <Input placeholder="0x..." {...field} />
                  </FormControl>
                  <FormDescription>
                    A bytes32 value used for creating unique upgrade proposal hashes.
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />
          </div>
          <Button type="submit">
            Next
          </Button>
        </form>
      </Form>
    </div>
  )
}