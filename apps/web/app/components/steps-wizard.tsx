import { StepIndicator } from "@/components/step-indicator";
import type { ReactElement, ReactNode } from "react";

export type WizardStepProps = {
  step: number;
  children: ReactNode;
};

export type StepsWizzardProps = {
  currentStep: number;
  totalSteps: number;
  children: ReactElement<WizardStepProps>[];
};

export function WizardStep({ children }: WizardStepProps) {
  return children;
}

export function StepsWizard(props: StepsWizzardProps): React.ReactElement {
  const currentChildren = props.children.filter((child) => child.props.step === props.currentStep);
  return (
    <>
      <StepIndicator currentStep={props.currentStep} totalSteps={props.totalSteps} />
      <div className="flex justify-center">
        <div className="max-w-xl flex-1 pt-8">{currentChildren}</div>
      </div>
    </>
  );
}
