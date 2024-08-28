import { describe, it, expect } from "vitest";
import { failHandler } from "../src/commands/fail-handler.js";
import yargs from "yargs";
import { EnvBuilder } from "../src/lib/env-builder.js";
import { Terminal } from "../src/lib/terminal.js";
import { Stream } from "node:stream";
import {
  ContractNotVerified,
  ExternalApiError,
  MalformedUpgrade,
  MissingNetwork,
  NotADir,
  NotAnUpgradeDir,
} from "@repo/common/ethereum";

const doNothing = () => {};

type BuildTermTest = {
  term: Terminal;
  flush: () => string;
  flushErr: () => string;
  env: EnvBuilder;
};

const buildTestTerm = (): BuildTermTest => {
  const out = new Stream.Writable();
  const err = new Stream.Writable();
  const buff: number[] = [];
  const buffErr: number[] = [];
  out._write = (chunk, _encoding, next) => {
    buff.push(...chunk);
    next();
  };
  err._write = (chunk, _encoding, next) => {
    buffErr.push(...chunk);
    next();
  };

  const term = new Terminal(out, err);

  const env = new EnvBuilder();
  env.withTerminal(term);
  return {
    term,
    flush: () => {
      return Buffer.from(buff).toString();
    },
    flushErr: () => Buffer.from(buffErr).toString(),
    env,
  };
};

describe("error handler", () => {
  const cli = yargs([])
    .scriptName("my-test")
    .command(
      "some command",
      "some help",
      (yargs) => yargs,
      async (_yargs) => {}
    );

  it("when a message is sent it prints that message", async () => {
    const { env, flush } = buildTestTerm();

    await failHandler(env, "someMessage", undefined, cli, doNothing);
    expect(flush()).toContain("someMessage");
  });

  it("when a message is sent it prints that message even when an error is sent", async () => {
    const { env, flush } = buildTestTerm();

    await failHandler(env, "someMessage", new Error(), cli, doNothing);
    expect(flush()).toContain("someMessage");
  });

  it("when no message is sent and ContracNotVerified is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(env, undefined, new ContractNotVerified("0x01"), cli, doNothing);
    expect(flushErr()).toContain("Contract for 0x01 not verified in block explorer");
  });

  it("when no message is sent and NotAnUpgradeDir is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(env, undefined, new NotAnUpgradeDir("/some/path"), cli, doNothing);
    expect(flushErr()).toContain(
      'Expected "/some/path" to be an upgrade directory but it\'s not. Upgrade directories contain a "common.json" file inside'
    );
  });

  it("when no message is sent and NotADir is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(env, undefined, new NotADir("/some/path"), cli, doNothing);
    expect(flushErr()).toContain(
      'Specified path "/some/path" is not a directory or there are no permissions to access it.'
    );
  });

  it("when no message is sent and MalformedUpgrade is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(env, undefined, new MalformedUpgrade("something is wrong"), cli, doNothing);
    expect(flushErr()).toContain("Problem processing specified upgrade: something is wrong");
  });

  it("when no message is sent and MissingNetwork is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(env, undefined, new MissingNetwork("/some/path", "mainnet"), cli, doNothing);
    expect(flushErr()).toContain(
      'Upgrade inside "/some/path" does not contain information for "mainnet". Maybe you can try with a different network.'
    );
  });

  it("when no message is sent and ExternalApiError is sent it serializes the error", async () => {
    const { env, flushErr } = buildTestTerm();

    await failHandler(
      env,
      undefined,
      new ExternalApiError("external-service", "not working"),
      cli,
      doNothing
    );
    expect(flushErr()).toContain('Error consuming data from "external-service": not working');
  });
});
