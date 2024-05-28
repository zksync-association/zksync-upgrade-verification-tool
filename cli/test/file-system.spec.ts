import { describe, it, expect } from "vitest";
import { FileSystem } from "../src/lib/file-system";
import path from "node:path";

describe("FileSyste class", () => {
  const subject = () => new FileSystem();

  describe("#readFile", () => {
    it("can read a file that exists", async () => {
      const fs = subject();
      const pkgBuf = await fs.readFile(path.join(import.meta.dirname, "../package.json"));
      const pkg = JSON.parse(pkgBuf.toString()) as any;
      expect(pkg.name).to.eql("validate-cli");
    });

    it("throws an error when a file does not exists", async () => {
      const fs = subject();
      await expect(() => fs.readFile(path.join("does/not/exist.xyz"))).rejects.toThrow();
    });
  });
});
