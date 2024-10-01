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

const TOAST_ID = "archive_button";

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
  const buttonDisabled = disabled || archivedReason === "";

  const archivedOn = new Date().toISOString();

  useEffect(() => {
    if (success) {
      toast.success("Archived successfully", { id: TOAST_ID });
      setOpen(false);
    }
  }, [success]);

  function onClick() {
    if (archivedReason === "") {
      return;
    }

    toast.loading("Archiving...", { id: TOAST_ID });
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
          archivedBy: user.address,
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
          toast.error("Failed to archive", { id: TOAST_ID });
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
        <Label htmlFor="archivedReason">Reason for archiving</Label>
        <Input
          id="archivedReason"
          value={archivedReason}
          onChange={(e) => setArchivedReason(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            className="my-4 w-40"
            onClick={onClick}
            loading={loading}
            disabled={buttonDisabled}
          >
            Archive
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
