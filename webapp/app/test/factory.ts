import { createOrIgnoreProposal as createDbProposal } from "@/.server/db/dto/proposals";
import { faker } from "@faker-js/faker";

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
  };
};

export const createRandomEmergencyProposalParams = () => {
  const randomLength = Math.floor(Math.random() * (50 - 16 + 1)) * 2 + 32;

  return {
    title: faker.lorem.sentence(),
    value: faker.number.bigInt(),
    targetAddress: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    externalId: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    calldata: faker.string.hexadecimal({ length: randomLength }) as `0x${string}`,
    salt: faker.string.hexadecimal({ length: 64 }) as `0x${string}`,
    proposedOn: faker.date.anytime(),
    proposer: faker.string.hexadecimal({ length: 20 }) as `0x${string}`,
    transactionHash: faker.string.hexadecimal({ length: 32 }) as `0x${string}`,
  };
};
