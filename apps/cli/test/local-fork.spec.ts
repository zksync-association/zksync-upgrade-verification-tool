import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEther, padHex } from "viem";
import { LocalFork } from "../src/reports/local-fork";

describe("LocalFork", () => {
  let fork: LocalFork;

  beforeAll(async () => {
    fork = await LocalFork.create("https://eth.llamarpc.com", "mainnet");
  });

  afterAll(async () => {
    await fork.tearDown();
  });

  it("can get correct network id:", async () => {
    const rpc = fork.rpc();
    const netVersion = await rpc.netVersion();
    expect(netVersion).toEqual("1");
  });

  it("can fund an an address", async () => {
    const someAddress = padHex("0xaa", { size: 20 });
    const value = parseEther("1");
    const rpc = fork.rpc();

    expect(await rpc.balanceOf(someAddress)).toEqual(0n);
    await fork.fund(someAddress, value);
    const balance = await rpc.balanceOf(someAddress);
    expect(balance).toEqual(value);
  });
});
