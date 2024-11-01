import { updateEmergencyProposal } from "@/.server/db/dto/emergency-proposals";
import { updateFreezeProposal } from "@/.server/db/dto/freeze-proposals";
import { updateL2Cancellation } from "@/.server/db/dto/l2-cancellations";
import { l1Rpc } from "@/.server/service/ethereum-l1/client";
import { unauthorized } from "@/utils/http";
import { getFormDataOrThrow } from "@/utils/read-from-request";
import { env } from "@config/env.server";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { addressSchema, hexSchema } from "@repo/common/schemas";
import { isAddressEqual, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { z } from "zod";

import { defaultLogger } from "@config/log.server";
import { $path } from "remix-routes";

const logger = defaultLogger.child({
  module: $path("/resources/zk-admin-sign"),
});

export const zkAdminSignActionSchema = z.enum([
  "ArchiveEmergencyProposal",
  "ArchiveSoftFreezeProposal",
  "ArchiveHardFreezeProposal",
  "ArchiveUnfreezeProposal",
  "ArchiveSetSoftFreezeThresholdProposal",
  "ArchiveL2CancellationProposal",
]);

export type ZkAdminSignAction = z.infer<typeof zkAdminSignActionSchema>;

export const zkAdminTypedData = ({
  proposalId,
  proposalType,
  archivedReason,
  archivedOn,
  archivedBy,
}: {
  proposalId: bigint;
  proposalType: ZkAdminSignAction;
  archivedReason: string;
  archivedOn: string;
  archivedBy: Address;
}) => {
  const internalTypes = [
    {
      name: "proposalId",
      type: "uint256",
    },
    {
      name: "proposalType",
      type: "string",
    },
    {
      name: "archivedReason",
      type: "string",
    },
    {
      name: "archivedOn",
      type: "string",
    },
    {
      name: "archivedBy",
      type: "address",
    },
  ] as const;
  const types = { [proposalType]: internalTypes } as {
    [key in ZkAdminSignAction]: typeof internalTypes;
  };
  const data = {
    primaryType: proposalType,
    types,
    message: {
      proposalId,
      proposalType,
      archivedReason,
      archivedOn,
      archivedBy,
    },
  };
  return data;
};

export async function action({ request }: ActionFunctionArgs) {
  const data = await getFormDataOrThrow(request, {
    proposalId: z.coerce.bigint(),
    proposalType: zkAdminSignActionSchema,
    archivedReason: z.string(),
    archivedOn: z.string(),
    archivedBy: addressSchema,
    signature: hexSchema,
  });

  if (!env.ZK_ADMIN_ADDRESS.some((adminAddress) => isAddressEqual(data.archivedBy, adminAddress))) {
    logger.error({ archivedBy: data.archivedBy }, "Address is not zk admin");
    throw unauthorized();
  }

  // Validate signature
  const isValid = await l1Rpc.verifyTypedData({
    domain: {
      name: "ZkAdmin",
      version: "1",
      chainId: env.ETH_NETWORK === "mainnet" ? mainnet.id : sepolia.id,
    },
    address: data.archivedBy,
    signature: data.signature,
    ...zkAdminTypedData({
      proposalId: data.proposalId,
      proposalType: data.proposalType,
      archivedReason: data.archivedReason,
      archivedOn: data.archivedOn,
      archivedBy: data.archivedBy,
    }),
  });
  if (!isValid) {
    logger.error("Signature is not valid");
    throw unauthorized();
  }

  // Save signature in db
  const dto = {
    archivedOn: new Date(data.archivedOn),
    archivedReason: data.archivedReason,
    archivedBy: data.archivedBy,
    archivedSignature: data.signature,
  };

  const proposalId = Number(data.proposalId);
  switch (data.proposalType) {
    case "ArchiveEmergencyProposal": {
      await updateEmergencyProposal({
        ...dto,
        id: proposalId,
      });
      break;
    }
    case "ArchiveSoftFreezeProposal":
    case "ArchiveHardFreezeProposal":
    case "ArchiveUnfreezeProposal":
    case "ArchiveSetSoftFreezeThresholdProposal": {
      await updateFreezeProposal({
        ...dto,
        id: proposalId,
      });
      break;
    }
    case "ArchiveL2CancellationProposal": {
      await updateL2Cancellation({
        ...dto,
        id: proposalId,
      });
      break;
    }
  }

  return json({ ok: true });
}
