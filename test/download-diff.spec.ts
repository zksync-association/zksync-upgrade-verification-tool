import {describe, expect, it} from "vitest";
import "dotenv/config";
import {createTempDir, execAsync, expectToFailAsync} from "./util";
import * as fs from "node:fs/promises";

describe("validate download-diff", () => {
  it('fails when target path does not exists', async () => {
    const temp = createTempDir()
    await fs.rmdir(temp)
    const { stdout } = await expectToFailAsync(
      () => execAsync(
        `pnpm validate download-diff reference/test-upgrade-mini ${temp}`
      )
    )
    expect(stdout).toContain(`Specified path "${temp}" is not a directory or there are no permissions to access it.`)
  })

  it('downloads all the files inside the specified directory ', async () => {
    const temp = createTempDir()
    const { stdout } = await execAsync(
      `pnpm validate download-diff reference/1699353977-boojum ${temp} --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0`
    )
    expect(stdout).toContain(`✅ Source code successfully downloaded in: ${temp}`)
    const subFolders = await fs.readdir(temp, { recursive: false })
    expect(subFolders).toEqual(expect.arrayContaining(["old", "new"]))
  })
});
