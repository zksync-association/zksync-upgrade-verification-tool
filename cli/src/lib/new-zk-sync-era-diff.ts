import type {Hex} from "viem";
import type {CurrentZksyncEraState, HexEraPropNames, NumberEraPropNames} from "./current-zksync-era-state";
import {MissingRequiredProp} from "./errors";
import type {Option} from "nochoices";

export class NewZkSyncEraDiff {
  current: CurrentZksyncEraState
  proposed: CurrentZksyncEraState

  constructor(current: CurrentZksyncEraState, proposed: CurrentZksyncEraState) {
    this.current = current
    this.proposed = proposed
  }

  hexAttrDiff(prop: HexEraPropNames): [Hex, Option<Hex>] {
    return [
      this.current.hexAttrValue(prop).expect(new MissingRequiredProp(prop)),
      this.proposed.hexAttrValue(prop)
    ]
  }

  numberAttrDiff(prop: NumberEraPropNames): [bigint, Option<bigint>] {
    return [
      this.current.numberAttrValue(prop).expect(new MissingRequiredProp(prop)),
      this.proposed.numberAttrValue(prop)
    ]
  }

  admin(): [Hex, Option<Hex>] {
    return this.hexAttrDiff("admin")
  }

  pendingAdmin(): [Hex, Option<Hex>] {
    return this.hexAttrDiff("pendingAdmin")
  }

  baseTokenGasPriceMultiplierNominator(): [bigint, Option<bigint>] {
    return this.numberAttrDiff("baseTokenGasPriceMultiplierNominator")
  }

  baseTokenGasPriceMultiplierDenominator(): [bigint, Option<bigint>] {
    return this.numberAttrDiff("baseTokenGasPriceMultiplierDenominator")
  }
}