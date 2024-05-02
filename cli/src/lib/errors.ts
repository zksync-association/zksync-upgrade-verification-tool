import * as console from "node:console";

export class ContracNotVerified extends Error {
  constructor (addr: string) {
    super(`Contract for ${addr} not verified in block explorer`);
  }
}

export class NotAnUpgradeDir extends Error {
  private path: string;
  constructor (path: string) {
    super(`Expected ${path} to be an upgrade directory but it's not. Upgrade directories contain a "common.json" file inside`);
    this.path = path
  }
}

const KNOWN_ERRORS = [ ContracNotVerified, NotAnUpgradeDir ]

export function printError(e: Error): void {
  const isKnown = KNOWN_ERRORS.some(kind => e instanceof kind)

  if (isKnown) {
    console.log(`> ${e.message}`)
  } else {
    console.log('Unexpected error:')
    console.error(e)
  }
}