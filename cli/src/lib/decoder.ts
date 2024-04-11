import type { Abi } from "viem";
import { account20String, type Account20String, type HashString } from "../schema";
import { ETHERSCAN_ENDPOINTS, type Network } from "./constants";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

export const fetchAbi = async (network: Network, contractAddress: Account20String) => {
  console.log("🔦 Checking upgrade with id: 1234");

  if (!ETHERSCAN_KEY) {
    throw new Error("No Etherscan API key found in environment variables");
  }
  const endpoint = ETHERSCAN_ENDPOINTS[network];
  const contractAddr = account20String.parse("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  const query = buildQueryString(endpoint, contractAddr, ETHERSCAN_KEY);
  const response = await fetch(query);

  // TODO: Parse this with zod
  const json = (await response.json()) as any;
  return json.result as Abi;
};

const buildQueryString = (endpoint: HashString, address: Account20String, apiToken: string) => {
  return `${endpoint}?module=contract&action=getabi&address=${address}&apikey=${apiToken}`;
};
