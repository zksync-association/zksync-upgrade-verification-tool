import { withProtocolGovernor } from "./util/with-protocol-governor.js";
import { ALL_PROPOSAL_STATES } from "./util/constants.js";
import "dotenv/config"

async function main() {
  const proposalId = process.env.PROPOSAL_ID

  if (!proposalId) {
    throw new Error("Please provide a proposalId via PROPOSAL_ID env var.")
  }

  await withProtocolGovernor(async (contract) => {
    const proposalStateNumber = await contract.getFunction("state").staticCall(proposalId);
    const proposalVotes = await contract.getFunction("proposalVotes").staticCall(proposalId);

    console.log(`Current state: ${ALL_PROPOSAL_STATES[proposalStateNumber]}`);
    console.log(`Vote count: ${proposalVotes}`);
  })
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ failed");
  });