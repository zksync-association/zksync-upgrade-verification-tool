import { StepsWizard, WizardStep } from "@/components/steps-wizard";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { emergencyPropSchema } from "@/common/emergency-proposal-schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const step1Schema = z.object({
  title: z.string(),
  salt: z.string(),
})

type Step1 = z.infer<typeof step1Schema>

const step1Default: Step1 = {
  title: "",
  salt: ""
}

export default function NewEmergencyUpgrade() {
  const [step, setStep] = useState<number>(1)
  const form = useForm<Step1>({
    resolver: zodResolver(emergencyPropSchema),
    defaultValues: step1Default
  })

  const step1Submit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log(step)
  }

  return (
    <div>
      <StepsWizard currentStep={step} totalSteps={5}>
        <WizardStep step={1}>
          <div>
            <Form {...form}>
              <form onSubmit={step1Submit}>
                <h3 className="mb-4 font-semibold text-lg">Define Emergency Proposal</h3>
                <div className="grid gap-4 py-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({field}) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="..." {...field} />
                        </FormControl>
                        <FormDescription>
                          This is to help voters identify which proposal this is.
                        </FormDescription>
                        <FormMessage data-testid="title-error"/>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="salt"
                    render={({field}) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="0x..." {...field} />
                        </FormControl>
                        <FormDescription>
                          A bytes32 value used for creating unique upgrade proposal hashes.
                        </FormDescription>
                        <FormMessage/>
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit">
                  Next
                </Button>
              </form>
            </Form>
          </div>
        </WizardStep>
        <WizardStep step={2}>
          <div>

          </div>
        </WizardStep>
        <WizardStep step={3}>
          <div>

          </div>
        </WizardStep>
      </StepsWizard>
    </div>
  )
}