import "dotenv/config";
import { getZkTokenContract, getZkWallet } from "./util/with-protocol-governor";

async function main() {
  const zkWallet = getZkWallet();
  const contract = await getZkTokenContract();
  await contract.getFunction("delegate").send(zkWallet.address);
  console.log("Delegate OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log("❌ delegate tokens failed");
});
