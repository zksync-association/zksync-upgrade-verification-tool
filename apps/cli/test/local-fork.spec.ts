import { describe, expect, it } from "vitest";
import { parseEther, padHex, zeroAddress } from "viem";
import { LocalFork } from "../src/reports/local-fork";

describe("LocalFork", () => {
  it("can get correct network id:", async () => {
    const fork = await LocalFork.create(
      "https://ethereum-sepolia-rpc.publicnode.com",
      "sepolia",
      9090
    );
    const rpc = fork.rpc();
    const netVersion = await rpc.netVersion();
    expect(netVersion).toEqual("11155111");
    await fork.tearDown();
  });

  it("can fund an an address", async () => {
    const fork = await LocalFork.create(
      "https://ethereum-sepolia-rpc.publicnode.com",
      "sepolia",
      9091
    );
    const someAddress = padHex("0xaaaa", { size: 20 });
    const value = parseEther("1");
    const rpc = fork.rpc();

    expect(await rpc.balanceOf(someAddress)).toEqual(0n);
    await fork.fund(someAddress, value);
    const balance = await rpc.balanceOf(someAddress);
    expect(balance).toEqual(value);
    await fork.tearDown();
  });
});
