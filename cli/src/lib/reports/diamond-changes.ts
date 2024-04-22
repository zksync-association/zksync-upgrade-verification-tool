import type {AbiSet} from "../abi-set.js";
import CliTable from "cli-table3";
import path from "node:path";
import fs from "node:fs/promises";
import type {FacetCutsJson} from "../../schema/index.js";

export type DiamondCutAction = "add" | "change" | "remove"

export function cutAction (n: number): DiamondCutAction {
  const all = ["add", "change", "remove"] as const;
  const op = all[n]
  if (!op) {
    throw new Error(`uknown diamond cut operation: ${n}`)
  }
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
    if (this.action === 'remove' && c2.action === 'add') {
      return new Change(this.selector, 'change', c2.newFacet!)
    }

    return c2
  }

  format (abiSet: AbiSet) {
    const name = abiSet.signatureForSelector(this.selector)
    return `${name} (${this.selector}) ${this.actionEffect()}`
  }

  actionEffect (): string {
    if (this.action === 'change') {
      return 'upgraded'
    } else if (this.action === 'remove') {
      return 'removed'
    } else {
      return 'added'
    }
  }
}

export class DiamondChanges {
  private data: Map<string, Change>

  constructor () {
    this.data = new Map()
  }

  add (selector: string, action: DiamondCutAction, newFacet: string): void {
    const old = this.data.get(selector)
    const change = new Change(selector, action, newFacet)
    if (old) {
      this.data.set(selector, old.apply(change))
    } else {
      this.data.set(selector, change)
    }
  }

  actionForSelector(selector: string): DiamondCutAction | undefined {
    return this.data.get(selector)?.action
  }

  // totalSummary (): string[] {
  //   // const changeSet = [...this.data.values()].reduce((set, change) => {
  //   //   if (change.newFacet) {
  //   //     set.add(change.newFacet)
  //   //   }
  //   //
  //   //   return set
  //   // }, new Set<string>())
  //   // return [...changeSet]
  // }

  orphanSelectors (): void {
    // TODO
  }


  static fromFile(jsonCuts: FacetCutsJson): DiamondChanges {
    const instance = new this()
    jsonCuts.forEach(({ facet, selectors, action: actionNumber }) => {
      const action = cutAction(actionNumber)
      selectors.forEach((selector) => instance.add(selector, action, facet))
    })
    return instance
  }

  private createTable(title: string): CliTable.Table {
    return new CliTable({
      head: [title],
      style: {compact: true}
    })
  }

  format (abis: AbiSet): string {
    const byFacet = new Map<string, Change[]>()
    const removes = []
    // const lines = []
    for (const change of this.data.values()) {
      const summary = change
      if (summary.newFacet) {
        const key = summary.newFacet;
        let value = byFacet.get(key) || []
        value.push(summary)
        byFacet.set(key, value)
      } else {
        removes.push(summary)
      }
    }

    const tables = []


    if (removes.length !== 0) {
      const removedTable = this.createTable('Operations removed')

      removes.forEach(remove => {
        const signature = abis.signatureForSelector(remove.selector)
        removedTable.push([signature, remove.actionEffect()])
      })
      tables.push(removedTable)
    }


    for (const [key, value] of byFacet.entries()) {
      const table = this.createTable(`${abis.nameForContract(key)} (${key})`)

      value.forEach(change => {
        const signature = abis.signatureForSelector(change.selector)
        table.push([signature, change.actionEffect()])
      })
      tables.push(table)
    }

    return tables.map(t => t.toString()).join('\n')
  }
}