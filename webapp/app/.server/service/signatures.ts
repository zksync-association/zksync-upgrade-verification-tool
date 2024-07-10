import { db } from "@/.server/db";
import { signaturesTable } from "@/.server/db/schema";
import {
  councilAddress,
  guardianMembers,
  guardiansAddress,
} from "@/.server/service/authorized-users";
import { l1RpcProposals } from "@/.server/service/clients";
import { guardiansAbi } from "@/.server/service/protocol-upgrade-handler-abi";
import { badRequest } from "@/utils/http";
import { zodHex } from "validate-cli/src";
import { type Hex, hashTypedData } from "viem";
import { z } from "zod";

const actionSchema = z.enum([
  "ExtendLegalVetoPeriod",
  "ApproveUpgradeGuardians",
  "ApproveUpgradeSecurityCouncil",
]);

type ProposalAction = z.infer<typeof actionSchema>;

async function verifySignature(
  verifierAddr: Hex,
  signature: Hex,
  action: ProposalAction,
  proposalId: Hex
) {
  const digest = hashTypedData({
    domain: {
      name: "Guardians",
      version: "1",
      chainId: 31337,
      verifyingContract: verifierAddr,
    },
    primaryType: action,
    message: {
      id: proposalId,
    },
    types: {
      [action]: [
        {
          name: "id",
          type: "bytes32",
        },
      ],
    },
  });

  try {
    await l1RpcProposals.contractRead(verifierAddr, "checkSignatures", guardiansAbi.raw, z.any(), [
      digest,
      [verifierAddr],
      [signature],
      1,
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

export async function validateAndSaveSignature(
  signature: string,
  signer: string,
  action: string,
  proposalId: string
) {
  const signatureHex = zodHex.parse(signature);
  const signerHex = zodHex.parse(signer);
  const proposalIdHex = zodHex.parse(proposalId);
  const parsedAction = actionSchema.parse(action);

  let validSignature: boolean;
  if (parsedAction === "ExtendLegalVetoPeriod" || parsedAction === "ApproveUpgradeGuardians") {
    const guardians = await guardianMembers();
    if (!guardians.includes(signerHex)) {
      throw badRequest(
        `Signer is not a guardian. Only guardians can execute this action: ${parsedAction}`
      );
    }

    const addr = await guardiansAddress();

    validSignature = await verifySignature(addr, signatureHex, parsedAction, proposalIdHex);
  } else {
    const guardians = await guardianMembers();
    if (!guardians.includes(signerHex)) {
      throw badRequest(
        `Signer is not a guardian. Only guardians can execute this action: ${parsedAction}`
      );
    }

    const addr = await councilAddress();
    validSignature = await verifySignature(addr, signatureHex, parsedAction, proposalIdHex);
  }

  if (!validSignature) {
    throw badRequest("Invalid signature");
  }

  await db
    .insert(signaturesTable)
    .values({
      action: parsedAction,
      signature: signatureHex,
      proposal: proposalIdHex,
      signer: signerHex,
    })
    .onConflictDoNothing();
}
