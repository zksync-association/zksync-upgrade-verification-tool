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
import { bytes32Schema } from "@repo/common/schemas";
import { useState } from "react";
import { z } from "zod";

export const step1Schema = {
  title: z.string().min(1, "Cannot be empty"),
  salt: bytes32Schema,
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
