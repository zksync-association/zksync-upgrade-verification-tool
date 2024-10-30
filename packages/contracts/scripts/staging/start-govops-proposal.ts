import "dotenv/config";
import { keccak256, numberToHex } from "viem";
import { EXAMPLE_GOVOPS_PROPOSAL } from "../util/constants.js";
import { getGovOpsGovernor } from "../util/with-protocol-governor.js";

async function main() {
  const contract = await getGovOpsGovernor();
  const response = await contract
    .getFunction("propose")
    .send(
      EXAMPLE_GOVOPS_PROPOSAL.addresses,
      EXAMPLE_GOVOPS_PROPOSAL.values,
      EXAMPLE_GOVOPS_PROPOSAL.callDatas,
      EXAMPLE_GOVOPS_PROPOSAL.description
    );
  await response.wait();

  const proposalId = await contract
    .getFunction("hashProposal")
    .staticCall(
      EXAMPLE_GOVOPS_PROPOSAL.addresses,
      EXAMPLE_GOVOPS_PROPOSAL.values,
      EXAMPLE_GOVOPS_PROPOSAL.callDatas,
      keccak256(Buffer.from(EXAMPLE_GOVOPS_PROPOSAL.description))
    );

  console.log("Proposed OK");
  console.log(`Id=${numberToHex(proposalId)}`);
  console.log(`Addresses=${EXAMPLE_GOVOPS_PROPOSAL.addresses}`);
  console.log(`Values=${EXAMPLE_GOVOPS_PROPOSAL.values}`);
  console.log(`CallDatas=${EXAMPLE_GOVOPS_PROPOSAL.callDatas}`);
  console.log(`Description=${EXAMPLE_GOVOPS_PROPOSAL.description}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
