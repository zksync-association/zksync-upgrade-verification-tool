import type { FormCall } from "@/common/calls";
import { Button } from "@/components/ui/button";
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import type { action } from "./_route";

export type Step3Props = {
  step1: Step1;
  calls: FormCall[];
  onBack: () => void;
  submit: () => void;
};

export function Step3(props: Step3Props) {
  const { submit, data, state } = useFetcher<typeof action>();

  useEffect(() => {
    submit(
      {
        intent: "validate",
        calls: JSON.stringify(props.calls),
        salt: props.step1.salt,
        title: props.step1.title,
      },
      { method: "POST", action: $path("/app/emergency/new") }
    );
  });

  const valid = data?.ok && data.errors.length === 0;

  return (
    <div>
      <div>
        <p>
          <b>Title:</b> {props.step1.title}
        </p>
        <p>
          <b>Salt:</b> {props.step1.salt}
        </p>
      </div>

      <div>
        {props.calls.map((call) => (
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

      {!data && <div>Validating...</div>}

      {data?.errors && <div>Error validation transactions: {data.errors.join(", ")}</div>}

      <div>{valid ? "Data validation ok" : "Error validating transactions"}</div>

      <Button variant="outline" onClick={props.onBack}>
        Back
      </Button>

      <Button
        disabled={!valid}
        onClick={props.submit}
        loading={state === "submitting" || state === "loading"}
      >
        Submit
      </Button>
    </div>
  );
}
