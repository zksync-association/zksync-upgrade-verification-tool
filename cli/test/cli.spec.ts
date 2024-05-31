import { describe, expect, it } from "vitest";
import { buildCli } from "../src/lib/index";
import type { EnvBuilder } from "../src/lib/env-builder";

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
      const cli = buildCli(["check", "someDir", "--ethscankey=fakeKey"], fakeCheck, fail, fail);
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
        env: EnvBuilder,
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
        fakeDownload
      );
      await cli.parseAsync();
      expect(called).toBe(true);
    });
  });
});
