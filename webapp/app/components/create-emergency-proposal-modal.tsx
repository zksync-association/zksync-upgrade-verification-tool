import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

export function CreateEmergencyProposalModal({
  isOpen,
  onClose,
}: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: "",
    targetAddress: "",
    calldata: "",
    value: "0",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleVerify = () => {
    // Add verification logic here
    setStep(2);
  };

  const handleCreate = () => {
    // Add creation logic here
    console.log("Creating emergency proposal:", formData);
    onClose();
  };

  const handleBack = () => {
    setStep(1);
  };

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader className="flex flex-row items-center justify-between">
          <AlertDialogTitle>Create Emergency Upgrade Proposal</AlertDialogTitle>
          {step === 1 && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-4 w-4 p-0">
              <Cross2Icon className="h-4 w-4" />
            </Button>
          )}
        </AlertDialogHeader>
        {step === 1 ? (
          <>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="Name of the Emergency Proposal"
                  value={formData.title}
                  onChange={handleInputChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="targetAddress">Target address</Label>
                <Input
                  id="targetAddress"
                  name="targetAddress"
                  placeholder="0x..."
                  value={formData.targetAddress}
                  onChange={handleInputChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="calldata">Calldata</Label>
                <Textarea
                  id="calldata"
                  name="calldata"
                  placeholder="0x..."
                  value={formData.calldata}
                  onChange={handleInputChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="value">Value (eth)</Label>
                <Input
                  id="value"
                  name="value"
                  placeholder="0"
                  value={formData.value}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            <AlertDialogFooter>
              <Button onClick={handleVerify}>Verify</Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <div className="py-4">
              <h3 className="mb-4 font-semibold">Proposal Details</h3>
              <div className="space-y-2">
                <p>
                  <span className="font-medium">Title:</span> {formData.title}
                </p>
                <p>
                  <span className="font-medium">Target Address:</span> {formData.targetAddress}
                </p>
                <p>
                  <span className="font-medium">Calldata:</span> {formData.calldata}
                </p>
                <p>
                  <span className="font-medium">Value:</span> {formData.value} eth
                </p>
              </div>
            </div>
            <AlertDialogFooter>
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button onClick={handleCreate}>Create</Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
