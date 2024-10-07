import { type Call, formCallSchemaWithoutObject } from "@/common/calls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormDescription,
  FormInput,
  FormItem,
  FormLabel,
  FormMessage,
  FormTextarea,
} from "@/components/ui/form";
import { DisplayCalls } from "@/routes/app/emergency/new/display-calls";
import { DisplayStep1 } from "@/routes/app/emergency/new/displayStep1";
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { parseFormData } from "@/utils/read-from-request";
import { useCallback, useState } from "react";

export type NewEmergencyProposalStep2Props = {
  step1: Step1;
  onBack: () => void;
  onNext: (data: Call[]) => void;
  calls: Call[];
};

export function NewEmergencyProposalStep2(props: NewEmergencyProposalStep2Props) {
  const [calls, setCalls] = useState<Call[]>(props.calls);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof Call, string>>>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const data = parseFormData(formData, formCallSchemaWithoutObject);
    if (!data.success) {
      setFormErrors(data.errors);
      return;
    }
    setFormErrors({});
    setCalls([...calls, data.data]);
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
        <CardContent>
          <Form onSubmit={handleSubmit}>
            <FormItem name="target">
              <FormLabel>Target Address</FormLabel>
              <FormInput placeholder="0x..." />
              <FormDescription>Target address for upgrade transaction</FormDescription>
              <FormMessage data-testid="title-error">{formErrors.target}</FormMessage>
            </FormItem>

            <FormItem name="data">
              <FormLabel>Calldata</FormLabel>
              <FormTextarea placeholder="0x..." />
              <FormDescription>Calldata for the upgrade transaction</FormDescription>
              <FormMessage>{formErrors.data}</FormMessage>
            </FormItem>

            <FormItem name="value">
              <FormLabel>Value</FormLabel>
              <FormInput type="number" defaultValue={0} />
              <FormDescription>Value for the upgrade transaction</FormDescription>
              <FormMessage>{formErrors.value}</FormMessage>
            </FormItem>

            <Button>Add call</Button>
          </Form>
        </CardContent>
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
