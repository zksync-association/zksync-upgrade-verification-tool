/**
 * /app/reinforce – Reinforce Freeze / Unfreeze Panel
 *
 * This page lets anyone (no special role required) reinforce the current
 * freeze or unfreeze state of the protocol by calling:
 *   - reinforceFreeze() / reinforceFreezeOneChain(chainId)
 *   - reinforceUnfreeze() / reinforceUnfreezeOneChain(chainId)
 * on the ProtocolUpgradeHandler.
 *
 * Use case: when a freeze or emergency-upgrade transaction succeeded but the
 * individual hyperchains / bridges were not (yet) frozen/unfrozen – which can
 * happen because _freeze()/_unfreeze() currently have their multi-chain logic
 * commented out (TODO: uncomment when L2 node is fully deployed) – or because
 * a front-runner froze/unfroze only a subset of chains.
 */

import type { MetaFunction } from "@remix-run/node";
import {
  getLastFreezeBlockNumber,
  getLastUnfreezeBlockNumber,
  getProtocolFreezeState,
  getReinforcedFreezeChainIds,
  getReinforcedUnfreezeChainIds,
  getStateTransitionManagerAddress,
} from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import { getAllHyperchainChainIDs } from "@/.server/service/ethereum-l1/contracts/state-transition-manager";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/utils/date";
import { FreezeStatus, freezeStatusLabel, isProtocolFrozen, isProtocolUnfrozen } from "@/utils/reinforce-abis";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { env } from "@config/env.server";
import type { Hex } from "viem";
import { ReinforceAllButton } from "../reinforce-all-button";
import { ReinforceChainButton } from "../reinforce-chain-button";
import { cn } from "@/utils/cn";

export const meta: MetaFunction = () => [
  { title: "Reinforce Freeze / Unfreeze | Governance Authentication" },
];

// Loader ------------------------------------------------------------------

export async function loader(_args: LoaderFunctionArgs) {
  const { protocolFrozenUntil, lastFreezeStatusInUpgradeCycle } = await getProtocolFreezeState();

  // Best-effort: get STM address and hyperchain IDs
  let allChainIds: bigint[] = [];
  let stmAddress: string | null = null;
  try {
    stmAddress = await getStateTransitionManagerAddress();
    allChainIds = await getAllHyperchainChainIDs(stmAddress as Hex);
  } catch {
    // STM may not be configured in the current environment
  }

  // Determine which chains have already been reinforced in the current cycle
  let reinforcedFreezeChainIds: bigint[] = [];
  let reinforcedUnfreezeChainIds: bigint[] = [];

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const protocolIsCurrentlyFrozen =
    protocolFrozenUntil > nowSec &&
    (lastFreezeStatusInUpgradeCycle === FreezeStatus.Soft ||
      lastFreezeStatusInUpgradeCycle === FreezeStatus.Hard);

  const protocolIsCurrentlyUnfrozen =
    protocolFrozenUntil === 0n ||
    nowSec > protocolFrozenUntil ||
    lastFreezeStatusInUpgradeCycle === FreezeStatus.AfterSoftFreeze ||
    lastFreezeStatusInUpgradeCycle === FreezeStatus.AfterHardFreeze;

  if (protocolIsCurrentlyFrozen) {
    const freezeBlock = await getLastFreezeBlockNumber();
    if (freezeBlock !== null) {
      reinforcedFreezeChainIds = await getReinforcedFreezeChainIds(freezeBlock);
    }
  }

  if (
    protocolIsCurrentlyUnfrozen &&
    lastFreezeStatusInUpgradeCycle !== FreezeStatus.None
  ) {
    const unfreezeBlock = await getLastUnfreezeBlockNumber();
    if (unfreezeBlock !== null) {
      reinforcedUnfreezeChainIds = await getReinforcedUnfreezeChainIds(unfreezeBlock);
    }
  }

  const unreinforcedFreezeChainIds = allChainIds.filter(
    (id) => !reinforcedFreezeChainIds.includes(id)
  );
  const unreinforcedUnfreezeChainIds = allChainIds.filter(
    (id) => !reinforcedUnfreezeChainIds.includes(id)
  );

  return json({
    handlerAddress: env.UPGRADE_HANDLER_ADDRESS as Hex,
    stmAddress,
    protocolFrozenUntil: protocolFrozenUntil.toString(),
    lastFreezeStatusInUpgradeCycle,
    protocolIsCurrentlyFrozen,
    protocolIsCurrentlyUnfrozen,
    allChainIds: allChainIds.map(String),
    reinforcedFreezeChainIds: reinforcedFreezeChainIds.map(String),
    unreinforcedFreezeChainIds: unreinforcedFreezeChainIds.map(String),
    reinforcedUnfreezeChainIds: reinforcedUnfreezeChainIds.map(String),
    unreinforcedUnfreezeChainIds: unreinforcedUnfreezeChainIds.map(String),
  });
}

