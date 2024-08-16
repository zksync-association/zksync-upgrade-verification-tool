declare global {
  interface BigInt {
    toJSON(): string;
  }
}

// Serialize BigInt to string, as there's no standard JSON representation for BigInt
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
export function patchBigintToJSON() {
  BigInt.prototype.toJSON = function (): string {
    return this.toString();
  };
}
