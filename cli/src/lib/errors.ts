import * as console from "node:console";
import type { Network } from "./constants.js";

export class ContracNotVerified extends Error {
  constructor(addr: string) {
    super(`Contract for ${addr} not verified in block explorer`);
  }
}

export class NotADir extends Error {
  constructor(path: string) {
    super(`Specified path "${path}" is not a directory or there are no permissions to access it.`);
  }
}

export class NotAnUpgradeDir extends Error {
  constructor(path: string) {
    super(
      `Expected "${path}" to be an upgrade directory but it's not. Upgrade directories contain a "common.json" file inside`
    );
  }
}

export class MalformedUpgrade extends Error {
  constructor(msg: string) {
    super(`Problem processing specified upgrade: ${msg}`);
  }
}

export class MissingNetwork extends Error {
  constructor(path: string, network: Network) {
    super(
      `Upgrade inside ${path} does not contain information for "${network}". Maybe you can try with a different network.`
    );
  }
}

const KNOWN_ERRORS = [
  ContracNotVerified,
  NotAnUpgradeDir,
  NotADir,
  MalformedUpgrade,
  MissingNetwork
];

export function printError(e: Error): void {
  const isKnown = KNOWN_ERRORS.some((kind) => e instanceof kind);

  console.error(e)
  if (isKnown) {
    console.log("");
    console.log(`> ${e.message}`);
  } else {
    console.log("Unexpected error:");
    console.error(e);
  }
}
