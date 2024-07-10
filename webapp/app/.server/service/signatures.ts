import { createOrIgnoreSignature } from "@/.server/db/dto/signatures";
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
import { zodHex } from "validate-cli/src";
import { type Hex, hashTypedData } from "viem";
import { TypeOf, z, ZodAny, ZodType } from "zod";
import { actionSchema } from "@/.server/db/schema";


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
      chainId: env.NODE_ENV === "development" ? 31337 : 1,
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
  const parsed = parser.safeParse(value)
  if (!parsed.success) {
    throw badRequest(parsed.error.message)
  }
  return parsed.data
}

export async function validateAndSaveSignature(
  signature: string,
  signer: string,
  action: string,
  proposalId: string
) {
  const signatureHex = parseOrBadRequest(signature, zodHex);
  const signerHex = parseOrBadRequest(signer, zodHex) ;
  const parsedAction = parseOrBadRequest(action ,actionSchema);
  const proposalIdHex = parseOrBadRequest(proposalId, zodHex);

  let validSignature: boolean;
  if (parsedAction === "ExtendLegalVetoPeriod" || parsedAction === "ApproveUpgradeGuardians") {
    const guardians = await guardianMembers();
    if (!guardians.includes(signerHex)) {
      throw badRequest(
        `Signer is not a guardian. Only guardians can execute this action: ${parsedAction}`
      );
    }

    const addr = await guardiansAddress();
    validSignature = await verifySignature(
      signerHex,
      signatureHex,
      addr,
      parsedAction,
      proposalIdHex,
      "Guardians"
    );
  } else {
    const members = await councilMembers();
    if (!members.includes(signerHex)) {
      throw badRequest(
        `Signer is not a security council member. Only the security council can execute this action: ${parsedAction}`
      );
    }

    const addr = await councilAddress();
    validSignature = await verifySignature(
      signerHex,
      signatureHex,
      addr,
      parsedAction,
      proposalIdHex,
      "SecurityCouncil"
    );
  }

  if (!validSignature) {
    throw badRequest("Invalid signature");
  }

  const dto = {
    action: parsedAction,
    signature: signatureHex,
    proposal: proposalIdHex,
    signer: signerHex,
  };

  await createOrIgnoreSignature(dto);
}
