import type { Call } from "@/common/calls";
import { Button } from "@/components/ui/button";
import { DisplayCalls } from "@/routes/app/emergency/new/display-calls";
import { DisplayStep1 } from "@/routes/app/emergency/new/displayStep1";
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import type { action } from "./_route";

export type Step3Props = {
  step1: Step1;
  calls: Call[];
  onBack: () => void;
  submit: () => void;
};

export function Step3(props: Step3Props) {
  const { submit, data } = useFetcher<typeof action>();

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

  const valid = data !== undefined && data.errors.length === 0;
  console.log("valid", valid);

  return (
    <div>
      <DisplayStep1 {...props.step1} />

      <DisplayCalls calls={props.calls} />

      {!data && <div>Validating...</div>}

      {!valid && (
        <div className="my-10 mb-2 font-bold">
          <h2 className="text-2xl">Error validating transactions:</h2>
          <p>{data?.errors?.join(", ")}</p>
        </div>
      )}

      {valid && (
        <div className="my-10">
          <h2 className="mb-2 font-bold text-2xl">Validations ok</h2>
          <p>All checks ok</p>
        </div>
      )}

      <div className="flex gap-5">
        <Button disabled={!valid} onClick={props.submit} loading={!data}>
          Submit
        </Button>

        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
