import { BlockExplorerClient } from "./block-explorer-client.js";
import type { Network } from "./constants.js";
import { RpcClient } from "./rpc-client.js";
import { EraContractsRepo } from "./era-contracts-repo";
import { FileSystem } from "./file-system";
import { UpgradeImporter } from "./importer";

export class EnvBuilder {
  private _etherscanApiKey?: string;
  rpcUrl?: string;
  private _network?: Network;
  private ref = "main";

  private _l1Client?: BlockExplorerClient;
  private _l2Client?: BlockExplorerClient;
  private _repo?: EraContractsRepo;

  // Config

  withNetwork(n: Network): void {
    this._network = n;
  }

  withEtherscanApiKey(etherscanKey: string): void {
    this._etherscanApiKey = etherscanKey;
  }

  withRef(ref: string): void {
    this.ref = ref;
  }

  withRpcUrl(maybeUrl: string | undefined): void {
    this.rpcUrl = maybeUrl;
  }

  // Get components

  get network(): Network {
    if (!this._network) {
      throw new Error("Missing network");
    }
    return this._network;
  }

  get etherscanApiKey(): string {
    if (!this._etherscanApiKey) {
      throw new Error("Missing etherscan key");
    }
    return this._etherscanApiKey;
  }

  l1Client(): BlockExplorerClient {
    if (this._l1Client) {
      return this._l1Client;
    }

    this._l1Client = BlockExplorerClient.fromNetwork(this.etherscanApiKey, this.network);
    return this._l1Client;
  }

  l2Client(): BlockExplorerClient {
    if (this._l2Client) {
      return this._l2Client;
    }
    this._l2Client = BlockExplorerClient.forL2(this.network);
    return this._l2Client;
  }

  rpcL1(): RpcClient {
    return RpcClient.forL1(this.network);
  }

  rpcL2(): RpcClient {
    return RpcClient.forL2(this.network);
  }

  fs(): FileSystem {
    return new FileSystem();
  }

  importer(): UpgradeImporter {
    return new UpgradeImporter(this.fs());
  }

  async contractsRepo(): Promise<EraContractsRepo> {
    if (!this._repo) {
      const repo = await EraContractsRepo.default();
      await repo.init();
      this._repo = repo;
      await this._repo.setRevision(this.ref);
      return repo;
    }

    return this._repo;
  }
}