// Component ----------------------------------------------------------------

export default function ReinforcePage() {
  const {
    handlerAddress,
    protocolFrozenUntil,
    lastFreezeStatusInUpgradeCycle,
    protocolIsCurrentlyFrozen,
    protocolIsCurrentlyUnfrozen,
    allChainIds,
    reinforcedFreezeChainIds,
    unreinforcedFreezeChainIds,
    reinforcedUnfreezeChainIds,
    unreinforcedUnfreezeChainIds,
  } = useLoaderData<typeof loader>();

  const frozenUntilDate =
    BigInt(protocolFrozenUntil) > 0n
      ? new Date(Number(protocolFrozenUntil) * 1000)
      : null;

  const hasUnreinforcedFreezeChains = unreinforcedFreezeChainIds.length > 0;
  const hasUnreinforcedUnfreezeChains = unreinforcedUnfreezeChainIds.length > 0;

  // Front-run warning: protocol is frozen AND some chains are not yet reinforced
  const showFreezePartialWarning =
    protocolIsCurrentlyFrozen && hasUnreinforcedFreezeChains && allChainIds.length > 0;
  // Unfreeze partial warning: protocol is unfrozen but some chains are not yet reinforced
  const showUnfreezePartialWarning =
    protocolIsCurrentlyUnfrozen &&
    lastFreezeStatusInUpgradeCycle !== FreezeStatus.None &&
    hasUnreinforcedUnfreezeChains &&
    allChainIds.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <HeaderWithBackButton>Reinforce Freeze / Unfreeze</HeaderWithBackButton>

      {/* ── Partial-freeze / front-run warning ─────────────────────────── */}
      {showFreezePartialWarning && (
        <div
          className="flex items-start gap-3 rounded-lg border-2 border-red-500 bg-red-950/60 p-4 text-red-200"
          data-testid="partial-freeze-warning"
        >
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-400" />
          <div>
            <p className="font-bold text-red-300 text-lg">
              ⚠ Partial Freeze Detected – Possible Front-Run
            </p>
            <p className="mt-1 text-sm">
              The protocol is recorded as <strong>frozen</strong> on the
              ProtocolUpgradeHandler, but{" "}
              <strong>{unreinforcedFreezeChainIds.length}</strong> out of{" "}
              <strong>{allChainIds.length}</strong> hyperchain(s) have not yet
              received a <code>reinforceFreezeOneChain</code> call. This can
              happen when a freeze transaction was front-run (only a subset of
              chains were frozen before the main tx executed) or when the
              multi-chain freeze logic is not yet active (TODO in _freeze()).
            </p>
            <p className="mt-2 text-sm font-semibold">
              Use the controls below to reinforce the remaining chains.
            </p>
          </div>
        </div>
      )}

      {/* ── Partial-unfreeze warning ─────────────────────────────────────── */}
      {showUnfreezePartialWarning && (
        <div
          className="flex items-start gap-3 rounded-lg border-2 border-yellow-500 bg-yellow-950/60 p-4 text-yellow-200"
          data-testid="partial-unfreeze-warning"
        >
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-yellow-400" />
          <div>
            <p className="font-bold text-yellow-300 text-lg">
              ⚠ Partial Unfreeze Detected
            </p>
            <p className="mt-1 text-sm">
              The protocol has been unfrozen, but{" "}
              <strong>{unreinforcedUnfreezeChainIds.length}</strong> hyperchain(s)
              have not yet been reinforced. Use the controls below to reinforce
              the remaining chains.
            </p>
          </div>
        </div>
      )}

      {/* ── Protocol status card ─────────────────────────────────────────── */}
      <Card data-testid="protocol-status-card">
        <CardHeader>
          <CardTitle>Protocol Freeze Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            label="Freeze cycle status"
            value={freezeStatusLabel(lastFreezeStatusInUpgradeCycle)}
          />
          <StatusRow
            label="Protocol frozen until"
            value={
              frozenUntilDate
                ? formatDateTime(frozenUntilDate)
                : "Not frozen"
            }
          />
          <StatusRow
            label="Current state"
            value={
              protocolIsCurrentlyFrozen
                ? "FROZEN"
                : "NOT FROZEN"
            }
            highlight={protocolIsCurrentlyFrozen ? "red" : "green"}
          />
          <StatusRow
            label="Total hyperchains"
            value={String(allChainIds.length)}
          />
          {protocolIsCurrentlyFrozen && (
            <StatusRow
              label="Reinforced (freeze)"
              value={`${reinforcedFreezeChainIds.length} / ${allChainIds.length}`}
            />
          )}
          {protocolIsCurrentlyUnfrozen &&
            lastFreezeStatusInUpgradeCycle !== FreezeStatus.None && (
              <StatusRow
                label="Reinforced (unfreeze)"
                value={`${reinforcedUnfreezeChainIds.length} / ${allChainIds.length}`}
              />
            )}
        </CardContent>
      </Card>

      {/* ── Reinforce Freeze ─────────────────────────────────────────────── */}
      <Card data-testid="reinforce-freeze-card">
        <CardHeader>
          <CardTitle>Reinforce Freeze</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Callable by anyone when <code>block.timestamp &lt;= protocolFrozenUntil</code>.{" "}
            <code>reinforceFreeze()</code> will freeze ALL chains + pause bridges once the
            multi-chain logic is active (currently a TODO in <code>_freeze()</code>).{" "}
            <code>reinforceFreezeOneChain(chainId)</code> directly calls{" "}
            <code>STATE_TRANSITION_MANAGER.freezeChain(chainId)</code> and works today.
          </p>

          {!protocolIsCurrentlyFrozen && (
            <p className="rounded border border-gray-600 bg-gray-800/50 p-3 text-gray-400 text-sm">
              Reinforce Freeze is only available while the protocol is frozen (
              <code>protocolFrozenUntil &gt; 0</code>).
            </p>
          )}

          {protocolIsCurrentlyFrozen && (
            <>
              <div className="flex flex-wrap gap-3">
                <ReinforceAllButton
                  handlerAddress={handlerAddress}
                  mode="freeze"
                />
              </div>

              {allChainIds.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-sm">Per-chain reinforcement:</p>
                  {allChainIds.map((chainId) => {
                    const reinforced = reinforcedFreezeChainIds.includes(chainId);
                    return (
                      <ChainRow
                        key={chainId}
                        chainId={chainId}
                        reinforced={reinforced}
                        mode="freeze"
                        handlerAddress={handlerAddress}
                      />
                    );
                  })}
                </div>
              )}

              {allChainIds.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No hyperchain IDs found from the StateTransitionManager. You can
                  still call <code>reinforceFreeze()</code> above.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Reinforce Unfreeze ───────────────────────────────────────────── */}
      <Card data-testid="reinforce-unfreeze-card">
        <CardHeader>
          <CardTitle>Reinforce Unfreeze</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Callable by anyone when <code>protocolFrozenUntil == 0</code>.{" "}
            <code>reinforceUnfreeze()</code> will unfreeze ALL chains + unpause bridges once
            the multi-chain logic is active. <code>reinforceUnfreezeOneChain(chainId)</code>{" "}
            directly calls <code>STATE_TRANSITION_MANAGER.unfreezeChain(chainId)</code>.
          </p>

          {!protocolIsCurrentlyUnfrozen && (
            <p className="rounded border border-gray-600 bg-gray-800/50 p-3 text-gray-400 text-sm">
              Reinforce Unfreeze is only available when the protocol is not frozen (
              <code>protocolFrozenUntil == 0</code>).
            </p>
          )}

          {protocolIsCurrentlyUnfrozen && lastFreezeStatusInUpgradeCycle === FreezeStatus.None && (
            <p className="rounded border border-gray-600 bg-gray-800/50 p-3 text-gray-400 text-sm">
              No freeze cycle has occurred yet – reinforce unfreeze is only meaningful
              after a freeze has happened and been cleared.
            </p>
          )}

          {protocolIsCurrentlyUnfrozen &&
            lastFreezeStatusInUpgradeCycle !== FreezeStatus.None && (
              <>
                <div className="flex flex-wrap gap-3">
                  <ReinforceAllButton
                    handlerAddress={handlerAddress}
                    mode="unfreeze"
                  />
                </div>

                {allChainIds.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium text-sm">Per-chain reinforcement:</p>
                    {allChainIds.map((chainId) => {
                      const reinforced = reinforcedUnfreezeChainIds.includes(chainId);
                      return (
                        <ChainRow
                          key={chainId}
                          chainId={chainId}
                          reinforced={reinforced}
                          mode="unfreeze"
                          handlerAddress={handlerAddress}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "green";
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span
        className={cn(
          "font-medium",
          highlight === "red" && "text-red-400",
          highlight === "green" && "text-green-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ChainRow({
  chainId,
  reinforced,
  mode,
  handlerAddress,
}: {
  chainId: string;
  reinforced: boolean;
  mode: "freeze" | "unfreeze";
  handlerAddress: Hex;
}) {
  return (
    <div
      className="flex items-center justify-between rounded border border-gray-700 px-3 py-2"
      data-testid={`chain-row-${chainId}`}
    >
      <div className="flex items-center gap-2">
        {reinforced ? (
          <CheckCircle className="h-4 w-4 text-green-400" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
        <span className="text-sm">Chain {chainId}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs",
            reinforced
              ? "bg-green-900/50 text-green-300"
              : "bg-red-900/50 text-red-300"
          )}
        >
          {reinforced ? "Reinforced" : "Pending"}
        </span>
      </div>
      {!reinforced && (
        <ReinforceChainButton
          handlerAddress={handlerAddress}
          chainId={BigInt(chainId)}
          mode={mode}
        />
      )}
    </div>
  );
}
