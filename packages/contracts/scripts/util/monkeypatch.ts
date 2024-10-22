// Workaround for the workaround proposed here: https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-node#running-hardhats-test-task-with-hardhat-zksync-node.
// The import to get the type it's not exposed. This is the part needed to make
// the typing work.
declare module "hardhat/types/config" {
  interface HardhatNetworkConfig {
    zksync: boolean;
    url: string;
  }
}