import { BlockExplorerClient } from "./block-explorer-client.js";
import { NET_VERSIONS, type Network } from "./constants.js";
import { RpcClient } from "./rpc-client.js";
import { EraContractsRepo } from "./era-contracts-repo";
import { FileSystem } from "./file-system";
import { UpgradeImporter } from "./importer";
import { Terminal } from "../terminal";

export class EnvBuilder {
  private _etherscanApiKey?: string;
  rpcUrl?: string;
  private _network?: Network;
  private ref = "main";

  private _l1Client?: BlockExplorerClient;
  private _l2Client?: BlockExplorerClient;
  private _repo?: EraContractsRepo;
  colored = true;
  private terminal = Terminal.default();

  // Config
  private _rpcL1?: RpcClient;

  withNetwork(n: Network): void {
    this._network = n;
  }

  withTerminal(term: Terminal) {
    this.terminal = term;
  }

  withEtherscanApiKey(etherscanKey: string): void {
    this._etherscanApiKey = etherscanKey;
  }

  withRef(ref: string): void {
    this.ref = ref;
  }

  withL1RpcUrl(maybeUrl: string | undefined): void {
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

    this._l1Client = BlockExplorerClient.forL1(this.etherscanApiKey, this.network);
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
    if (!this._rpcL1) {
      this._rpcL1 = this.rpcUrl ? new RpcClient(this.rpcUrl) : RpcClient.forL1(this.network);
    }

    return this._rpcL1;
  }

  async newRpcL1(): Promise<RpcClient> {
    const rpc = this.rpcL1();
    if ((await rpc.netVersion()) !== NET_VERSIONS[this.network]) {
      throw new Error("Rpc network does not match with specified network");
    }
    return rpc;
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

  withColored(colored: boolean) {
    this.colored = colored;
  }

  term() {
    return this.terminal;
  }
}
