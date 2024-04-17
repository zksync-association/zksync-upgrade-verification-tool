import type {AbiSet} from "./abi-set.js";

export type DiamondCutAction = "add" | "change" | "remove"

export function cutAction(n: number): DiamondCutAction {
  const all = ["add", "change", "remove"] as const;
  const op = all[n]
  if (!op) { throw new Error(`uknown diamond cut operation: ${n}`)}
  return op
}

export class Change {
  selector: string
  action: DiamondCutAction
  newFacet?: string

  constructor (selector: string, action: DiamondCutAction, newFacet: string) {
    this.selector = selector
    this.action = action
    if (Number(newFacet) !== 0) {
      this.newFacet = newFacet
    }
  }

  apply (c2: Change): Change {
    if(this.action === 'remove' && c2.action === 'add') {
      return new Change(this.selector, 'change', c2.newFacet!)
    }

    return c2
  }

  format(abiSet: AbiSet) {
    const name = abiSet.nameForSelector(this.selector)
    if (this.newFacet) {
      const facetName = abiSet.nameForContract(this.newFacet)
      return `${name} (${this.selector}) ${this.actionEffect()} -> ${facetName} (${this.newFacet})`
    } else {
      return `${name} (${this.selector}) ${this.actionEffect()}`
    }
  }

  actionEffect(): string {
    if (this.action === 'change') {
      return 'upgraded to'
    } else
    if (this.action === 'remove') {
      return 'removed'
    } else {
      return 'added with'
    }
  }
}

export class DiamondChanges {
  private data: Map<string, Change[]>

  constructor () {
    this.data = new Map()
  }

  add(selector: string, action: DiamondCutAction, newFacet: string): void {
    const old = this.data.get(selector)
    const change = new Change(selector, action, newFacet)
    if (old) {
      old.push(change)
    } else {
      this.data.set(selector, [change])
    }
  }

  format (abis: AbiSet): string {
    const lines = []
    for (const changes of this.data.values()) {
      const summary = this.summarizeChanges(changes)

      lines.push(summary.format(abis))
    }
    return lines.join('\n')
  }

  private summarizeChanges(changes: Change[]): Change {
    const final = changes.reduce((c1, c2) => c1.apply(c2))
    return final
  }
}