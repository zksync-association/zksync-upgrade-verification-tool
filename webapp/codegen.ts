import type { CodegenConfig } from "@graphql-codegen/cli";
import dotenv from "dotenv";
dotenv.config();

const config: CodegenConfig = {
  overwrite: true,
  schema: [
    {
      "https://api.tally.xyz/query": {
        headers: {
          "Api-Key": `${process.env.TALLY_API_KEY || "ERROR: TALLY_API_KEY is not set"}`,
        },
      },
    },
  ],
  documents: "app/.server/service/**/*.graphql",
  generates: {
    "app/.server/service/generated/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typescript-urql"],
      config: {
        rawRequest: true,
        inlineFragmentTypes: "combine",
      },
    },
  },
};

export default config;
