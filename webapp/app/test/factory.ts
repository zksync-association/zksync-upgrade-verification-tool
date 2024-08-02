import { createOrIgnoreProposal as createDbProposal } from "@/.server/db/dto/proposals";
import type { emergencyProposalsTable, proposalsTable } from "@/.server/db/schema";
import { faker } from "@faker-js/faker";
import type { InferInsertModel } from "drizzle-orm";

export const createRandomProposal = async () => {
  const params = createRandomProposalParams();
  await createDbProposal({
    externalId: params.externalId,
    calldata: params.calldata,
    proposedOn: params.proposedOn,
    executor: params.executor,
    transactionHash: params.transactionHash,
  });

  return params;
};

export const createRandomProposalParams = () => {
  const randomLength = Math.floor(Math.random() * (50 - 16 + 1)) * 2 + 32;

  return {
    externalId: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    calldata: faker.string.hexadecimal({ length: randomLength }) as `0x${string}`,
    proposedOn: faker.date.anytime(),
    executor: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    transactionHash: faker.string.hexadecimal({ length: 32 }) as `0x${string}`,
  } satisfies InferInsertModel<typeof proposalsTable>;
};

export const createRandomEmergencyProposalParams = () => {
  const randomLength = Math.floor(Math.random() * (50 - 16 + 1)) * 2 + 32;
  const timestamp = faker.date.anytime();
  return {
    title: faker.lorem.sentence(),
    value: faker.number.int(),
    status: "ACTIVE" as const,
    targetAddress: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    externalId: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    calldata: faker.string.hexadecimal({ length: randomLength }) as `0x${string}`,
    salt: faker.string.hexadecimal({ length: 64 }) as `0x${string}`,
    changedOn: timestamp,
    proposedOn: timestamp,
    proposer: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
  } satisfies InferInsertModel<typeof emergencyProposalsTable>;
};
