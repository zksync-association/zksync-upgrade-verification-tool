import { StepsWizard, WizardStep } from "@/components/steps-wizard";
import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { NewEmergencyProposalStep1, Step1 } from "@/routes/app/emergency/new/step1";
import { FormCall, NewEmergencyProposalStep2 } from "@/routes/app/emergency/new/step2";


export default function NewEmergencyUpgrade() {
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [step1, setStep1] = useState<Step1 | null>(null)
  const [calls, setCalls] = useState<FormCall[] | null>()

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

  const logAll = useCallback(() => {
    console.log(step1)
    console.log(calls)
  }, [step1])

  return (
    <div>
      <StepsWizard currentStep={currentStep} totalSteps={5}>
        <WizardStep step={1}>
          <NewEmergencyProposalStep1 callback={step1Submit} />
        </WizardStep>
        <WizardStep step={2}>
          {step1 && <NewEmergencyProposalStep2 onBack={step2Back} onNext={step2Next} step1={step1} />}
        </WizardStep>
        <WizardStep step={3}>
          <div>
          </div>
        </WizardStep>
      </StepsWizard>
      <Button onClick={logAll}>Log!</Button>
    </div>
  )
}