import { getZkGovOpsProposals } from "@/.server/service/l2-governor-proposals";

export async function loader() {
  await getZkGovOpsProposals();
  return null;
}

export default function L2Proposals() {
  return null;
}
