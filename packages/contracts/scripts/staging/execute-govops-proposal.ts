import "dotenv/config";
import { keccak256 } from "viem";

import { getGovOpsGovernor, getProtocolGovernor } from "../util/with-protocol-governor.js";
import { EXAMPLE_GOVOPS_PROPOSAL, EXAMPLE_PROTOCOL_UPGRADE } from "../util/constants.js";

async function main() {
  const contract = await getGovOpsGovernor();
  const queueTx = await contract
    .getFunction("queue")
    .send(
      EXAMPLE_GOVOPS_PROPOSAL.addresses,
      EXAMPLE_GOVOPS_PROPOSAL.values,
      EXAMPLE_GOVOPS_PROPOSAL.callDatas,
      keccak256(Buffer.from(EXAMPLE_GOVOPS_PROPOSAL.description))
    );
  await queueTx.wait();

  console.log("Queue OK");

  const executeTx = await contract
    .getFunction("execute")
    .send(
      EXAMPLE_GOVOPS_PROPOSAL.addresses,
      EXAMPLE_GOVOPS_PROPOSAL.values,
      EXAMPLE_GOVOPS_PROPOSAL.callDatas,
      keccak256(Buffer.from(EXAMPLE_GOVOPS_PROPOSAL.description))
    );
  await executeTx.wait();

  console.log("Execute OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
