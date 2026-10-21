import {
  CHAIN_UPGRADE,
  type ChainUpgradePlan,
  type ChainUpgradeState,
  protocolVersionLabel,
} from "@/common/chain-upgrade";
import { STORAGE_PREFIX } from "@/common/storage-prefix";
import { useConnectWallet } from "@/components/connect-button";
import { AddressLink, CopyButton, Hash, TxLink } from "@/components/hex";
import { PageHeader, Facts } from "@/components/page";
import { useHoldUpdates } from "@/components/presence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { type Hex, isAddressEqual } from "viem";

type Action = ChainUpgradePlan["action"];
type Sent = {
  status: "awaiting" | "pending" | "uncertain" | "reverted";
  hash?: Hex;
  timestamp: string;
  version: string;
};
function parseSent(_raw: string | null): Sent | undefined {
  if (_raw === null) return undefined;
  const value = JSON.parse(_raw) as Partial<Sent> | null;
  if (
    !value ||
    typeof value !== "object" ||
    !["awaiting", "pending", "uncertain", "reverted"].includes(value.status ?? "") ||
    typeof value.timestamp !== "string" ||
    !/^\d+$/.test(value.timestamp) ||
    typeof value.version !== "string" ||
    !/^\d+$/.test(value.version) ||
    (value.hash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.hash))
  )
    throw new Error(
      "The saved submission journal cannot be read. Check the wallet before sending."
    );
  return value as Sent;
}
export default function ChainUpgradePage() {
  const [chainId, setChainId] = useState<string>(CHAIN_UPGRADE.defaultChainId);
  const [selected, setSelected] = useState<string>(CHAIN_UPGRADE.defaultChainId);
  const [state, setState] = useState<ChainUpgradeState | null>(null);
  const [timestamp, setTimestamp] = useState("");
  const [review, setReview] = useState<ChainUpgradePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readRevision = useRef(0);
  const holdRead = useRef(false);
  const [journal, setSent] = useState<Partial<Record<Action, Sent>>>({});
  const sent = Object.fromEntries(
    Object.entries(journal).filter(
      ([, _entry]) => !state || state.completed || _entry?.version === state.currentVersion
    )
  ) as Partial<Record<Action, Sent>>;
  const account = useAccount();
  const { data: wallet } = useWalletClient();
  const connect = useConnectWallet();
  useHoldUpdates(busy || !!review);
  holdRead.current = busy || !!review;
  const key = useCallback(
    (_action: Action) => `${STORAGE_PREFIX}chain-upgrade:${selected}:${_action}`,
    [selected]
  );
  const stored = (_action: Action): Sent | undefined => {
    const value = localStorage.getItem(key(_action));
    const record = parseSent(value);
    return record && state && record.version !== state.currentVersion ? undefined : record;
  };
  const save = (_action: Action, _value: Sent) => {
    localStorage.setItem(key(_action), JSON.stringify(_value));
    setSent((_current) => ({ ..._current, [_action]: _value }));
  };
  const fetchData = useCallback(async (_query: URLSearchParams) => {
    const response = await fetch(`/resources/chain-upgrade?${_query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(CHAIN_UPGRADE.timeoutMs),
    });
    const value = (await response.json()) as {
      state?: ChainUpgradeState;
      plan?: ChainUpgradePlan;
      error?: string;
    };
    if (!response.ok || !value.state)
      throw new Error(value.error ?? "Chain upgrade data could not be read.");
    return value;
  }, []);
  const refresh = useCallback(async () => {
    const revision = ++readRevision.current;
    const value = await fetchData(new URLSearchParams({ chainId: selected }));
    if (revision === readRevision.current && value.state) setState(value.state);
  }, [selected, fetchData]);
  useEffect(() => {
    setState(null);
    setError(null);
    try {
      setSent(
        Object.fromEntries(
          (["timestamp", "execute"] as const).map((_action) => {
            const raw = localStorage.getItem(key(_action));
            return [_action, parseSent(raw)];
          })
        )
      );
    } catch {
      setError("The saved submission journal cannot be read. Check the wallet before sending.");
      setSent({
        timestamp: { status: "uncertain", timestamp: "", version: "" },
        execute: { status: "uncertain", timestamp: "", version: "" },
      });
    }
    let current = true;
    let reading = false;
    const load = async () => {
      if (reading || holdRead.current) return;
      reading = true;
      try {
        await refresh();
      } catch (_error) {
        if (current) setError(_error instanceof Error ? _error.message : String(_error));
      } finally {
        reading = false;
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, CHAIN_UPGRADE.refreshMs);
    return () => {
      current = false;
      readRevision.current++;
      clearInterval(interval);
    };
  }, [refresh, key]);
  const owns = state && account.address && isAddressEqual(account.address, state.owner);
  const getPlan = async (_action: Action) => {
    if (!account.address || !state) throw new Error("Connect the ChainAdmin owner first.");
    const previous = stored(_action);
    const query = new URLSearchParams({
      chainId: selected,
      action: _action,
      owner: account.address,
    });
    if (_action === "timestamp") {
      const when =
        previous?.timestamp ??
        (timestamp ? String(Math.floor(Date.parse(`${timestamp}Z`) / 1000)) : "");
      if (!/^\d+$/.test(when)) throw new Error("Choose an upgrade time in UTC.");
      query.set("timestamp", when);
    }
    if (previous?.hash) query.set("hash", previous.hash);
    const value = await fetchData(query);
    if (!value.plan) throw new Error("No transaction was prepared.");
    return value.plan;
  };
  const prepare = async (_action: Action) => {
    setBusy(true);
    setError(null);
    try {
      const plan = await getPlan(_action);
      const previous = stored(_action);
      if (previous && plan.previousSubmission?.status !== "reverted")
        throw new Error(
          "This submission is pending or uncertain. Check the wallet and refresh its state before sending again."
        );
      if (previous) save(_action, { ...previous, status: "reverted" });
      setReview(plan);
    } catch (_error) {
      setError(_error instanceof Error ? _error.message : String(_error));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!review || !wallet || busy) return;
    if (!navigator.locks) {
      setError("Use a browser with transaction coordination support.");
      return;
    }
    await navigator.locks.request(
      `${STORAGE_PREFIX}chain-upgrade-send`,
      { ifAvailable: true },
      async (_lock) => {
        if (!_lock) {
          setError("Another tab has a wallet request open.");
          return;
        }
        setBusy(true);
        setError(null);
        let requested = false;
        try {
          const plan = await getPlan(review.action);
          if (
            plan.to !== review.to ||
            plan.data !== review.data ||
            plan.owner !== review.owner ||
            plan.gasLimit !== review.gasLimit ||
            plan.timestamp !== review.timestamp
          )
            throw new Error(
              "The reviewed chain upgrade call changed. Close this review and prepare it again."
            );
          const previous = stored(plan.action);
          if (
            previous &&
            !(
              previous.status === "reverted" &&
              previous.hash === plan.previousSubmission?.hash &&
              plan.previousSubmission?.status === "reverted"
            )
          )
            throw new Error("This call already has a pending or uncertain submission.");
          if ((await wallet.getChainId()) !== plan.chainId)
            throw new Error("Switch the connected wallet to Sepolia.");
          const [sender] = await wallet.getAddresses();
          if (!sender || !isAddressEqual(sender, plan.owner))
            throw new Error("Select the reviewed ChainAdmin owner in the wallet.");
          const record: Sent = {
            status: "awaiting",
            timestamp: plan.timestamp,
            version: plan.state.currentVersion,
          };
          save(plan.action, record);
          requested = true;
          const hash = await wallet.sendTransaction({
            account: plan.owner,
            chain: wallet.chain,
            to: plan.to,
            data: plan.data,
            value: 0n,
            gas: BigInt(plan.gasLimit),
          });
          save(plan.action, { ...record, status: "pending", hash });
          setReview(null);
          await refresh();
        } catch (_error) {
          const e = _error as { code?: number; cause?: { code?: number }; name?: string };
          if (requested) {
            if (
              e.code === 4001 ||
              e.cause?.code === 4001 ||
              e.name === "UserRejectedRequestError"
            ) {
              localStorage.removeItem(key(review.action));
              setSent((_current) => ({ ..._current, [review.action]: undefined }));
            } else if (!stored(review.action)?.hash)
              save(review.action, {
                status: "uncertain",
                timestamp: review.timestamp,
                version: review.state.currentVersion,
              });
          }
          setError(
            _error instanceof Error
              ? _error.message.split("\n")[0] ?? "Wallet request failed"
              : String(_error)
          );
        } finally {
          setBusy(false);
        }
      }
    );
  };
  const scheduled = !!state && BigInt(state.timestamp) > 0n;
  const ready = !!state && scheduled && BigInt(state.clock) >= BigInt(state.timestamp);
  const stampDone = state && sent.timestamp && state.timestamp === sent.timestamp.timestamp;
  const timeLabel = (_time: string) =>
    new Date(Number(_time) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
  return (
    <div className="space-y-6">
      <PageHeader title="Chain upgrade">
        <p>
          Schedule and apply a registered protocol upgrade to one chain. Transactions are submitted
          on Sepolia through that chain's admin.
        </p>
      </PageHeader>
      <Card className="flex flex-wrap items-end gap-3 p-5">
        <div>
          <Label htmlFor="chain-upgrade-id">Chain ID</Label>
          <Input
            id="chain-upgrade-id"
            value={chainId}
            onChange={(_e) => setChainId(_e.target.value)}
            disabled={busy || !!review}
          />
        </div>
        <Button
          disabled={busy || !!review}
          onClick={() => {
            if (selected === chainId) void refresh().catch((_e) => setError(String(_e)));
            else setSelected(chainId);
          }}
        >
          Load chain
        </Button>
      </Card>
      {error && !review && (
        <p
          role="alert"
          className="break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"
        >
          {error}
        </p>
      )}
      {!state && !error && (
        <p role="status">Reading the chain, admin, timestamp and registered upgrade…</p>
      )}
      {state && (
        <>
          <Facts
            items={[
              {
                label: "Chain",
                value: `${state.chainId} · ${state.completed ? "Up to date" : "Upgrade available"}`,
              },
              { label: "Current version", value: protocolVersionLabel(state.currentVersion) },
              { label: "CTM version", value: protocolVersionLabel(state.targetVersion) },
              { label: "Chain contract", value: <AddressLink address={state.diamond} /> },
              { label: "ChainAdmin", value: <AddressLink address={state.admin} /> },
              { label: "Required owner", value: <AddressLink address={state.owner} /> },
            ]}
          />
          {state.completed ? (
            <Card className="p-5">
              <h2 className="font-semibold text-lg">
                Chain upgraded to {protocolVersionLabel(state.currentVersion)}
              </h2>
              <p>
                The chain and CTM protocol versions match. No further chain upgrade is available.
              </p>
              {sent.execute?.hash && <TxLink hash={sent.execute.hash} />}
            </Card>
          ) : (
            <>
              <p className="text-slate-600 text-sm">
                Registered upgrade cut: <Hash value={state.cutHash} />
                {state.cutSourceTransaction && (
                  <>
                    {" "}
                    · <TxLink hash={state.cutSourceTransaction} />
                  </>
                )}{" "}
                · checked at L1 block {state.block}
              </p>
              {!owns && (
                <Card className="space-y-3 p-5">
                  <p>Connect the ChainAdmin owner shown above to prepare these transactions.</p>
                  <Button
                    onClick={connect.connectMetaMask ?? connect.connect}
                    disabled={!(connect.connectMetaMask ?? connect.connect)}
                  >
                    Connect owner wallet
                  </Button>
                </Card>
              )}
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold text-lg">1. Set upgrade timestamp</h2>
                <p>
                  {scheduled
                    ? `Scheduled for ${timeLabel(state.timestamp)}.`
                    : "No upgrade timestamp is set for the chain's current version."}{" "}
                  Set the time coordinated with the chain's node operators.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="chain-upgrade-time">Upgrade time (UTC)</Label>
                    <Input
                      id="chain-upgrade-time"
                      type="datetime-local"
                      step="1"
                      value={timestamp}
                      disabled={busy || !!review}
                      onChange={(_e) => setTimestamp(_e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || !!review}
                    onClick={() =>
                      setTimestamp(new Date(Number(state.clock) * 1000).toISOString().slice(0, 19))
                    }
                  >
                    Use current chain time
                  </Button>
                </div>
                {sent.timestamp?.hash && <TxLink hash={sent.timestamp.hash} />}
                <Button
                  disabled={busy || !!review || !owns || !!stampDone}
                  onClick={() => void prepare("timestamp")}
                >
                  {stampDone
                    ? "Timestamp confirmed"
                    : sent.timestamp
                      ? "Check timestamp / retry if failed"
                      : "Review timestamp"}
                </Button>
              </Card>
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold text-lg">2. Execute chain upgrade</h2>
                <p>
                  {!scheduled
                    ? "Set the upgrade timestamp first."
                    : !ready
                      ? `Available after ${timeLabel(state.timestamp)} (L1 chain clock).`
                      : "The scheduled time has arrived. Review the registered upgrade and apply it to this chain."}
                </p>
                {sent.execute?.hash && <TxLink hash={sent.execute.hash} />}
                <Button
                  disabled={busy || !!review || !owns || !ready}
                  onClick={() => void prepare("execute")}
                >
                  {sent.execute ? "Check execution / retry if failed" : "Review chain upgrade"}
                </Button>
              </Card>
            </>
          )}
        </>
      )}
      <Dialog
        open={!!review}
        onOpenChange={(_open) => {
          if (!_open && !busy) setReview(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {review?.action === "timestamp"
                ? "Set this chain's upgrade timestamp"
                : "Execute this chain's registered upgrade"}
            </DialogTitle>
            <DialogDescription>
              Review the exact call before confirming it in your wallet.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-3 text-sm">
              {error && (
                <p role="alert" className="text-red-800">
                  {error}
                </p>
              )}
              <p>Sepolia · chain {review.state.chainId}</p>
              <p>
                From: <AddressLink address={review.owner} />
              </p>
              <p>
                To ChainAdmin: <AddressLink address={review.to} />
              </p>
              <p>
                {protocolVersionLabel(review.state.currentVersion)} →{" "}
                {protocolVersionLabel(review.state.targetVersion)}
              </p>
              <p>Upgrade time: {timeLabel(review.timestamp)}</p>
              <p>Value: 0 ETH · gas limit: {review.gasLimit}. Unused gas is not charged.</p>
              {review.previousSubmission?.status === "reverted" && (
                <p>The previous transaction reverted. This is a new attempt.</p>
              )}
              <details>
                <summary>Exact transaction calldata</summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {review.data}
                </pre>
                <CopyButton value={review.data} label="Copy calldata" />
              </details>
              <Button disabled={busy} onClick={() => void send()}>
                {busy
                  ? "Checking…"
                  : review.previousSubmission?.status === "reverted"
                    ? "Retry in wallet"
                    : "Send to wallet"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
