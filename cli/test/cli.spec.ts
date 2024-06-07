import { describe, expect, it } from "vitest";
import { buildCli } from "../src/lib/index";
import type { EnvBuilder } from "../src/lib/env-builder";
import type {Option} from "nochoices";

const fail = () => expect.fail("should not be called");

describe("cli", () => {
  describe("check", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeCheck = async (env: EnvBuilder, upgradeDirectory: string): Promise<void> => {
        expect(upgradeDirectory).to.equal("someDir");
        expect(env.etherscanApiKey).to.eql("fakeKey");
        called = true;
      };
      const cli = buildCli(
        ["check", "someDir", "--ethscankey=fakeKey"],
        fakeCheck,
        fail,
        fail,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });

  describe("facet-diff", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeCheck = async (
        env: EnvBuilder,
        upgradeDirectory: string,
        contractName: string
      ): Promise<void> => {
        expect(upgradeDirectory).to.equal("someDir");
        expect(contractName).to.eql("facet:SomeFacet");
        expect(env.etherscanApiKey).to.eql("fakeKey");
        called = true;
      };
      const cli = buildCli(
        ["facet-diff", "someDir", "SomeFacet", "--ethscankey=fakeKey"],
        fail,
        fakeCheck,
        fail,
        fail
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });

  describe("verifier-diff", () => {
    it("sends right arguments", async () => {
      let called = false;
      const fakeCheck = async (
        env: EnvBuilder,
        upgradeDirectory: string,
        contractName: string
      ): Promise<void> => {
        expect(upgradeDirectory).to.equal("someDir");
        expect(contractName).to.eql("verifier");
        expect(env.etherscanApiKey).to.eql("fakeKey");
        called = true;
      };
      const cli = buildCli(
        ["verifier-diff", "someDir", "--ethscankey=fakeKey"],
        fail,
        fakeCheck,
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
        ["download-diff", "someDir", "targetDir", "--ethscankey=fakeKey"],
        fail,
        fail,
        fakeDownload,
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
        ["storage-diff", "someDir", "--ethscankey=fakeKey"],
        fail,
        fail,
        fail,
        fakeStorageDiff
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
        ["storage-diff", "someDir", "--ethscankey=fakeKey", "--precalculated=path/to/data.json"],
        fail,
        fail,
        fail,
        fakeStorageDiff
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });
});
