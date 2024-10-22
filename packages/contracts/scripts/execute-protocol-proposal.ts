import "dotenv/config"
import { keccak256 } from "viem";

import { withProtocolGovernor } from "./util/with-protocol-governor.js";
import { EXAMPLE_PROTOCOL_UPGRADE } from "./util/constants";

async function main() {
  await withProtocolGovernor(async (contract) => {
    const executeTx = await contract
        .getFunction("execute")
        .send(
            EXAMPLE_PROTOCOL_UPGRADE.addresses,
            EXAMPLE_PROTOCOL_UPGRADE.values,
            EXAMPLE_PROTOCOL_UPGRADE.callDatas,
            keccak256(Buffer.from(EXAMPLE_PROTOCOL_UPGRADE.description))
        );
    await executeTx.wait();
  })

  console.log("Executed OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ failed");
  });