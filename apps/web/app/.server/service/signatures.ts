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
  councilAddress,
  councilMembers,
  emergencyBoardAddress,
  getUserAuthRole,
  guardianMembers,
  guardiansAddress,
  zkFoundationAddress,
} from "@/.server/service/authorized-users";
import { getFreezeProposalSignatureArgs } from "@/common/freeze-proposal";
import { getL2CancellationSignatureArgs } from "@/common/l2-cancellations";
import { emergencyProposalStatusSchema } from "@/common/emergency-proposal-status";
import { signActionEnum } from "@/common/sign-action";
import { GUARDIANS_COUNCIL_THRESHOLD, SEC_COUNCIL_THRESHOLD } from "@/utils/emergency-proposals";
import { badRequest, notFound } from "@/utils/http";
import { type BasicSignature, classifySignatures } from "@/utils/signatures";
import { type Hex, hexToBigInt } from "viem";
import {
  assertSignatureIsValidMultisig,
  assertValidSignatureZkFoundation,
} from "@/.server/service/verify-signature-multisig";
import {
  emergencyUpgradeActionForRole,
  regularUpgradeContractNameByRole,
  standardUpgradeActionForRole,
  UserRoleEnum,
} from "@/common/user-role-schema";
import { getProposalByExternalId } from "@/.server/db/dto/proposals";
import { getFreezeProposalById } from "@/.server/db/dto/freeze-proposals";
import { getL2CancellationById } from "@/.server/db/dto/l2-cancellations";
import { freezeActionFromType } from "@/common/freeze-proposal-type";
import { multisigContractForRole } from "@/.server/user-role-data";

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

async function emergencyUpgrade(externalId: Hex, signer: Hex, signature: Hex) {
  const proposal = await getEmergencyProposalByExternalId(externalId);

  if (!proposal) {
    throw notFound();
  }

  if (
    proposal.status === emergencyProposalStatusSchema.enum.CLOSED ||
    proposal.status === emergencyProposalStatusSchema.enum.BROADCAST
  ) {
    throw badRequest(
      `Emergency proposal ${proposal.externalId} is on status ${proposal.status} which does not support new signatures.`
    );
  }

  const role = await getUserAuthRole(signer);

  const types = [
    {
      name: "id",
      type: "bytes32",
    },
  ];

  const action = emergencyUpgradeActionForRole(role);

  const message = {
    id: proposal.externalId,
  };

  const contractName = "EmergencyUpgradeBoard";
  const verifierAddr = await emergencyBoardAddress();

  if (role === UserRoleEnum.enum.zkFoundation) {
    await assertValidSignatureZkFoundation(
      signer,
      signature,
      verifierAddr,
      action,
      message,
      types,
      contractName
    );
  } else {
    await assertSignatureIsValidMultisig({
      signer,
      signature,
      verifierAddr: verifierAddr,
      action,
      message: message,
      types,
      contractName: contractName,
      targetContract: await multisigContractForRole(role),
    });
  }

  await db.transaction(async (sqltx) => {
    const dto = {
      action,
      signature,
      emergencyProposal: proposal.externalId,
      signer,
    };

    const oldSignatures = await getSignaturesByEmergencyProposalId(proposal.externalId, {
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

async function regularUpgrade(externalId: Hex, signer: Hex, signature: Hex) {
  const proposal = await getProposalByExternalId(externalId);
  if (!proposal) {
    throw notFound();
  }

  const role = await getUserAuthRole(signer);

  const action = standardUpgradeActionForRole(role);

  const types = [
    {
      name: "id",
      type: "bytes32",
    },
  ];

  const contractAddress = await multisigContractForRole(role);

  await assertSignatureIsValidMultisig({
    signer,
    signature,
    verifierAddr: contractAddress,
    action,
    message: {
      id: proposal.externalId,
    },
    types,
    contractName: regularUpgradeContractNameByRole(role),
    targetContract: contractAddress,
  });

  const dto = {
    action,
    signature,
    proposal: proposal.externalId,
    signer,
  };

  await createOrIgnoreSignature(dto);
}

async function extendVetoPeriod(externalId: Hex, signer: Hex, signature: Hex) {
  const proposal = await getProposalByExternalId(externalId);
  if (!proposal) {
    throw notFound();
  }

  const role = await getUserAuthRole(signer);

  if (role !== UserRoleEnum.enum.guardian) {
    throw badRequest("Only guardians can extend legal veto period");
  }

  const contractAddress = await guardiansAddress();

  const types = [
    {
      name: "id",
      type: "bytes32",
    },
  ];

  const action = signActionEnum.enum.ExtendLegalVetoPeriod;
  await assertSignatureIsValidMultisig({
    signer,
    signature,
    verifierAddr: contractAddress,
    action,
    message: {
      id: proposal.externalId,
    },
    types,
    contractName: regularUpgradeContractNameByRole(role),
    targetContract: contractAddress,
  });

  const dto = {
    action,
    signature,
    proposal: proposal.externalId,
    signer,
  };

  await createOrIgnoreSignature(dto);
}

async function freeze(freezeId: number, signer: Hex, signature: Hex) {
  const freeze = await getFreezeProposalById(freezeId);
  if (!freeze) {
    throw notFound();
  }

  const role = await getUserAuthRole(signer);

  if (role !== UserRoleEnum.enum.securityCouncil) {
    throw badRequest("only security council members can freeze contract");
  }

  const action = freezeActionFromType(freeze.type);

  const { message, types } = getFreezeProposalSignatureArgs(freeze);

  await assertSignatureIsValidMultisig({
    signer,
    signature,
    verifierAddr: await councilAddress(),
    action,
    message,
    types,
    contractName: "SecurityCouncil",
    targetContract: await councilAddress(),
  });

  await createOrIgnoreSignature({
    action,
    signature,
    signer,
    freezeProposal: freeze.id,
  });
}

async function l2Cancellation(vetoId: number, signer: Hex, signature: Hex) {
  const cancellation = await getL2CancellationById(vetoId);
  if (!cancellation) {
    throw notFound();
  }

  const role = await getUserAuthRole(signer);

  if (role !== UserRoleEnum.enum.guardian) {
    throw badRequest("only guardians can extend legal veto period");
  }

  const { message, types } = getL2CancellationSignatureArgs({
    proposal: {
      externalId: cancellation.externalId,
      nonce: cancellation.nonce,
    },
    l2GasLimit: hexToBigInt(cancellation.txRequestGasLimit),
    l2GasPerPubdataByteLimit: hexToBigInt(cancellation.txRequestL2GasPerPubdataByteLimit),
    txMintValue: hexToBigInt(cancellation.txRequestTxMintValue),
    refundRecipient: cancellation.txRequestRefundRecipient,
    l2GovernorAddress: cancellation.txRequestTo,
  });

  const contractAddress = await guardiansAddress();

  await assertSignatureIsValidMultisig({
    signer,
    signature,
    verifierAddr: contractAddress,
    action: "CancelL2GovernorProposal",
    message,
    types,
    contractName: "Guardians",
    targetContract: contractAddress,
  });

  await createOrIgnoreSignature({
    action: "CancelL2GovernorProposal",
    signature,
    signer,
    l2GovernorProposal: cancellation.id,
  });
}

export const SIGNATURE_FACTORIES = {
  emergencyUpgrade,
  regularUpgrade,
  extendVetoPeriod,
  freeze,
  l2Cancellation,
} as const;
