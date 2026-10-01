import { freezeActionFromSlug } from "@/common/freeze";
import { notFound } from "@/utils/http";
import { type Hex, getAddress, isAddress } from "viem";
import type { FreezeParams } from "./flows/freeze";
import type { VetoParams } from "./flows/l2-veto";
import { bytes32Pattern } from "./request";

// URL → flow parameters, shared by the pages and the JSON API so both run the same checks.

const uint = /^\d{1,78}$/;

export function parseId(raw: string | undefined): Hex {
  if (!raw || !bytes32Pattern.test(raw)) throw notFound();
  return raw.toLowerCase() as Hex;
}

export function parseFreezeParams(slug: string | undefined, url: URL): FreezeParams {
  const action = freezeActionFromSlug(slug ?? "");
  const nonce = url.searchParams.get("nonce") ?? "";
  const validUntil = url.searchParams.get("validUntil") ?? "";
  const threshold = url.searchParams.get("threshold") ?? undefined;
  if (!action || !uint.test(nonce) || !uint.test(validUntil)) throw notFound();
  if (action === "SetSoftFreezeThreshold" && !uint.test(threshold ?? "")) throw notFound();
  return {
    action,
    nonce,
    validUntil,
    threshold: action === "SetSoftFreezeThreshold" ? threshold : undefined,
  };
}

export function parseVetoParams(id: string | undefined, url: URL): VetoParams {
  const q = url.searchParams;
  const field = (name: string) => q.get(name) ?? "";
  const governor = field("governor");
  const refund = field("refundRecipient");
  const values = {
    l2ProposalId: id ?? "",
    l2GasLimit: field("l2GasLimit"),
    l2GasPerPubdataByteLimit: field("l2GasPerPubdataByteLimit"),
    txMintValue: field("txMintValue"),
    nonce: field("nonce"),
  };
  if (
    !Object.values(values).every((v) => uint.test(v)) ||
    !isAddress(governor) ||
    !isAddress(refund)
  )
    throw notFound();
  return {
    ...values,
    l2GovernorAddress: getAddress(governor),
    refundRecipient: getAddress(refund),
  };
}
