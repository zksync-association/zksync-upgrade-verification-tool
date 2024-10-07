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
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { parseFormData } from "@/utils/read-from-request";
import { useCallback, useState } from "react";
import DisplayStep2 from "./display-step2";
import DisplayStep1 from "./display-step1";
import AddButton from "@/components/add-button";

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
    e.currentTarget.reset();
  };

  const onNext = useCallback(() => {
    props.onNext(calls);
  }, [calls, props.onNext]);

  const removeCall = (index: number) => {
    setCalls(calls.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2: Define Upgrade Calls</CardTitle>
      </CardHeader>
      <CardContent>
        <DisplayStep1 className="mb-8" {...props.step1} />

        <Form onSubmit={handleSubmit}>
          <FormItem name="target">
            <FormLabel>Target Address</FormLabel>
            <FormInput />
            <FormDescription>Target address for upgrade transaction</FormDescription>
            <FormMessage data-testid="title-error">{formErrors.target}</FormMessage>
          </FormItem>

          <FormItem name="data">
            <FormLabel>Calldata</FormLabel>
            <FormTextarea />
            <FormDescription>Calldata for the upgrade transaction</FormDescription>
            <FormMessage>{formErrors.data}</FormMessage>
          </FormItem>

          <FormItem name="value">
            <FormLabel>Value</FormLabel>
            <FormInput type="number" defaultValue={0} />
            <FormDescription>Value for the upgrade transaction</FormDescription>
            <FormMessage>{formErrors.value}</FormMessage>
          </FormItem>

          <AddButton>Add call</AddButton>

          {calls.length > 0 && (
            <div className="pt-8">
              <h3 className="mb-4 font-medium text-lg">Added Calls:</h3>
              <DisplayStep2 calls={calls} removeCall={removeCall} />
            </div>
          )}
        </Form>
        <div className="mt-8 flex gap-5">
          <Button variant="secondary" onClick={props.onBack}>
            Back
          </Button>
          <Button disabled={calls.length === 0} onClick={onNext}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
