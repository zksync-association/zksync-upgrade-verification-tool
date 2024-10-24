import "dotenv/config";
import { calculateProposalId, getProtocolGovernor } from "../util/with-protocol-governor.js";
import { EXAMPLE_PROTOCOL_UPGRADE } from "../util/constants";

async function main() {
  const contract = await getProtocolGovernor();
  const proposalId = calculateProposalId(contract, EXAMPLE_PROTOCOL_UPGRADE);
  const castVoteTx = await contract.getFunction("castVote").send(proposalId, 1n);
  await castVoteTx.wait();

  console.log("Voted OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
