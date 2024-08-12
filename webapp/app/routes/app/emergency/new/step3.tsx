import { Step1 } from "@/routes/app/emergency/new/step1";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { action } from './_route'
import { $path } from "remix-routes";
import { FormCall } from "@/common/calls";
import { Button } from "@/components/ui/button";

export type Step3Props = {
  step1: Step1;
  calls: FormCall[];
  onBack: () => void;
  submit: () => void;
}

export function Step3(props: Step3Props) {
  const { submit, data, state } = useFetcher<typeof action>();

  useEffect(() => {
    submit(
      { intent: "validate", calls: JSON.stringify(props.calls), salt: props.step1.salt, title: props.step1.title },
      { method: "POST", action: $path("/app/emergency/new") }
    )
  }, []);

  const valid = data && data.ok

  const coso = data === undefined ? "waiting.." : data
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
        {props.calls.map((call, index) => (
          <div key={index}>
            <p><b>target:</b> {call.target}</p>
            <p><b>data:</b> {call.data}</p>
            <p><b>value:</b> {call.value}</p>
          </div>
        ))}
      </div>

      { JSON.stringify(coso) }



      <Button variant="outline" onClick={props.onBack}>
        Back
      </Button>

      <Button onClick={props.submit}>
        Submit
      </Button>
    </div>
  )
}