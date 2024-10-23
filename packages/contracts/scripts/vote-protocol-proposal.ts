import "dotenv/config"
import { withProtocolGovernor } from "./util/with-protocol-governor.js";

async function main() {
  const proposalId = process.env.PROPOSAL_ID

  if (!proposalId) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  await withProtocolGovernor(async (contract, wallet) => {
    const castVoteTx = await contract.getFunction("castVote").send(proposalId, 1n);
    await castVoteTx.wait();

    console.log("Voted OK");
  })
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ failed");
  });