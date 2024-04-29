import {BlockExplorerClient} from "./block-explorer-client.js";
import type {Network} from "./constants.js";
import {GithubClient} from "./github-client.js";
import {RpcClient} from "./rpc-client.js";

export class EnvBuilder {
  _etherscanKey?: string
  githubKey?: string
  rpcUrl?: string
  _network?: Network

  _l1Client?: BlockExplorerClient
  _l2Client?: BlockExplorerClient
  _github?: GithubClient

  withNetwork(n: Network): void {
    this._network = n
  }

  get network(): Network {
    if (!this._network) {
      throw new Error('Missing network')
    }
    return this._network
  }

  get etherscanKey (): string {
    if (!this._etherscanKey) {
      throw new Error('Missing etherscan key')
    }
    return this._etherscanKey
  }

  withEtherscanKey(etherscanKey: string): void {
    this._etherscanKey = etherscanKey
  }

  withGithubKey(maybeKey: string | undefined): void {
    this.githubKey = maybeKey
  }

  withRpcUrl(maybeUrl: string | undefined): void {
    this.rpcUrl = maybeUrl
  }

  l1Client (): BlockExplorerClient {
    if (this._l1Client) {
      return this._l1Client
    }

    this._l1Client = BlockExplorerClient.fromNetwork(this.etherscanKey, this.network);
    return this._l1Client
  }

  l2Client (): BlockExplorerClient {
    if (this._l2Client) {
      return this._l2Client
    }
    this._l2Client = BlockExplorerClient.forL2()
    return this._l2Client
  }

  github (): GithubClient {
    if (this._github) {
      return this._github
    }

    this._github = new GithubClient(this.githubKey);
    return this._github
  }

  rpc (): RpcClient {
    return new RpcClient(this.network, this.rpcUrl)
  }
}