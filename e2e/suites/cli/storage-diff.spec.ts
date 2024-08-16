import { describe, expect, it } from "vitest";
import { execAsync } from "../../helpers/util";

describe("storage-diff", () => {
  it("shows the correct data", async () => {
    const { stdout } = await execAsync(
      "pnpm validate storage-diff reference/1699353977-boojum --precalculated=reference/realistic-memory-diff.json --noColor"
    );

    // Check an address
    expect(stdout).toContain(`--------------------------
name: ZkSyncHyperchainBase.s.verifier
description: Verifier contract. Used to verify aggregated proof for batches

before:
  0xdd9c826196cf3510b040a8784d85ae36674c7ed2

after:
  0x9d6c59d9a234f585b367b4ba3c62e5ec7a6179fd
--------------------------`);

    // Check a struct
    expect(stdout).toContain(`--------------------------
name: ZkSyncHyperchainBase.s.__DEPRECATED_verifierParams
description: [DEPRECATED]

before:
  .recursionNodeLevelVkHash: 0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080
  .recursionLeafLevelVkHash: 0x400a4b532c6f072c00d1806ef299300d4c104f4ac55bd8698ade78894fcadc0a
  .recursionCircuitsSetVksHash: Empty slot.

after:
  .recursionNodeLevelVkHash: 0xf520cd5b37e74e19fdb369c8d676a04dce8a19457497ac6686d2bb95d94109c8
  .recursionLeafLevelVkHash: 0x435202d277dd06ef3c64ddd99fda043fc27c2bd8b7c66882966840202c27f4f6
  .recursionCircuitsSetVksHash: Empty slot.
--------------------------`);

    // Check a list
    expect(stdout).toContain(`--------------------------
name: DiamondStorage.facets
description: The array of all unique facet addresses that belong to the diamond proxy

before:
  - 0x230214f0224c7e0485f348a79512ad00514db1f7
  - 0x10113bb3a8e64f8ed67003126adc8ce74c34610c
  - 0xa57f9ffd65fc0f5792b5e958df42399a114ec7e7
  - 0xfd3779e6214ebbd40f5f5890351298e123a46ba6

after:
  - 0x342a09385e9bad4ad32a6220765a6c333552e565
  - 0x345c6ca2f3e08445614f4299001418f125ad330a
  - 0x7814399116c17f2750ca99cbfd2b75ba9a0793d7
  - 0x1a451d9bfbd176321966e9bc540596ca9d39b4b1
--------------------------`);

    // Check some mapping keys:
    expect(stdout).toContain(
      "[0xe58bb639]: .facetAddress: 0x230214f0224c7e0485f348a79512ad00514db1f7"
    );
    expect(stdout).toContain(
      "[0xfacd743b]: .facetAddress: 0x10113bb3a8e64f8ed67003126adc8ce74c34610c"
    );
    expect(stdout).toContain(
      "[0x4fc07d75]: .facetAddress: 0x10113bb3a8e64f8ed67003126adc8ce74c34610c"
    );
  });

  it("matches snapshot", async () => {
    const { stdout } = await execAsync(
      "pnpm validate storage-diff reference/1699353977-boojum --precalculated=reference/realistic-memory-diff.json --noColor"
    );
    expect(stdout).toMatchSnapshot();
  });
});
