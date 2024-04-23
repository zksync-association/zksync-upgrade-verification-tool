import type {FacetCutsJson, FacetsJson, UpgradeManifest} from "../schema/index.js";


export type FacetData = {
  name: string,
  address: string,
  selectors: string[]
}

export class FacetChanges {
  newProtocolVersion: string;
  facets: FacetData[]
  orphanedSelectors: string[]

  constructor (newProtocolVersion: string) {
    this.newProtocolVersion = newProtocolVersion
    this.facets = []
    this.orphanedSelectors = []
  }

  facetAffected(name: string): FacetData | undefined {
    return this.facets.find(f => f.name === name)
  }

  addFacet(facetName: string, facetAddr: string, selectors: string[]) {
    this.orphanedSelectors = this.orphanedSelectors.filter(selector => !selectors.includes(selector))

    this.facets.push({
      name: facetName,
      address: facetAddr,
      selectors: selectors
    })
  }

  removeFacet(selectors: string[]) {
    this.orphanedSelectors.push(...selectors)
  }

  static fromFile(common: UpgradeManifest, jsonCuts: FacetCutsJson, facets: FacetsJson): FacetChanges {
    const instance = new FacetChanges(common.protocolVersion.toString())
    const facetDefs = Object.keys(facets).map((name) => {
      return {
        name: name,
        ...facets[name]
      }
    });

    for (const cut of jsonCuts) {
      if (cut.action === 2) {
        instance.removeFacet(cut.selectors)
      } else
      if (cut.action === 0) {
        const facetDef = facetDefs.find(f => f.address === cut.facet)
        if (!facetDef) {
          throw new Error(`Inconsistent data. ${cut.facet} not present in facets.json`)
        }
        instance.addFacet(facetDef.name, facetDef.address, cut.selectors)
      } else {
        // TODO: Handle upgrade
        throw new Error('Upgrade action not suported yet')
      }
    }

    return instance
  }
}