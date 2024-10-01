import { expect } from "chai";
import hre from "hardhat";
import fs from "node:fs";
import type { Address, PublicClient } from "viem";
import { deploySetup } from "../helpers/deploy-setup.js";

const availableAddresses = [
  "ProtocolUpgradeHandler",
  "Guardians",
  "SecurityCouncil",
  "Counter",
  "EmergencyUpgradeBoard",
  "ZkGovOpsGovernor",
  "ZkTokenGovernor",
] as const;
type AvailableAddresses = (typeof availableAddresses)[number];

function getDeployedAddresses() {
  const content = fs.readFileSync("addresses.txt", "utf-8");
  const addresses: Record<AvailableAddresses, Address> = {} as Record<AvailableAddresses, Address>;

  for (const line of content.split("\n")) {
    const [key, value] = line.split(":");
    if (key && value) {
      addresses[key.trim() as AvailableAddresses] = value.trim() as Address;
    }
  }
  return addresses;
}

describe("Deploy:All tests", () => {
  let client: PublicClient;
  let addresses: Record<AvailableAddresses, `0x${string}`>;

  before(async () => {
    await deploySetup();
    client = await hre.viem.getPublicClient();
    addresses = getDeployedAddresses();
    console.log("Deployed addresses:", addresses);
  });

  it("should have deployed the ProtocolUpgradeHandler contract", async () => {
    const address = addresses.ProtocolUpgradeHandler;
    const securityCouncil = await client.readContract({
      address,
      abi: [
        {
          inputs: [],
          name: "securityCouncil",
          outputs: [{ internalType: "address", name: "", type: "address" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "securityCouncil",
    });
    expect(securityCouncil).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("should have deployed the SecurityCouncil contract", async () => {
    const address = addresses.SecurityCouncil;
    const protocolUpgradeHandler = await client.readContract({
      address,
      abi: [
        {
          inputs: [],
          name: "PROTOCOL_UPGRADE_HANDLER",
          outputs: [
            { internalType: "contract IProtocolUpgradeHandler", name: "", type: "address" },
          ],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "PROTOCOL_UPGRADE_HANDLER",
    });
    expect(protocolUpgradeHandler).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("should have deployed the Guardians contract", async () => {
    const address = addresses.Guardians;
    const protocolUpgradeHandler = await client.readContract({
      address,
      abi: [
        {
          inputs: [],
          name: "PROTOCOL_UPGRADE_HANDLER",
          outputs: [
            { internalType: "contract IProtocolUpgradeHandler", name: "", type: "address" },
          ],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "PROTOCOL_UPGRADE_HANDLER",
    });
    expect(protocolUpgradeHandler).to.not.equal("0x0000000000000000000000000000000000000000");
  });
});
