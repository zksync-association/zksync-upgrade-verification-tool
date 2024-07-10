import { createOrIgnoreSignature } from "@/.server/db/dto/signatures";
import type { Action, actionSchema } from "@/.server/db/schema";
import {
  councilAddress,
  councilMembers,
  guardianMembers,
  guardiansAddress,
} from "@/.server/service/authorized-users";
import { l1RpcProposals } from "@/.server/service/clients";
import { guardiansAbi } from "@/.server/service/protocol-upgrade-handler-abi";
import { badRequest } from "@/utils/http";
import { env } from "@config/env.server";
import { type Hex, hashTypedData } from "viem";
import { mainnet, sepolia } from "wagmi/chains";
import { type TypeOf, type ZodType, z } from "zod";

type ProposalAction = z.infer<typeof actionSchema>;

async function verifySignature(
  signer: Hex,
  signature: Hex,
  verifierAddr: Hex,
  action: ProposalAction,
  proposalId: Hex,
  contractName: string
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
    await l1RpcProposals.contractRead(verifierAddr, "checkSignatures", guardiansAbi.raw, z.any(), [
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

function parseOrBadRequest<T extends ZodType>(value: any, parser: T): TypeOf<typeof parser> {
  const parsed = parser.safeParse(value);
  if (!parsed.success) {
    throw badRequest(parsed.error.message);
  }
  return parsed.data;
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
      "Guardians"
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
      "SecurityCouncil"
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
