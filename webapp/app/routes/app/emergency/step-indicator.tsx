import { cn } from "@/utils/cn";
import React from "react";
interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center space-x-2">
      {[...Array(totalSteps)].map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        <React.Fragment key={index}>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
              index + 1 === currentStep
                ? "bg-blue-500 text-white"
                : index + 1 < currentStep
                  ? "bg-blue-200 text-blue-700"
                  : "bg-gray-200 text-gray-400"
            )}
          >
            {index + 1}
          </div>
          {index < totalSteps - 1 && (
            <div
              className={cn(
                "h-1 w-12 rounded",
                index + 1 < currentStep ? "bg-blue-500" : "bg-gray-200"
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
