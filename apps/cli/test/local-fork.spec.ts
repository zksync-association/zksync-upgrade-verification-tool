import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { LocalFork } from "../src/reports/local-fork";

describe("LocalFork", () => {
  let fork: LocalFork;
  beforeEach(async () => {
    fork = await LocalFork.create("https://eth.llamarpc.com", "mainnet");
  });

  afterEach(async () => {
    await fork.tearDown();
  });

  it("can get correct network id:", async () => {
    const rpc = fork.rpc();
    const netVersion = await rpc.netVersion();
    expect(netVersion).toEqual("1");
  });

  it("can fund an anddress", async () => {
    const someAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const value = parseEther("1");
    await fork.fund(someAddress, value);
    const rpc = fork.rpc();
    const balance = await rpc.balanceOf(someAddress);
    expect(balance).toEqual(value);
  });
});
