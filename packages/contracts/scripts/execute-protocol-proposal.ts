import "dotenv/config";
import { keccak256 } from "viem";

import { getProtocolGovernor } from "./util/with-protocol-governor.js";
import { EXAMPLE_PROTOCOL_UPGRADE } from "./util/constants.js";

async function main() {
  const contract = await getProtocolGovernor();
  const queueTx = await contract
    .getFunction("queue")
    .send(
      EXAMPLE_PROTOCOL_UPGRADE.addresses,
      EXAMPLE_PROTOCOL_UPGRADE.values,
      EXAMPLE_PROTOCOL_UPGRADE.callDatas,
      keccak256(Buffer.from(EXAMPLE_PROTOCOL_UPGRADE.description))
    );
  await queueTx.wait();

  console.log("Queue OK");

  const executeTx = await contract
    .getFunction("execute")
    .send(
      EXAMPLE_PROTOCOL_UPGRADE.addresses,
      EXAMPLE_PROTOCOL_UPGRADE.values,
      EXAMPLE_PROTOCOL_UPGRADE.callDatas,
      keccak256(Buffer.from(EXAMPLE_PROTOCOL_UPGRADE.description))
    );
  await executeTx.wait();

  console.log("Execute OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ failed");
});
