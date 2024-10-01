import { describe, expect, it } from "vitest";
import type { Option } from "nochoices";
import type { Argv } from "yargs";
import { buildCli } from "../src/lib/cli.js";
import type { EnvBuilder } from "../src/lib/env-builder.js";

const fail = () => expect.fail("should not be called");

describe("cli", () => {
  describe("check", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeCheck = async (env: EnvBuilder, filePath: string): Promise<void> => {
        expect(filePath).to.equal("pathToJsonFile");
        expect(env.etherscanApiKey).to.eql("fakeKey");
        called = true;
      };
      const cli = buildCli(
        ["check", "--file=pathToJsonFile", "--ethscankey=fakeKey"],
        fakeCheck,
        fail,
        fail,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });

  describe("download-diff", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeDownload = async (
        _env: EnvBuilder,
        upgradeDirectory: string,
        targetDir: string,
        l1Filter: string[]
      ): Promise<void> => {
        expect(upgradeDirectory).to.equal("someDir");
        expect(targetDir).to.eql("targetDir");
        expect(targetDir).to.eql("targetDir");
        expect(l1Filter).to.eql([]);
        called = true;
      };
      const cli = buildCli(
        ["download-code", "-f", "someDir", "targetDir", "--ethscankey=fakeKey"],
        fail,
        fakeDownload,
        fail,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });

  describe("storage-diff", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeStorageDiff = async (
        _env: EnvBuilder,
        upgradeDirectory: string,
        preCalculatedPath: Option<string>
      ): Promise<void> => {
        expect(upgradeDirectory).to.equal("someDir");
        expect(preCalculatedPath.isNone()).to.equal(true);
        called = true;
      };
      const cli = buildCli(
        ["storage-diff", "-f", "someDir", "--ethscankey=fakeKey"],
        fail,
        fail,
        fakeStorageDiff,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });

    it("when precalculated is specified it is received", async () => {
      let called = false;
      const fakeStorageDiff = async (
        _env: EnvBuilder,
        upgradeDirectory: string,
        preCalculatedPath: Option<string>
      ): Promise<void> => {
        expect(upgradeDirectory).toEqual("someDir");
        expect(preCalculatedPath.unwrap()).toEqual("path/to/data.json");
        called = true;
      };
      const cli = buildCli(
        [
          "storage-diff",
          "-f",
          "someDir",
          "--ethscankey=fakeKey",
          "--precalculated=path/to/data.json",
        ],
        fail,
        fail,
        fakeStorageDiff,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });

  describe("fail handler", () => {
    it("sends right arguments", async () => {
      let called = false;
      let receivedMsg: string | undefined;
      let error: Error | undefined;

      const fakeErrorHandler = async (
        _env: EnvBuilder,
        msg: string | undefined,
        err: Error | undefined,
        _argParser: Argv,
        _cbk: () => void
      ): Promise<void> => {
        receivedMsg = msg;
        error = err;
        called = true;
      };
      const cli = buildCli(["unknown"], fail, fail, fail, fakeErrorHandler);
      await cli.parseAsync();

      expect(called).toBe(true);
      expect(receivedMsg).to.eql("Unknown argument: unknown");
      expect(error).toBe(undefined);
    });
  });
});
