import { StepsWizard, WizardStep } from "@/components/steps-wizard";
import React, { useState } from "react";
import { NewEmergencyProposalStep1, Step1 } from "@/routes/app/emergency/new/step1";
import { NewEmergencyProposalStep2 } from "@/routes/app/emergency/new/step2";
import { Step3 } from "@/routes/app/emergency/new/step3";
import { ActionFunctionArgs, json } from "@remix-run/node";
import { badRequest } from "@/utils/http";
import { getFormData } from "remix-params-helper";
import { z } from "zod";
import { callSchema, FormCall, hexSchema } from "@/common/calls";
import { validateEmergencyProposalCalls } from "@/.server/service/emergency-proposals";

export async function action ({ request }: ActionFunctionArgs) {
  const body = await getFormData(request, z.object({
    intent: z.string(),
    calls: z.string(),
    salt: hexSchema,
    title: z.string().min(1),
  }))

  if (!body.success) {
    throw badRequest(body.errors.toString())
  }

  const calls = z.array(callSchema).safeParse(JSON.parse(body.data.calls))

  if (!calls.success) {
    throw badRequest("Malformed calls array")
  }

  const errors = await validateEmergencyProposalCalls(calls.data)

  return json({ ok: true, errors });
}

export default function NewEmergencyUpgrade() {
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [step1, setStep1] = useState<Step1 | null>(null)
  const [calls, setCalls] = useState<FormCall[]>([])

  const step1Submit = (newStep1: Step1) => {
    setStep1(newStep1)
    setCurrentStep(2)
  }

  const step2Back = () => {
    setCurrentStep(1)
  }

  const step2Next = (newCalls: FormCall[]) => {
    setCalls(newCalls)
    setCurrentStep(3)
  }

  const step3Back = () => {
    setCurrentStep(2)
  }

  return (
    <div>
      <StepsWizard currentStep={currentStep} totalSteps={5}>
        <WizardStep step={1}>
          <NewEmergencyProposalStep1 callback={step1Submit} />
        </WizardStep>
        <WizardStep step={2}>
          {step1 && <NewEmergencyProposalStep2 onBack={step2Back} onNext={step2Next} step1={step1} calls={calls} />}
        </WizardStep>
        <WizardStep step={3}>
          {step1 && <Step3 step1={step1} calls={calls} onBack={step3Back}></Step3>}
        </WizardStep>
      </StepsWizard>
    </div>
  )
}