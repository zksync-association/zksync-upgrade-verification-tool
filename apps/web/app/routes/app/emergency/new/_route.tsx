import { isUniqueConstraintError } from "@/.server/db/errors";
import {
  saveEmergencyProposal,
  validateEmergencyProposalCalls,
} from "@/.server/service/emergency-proposals";
import { emergencyUpgradeBoardAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import { type Call, callSchema } from "@/common/calls";
import { StepsWizard, WizardStep } from "@/components/steps-wizard";
import { NewEmergencyProposalStep1, type Step1 } from "@/routes/app/emergency/new/step1";
import { NewEmergencyProposalStep2 } from "@/routes/app/emergency/new/step2";
import { Step3 } from "@/routes/app/emergency/new/step3";
import { requireUserFromRequest } from "@/utils/auth-headers";
import { badRequest } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { type ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { hexSchema } from "@repo/common/schemas";
import { useState } from "react";
import { $path } from "remix-routes";
import { z } from "zod";

export const meta = Meta["/app/emergency/new"];

export async function loader() {
  return json({ emergencyBoardAddress: await emergencyUpgradeBoardAddress() });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromRequest(request);
  const body = z
    .object({
      intent: z.enum(["validate", "save"]),
      calls: z.array(callSchema),
      salt: hexSchema,
      title: z.string().min(1),
    })
    .safeParse(await request.json());

  if (!body.success) {
    throw badRequest(`Error parsing body: ${body.error.toString()}`);
  }

  const calls = body.data.calls;
  const validations = await validateEmergencyProposalCalls(calls);
  const allValid = validations.every((v) => v.isValid);

  // If intent is validate, we should return the validations and the status.
  if (body.data.intent === "validate") {
    return json({ ok: allValid, validations });
  }

  // Otherwise, we should just save the proposal, not caring if the validations are ok or not
  // as the user will be responsible for the proposal being valid.
  if (body.data.intent === "save") {
    try {
      const proposal = await saveEmergencyProposal(
        {
          salt: body.data.salt,
          title: body.data.title,
          proposer: user.address,
        },
        calls
      );
      return redirect($path("/app/emergency/:id", { id: proposal.externalId }));
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw badRequest("Proposal with these params already exists.");
      }
      throw err;
    }
  }
}

export default function NewEmergencyUpgrade() {
  const { emergencyBoardAddress } = useLoaderData<typeof loader>();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [step1, setStep1] = useState<Step1 | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const fetcher = useFetcher<typeof action>();

  const step1Submit = (newStep1: Step1) => {
    setStep1(newStep1);
    setCurrentStep(2);
  };

  const step2Back = () => {
    setCurrentStep(1);
  };

  const step2Next = (newCalls: Call[]) => {
    setCalls(newCalls);
    setCurrentStep(3);
  };

  const step3Back = () => {
    setCurrentStep(2);
  };

  const step3Submit = () => {
    if (!step1) {
      throw new Error("missign step 1 data");
    }

    fetcher.submit(
      { intent: "save", calls: calls, salt: step1.salt, title: step1.title },
      { method: "POST", encType: "application/json" }
    );
  };

  return (
    <div>
      <h2 className="pt-10 pb-5 font-bold text-3xl">Create New Emergency Upgrade</h2>
      <StepsWizard currentStep={currentStep} totalSteps={3}>
        <WizardStep step={1}>
          <NewEmergencyProposalStep1 callback={step1Submit} />
        </WizardStep>
        <WizardStep step={2}>
          {step1 && (
            <NewEmergencyProposalStep2
              onBack={step2Back}
              onNext={step2Next}
              step1={step1}
              calls={calls}
            />
          )}
        </WizardStep>
        <WizardStep step={3}>
          {step1 && (
            <Step3
              step1={step1}
              calls={calls}
              onBack={step3Back}
              submit={step3Submit}
              executorAddress={emergencyBoardAddress}
            />
          )}
        </WizardStep>
      </StepsWizard>
    </div>
  );
}
