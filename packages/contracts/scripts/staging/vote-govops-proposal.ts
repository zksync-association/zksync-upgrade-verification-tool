import "dotenv/config";
import { calculateProposalId, getGovOpsGovernor } from "../util/with-protocol-governor.js";
import { EXAMPLE_GOVOPS_PROPOSAL } from "../util/constants";

async function main() {
  const contract = await getGovOpsGovernor();
  const proposalId = calculateProposalId(contract, EXAMPLE_GOVOPS_PROPOSAL);
  const castVoteTx = await contract.getFunction("castVote").send(proposalId, 1n);
  await castVoteTx.wait();

  console.log("Voted OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
