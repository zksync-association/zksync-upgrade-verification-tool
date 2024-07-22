import { cacheExchange, Client, fetchExchange, gql } from "@urql/core";

// Currently Set to Arbitrum since no test data available
export const TALLY_GOV_ID = "eip155:42161:0x789fC99093B09aD01C34DC7251D0C89ce743e5a4"

export const graphQLClient = () =>
  new Client({
    url: "https://api.tally.xyz/query",
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => {
      const token = process.env.TALLY_API_KEY;
      if (!token) {
        console.log("TALLY_API_KEY is not set");
        // TODO add error segment here
      }
      return {
        headers: { "Api-Key": token ? token : "" },
      };
    },
  });

export const getTallyInfo = async (proposalId: string) => {
  console.log("Fetching Tally Info for proposalId: ", proposalId);
  const client = graphQLClient();
  return client.query(TALLY_QUERY, { proposalId, governorId: TALLY_GOV_ID });
};

const TALLY_QUERY = gql`
 query Proposal($proposalId: String!, $governorId: AccountID!) {
    proposal(
        input: {
            onchainId: $proposalId
            governorId: $governorId
            # onchainId: "16862129143470948068395175122563617380780349421262247459634070073165514405758"
            # governorId: "eip155:42161:0x789fC99093B09aD01C34DC7251D0C89ce743e5a4"
        }
    ) {
        onchainId
        chainId
        createdAt
        l1ChainId
        originalId
        quorum
        status
        governor {
            isPrimary
            name
            quorum
            type
        }
        metadata {
            title
            description
            eta
            ipfsHash
            txHash
            discourseURL
            snapshotURL
        }
    }
}
`;