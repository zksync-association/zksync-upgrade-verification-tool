import { createOrIgnoreSignature } from "@/.server/db/dto/signatures";
import { db } from "@/.server/db/index";
import { type Action, type freezeProposalsTable, signaturesTable } from "@/.server/db/schema";
import { l1Rpc } from "@/.server/service/clients";
import { guardiansAbi } from "@/.server/service/contract-abis";
import {
  councilAddress,
  councilMembers,
  guardianMembers,
  guardiansAddress,
} from "@/.server/service/contracts";
import { badRequest } from "@/utils/http";
import { env } from "@config/env.server";
import { type InferSelectModel, and, asc, eq } from "drizzle-orm";
import { type Hex, hashTypedData } from "viem";
import { mainnet, sepolia } from "wagmi/chains";
import { z } from "zod";

async function verifySignature({
  signer,
  signature,
  verifierAddr,

  action,
  contractName,
  types,
  message,
}: {
  signer: Hex;
  signature: Hex;
  verifierAddr: Hex;
  action: Action;
  contractName: string;
  types: { name: string; type: string }[];
  message: { [key: string]: any };
}) {
  const digest = hashTypedData({
    domain: {
      name: contractName,
      version: "1",
      chainId: env.NODE_ENV === "development" ? sepolia.id : mainnet.id,
      verifyingContract: verifierAddr,
    },
    primaryType: action,
    message,
    types: {
      [action]: types,
    },
  });

  try {
    await l1Rpc.contractRead(verifierAddr, "checkSignatures", guardiansAbi.raw, z.any(), [
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

export async function validateAndSaveProposalSignature(
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
    validSignature = await verifySignature({
      signer,
      signature,
      verifierAddr: addr,
      action,
      message: {
        id: proposalId,
      },
      types: [
        {
          name: "id",
          type: "uint256",
        },
      ],
      contractName: "Guardians",
    });
  } else {
    const members = await councilMembers();
    if (!members.includes(signer)) {
      throw badRequest(
        `Signer is not a security council member. Only the security council can execute this action: ${action}`
      );
    }

    const addr = await councilAddress();
    validSignature = await verifySignature({
      signer,
      signature,
      verifierAddr: addr,
      action,
      message: {
        id: proposalId,
      },
      types: [
        {
          name: "id",
          type: "uint256",
        },
      ],
      contractName: "SecurityCouncil",
    });
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

export async function validateAndSaveFreezeSignature({
  signature,
  signer,
  action,
  proposal,
}: {
  signature: Hex;
  signer: Hex;
  action: Action;
  proposal: InferSelectModel<typeof freezeProposalsTable>;
}) {
  if (
    ![
      "ApproveSoftFreeze",
      "ApproveHardFreeze",
      "ApproveUnfreeze",
      "ApproveSetSoftFreezeThreshold",
    ].includes(action)
  ) {
    throw badRequest("Invalid action");
  }

  const securityCouncilMembers = await councilMembers();
  if (!securityCouncilMembers.includes(signer)) {
    throw badRequest(
      `Signer is not part of the security council. Only security council members can execute this action: ${action}`
    );
  }

  let message = {};
  const validUntil = Math.floor(proposal.validUntil.getTime() / 1000);
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    message = {
      threshold: proposal.softFreezeThreshold,
      nonce: proposal.externalId,
      validUntil,
    };
  } else {
    message = {
      nonce: proposal.externalId,
      validUntil,
    };
  }

  let types = [];
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    types = [
      {
        name: "threshold",
        type: "uint256",
      },
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  } else {
    types = [
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  }

  const addr = await councilAddress();
  const validSignature = await verifySignature({
    signer,
    signature,
    verifierAddr: addr,
    action,
    message,
    types,
    contractName: "Guardians",
  });

  if (!validSignature) {
    throw badRequest("Invalid signature");
  }

  await createOrIgnoreSignature({
    action,
    signature,
    signer,
    freezeProposal: proposal.id,
  });
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
