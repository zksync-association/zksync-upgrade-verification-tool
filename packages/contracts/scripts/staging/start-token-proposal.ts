import "dotenv/config";
import { keccak256, numberToHex } from "viem";
import { EXAMPLE_TOKEN_PROPOSAL } from "../util/constants.js";
import { getTokenGovernor } from "../util/with-protocol-governor.js";

async function main() {
  const contract = await getTokenGovernor();
  const response = await contract
    .getFunction("propose")
    .send(
      EXAMPLE_TOKEN_PROPOSAL.addresses,
      EXAMPLE_TOKEN_PROPOSAL.values,
      EXAMPLE_TOKEN_PROPOSAL.callDatas,
      EXAMPLE_TOKEN_PROPOSAL.description
    );
  await response.wait();

  const proposalId = await contract
    .getFunction("hashProposal")
    .staticCall(
      EXAMPLE_TOKEN_PROPOSAL.addresses,
      EXAMPLE_TOKEN_PROPOSAL.values,
      EXAMPLE_TOKEN_PROPOSAL.callDatas,
      keccak256(Buffer.from(EXAMPLE_TOKEN_PROPOSAL.description))
    );

  console.log("Proposed OK");
  console.log(`Id=${numberToHex(proposalId)}`);
  console.log(`Addresses=${EXAMPLE_TOKEN_PROPOSAL.addresses}`);
  console.log(`Values=${EXAMPLE_TOKEN_PROPOSAL.values}`);
  console.log(`CallDatas=${EXAMPLE_TOKEN_PROPOSAL.callDatas}`);
  console.log(`Description=${EXAMPLE_TOKEN_PROPOSAL.description}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
