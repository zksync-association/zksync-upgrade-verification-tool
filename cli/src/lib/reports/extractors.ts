import { ValueExtractor } from "./value-extractor";
import { bytesToHex, type Hex } from "viem";

export class BigNumberExtractor extends ValueExtractor<bigint> {
  visitBigNumber(n: bigint): bigint {
    return n;
  }
}

export class BlobExtractor extends ValueExtractor<Hex> {
  visitBuf(buf: Buffer): Hex {
    return bytesToHex(buf);
  }
}

export class AddressExtractor extends ValueExtractor<Hex> {
  visitAddress(addr: Hex): Hex {
    return addr;
  }
}
