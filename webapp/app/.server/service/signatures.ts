import { db } from "@/.server/db";
import {
  getEmergencyProposalByExternalId,
  updateEmergencyProposal,
} from "@/.server/db/dto/emergency-proposals";
import {
  createOrIgnoreSignature,
  getSignaturesByEmergencyProposalId,
} from "@/.server/db/dto/signatures";
import {
  type freezeProposalsTable,
  type l2CancellationsTable,
  signaturesTable,
} from "@/.server/db/schema";
import {
  councilAddress,
  councilMembers,
  emergencyBoardAddress,
  guardianMembers,
  guardiansAddress,
  zkFoundationAddress,
} from "@/.server/service/authorized-users";
import { l1Rpc } from "@/.server/service/clients";
import { guardiansAbi } from "@/.server/service/contract-abis";
import { getFreezeProposalSignatureArgs } from "@/common/freeze-proposal";
import { getL2CancellationSignatureArgs } from "@/common/l2-cancellations";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import type { SignAction } from "@/common/sign-action";
import { GUARDIANS_COUNCIL_THRESHOLD, SEC_COUNCIL_THRESHOLD } from "@/utils/emergency-proposals";
import { badRequest, notFound } from "@/utils/http";
import { type BasicSignature, classifySignatures } from "@/utils/signatures";
import { env } from "@config/env.server";
import { type InferSelectModel, and, asc, eq } from "drizzle-orm";
import { type Hex, hashTypedData, hexToBigInt } from "viem";
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
  targetContract,
}: {
  signer: Hex;
  signature: Hex;
  verifierAddr: Hex;
  action: SignAction;
  contractName: string;
  types: { name: string; type: string }[];
  message: { [_key: string]: any };
  targetContract: Hex;
}) {
  const digest = hashTypedData({
    domain: {
      name: contractName,
      version: "1",
      chainId: env.ETH_NETWORK === "mainnet" ? mainnet.id : sepolia.id,
      verifyingContract: verifierAddr,
    },
    primaryType: action,
    message,
    types: {
      [action]: types,
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
  } catch {
    return false;
  }
}

async function shouldMarkProposalAsReady(allSignatures: BasicSignature[]): Promise<boolean> {
  const guardians = await guardianMembers();
  const council = await councilMembers();
  const foundation = await zkFoundationAddress();

  const {
    guardians: guardianSignatures,
    council: councilSignatures,
    foundation: foundationSignature,
  } = classifySignatures(guardians, council, foundation, allSignatures);

  return (
    guardianSignatures.length >= GUARDIANS_COUNCIL_THRESHOLD &&
    councilSignatures.length >= SEC_COUNCIL_THRESHOLD &&
    foundationSignature !== null
  );
}

export async function saveEmergencySignature(
  signature: Hex,
  signer: Hex,
  action: SignAction,
  emergencyProposalId: Hex
) {
  switch (action) {
    case "ExecuteEmergencyUpgradeGuardians": {
      const isValid = await verifySignature({
        signer,
        signature,
        verifierAddr: await emergencyBoardAddress(),
        action,
        message: {
          id: emergencyProposalId,
        },
        types: [
          {
            name: "id",
            type: "bytes32",
          },
        ],
        contractName: "EmergencyUpgradeBoard",
        targetContract: await guardiansAddress(),
      });
      if (!isValid) {
        throw badRequest("Invalid signature provided");
      }
      break;
    }
    case "ExecuteEmergencyUpgradeSecurityCouncil": {
      const isValid = await verifySignature({
        signer,
        signature,
        verifierAddr: await emergencyBoardAddress(),
        action,
        message: {
          id: emergencyProposalId,
        },
        types: [
          {
            name: "id",
            type: "bytes32",
          },
        ],
        contractName: "EmergencyUpgradeBoard",
        targetContract: await councilAddress(),
      });
      if (!isValid) {
        throw badRequest("Invalid signature provided");
      }
      break;
    }
    case "ExecuteEmergencyUpgradeZKFoundation":
      // TODO: Check how to validate this signature.
      break;
    default:
      throw badRequest(`Unknown signature action: ${action}`);
  }

  await db.transaction(async (sqltx) => {
    const proposal = await getEmergencyProposalByExternalId(emergencyProposalId, { tx: sqltx });

    if (!proposal) {
      throw notFound();
    }

    if (proposal.status !== emergencyProposalStatusSchema.enum.ACTIVE) {
      throw badRequest("Proposal is not accepting more signatures");
    }

    const dto = {
      action,
      signature,
      emergencyProposal: emergencyProposalId,
      signer,
    };

    const oldSignatures = await getSignaturesByEmergencyProposalId(emergencyProposalId, {
      tx: sqltx,
    });
    const allSignatures = [...oldSignatures, dto];

    if (await shouldMarkProposalAsReady(allSignatures)) {
      proposal.status = emergencyProposalStatusSchema.enum.READY;
      await updateEmergencyProposal(proposal);
    }

    await createOrIgnoreSignature(dto, { tx: sqltx });
  });
}

export async function validateAndSaveProposalSignature(
  signature: Hex,
  signer: Hex,
  action: SignAction,
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
          type: "bytes32",
        },
      ],
      contractName: "Guardians",
      targetContract: addr,
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
          type: "bytes32",
        },
      ],
      contractName: "SecurityCouncil",
      targetContract: addr,
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
  action: SignAction;
  proposal: InferSelectModel<typeof freezeProposalsTable>;
}) {
  if (
    action !== "SoftFreeze" &&
    action !== "HardFreeze" &&
    action !== "Unfreeze" &&
    action !== "SetSoftFreezeThreshold"
  ) {
    throw badRequest("Invalid action");
  }

  const securityCouncilMembers = await councilMembers();
  if (!securityCouncilMembers.includes(signer)) {
    throw badRequest(
      `Signer is not part of the security council. Only security council members can execute this action: ${action}`
    );
  }

  const { message, types } = getFreezeProposalSignatureArgs(proposal);

  const addr = await councilAddress();
  const validSignature = await verifySignature({
    signer,
    signature,
    verifierAddr: addr,
    action,
    message,
    types,
    contractName: "SecurityCouncil",
    targetContract: addr,
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

export async function validateAndSaveL2CancellationSignature({
  signature,
  signer,
  proposal,
}: {
  signature: Hex;
  signer: Hex;
  proposal: InferSelectModel<typeof l2CancellationsTable>;
}) {
  const enabledMembers = await guardianMembers();
  if (!enabledMembers.includes(signer)) {
    throw badRequest(
      "Signer is not part of the guardians. Only guardian members can execute this action."
    );
  }

  const { message, types } = getL2CancellationSignatureArgs({
    proposal: {
      externalId: proposal.externalId,
      nonce: proposal.nonce,
    },
    l2GasLimit: hexToBigInt(proposal.txRequestGasLimit),
    l2GasPerPubdataByteLimit: hexToBigInt(proposal.txRequestL2GasPerPubdataByteLimit),
    txMintValue: hexToBigInt(proposal.txRequestTxMintValue),
    refundRecipient: proposal.txRequestRefundRecipient,
    l2GovernorAddress: proposal.txRequestTo,
  });

  const addr = await guardiansAddress();
  const validSignature = await verifySignature({
    signer,
    signature,
    verifierAddr: addr,
    action: "CancelL2GovernorProposal",
    message,
    types,
    contractName: "Guardians",
    targetContract: addr,
  });

  if (!validSignature) {
    throw badRequest("Invalid signature");
  }

  await createOrIgnoreSignature({
    action: "CancelL2GovernorProposal",
    signature,
    signer,
    l2GovernorProposal: proposal.id,
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
