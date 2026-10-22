import { safeMessageHashes } from "@/common/safe";
import { safeAbi } from "@/common/abis";
import {
  SAFE_OWNER_APPROVAL,
  type SafeOwnerApprovalPlan,
  safeOwnerMessageCall,
} from "@/common/safe-owner-approval";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import {
  type Address,
  type Hex,
  decodeFunctionResult,
  isAddressEqual,
  keccak256,
  slice,
  zeroHash,
} from "viem";
import { callFn, ethCall } from "./chain/call";
import { getStandardUpgradeCore } from "./flows/standard";
import { l1, latestBlock, network, refreshHead } from "./rpc";
import { appStatus } from "./status";
import { readSafeOwnerReceipt } from "./safe-owner-receipt";

const requireThat = (_ok: unknown, _message: string) => {
  if (!_ok) throw new Error(_message);
};

/** Read-only preparation; keys and broadcasting stay in the connected owner wallet. */
export async function prepareSafeOwnerApproval(
  _id: Hex,
  _safe: Address,
  _owner: Address,
  _previousHash?: Hex
): Promise<SafeOwnerApprovalPlan> {
  const net = await network();
  requireThat(
    net.chainId === SAFE_OWNER_APPROVAL.chainId &&
      isAddressEqual(net.upgradeHandler, SAFE_OWNER_APPROVAL.handler),
    "Direct owner approvals are available only for the configured Testnet 3 deployment on Sepolia."
  );
  await refreshHead();
  const [status, upgrade, head] = await Promise.all([
    appStatus(),
    getStandardUpgradeCore(_id),
    latestBlock(),
  ]);
  if (!status.ok) throw new Error(status.error);
  requireThat(
    status.governance.warnings.length === 0 &&
      status.governance.network.overrides.length === 0 &&
      status.logHistory.status === "ok" &&
      status.sync.cache.state !== "mismatch",
    "Governance, trust anchors or log history require attention before approving."
  );
  requireThat(
    upgrade.started.idMatches &&
      upgrade.state === UPGRADE_STATES.Waiting &&
      upgrade.status.securityCouncilApprovalTimestamp === 0,
    "This upgrade is not awaiting Security Council approval."
  );
  requireThat(
    upgrade.governance.securityCouncil.members.some((_member) => isAddressEqual(_member, _safe)),
    "The selected Safe is not a current Security Council member."
  );
  requireThat(net.codePins, "This deployment has no Safe runtime pins.");
  const pins = net.codePins;
  if (!pins) throw new Error("This deployment has no Safe runtime pins.");
  const digest = governanceHashes(
    buildTypedData("ApproveUpgradeSecurityCouncil", upgrade.governance.securityCouncil.domain, {
      id: _id,
    })
  ).digest;
  const call = safeOwnerMessageCall(_safe, _owner, digest);
  const read = <T>(_name: string, _args: readonly unknown[] = []) =>
    callFn<T>({
      address: _safe,
      abi: safeAbi,
      functionName: _name,
      args: _args,
      blockNumber: head.number,
    });
  const [owners, threshold, version, domain, approved, safeCode, libraryCode, singleton, fallback] =
    await Promise.all([
      read<Address[]>("getOwners"),
      read<bigint>("getThreshold"),
      read<string>("VERSION"),
      read<Hex>("domainSeparator"),
      read<bigint>("signedMessages", [call.safeMessageHash]),
      l1.getCode({ address: _safe, blockNumber: head.number }),
      l1.getCode({ address: SAFE_OWNER_APPROVAL.library, blockNumber: head.number }),
      l1.getStorageAt({ address: _safe, slot: zeroHash, blockNumber: head.number }),
      l1.getStorageAt({
        address: _safe,
        slot: SAFE_OWNER_APPROVAL.fallbackSlot,
        blockNumber: head.number,
      }),
    ]);
  requireThat(
    version === "1.3.0" &&
      threshold === 1n &&
      owners.length === 1 &&
      owners[0] !== undefined &&
      isAddressEqual(owners[0], _owner),
    "Connect the sole owner of this 1-of-1 Safe. Other Safe policies require the Safe wallet flow."
  );
  requireThat(
    safeCode &&
      keccak256(safeCode) === pins.safeProxy &&
      singleton &&
      isAddressEqual(slice(singleton, 12), pins.safeSingleton) &&
      fallback &&
      isAddressEqual(slice(fallback, 12), pins.safeFallbackHandler),
    "Safe proxy, singleton or fallback handler differs from its pinned deployment."
  );
  requireThat(
    libraryCode && keccak256(libraryCode) === SAFE_OWNER_APPROVAL.libraryCodeHash,
    "Safe SignMessageLib runtime differs from the audited deployment."
  );
  requireThat(
    domain.toLowerCase() === safeMessageHashes(net.chainId, _safe, digest).domainHash.toLowerCase(),
    "Safe domain separator differs from the expected Sepolia domain."
  );
  let gasLimit: bigint = SAFE_OWNER_APPROVAL.minimumWalletGas;
  if (approved === 0n) {
    const result = await ethCall(
      { from: _owner, to: _safe, data: call.data, value: 0n, blockNumber: head.number },
      safeAbi
    );
    requireThat(
      decodeFunctionResult({ abi: safeAbi, functionName: "execTransaction", data: result }),
      "Safe execution simulation returned false."
    );
    const estimate = await l1.estimateGas({
      account: _owner,
      to: _safe,
      data: call.data,
      value: 0n,
    });
    const buffered = estimate * SAFE_OWNER_APPROVAL.estimateMultiplier;
    gasLimit = buffered > gasLimit ? buffered : gasLimit;
    requireThat(
      gasLimit <= SAFE_OWNER_APPROVAL.maximumWalletGas,
      "The Safe gas estimate exceeds the supported approval budget. Inspect it before sending."
    );
  }
  const plan: SafeOwnerApprovalPlan = {
    chainId: net.chainId,
    safe: _safe,
    owner: _owner,
    digest,
    safeMessageHash: call.safeMessageHash,
    to: call.to,
    data: call.data,
    value: "0",
    alreadyApproved: approved !== 0n,
    gasLimit: gasLimit.toString(),
    checkedAtBlock: head.number.toString(),
  };
  if (_previousHash && !plan.alreadyApproved)
    plan.previousSubmission = await readSafeOwnerReceipt(plan, _previousHash);
  return plan;
}
