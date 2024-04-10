import { lookupAndParse } from "../lib";
import path from "node:path";

export const verifyCommand = async (upgradeDirectory: string, parentDirectory?: string) => {
  console.log(`Verifying upgrade with id: ${upgradeDirectory}`);

  const { fileStatuses, parsedData } = await lookupAndParse(
    path.join(process.cwd(), parentDirectory || "", upgradeDirectory)
  );

  // console.log(fileStatuses);
  // console.log(parsedData);
  // TODO: import the directory
  // Run validation on each file
  // create a results file of the validation
  // return the results and print
};
