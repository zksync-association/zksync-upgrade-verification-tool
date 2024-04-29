import {BlockExplorerClient} from "./block-explorer-client.js";
import type {Network} from "./constants.js";
import {GithubClient} from "./github-client.js";
import {RpcClient} from "./rpc-client.js";

export class EnvBuilder {
  etherscanKey?: string
  githubKey?: string
  rpcUrl?: string
  _network?: Network

  withNetwork(n: Network): void {
    this._network = n
  }

  get network(): Network {
    if (!this._network) {
      throw new Error('Missing network')
    }
    return this._network
  }

  withEtherscanKey(etherscanKey: string): void {
    this.etherscanKey = etherscanKey
  }

  withGithubKey(maybeKey: string | undefined): void {
    this.githubKey = maybeKey
  }

  withRpcUrl(maybeUrl: string | undefined): void {
    this.rpcUrl = maybeUrl
  }

  l1Client (): BlockExplorerClient {
    if (!this.etherscanKey) {
      throw new Error('Missing etherscan key')
    }
    if (!this._network) {
      throw new Error('Missing network')
    }
    return BlockExplorerClient.fromNetwork(this.etherscanKey, this._network)
  }

  l2Client (): BlockExplorerClient {
    return BlockExplorerClient.forL2()
  }

  github (): GithubClient {
    return new GithubClient(this.githubKey)
  }

  rpc (): RpcClient {
    if (!this._network) {
      throw new Error('Missing network')
    }
    return new RpcClient(this._network, this.rpcUrl)
  }
}