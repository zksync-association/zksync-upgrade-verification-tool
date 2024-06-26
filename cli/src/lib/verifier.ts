export class VerifierContract {
  address: string;
  recursionCircuitsSetVksHash: string;
  recursionLeafLevelVkHash: string;
  recursionNodeLevelVkHash: string;

  constructor(
    address: string,
    recursionCircuitsSetVksHash: string,
    recursionLeafLevelVkHash: string,
    recursionNodeLevelVkHash: string
  ) {
    this.address = address;
    this.recursionCircuitsSetVksHash = recursionCircuitsSetVksHash;
    this.recursionLeafLevelVkHash = recursionLeafLevelVkHash;
    this.recursionNodeLevelVkHash = recursionNodeLevelVkHash;
  }
}
