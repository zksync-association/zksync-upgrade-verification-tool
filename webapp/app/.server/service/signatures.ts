import { createOrIgnoreSignature } from "@/.server/db/dto/signatures";
import { db } from "@/.server/db/index";
import { type Action, type actionSchema, signaturesTable } from "@/.server/db/schema";
import {
  councilAddress,
  councilMembers,
  emergencyBoardAddress,
  guardianMembers,
  guardiansAddress,
} from "@/.server/service/authorized-users";
import { l1Rpc } from "@/.server/service/clients";
import { guardiansAbi } from "@/.server/service/contract-abis";
import { badRequest } from "@/utils/http";
import { env } from "@config/env.server";
import { and, asc, eq } from "drizzle-orm";
import { type Hex, hashTypedData } from "viem";
import { mainnet, sepolia } from "wagmi/chains";
import { z } from "zod";

type ProposalAction = z.infer<typeof actionSchema>;

async function verifySignature(
  signer: Hex,
  signature: Hex,
  verifierAddr: Hex,
  action: ProposalAction,
  proposalId: Hex,
  contractName: string,
  targetContract: Hex
) {
  const digest = hashTypedData({
    domain: {
      name: contractName,
      version: "1",
      chainId: env.NODE_ENV === "development" ? sepolia.id : mainnet.id,
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
    await l1Rpc.contractRead(targetContract, "checkSignatures", guardiansAbi.raw, z.any(), [
      digest,
      [signer],
      [signature],
      1,
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

export async function saveEmergencySignature(
  signature: Hex,
  signer: Hex,
  action: Action,
  emergencyProposalId: Hex
) {
  if (action === "ExecuteEmergencyUpgradeGuardians") {
    const isValid = await verifySignature(
      signer,
      signature,
      await emergencyBoardAddress(),
      action,
      emergencyProposalId,
      "EmergencyUpgradeBoard",
      await guardiansAddress()
    );
    if (!isValid) {
      throw badRequest("Invalid signature provided");
    }
  }

  if (action === "ExecuteEmergencyUpgradeSecurityCouncil") {
    const isValid = await verifySignature(
      signer,
      signature,
      await emergencyBoardAddress(),
      action,
      emergencyProposalId,
      "EmergencyUpgradeBoard",
      await councilAddress()
    );
    if (!isValid) {
      throw badRequest("Invalid signature provided");
    }
  }

  if (action === "ExecuteEmergencyUpgradeZKFoundation") {
    // TODO: How do we verify this signatures?
  }

  const dto = {
    action,
    signature,
    emergencyProposal: emergencyProposalId,
    signer,
  };

  await createOrIgnoreSignature(dto);
}

export async function validateAndSaveSignature(
  signature: Hex,
  signer: Hex,
  action: Action,
  proposalId: Hex
) {
  let validSignature: boolean;
  if (action === "ExtendLegalVetoPeriod" || action === "ApproveUpgradeGuardians") {
    const guardians = await guardianMembers();
    if (!guardians.includes(signer)) {
      throw badRequest(
        `Signer is not a guardian. Only guardians can execute this action: ${action}`
      );
    }

    const addr = await guardiansAddress();
    validSignature = await verifySignature(
      signer,
      signature,
      addr,
      action,
      proposalId,
      "Guardians",
      addr
    );
  } else {
    const members = await councilMembers();
    if (!members.includes(signer)) {
      throw badRequest(
        `Signer is not a security council member. Only the security council can execute this action: ${action}`
      );
    }

    const addr = await councilAddress();
    validSignature = await verifySignature(
      signer,
      signature,
      addr,
      action,
      proposalId,
      "SecurityCouncil",
      addr
    );
  }

  if (!validSignature) {
    throw badRequest("Invalid signature");
  }

  const dto = {
    action,
    signature,
    proposal: proposalId,
    signer,
  };

  await createOrIgnoreSignature(dto);
}

export async function buildExtendVetoArgs(proposalId: Hex): Promise<null | any[]> {
  const records = await db.query.signaturesTable.findMany({
    where: and(
      eq(signaturesTable.proposal, proposalId),
      eq(signaturesTable.action, "ExtendLegalVetoPeriod")
    ),
    orderBy: asc(signaturesTable.signer),
  });

  if (records.length < 2) {
    return null;
  }

  return [proposalId, records.map((r) => r.signer), records.map((r) => r.signature)];
}
