export class ContracNotVerified extends Error {
  constructor (addr: string) {
    super(`Contract for ${addr} not verified in block explorer`);
  }
}