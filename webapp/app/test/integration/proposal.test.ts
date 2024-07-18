import { db } from "@/.server/db";
import { createOrIgnoreProposal } from "@/.server/db/dto/proposals";
import { proposalsTable } from "@/.server/db/schema";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { createRandomProposal } from "../factory";

describe("Proposal DB", () => {
  it("should create a proposal", async () => {
    const { externalId, calldata, proposedOn, executor, transactionHash } =
      await createRandomProposal();

    const proposals = await db
      .select()
      .from(proposalsTable)
      .where(eq(proposalsTable.externalId, externalId));

    expect(proposals[0]).toBeDefined();
    if (!proposals[0]) throw new Error("Proposal not found");

    const createdProposal = proposals[0];
    expect(createdProposal.calldata.toString().toLowerCase()).toEqual(
      calldata.toString().toLowerCase()
    );
    expect(createdProposal.proposedOn.getTime()).toEqual(proposedOn.getTime());
    expect(createdProposal.executor.toLowerCase()).toEqual(executor.toLowerCase());
    expect(createdProposal.transactionHash.toLowerCase()).toEqual(transactionHash.toLowerCase());
  });

  it("should ignore proposals with the same external id", async () => {
    const randomParams = await createRandomProposal();
    await createOrIgnoreProposal({
      ...randomParams,
    });

    const proposals = await db
      .select()
      .from(proposalsTable)
      .where(eq(proposalsTable.externalId, randomParams.externalId));

    expect(proposals).toHaveLength(1);
  });

  it("should get a list of proposals", async () => {
    await createRandomProposal();
    await createRandomProposal();
    const proposals = await db.select().from(proposalsTable);
    expect(proposals).toBeDefined();
    expect(proposals).toBeInstanceOf(Array);
  });
});
