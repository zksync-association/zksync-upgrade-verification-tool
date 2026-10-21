import {
  chainUpgradeAdminAbi as adminAbi,
  chainUpgradeBridgehubAbi as bridgeAbi,
  chainUpgradeCtmAbi as ctmAbi,
  chainUpgradeDiamondAbi as diamondAbi,
  chainUpgradeLegacyDiamondAbi as legacyAbi,
  chainUpgradeNotifierAbi as notifierAbi,
} from "@/common/abis";
import {
  CHAIN_UPGRADE,
  type ChainUpgradePlan,
  type ChainUpgradeState,
} from "@/common/chain-upgrade";
import {
  type Address,
  type Hex,
  type Abi,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  zeroAddress,
  zeroHash,
} from "viem";
import { callFn, ethCall } from "../chain/call";
import { l1, latestBlock, network, refreshHead } from "../rpc";
import { appStatus } from "../status";
import { readSafeOwnerReceipt } from "../safe-owner-receipt";

function requireThat(_ok: unknown, _message: string): asserts _ok {
  if (!_ok) throw new Error(_message);
}
export async function loadChainUpgrade(_chainId: bigint) {
  requireThat(_chainId > 0n, "Enter a positive chain ID.");
  const net = await network();
  requireThat(
    net.chainId === CHAIN_UPGRADE.l1ChainId &&
      isAddressEqual(net.upgradeHandler, CHAIN_UPGRADE.handler),
    "Chain upgrade execution is available for the configured Testnet 3 deployment on Sepolia."
  );
  await refreshHead();
  const [status, head] = await Promise.all([appStatus(), latestBlock()]);
  if (!status.ok) throw new Error(status.error);
  requireThat(
    !status.governance.warnings.length &&
      !status.governance.network.overrides.length &&
      status.logHistory.status === "ok" &&
      status.sync.cache.state !== "mismatch",
    "Governance, trust anchors or log history require attention before preparing a chain upgrade."
  );
  const read = <T>(_address: Address, _abi: Abi, _name: string, _args: readonly unknown[] = []) =>
    callFn<T>({
      address: _address,
      abi: _abi,
      functionName: _name,
      args: _args,
      blockNumber: head.number,
    });
  const [diamond, registeredCtm] = await Promise.all([
    read<Address>(CHAIN_UPGRADE.bridgehub, bridgeAbi, "getZKChain", [_chainId]),
    read<Address>(CHAIN_UPGRADE.bridgehub, bridgeAbi, "chainTypeManager", [_chainId]),
  ]);
  requireThat(
    !isAddressEqual(diamond, zeroAddress),
    "This chain is not registered in the configured Bridgehub."
  );
  requireThat(
    isAddressEqual(registeredCtm, CHAIN_UPGRADE.ctm),
    "This chain uses a different CTM; its upgrade is not supported by this deployment."
  );
  const [ctm, admin, chainId, currentVersion] = await Promise.all([
    read<Address>(diamond, diamondAbi, "getChainTypeManager"),
    read<Address>(diamond, diamondAbi, "getAdmin"),
    read<bigint>(diamond, diamondAbi, "getChainId"),
    read<bigint>(diamond, diamondAbi, "getProtocolVersion"),
  ]);
  requireThat(
    chainId === _chainId && isAddressEqual(ctm, registeredCtm),
    "Bridgehub and chain identity disagree."
  );
  const [owner, adminCode, targetVersion, notifier] = await Promise.all([
    read<Address>(admin, adminAbi, "owner"),
    l1.getCode({ address: admin, blockNumber: head.number }),
    read<bigint>(ctm, ctmAbi, "protocolVersion"),
    read<Address>(ctm, ctmAbi, "serverNotifierAddress"),
  ]);
  requireThat(
    adminCode && keccak256(adminCode) === CHAIN_UPGRADE.adminCodeHash,
    "The chain admin is not the supported ChainAdminOwnable implementation."
  );
  requireThat(
    !isAddressEqual(owner, zeroAddress) && !isAddressEqual(notifier, zeroAddress),
    "The chain owner or notifier is unavailable."
  );
  const notifierCtm = await read<Address>(notifier, notifierAbi, "chainTypeManager");
  requireThat(isAddressEqual(notifierCtm, ctm), "ServerNotifier points to a different CTM.");
  const state: ChainUpgradeState = {
    chainId: _chainId.toString(),
    l1ChainId: net.chainId,
    block: head.number.toString(),
    clock: head.timestamp.toString(),
    diamond,
    ctm,
    admin,
    owner,
    notifier,
    currentVersion: currentVersion.toString(),
    targetVersion: targetVersion.toString(),
    completed: currentVersion === targetVersion,
    timestamp: "0",
    cutHash: zeroHash,
    cutBlock: "0",
    cutSourceTransaction: null,
  };
  requireThat(
    currentVersion <= targetVersion,
    "Chain protocol version is ahead of the CTM version."
  );
  if (state.completed) return { state, cut: null, head };
  const [cutHash, cutBlock, timestamp] = await Promise.all([
    read<Hex>(ctm, ctmAbi, "upgradeCutHash", [currentVersion]),
    read<bigint>(ctm, ctmAbi, "upgradeCutDataBlock", [currentVersion]),
    read<bigint>(notifier, notifierAbi, "protocolVersionToUpgradeTimestamp", [
      _chainId,
      currentVersion,
    ]),
  ]);
  requireThat(
    cutHash !== zeroHash && cutBlock > 0n && cutBlock <= head.number,
    "The CTM has not registered an upgrade cut for this chain's current version."
  );
  const logs = await l1.getContractEvents({
    address: ctm,
    abi: ctmAbi,
    eventName: "NewUpgradeCutData",
    args: { protocolVersion: currentVersion },
    fromBlock: cutBlock,
    toBlock: cutBlock,
    strict: true,
  });
  const tuple = ctmAbi.find(
    (_entry) => _entry.type === "event" && _entry.name === "NewUpgradeCutData"
  );
  requireThat(tuple?.type === "event", "Upgrade cut ABI is unavailable.");
  const matched = logs.filter(
    (_log) =>
      _log.args.diamondCutData &&
      keccak256(encodeAbiParameters([tuple.inputs[1]], [_log.args.diamondCutData])) === cutHash
  );
  requireThat(
    matched.length === 1 && matched[0],
    "The published diamond cut does not uniquely match the CTM's registered hash."
  );
  state.timestamp = timestamp.toString();
  state.cutHash = cutHash;
  state.cutBlock = cutBlock.toString();
  state.cutSourceTransaction = matched[0].transactionHash;
  return { state, cut: matched[0].args.diamondCutData, head };
}
export async function prepareChainUpgrade(
  _chainId: bigint,
  _action: "timestamp" | "execute",
  _owner: Address,
  _timestamp?: bigint,
  _previousHash?: Hex
): Promise<ChainUpgradePlan> {
  const { state, cut, head } = await loadChainUpgrade(_chainId);
  requireThat(!state.completed && cut, "This chain is already on the CTM's current version.");
  requireThat(
    isAddressEqual(_owner, state.owner),
    "Connect the current ChainAdmin owner to prepare this call."
  );
  let target: Address;
  let data: Hex;
  if (_action === "timestamp") {
    requireThat(
      _timestamp !== undefined && _timestamp > 0n,
      "Choose a positive upgrade timestamp."
    );
    requireThat(_timestamp !== BigInt(state.timestamp), "This upgrade timestamp is already set.");
    target = state.notifier;
    data = encodeFunctionData({
      abi: notifierAbi,
      functionName: "setUpgradeTimestamp",
      args: [_chainId, _timestamp],
    });
  } else {
    requireThat(BigInt(state.timestamp) > 0n, "Set the chain's upgrade timestamp first.");
    requireThat(
      head.timestamp >= BigInt(state.timestamp),
      "The chain's scheduled upgrade time has not arrived."
    );
    target = state.diamond;
    const current = BigInt(state.currentVersion);
    const modern =
      ((current >> CHAIN_UPGRADE.versionShift) & CHAIN_UPGRADE.versionMask) >=
      CHAIN_UPGRADE.modernAdminMinor;
    data = modern
      ? encodeFunctionData({
          abi: diamondAbi,
          functionName: "upgradeChainFromVersion",
          args: [state.diamond, current, cut],
        })
      : encodeFunctionData({
          abi: legacyAbi,
          functionName: "upgradeChainFromVersion",
          args: [current, cut],
        });
  }
  const forwarded = encodeFunctionData({
    abi: adminAbi,
    functionName: "multicall",
    args: [[{ target, value: 0n, data }], true],
  });
  const request = {
    from: _owner,
    to: state.admin,
    data: forwarded,
    value: 0n,
    blockNumber: head.number,
  };
  await ethCall(request, adminAbi);
  const estimate = await l1.estimateGas({
    account: _owner,
    to: state.admin,
    data: forwarded,
    value: 0n,
  });
  const gasLimit =
    (estimate * CHAIN_UPGRADE.gasMarginNumerator + CHAIN_UPGRADE.gasMarginDenominator - 1n) /
      CHAIN_UPGRADE.gasMarginDenominator +
    CHAIN_UPGRADE.walletGasPadding;
  const block = await l1.getBlock({ blockNumber: head.number });
  requireThat(
    gasLimit <= block.gasLimit,
    "The buffered transaction gas exceeds the L1 block gas limit."
  );
  const plan: ChainUpgradePlan = {
    action: _action,
    chainId: state.l1ChainId,
    owner: _owner,
    to: state.admin,
    data: forwarded,
    value: "0",
    gasLimit: gasLimit.toString(),
    timestamp: (_timestamp ?? BigInt(state.timestamp)).toString(),
    state,
  };
  if (_previousHash) plan.previousSubmission = await readSafeOwnerReceipt(plan, _previousHash);
  return plan;
}
