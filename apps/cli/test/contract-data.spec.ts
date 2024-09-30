import { describe, it, expect } from "vitest";
import { ContractData } from "../src/etherscan/contract-data";

describe("ContractData", () => {
  it("can remap keys", async () => {
    const data = new ContractData(
      "ExampleContract",
      {
        "a/file1.txt": { content: "content1" },
        "a/file2.txt": { content: "content2" },
      },
      "some addr"
    );
    data.remapKeys("a", "b/c");

    expect(data.sources["b/c/file1.txt"]).to.eql({ content: "content1" });
    expect(data.sources["b/c/file2.txt"]).to.eql({ content: "content2" });
  });
});
