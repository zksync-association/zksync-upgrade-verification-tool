import type { Abi } from "viem";
import { getAbiSchema, account20String, type Account20String, type HashString } from "../schema";
import { ETHERSCAN_ENDPOINTS, type Network } from "./constants";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

export const fetchAbi = async (network: Network, contractAddress: Account20String) => {
  console.log(`🛬 Fetching contract ${contractAddress} abi from ${network}`);

  if (!ETHERSCAN_KEY) {
    throw new Error("No Etherscan API key found in environment variables");
  }
  const endpoint = ETHERSCAN_ENDPOINTS[network];
  const contractAddr = account20String.parse(contractAddress);
  const query = buildQueryString(endpoint, contractAddr, ETHERSCAN_KEY);
  const response = await fetch(query);

  const {message, result} = getAbiSchema.parse(await response.json());

  if (message !== "OK") {
    throw new Error(`Failed to fetch ABI for ${contractAddress}`);
  }

  return JSON.parse(result);
};

const buildQueryString = (endpoint: HashString, address: Account20String, apiToken: string) => {
  return `${endpoint}?module=contract&action=getabi&address=${address}&apikey=${apiToken}`;
};
