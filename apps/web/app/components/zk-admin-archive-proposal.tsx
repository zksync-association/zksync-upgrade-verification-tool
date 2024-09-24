import { Button } from "@/components/ui/button";
import {
  type action,
  zkAdminTypedData,
  type ZkAdminSignAction,
} from "@/routes/resources+/zk-admin-sign";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { useChains, useSignTypedData } from "wagmi";
import useUser from "./hooks/use-user";
import { Dialog, DialogHeader, DialogTitle, DialogTrigger, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export default function ZkAdminArchiveProposal({
  proposalId,
  proposalType,
  disabled,
}: {
  proposalId: bigint;
  proposalType: ZkAdminSignAction;
  disabled?: boolean;
}) {
  const { signTypedData, isPending, isSuccess } = useSignTypedData();
  const [chain] = useChains();
  const fetcher = useFetcher<typeof action>();
  const user = useUser();
  const [archivedReason, setArchivedReason] = useState("");
  const [open, setOpen] = useState(false);

  const loading = isPending || fetcher.state === "loading";
  const success = isSuccess && fetcher.data?.ok;

  const archivedOn = new Date().toISOString();

  useEffect(() => {
    if (success) {
      toast.success("Signed successfully", { id: "sign_button" });
      setOpen(false);
    }
  }, [success]);

  function onClick() {
    if (archivedReason === "") {
      return;
    }

    toast.loading("Signing...", { id: "sign_button" });
    signTypedData(
      {
        domain: {
          name: "ZkAdmin",
          version: "1",
          chainId: chain.id,
        },
        ...zkAdminTypedData({
          proposalId,
          proposalType,
          archivedReason,
          archivedOn,
        }),
      },
      {
        onSuccess: (signature) => {
          fetcher.submit(
            {
              proposalId: Number(proposalId),
              proposalType,
              archivedReason,
              archivedOn,
              signature,
              archivedBy: user.address,
            },
            {
              method: "POST",
              action: $path("/resources/zk-admin-sign"),
            }
          );
        },
        onError(e) {
          console.error(e);
          toast.error("Failed to sign", { id: "sign_button" });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild disabled={disabled || loading}>
        <Button loading={loading} disabled={disabled}>
          Archive Proposal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive Proposal</DialogTitle>
        </DialogHeader>
        <Label>Reason for archiving</Label>
        <Input value={archivedReason} onChange={(e) => setArchivedReason(e.target.value)} />
        <div className="flex justify-end">
          <Button
            className="my-4 w-40"
            onClick={onClick}
            loading={loading}
            disabled={archivedReason === "" || disabled}
          >
            Archive
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
