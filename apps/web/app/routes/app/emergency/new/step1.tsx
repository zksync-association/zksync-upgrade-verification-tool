import { hexSchema } from "@/common/basic-schemas";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { type Hex, padHex } from "viem";
import { z } from "zod";

export const step1Schema = z.object({
  title: z.string().min(1, "Cannot be empty"),
  salt: hexSchema
    .refine((a) => a.length <= 66, "Should be 32 byte number")
    .transform((str) => str as Hex)
    .transform((str) => padHex(str, { size: 32 })),
});

export type Step1 = z.infer<typeof step1Schema>;

const step1Default: Step1 = {
  title: "",
  salt: `0x${"0".repeat(64)}`,
};

export type NewEmergencyProposalStep1Props = {
  callback: (data: Step1) => void;
};

export function NewEmergencyProposalStep1(props: NewEmergencyProposalStep1Props) {
  const form = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: step1Default,
  });

  const step1Submit = (data: Step1) => {
    props.callback(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic data:</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(step1Submit)}>
          <CardContent>
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
              name="salt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Salt</FormLabel>
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
          </CardContent>
          <CardFooter>
            <Button type="submit">Next</Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
