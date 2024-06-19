import { describe, it, expect } from "vitest";
import { FileSystem } from "../src/lib/file-system";
import path from "node:path";
import { temporaryDirectory, temporaryFile } from "tempy";
import { NotADir } from "../src/lib/errors";

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

  describe("#writeFile", () => {
    it("writes content into file", async () => {
      const path = temporaryFile();
      const fs = subject();
      const content = Buffer.from("content");
      await fs.writeFile(path, content);
      expect(await fs.readFile(path)).toEqual(content);
    });

    it("fails if path does not exists", async () => {
      const path = "/does/not/exists";
      const fs = subject();
      const content = Buffer.from("content");
      expect(async () => await fs.writeFile(path, content)).rejects.toThrow();
    });
  });

  describe("#directoryExists", () => {
    it("returns true when directory exists", async () => {
      const temp = temporaryDirectory();
      const fs = subject();
      expect(await fs.directoryExists(temp)).toBe(true);
    });

    it("returns false when directory does not exist", async () => {
      const temp = "/does/not/exist";
      const fs = subject();
      expect(await fs.directoryExists(temp)).toBe(false);
    });
  });

  describe("#assertDirectoryExists", () => {
    it("does not throw when directory exists", async () => {
      const temp = temporaryDirectory();
      const fs = subject();
      await expect(fs.assertDirectoryExists(temp)).resolves.toBe(undefined);
    });

    it("returns false when directory does not exist", async () => {
      const temp = "/does/not/exist";
      const fs = subject();
      expect(fs.assertDirectoryExists(temp)).rejects.toThrow(NotADir);
    });
  });
});
