import {describe, it} from "vitest";
import {execAsync} from "./util";

describe("storage-diff", () => {
  it("prints all the information for the mini upgrade", async () => {
    const {stdout} = await execAsync("pnpm validate storage-diff reference/1699353977-boojum");

    console.log(stdout)
  })
})