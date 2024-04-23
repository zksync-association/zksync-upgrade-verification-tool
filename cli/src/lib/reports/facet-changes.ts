import type {FacetCutsJson, FacetsJson, UpgradeManifest} from "../../schema/index.js";


export type FacetData = {
  name: string,
  address: string,
  selectors: string[]
}

export class FacetChanges {
  newProtocolVersion: string;
  facets: FacetData[]

  constructor (newProtocolVersion: string, facets: FacetData[]) {
    this.facets = facets
    this.newProtocolVersion = newProtocolVersion
  }

  facetAffected(name: string): FacetData | undefined {
    return this.facets.find(f => f.name === name)
  }

  static fromFile(common: UpgradeManifest, jsonCuts: FacetCutsJson, facets: FacetsJson): FacetChanges {
    const keys = Object.keys(facets);
    const data = keys.map(facetName => {
      const facetDef = facets[facetName]

      const cut = jsonCuts.find(cut => cut.facet === facetDef.address)

      if (!cut) {
        throw new Error('Inconsistent data. Facet not defined in facets.json')
      }

      return {
        name: facetName,
        address: facetDef.address.toString(),
        selectors: cut.selectors
      }
    })

    return new FacetChanges(common.protocolVersion.toString(), data)
  }
}