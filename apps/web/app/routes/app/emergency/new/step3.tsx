import type { Call } from "@/common/calls";
import { Button } from "@/components/ui/button";
import type { Step1 } from "@/routes/app/emergency/new/step1";
import { calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import type { Hex } from "viem";
import type { action } from "./_route";
import DisplayStep2 from "./display-step2";
import DisplayStep1 from "./display-step1";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

export type Step3Props = {
  step1: Step1;
  calls: Call[];
  executorAddress: Hex;
  onBack: () => void;
  submit: () => void;
};

export function Step3(props: Step3Props) {
  const { submit, data } = useFetcher<typeof action>();
  const upgradeId = calculateUpgradeProposalHash(
    props.calls,
    props.step1.salt,
    props.executorAddress
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    submit(
      {
        intent: "validate",
        calls: props.calls,
        salt: props.step1.salt,
        title: props.step1.title,
      },
      { method: "POST", encType: "application/json", action: $path("/app/emergency/new") }
    );
  }, []);

  const valid = data?.ok;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3: Review and Submit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DisplayStep1 {...props.step1} />

        <h3 className="mb-2 font-medium text-lg">Calldata:</h3>
        <DisplayStep2 calls={props.calls} />

        <h3 className="mb-2 font-medium text-lg">Upgrade ID:</h3>
        <div className="flex flex-col gap-2">
          <span className="flex break-all rounded-xl bg-orange-900/60 p-4 font-mono text-sm">
            {upgradeId}
          </span>
          <span className="flex text-muted-foreground text-sm">
            This is the ID of the Emergency Upgrade. It is calculated from the title, salt and
            calldata.
          </span>
        </div>

        <h3 className="mb-2 font-medium text-lg">Validation Results:</h3>
        <div
          className={cn(
            "flex rounded-xl bg-muted p-4 text-sm",
            data && !valid && "bg-red-900/50",
            data && valid && "bg-green-900/50"
          )}
        >
          {!data ? (
            <div className="flex items-center gap-4">
              <Loading />
              Validating...
            </div>
          ) : !valid ? (
            <div>
              <ul className="font-medium text-red-500">
                {data?.validations?.map(
                  ({ isValid }, i) => !isValid && <li>Call {i + 1}: eth_call failed</li>
                )}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Validation errors detected. You can still submit if you're certain these errors are
                expected, but proceed with caution.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Check className="text-green-500" />
              <p className="text-green-500">Validation passed successfully</p>
            </div>
          )}
        </div>

        <div className="flex gap-5 pt-4">
          <Button variant="secondary" onClick={props.onBack}>
            Back
          </Button>
          <Button onClick={props.submit} loading={!data}>
            Submit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
