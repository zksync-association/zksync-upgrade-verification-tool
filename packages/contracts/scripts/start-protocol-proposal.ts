import "dotenv/config";
import { keccak256, numberToHex } from "viem";
import { EXAMPLE_PROTOCOL_UPGRADE } from "./util/constants.js";
import { withProtocolGovernor } from "./util/with-protocol-governor.js";

async function main() {
  await withProtocolGovernor(async (contract) => {
    const response = await contract
      .getFunction("propose")
      .send(
        EXAMPLE_PROTOCOL_UPGRADE.addresses,
        EXAMPLE_PROTOCOL_UPGRADE.values,
        EXAMPLE_PROTOCOL_UPGRADE.callDatas,
        EXAMPLE_PROTOCOL_UPGRADE.description
      );
    await response.wait();

    const proposalId = await contract
      .getFunction("hashProposal")
      .staticCall(
        EXAMPLE_PROTOCOL_UPGRADE.addresses,
        EXAMPLE_PROTOCOL_UPGRADE.values,
        EXAMPLE_PROTOCOL_UPGRADE.callDatas,
        keccak256(Buffer.from(EXAMPLE_PROTOCOL_UPGRADE.description))
      );

    console.log("Proposed OK");
    console.log(`Id=${numberToHex(proposalId)}`);
    console.log(`Addresses=${EXAMPLE_PROTOCOL_UPGRADE.addresses}`);
    console.log(`Values=${EXAMPLE_PROTOCOL_UPGRADE.values}`);
    console.log(`CallDatas=${EXAMPLE_PROTOCOL_UPGRADE.callDatas}`);
    console.log(`Description=${EXAMPLE_PROTOCOL_UPGRADE.description}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
