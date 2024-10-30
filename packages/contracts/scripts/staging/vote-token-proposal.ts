import "dotenv/config";
import { calculateProposalId, getTokenGovernor } from "../util/with-protocol-governor.js";
import { EXAMPLE_TOKEN_PROPOSAL } from "../util/constants.js";

async function main() {
  const contract = await getTokenGovernor();
  const proposalId = await calculateProposalId(contract, EXAMPLE_TOKEN_PROPOSAL);

  const castVoteTx = await contract.getFunction("castVote").send(proposalId, 1n);
  await castVoteTx.wait();

  console.log("Voted OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
