import { calculateProposalId, getGovOpsGovernor } from "../util/with-protocol-governor.js";
import { ALL_PROPOSAL_STATES, EXAMPLE_GOVOPS_PROPOSAL } from "../util/constants.js";
import "dotenv/config";

async function main() {
  const contract = await getGovOpsGovernor();
  const proposalId = calculateProposalId(contract, EXAMPLE_GOVOPS_PROPOSAL);
  const proposalStateNumber = await contract.getFunction("state").staticCall(proposalId);
  const proposalVotes = await contract.getFunction("proposalVotes").staticCall(proposalId);

  console.log(`Current state: ${ALL_PROPOSAL_STATES[proposalStateNumber]}`);
  console.log(`Vote count: ${proposalVotes}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
