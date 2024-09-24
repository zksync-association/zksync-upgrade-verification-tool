import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormDescription,
  FormInput,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { parseFormData } from "@/utils/read-from-request";
import { hexSchema } from "@repo/common/schemas";
import { useState } from "react";
import { type Hex, padHex } from "viem";
import { z } from "zod";

export const step1Schema = {
  title: z.string().min(1, "Cannot be empty"),
  salt: hexSchema
    .refine((a) => a.length <= 66, "Should be 32 byte number")
    .transform((str) => str as Hex)
    .transform((str) => padHex(str, { size: 32 })),
};

const step1SchemaObject = z.object(step1Schema);
export type Step1 = z.infer<typeof step1SchemaObject>;

export type NewEmergencyProposalStep1Props = {
  callback: (data: Step1) => void;
};

export function NewEmergencyProposalStep1(props: NewEmergencyProposalStep1Props) {
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof typeof step1Schema, string>>>(
    {}
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const data = parseFormData(formData, step1Schema);
    if (!data.success) {
      setFormErrors(data.errors);
      return;
    }
    setFormErrors({});
    props.callback(data.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic data:</CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={handleSubmit}>
          <FormItem name="title">
            <FormLabel>Title</FormLabel>
            <FormInput placeholder="..." />
            <FormDescription>
              This is to help voters identify which proposal this is.
            </FormDescription>
            <FormMessage data-testid="title-error">{formErrors.title}</FormMessage>
          </FormItem>

          <FormItem name="salt">
            <FormLabel>Salt</FormLabel>
            <FormInput defaultValue={`0x${"0".repeat(64)}`} />
            <FormDescription>
              A bytes32 value used for creating unique upgrade proposal hashes.
            </FormDescription>
            <FormMessage>{formErrors.salt}</FormMessage>
          </FormItem>
          <Button type="submit">Next</Button>
        </Form>
      </CardContent>
    </Card>
  );
}
