import { ethers } from "ethers";
import { createConfig, createStorage } from "wagmi";
import { connect, disconnect, reconnect } from "wagmi/actions";
import { walletConnect } from "wagmi/connectors";
import { custom, defineChain } from "viem";
import { DEFAULT_WALLET_CONNECT_PROJECT_ID } from "../../app/common/walletconnect";
import { CHAINS } from "./tx-sim-config.mjs";

// Same WalletConnect transport as the verifier. The HTML never submits a Safe
// transaction on behalf of an EOA or changes the source's required sender.
let config;
let connector;
function walletConfig() {
  if (config) return config;
  const chains = Object.values(CHAINS).map((_chain) =>
    defineChain({
      id: _chain.id,
      name: _chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [_chain.rpc] } },
      blockExplorers: { default: { name: _chain.name, url: _chain.explorer } },
    })
  );
  const readOnly = custom({
    request: async ({ method: _method }) => {
      throw new Error(`${_method}: chain reads use the configured RPC.`);
    },
  });
  config = createConfig({
    chains,
    transports: Object.fromEntries(chains.map((_chain) => [_chain.id, readOnly])),
    storage: createStorage({ storage: window.localStorage, key: "tx-sim:walletconnect" }),
    multiInjectedProviderDiscovery: false,
    connectors: [
      walletConnect({
        projectId: DEFAULT_WALLET_CONNECT_PROJECT_ID,
        showQrModal: true,
        customStoragePrefix: "tx-sim-singlefile",
        qrModalOptions: { enableExplorer: false, themeMode: "light" },
        metadata: {
          name: "ZKsync Testnet 3 governance",
          description: "Reviewed tx-sim transactions, one wallet confirmation at a time",
          url: "https://github.com/zksync-association/zksync-upgrade-verification-tool",
          icons: [],
        },
      }),
    ],
  });
  connector = config.connectors[0];
  return config;
}
window.__TX_SIM_WALLET__ = {
  async connect(_chainId) {
    const current = walletConfig();
    if (current.state.status !== "connected")
      await connect(current, { connector, chainId: _chainId });
    return connector.getProvider();
  },
  async restore() {
    const current = walletConfig();
    const connections = await reconnect(current, { connectors: [connector] });
    return connections.length ? connector.getProvider() : null;
  },
  async disconnect() {
    if (config) await disconnect(config);
  },
};
window.ethers = ethers;
import("./tx-sim-ui.mjs");
