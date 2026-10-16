// A proposal's calls as an actions table, like Tally's: one row per call (its kind, target and
// function, with the calls it carries), unfolding into its arguments as an aligned tree (names in one
// column, values in the next, whatever the depth; tuples and arrays fold, bytes that hold a known
// call open into it), each value coloured by kind, addresses linked to their chain's explorer with
// the names known for them. Raw shows every call as its signature, target, value and calldata. What
// is shown was re-encoded to the exact calldata; a call that is not opens by itself, with why.
import {
  type DecodedFunction,
  ERA_CHAIN,
  type ParamNode,
  addressLabel,
  functionsWithSelector,
  numberHint,
} from "@/common/calldata";
import type { DecodedCall } from "@/common/proposal";
import { useChain } from "@/components/governance-context";
import { CopyButton, useExplorer } from "@/components/hex";
import { cn } from "@/utils/cn";
import { formatEth, shortHex } from "@/utils/format";
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Coins,
  ExternalLink,
  KeyRound,
  type LucideIcon,
  Power,
  Send,
  SquareCode,
} from "lucide-react";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";

/** The chain the page's calls run on, and the names the page knows (governance contracts). */
type Where = {
  l1: number | undefined;
  chainId: number | undefined;
  labels: Record<string, string>;
};
const WhereContext = createContext<Where>({ l1: undefined, chainId: undefined, labels: {} });

/** The table's controls: the last expand/collapse-all (`v` counts presses), and the types switch. */
type View = { fold: { open: boolean; v: number }; types: boolean };
const ViewContext = createContext<View>({ fold: { open: false, v: 0 }, types: false });

export function CallList({
  calls,
  labels,
  chainId,
}: {
  calls: DecodedCall[];
  labels?: Record<string, string>;
  /** The chain the calls run on, when not the page's L1 (an Era proposal's calls). */
  chainId?: number;
}) {
  const l1 = useChain()?.chainId;
  const [fold, setFold] = useState({ open: false, v: 0 });
  const [types, setTypes] = useState(false);
  const [raw, setRaw] = useState(false);
  return (
    <WhereContext.Provider value={{ l1, chainId: chainId ?? l1, labels: labels ?? {} }}>
      <ViewContext.Provider value={{ fold, types }}>
        <div
          className="overflow-hidden rounded-xl border border-slate-300 bg-white"
          data-testid="call-list"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-slate-200 border-b px-4 py-2.5">
            <h3 className="font-semibold text-[16px] text-navy-800">
              Actions{" "}
              <span className="font-normal text-[14px] text-slate-600">· {calls.length}</span>
            </h3>
            <span className="flex flex-wrap items-center gap-1.5">
              {!raw && (
                <>
                  <ToolButton
                    onClick={() => setFold((f) => ({ open: !(f.v > 0 && f.open), v: f.v + 1 }))}
                  >
                    {fold.v > 0 && fold.open ? (
                      <>
                        <ChevronsDownUp aria-hidden className="h-3.5 w-3.5" /> Collapse all
                      </>
                    ) : (
                      <>
                        <ChevronsUpDown aria-hidden className="h-3.5 w-3.5" /> Expand all
                      </>
                    )}
                  </ToolButton>
                  <ToolButton onClick={() => setTypes(!types)} pressed={types}>
                    Show types
                  </ToolButton>
                </>
              )}
              <ToolButton onClick={() => setRaw(!raw)} pressed={raw}>
                {raw ? "Summary" : "Raw"}
              </ToolButton>
            </span>
          </div>
          {raw ? (
            <ol className="space-y-3 p-4">
              {calls.map((call, i) => (
                <RawCall key={`${i}-${call.target}`} call={call} index={i} />
              ))}
            </ol>
          ) : (
            <>
              <div
                aria-hidden
                className="hidden grid-cols-[36px_132px_minmax(0,1fr)_minmax(0,1.3fr)_112px] gap-x-4 border-slate-200 border-b bg-slate-50 px-4 py-2 font-medium text-[12.5px] text-slate-600 md:grid"
              >
                <span>#</span>
                <span>Type</span>
                <span>Target</span>
                <span>Function</span>
                <span className="text-right">Details</span>
              </div>
              <ol className="divide-y divide-slate-200">
                {calls.map((call, i) => (
                  <CallRow key={`${i}-${call.target}`} index={i} call={call} />
                ))}
              </ol>
            </>
          )}
        </div>
      </ViewContext.Provider>
    </WhereContext.Provider>
  );
}

function ToolButton({
  children,
  onClick,
  pressed,
}: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-medium text-[13px] transition-colors",
        pressed
          ? "border-navy-800 bg-navy-800 text-white"
          : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-75"
      )}
    >
      {children}
    </button>
  );
}

// ---- the summary rows ----

type Kind = { label: string; icon: LucideIcon; warn?: boolean };

/** What kind of action a call is, for the Type column. */
function kindOf(call: DecodedCall): Kind {
  const name = call.decoded?.name;
  if (!call.selector) return { label: "Transfer", icon: Send };
  if (!name) return { label: "Unknown", icon: AlertTriangle, warn: true };
  if (/^upgrade(To)?(AndCall)?$|^setNewVersionUpgrade$|DiamondCut$/.test(name))
    return { label: "Upgrade", icon: ArrowUpCircle };
  if (/^requestL2Transaction/.test(name)) return { label: "L1 → L2", icon: ArrowRightLeft };
  if (/^(approve|transfer|transferFrom|increaseAllowance|decreaseAllowance)$/.test(name))
    return { label: "Token", icon: Coins };
  if (/Owner(ship)?|Admin$|^setPendingAdmin$|^acceptAdmin$|^changeProxyAdmin$/.test(name))
    return { label: "Admin", icon: KeyRound };
  if (/^(un)?pause|^(un)?freeze/i.test(name)) return { label: "Control", icon: Power };
  return { label: "Call", icon: SquareCode };
}

/** The calls a call carries in its bytes arguments (one level down), by name. */
function carried(fn: DecodedFunction): string[] {
  const out: string[] = [];
  const walk = (nodes: ParamNode[]) => {
    for (const n of nodes) {
      if (n.kind === "bytes" && n.call) out.push(n.call.name);
      else if (n.kind === "tuple") walk(n.children);
    }
  };
  walk(fn.args);
  return out;
}

function CallRow({ call, index }: { call: DecodedCall; index: number }) {
  const { fold } = useContext(ViewContext);
  const { chainId } = useContext(WhereContext);
  const decoded = call.decoded;
  // A call that does not decode opens by itself: what it is not is worth reading.
  const attention = !decoded && call.selector !== null;
  const [open, setOpen] = useState(() => (fold.v > 0 ? fold.open : attention));
  useEffect(() => {
    if (fold.v > 0) setOpen(fold.open);
  }, [fold]);
  const kind = kindOf(call);
  const inner = decoded ? carried(decoded) : [];
  const params = decoded?.args.length ?? 0;
  const bytes = (call.data.length - 2) / 2;
  return (
    <li data-testid="call">
      <div
        className={cn(
          "group/call grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-slate-75 md:grid-cols-[36px_132px_minmax(0,1fr)_minmax(0,1.3fr)_112px] md:gap-x-4",
          open && "bg-slate-50"
        )}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`Call ${index + 1}: ${decoded?.name ?? kind.label}`}
      >
        <span className="mono col-start-1 row-start-1 text-[14px] text-slate-600">{index + 1}</span>
        <span
          className={cn(
            "col-start-2 row-start-1 inline-flex items-center gap-2 whitespace-nowrap font-medium text-[14px]",
            kind.warn ? "text-amber-900" : "text-slate-800"
          )}
        >
          <kind.icon aria-hidden className="h-4 w-4 shrink-0" />
          {kind.label}
        </span>
        <span
          className="col-span-2 col-start-2 row-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <TargetCell address={call.target} chainId={chainId} />
        </span>
        <span className="col-span-2 col-start-2 row-start-3 min-w-0 md:col-span-1 md:col-start-4 md:row-start-1">
          {decoded ? (
            <span className="mono break-all font-bold text-[14.5px] text-code-fn">
              {decoded.name}(..)
            </span>
          ) : (
            <span
              className={cn(
                "font-semibold text-[14px]",
                kind.warn ? "text-amber-900" : "text-slate-800"
              )}
            >
              {call.selector
                ? functionsWithSelector(call.selector).length > 0
                  ? "Does not decode"
                  : "Unknown function"
                : "Value transfer"}
            </span>
          )}
          {inner.length > 0 && (
            <span className="mono block truncate text-[12.5px] text-slate-600">
              {inner.map((name) => `↳ ${name}`).join("  ")}
            </span>
          )}
        </span>
        <span className="col-start-3 row-start-1 inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-[13px] text-slate-600 md:col-start-5">
          {call.value !== "0" && (
            <span className="mono text-code-num">{formatEth(call.value)}</span>
          )}
          {decoded
            ? params === 0
              ? "No params"
              : `${params} param${params === 1 ? "" : "s"}`
            : `${bytes} bytes`}
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 text-slate-600 transition-transform", open && "rotate-180")}
          />
        </span>
      </div>
      {open && <CallDetail call={call} />}
    </li>
  );
}

/** The short target in the table: its name, else the short address; link and copy beside. */
function TargetCell({ address, chainId }: { address: string; chainId: number | undefined }) {
  const { l1, labels } = useContext(WhereContext);
  const explorer = useExplorer();
  const onL1 = chainId === undefined || chainId === l1;
  const onEra = l1 !== undefined && chainId === ERA_CHAIN[l1];
  const href = onL1 ? explorer.address(address) : onEra ? explorer.l2Address(address) : null;
  const label =
    (onL1 ? labels[address.toLowerCase()] : undefined) ?? addressLabel(address, chainId ?? l1);
  return (
    <span
      className="group/row inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5"
      title={address}
    >
      {label && <span className="truncate font-medium text-[14px] text-slate-950">{label}</span>}
      <span className={cn("mono text-[13px]", label ? "text-slate-600" : "text-code-addr")}>
        {shortHex(address)}
      </span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in the explorer"
          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-brand-700"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <MiniCopy value={address} label="Copy address" />
    </span>
  );
}

/** An unfolded row: where the call goes in full, then its arguments. */
function CallDetail({ call }: { call: DecodedCall }) {
  const { chainId } = useContext(WhereContext);
  const decoded = call.decoded;
  const bytes = (call.data.length - 2) / 2;
  return (
    <div className="border-slate-200 border-t bg-white pb-2">
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5 text-[13.5px]">
        <Meta label="To">
          <AddressValue address={call.target} chainId={chainId} />
        </Meta>
        <Meta label="Value">
          <span className="mono text-code-num">{formatEth(call.value)}</span>
        </Meta>
        {call.selector && (
          <Meta label="Selector">
            <span className="mono text-slate-800">{call.selector}</span>
          </Meta>
        )}
        {decoded?.abi && (
          <Meta label="ABI">
            <span className="text-slate-800">{decoded.abi}</span>
          </Meta>
        )}
        <Meta label="Calldata">
          <span className="text-slate-800">
            {bytes} byte{bytes === 1 ? "" : "s"}
          </span>
          {bytes > 0 && <MiniCopy value={call.data} label="Copy calldata" />}
        </Meta>
        {decoded && decoded.alternatives.length > 0 && (
          <span
            className="rounded-full bg-amber-100 px-2 font-semibold text-[12px] text-amber-950"
            title={`Also decodes as: ${decoded.alternatives.join(", ")}`}
          >
            {decoded.alternatives.length} other signature
            {decoded.alternatives.length === 1 ? "" : "s"} match
          </span>
        )}
      </dl>
      <div className="border-slate-100 border-t pt-1.5">
        {decoded ? (
          decoded.args.length > 0 ? (
            decoded.args.map((arg) => (
              <ParamRow key={arg.name} node={arg} depth={0} parentChain={chainId} path={arg.name} />
            ))
          ) : (
            <p className="px-4 py-1 text-[13.5px] text-slate-600">No arguments.</p>
          )
        ) : call.selector ? (
          <RawWords data={call.data} selector={call.selector} />
        ) : (
          <p className="px-4 py-1 text-[13.5px] text-slate-600">
            No calldata: a plain value transfer.
          </p>
        )}
      </div>
    </div>
  );
}

// ---- raw ----

/** One call as Tally's raw view shows it: signature, target, value and calldata. */
function RawCall({ call, index }: { call: DecodedCall; index: number }) {
  const { chainId } = useContext(WhereContext);
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50">
      <p className="border-slate-200 border-b px-4 py-2 font-semibold text-[14px] text-navy-800">
        Call {index + 1}
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 text-[13.5px] sm:grid-cols-[120px_minmax(0,1fr)]">
        <dt className="font-semibold text-slate-700">Signature</dt>
        <dd className="mono break-all text-slate-950">
          {call.decoded?.signature ?? (call.selector ? `unknown (${call.selector})` : "none")}
        </dd>
        <dt className="font-semibold text-slate-700">Target</dt>
        <dd className="flex flex-wrap items-baseline gap-x-1.5">
          <AddressValue address={call.target} chainId={chainId} />
        </dd>
        <dt className="font-semibold text-slate-700">Value</dt>
        <dd className="mono text-slate-950">
          {call.value} wei{" "}
          <span className="font-sans text-slate-600">({formatEth(call.value)})</span>
        </dd>
        <dt className="font-semibold text-slate-700">Calldata</dt>
        <dd className="relative min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2">
          {call.data.length > 2 ? (
            <>
              <CopyButton
                value={call.data}
                label="Copy calldata"
                className="absolute top-1 right-1"
              />
              <Words data={call.data} />
            </>
          ) : (
            <span className="text-slate-600">empty (0x)</span>
          )}
        </dd>
      </dl>
    </li>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="font-semibold text-[12px] text-slate-700 uppercase tracking-[0.04em]">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">{children}</dd>
    </div>
  );
}

function Selector({ value }: { value: string }) {
  return (
    <span className="mono rounded border border-slate-300 bg-white px-1.5 text-[12px] text-slate-700">
      {value}
    </span>
  );
}

function Words({ data }: { data: string }) {
  const words: string[] = [];
  for (let i = 10; i < data.length && words.length < 400; i += 64)
    words.push(`0x${data.slice(i, i + 64)}`);
  return (
    <div className="grid max-h-72 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 overflow-y-auto pr-8 font-mono text-[12.5px] leading-6">
      <span className="text-slate-500">selector</span>
      <span className="text-code-bytes">{data.slice(0, 10)}</span>
      {words.map((w, i) => (
        <WordRow key={`${i}-${w}`} offset={i * 32} word={w} />
      ))}
      {data.length > 10 + 400 * 64 && (
        <>
          <span className="text-slate-500">…</span>
          <span className="font-sans text-slate-550">
            truncated: copy the calldata for all of it
          </span>
        </>
      )}
    </div>
  );
}

function WordRow({ offset, word }: { offset: number; word: string }) {
  return (
    <>
      <span className="text-slate-500">0x{offset.toString(16).padStart(4, "0")}</span>
      <span className="break-all text-code-bytes">{word}</span>
    </>
  );
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  324: "ZKsync Era",
  300: "ZKsync Era Sepolia",
  9075: "ZK Gateway",
};

function autoOpen(node: ParamNode, depth: number) {
  if (node.kind === "array") return depth < 4 && node.children.length <= 12;
  if (node.kind === "tuple") return depth < 5;
  if (node.kind === "bytes") return depth < 6;
  return false;
}

const isFoldable = (node: ParamNode) =>
  ((node.kind === "tuple" || node.kind === "array") && node.children.length > 0) ||
  (node.kind === "bytes" && (node.call !== null || node.payload !== null));

const PRIMITIVE = /^(address|bool|string|bytes\d*|u?int\d*)(\[\d*\])*$/;

/** The struct, enum or contract name when the ABI gives one; the plain type with Types on. */
function typeLabel(node: ParamNode, types: boolean) {
  if (node.struct) {
    const dims = /(\[\d*\])+$/.exec(node.type)?.[0] ?? "";
    return node.struct.endsWith("]") ? node.struct : `${node.struct}${dims}`;
  }
  if (types || !PRIMITIVE.test(node.type)) return node.type === "tuple" ? null : node.type;
  return null;
}

const INDENT = 16;
const LEVELS = Array.from({ length: 16 }, (_, i) => `level-${i}`);

function ParamRow({
  node,
  depth,
  parentChain,
  path,
}: { node: ParamNode; depth: number; parentChain: number | undefined; path: string }) {
  const { fold, types } = useContext(ViewContext);
  const canFold = isFoldable(node);
  // A row that appears after Expand / Collapse all follows it; before either, its depth decides.
  const [open, setOpen] = useState(
    () => canFold && (fold.v > 0 ? fold.open : autoOpen(node, depth))
  );
  useEffect(() => {
    if (fold.v > 0 && canFold) setOpen(fold.open);
  }, [fold, canFold]);
  const chain = node.chainId ?? parentChain;
  const children =
    node.kind === "tuple" || node.kind === "array"
      ? node.children
      : node.kind === "bytes"
        ? node.call?.args ?? (node.payload ? [node.payload] : [])
        : [];
  const type = typeLabel(node, types);
  const index = node.name.startsWith("[");
  return (
    <>
      <div className="group/row grid min-w-0 grid-cols-1 gap-x-4 px-4 py-1 text-[14px] leading-6 hover:bg-slate-75 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-baseline" title={path}>
          {/* One guide per level: the column stays aligned whatever the depth. */}
          {LEVELS.slice(0, depth).map((level) => (
            <span
              key={level}
              aria-hidden
              className="-my-1 shrink-0 self-stretch border-slate-300 border-l"
              style={{ width: INDENT, marginLeft: level === "level-0" ? 8 : 0 }}
            />
          ))}
          {canFold ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={`${open ? "Fold" : "Unfold"} ${node.name}`}
              className="mr-1 grid h-[18px] w-[18px] shrink-0 place-items-center self-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-950"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
          ) : (
            <span className="mr-1 w-[18px] shrink-0" />
          )}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span
              className={cn(
                "mono truncate",
                index ? "text-slate-600" : "font-semibold text-slate-950"
              )}
            >
              {node.name}
            </span>
            {type && <span className="mono truncate text-[12.5px] text-code-type">{type}</span>}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-[42px] font-mono sm:pl-0">
          {chain !== parentChain && chain !== undefined && (
            <span className="rounded border border-slate-200 bg-white px-1.5 font-sans text-[11px] text-slate-700">
              {CHAIN_NAMES[chain] ?? `Chain ${chain}`}
            </span>
          )}
          <Value node={node} open={open} chain={chain} />
        </div>
      </div>
      {canFold && open && (
        <>
          {node.kind === "bytes" && node.call && node.call.args.length === 0 && (
            <div
              className="px-4 py-1 text-[14px] text-slate-600 leading-6"
              style={{ paddingLeft: 16 + 8 + (depth + 1) * INDENT + 22 }}
            >
              No arguments.
            </div>
          )}
          {children.map((c, i) => (
            <ParamRow
              key={`${c.name}-${i}`}
              node={c}
              depth={depth + 1}
              parentChain={chain}
              path={c.name.startsWith("[") ? `${path}${c.name}` : `${path}.${c.name}`}
            />
          ))}
        </>
      )}
    </>
  );
}

function preview(n: ParamNode): string {
  if (n.kind === "value") {
    if (n.type === "address") return shortHex(n.value);
    return n.value.length > 20 ? `${n.value.slice(0, 18)}…` : n.value;
  }
  if (n.kind === "tuple") return "{…}";
  if (n.kind === "array") return `[${n.children.length}]`;
  if (n.call) return `ƒ ${n.call.name}`;
  if (n.payload) return n.payload.what;
  return `${(n.value.length - 2) / 2} bytes`;
}

const clip = (s: string) => (s.length > 110 ? `${s.slice(0, 108)}…` : s);

function Value({ node, open, chain }: { node: ParamNode; open: boolean; chain?: number }) {
  if (node.kind === "tuple") {
    return open ? null : (
      <span className="min-w-0 truncate text-slate-500">
        {clip(`{ ${node.children.map((c) => `${c.name}: ${preview(c)}`).join(", ")} }`)}
      </span>
    );
  }
  if (node.kind === "array") {
    const first = node.children[0];
    return (
      <>
        <span className="font-sans text-slate-550">
          {node.children.length} item{node.children.length === 1 ? "" : "s"}
        </span>
        {!open && first?.kind === "value" && (
          <span className="min-w-0 truncate text-slate-500">
            {clip(
              `[${node.children.slice(0, 6).map(preview).join(", ")}${node.children.length > 6 ? ", …" : ""}]`
            )}
          </span>
        )}
      </>
    );
  }
  if (node.kind === "bytes") {
    const length = (node.value.length - 2) / 2;
    if (node.call || node.payload) {
      return (
        <>
          {node.call ? (
            <span className="inline-flex items-baseline gap-1.5" title={node.call.signature}>
              <span className="text-slate-500 italic">ƒ</span>
              <span className="font-semibold text-code-fn">{node.call.name}</span>
              <Selector value={node.call.selector} />
            </span>
          ) : (
            <span className="font-sans font-semibold text-[12.5px] text-code-fn">
              {node.payload?.what}
            </span>
          )}
          <span className="font-sans text-[13px] text-slate-600">{length} bytes</span>
          <MiniCopy value={node.value} label="Copy bytes" />
        </>
      );
    }
    return <HexValue hex={node.value} />;
  }
  if (node.type === "address") return <AddressValue address={node.value} chainId={chain} />;
  if (/^u?int/.test(node.type)) {
    const hint = numberHint(node);
    return (
      <>
        <span className="break-all text-code-num tabular-nums">{node.value}</span>
        {hint && <span className="font-sans text-[13px] text-slate-600">{hint}</span>}
      </>
    );
  }
  if (node.type === "bool") return <span className="text-code-bool">{node.value}</span>;
  if (node.type === "string")
    return (
      <>
        <span className="whitespace-pre-wrap break-all text-code-str">
          {JSON.stringify(node.value)}
        </span>
        <MiniCopy value={node.value} label="Copy text" />
      </>
    );
  if (/^bytes\d+$/.test(node.type)) {
    // A selector: the function it names, where one is known.
    const named = node.type === "bytes4" ? functionsWithSelector(node.value) : [];
    return /^0x0*$/.test(node.value) ? (
      <span className="break-all text-slate-500">{node.value}</span>
    ) : (
      <>
        <span className="break-all text-code-bytes">{node.value}</span>
        {named.length > 0 && (
          <span className="break-all text-[13px] text-slate-600">{named.join(" or ")}</span>
        )}
        <MiniCopy value={node.value} label="Copy value" />
      </>
    );
  }
  return <span className="break-all">{node.value}</span>;
}

const LIMIT = 96;

function HexValue({ hex }: { hex: string }) {
  const [all, setAll] = useState(false);
  const length = (hex.length - 2) / 2;
  if (length === 0) return <span className="text-slate-500">empty (0x)</span>;
  const known = length >= 4 ? functionsWithSelector(hex.slice(0, 10)) : [];
  return (
    <>
      {known.length > 0 && <NotExact signatures={known} inline />}
      <span className="min-w-0 break-all text-code-bytes">
        {all || length <= LIMIT ? hex : `${hex.slice(0, 2 + LIMIT * 2)}…`}
        {!all && length > LIMIT && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="ml-1.5 rounded border border-slate-200 bg-white px-1.5 align-[1px] font-sans text-[11.5px] text-slate-550 hover:text-slate-950"
          >
            +{length - LIMIT} bytes
          </button>
        )}
      </span>
      <span className="font-sans text-[13px] text-slate-600">{length} bytes</span>
      <MiniCopy value={hex} label="Copy bytes" />
    </>
  );
}

function AddressValue({ address, chainId }: { address: string; chainId: number | undefined }) {
  const { l1, labels } = useContext(WhereContext);
  const explorer = useExplorer();
  const zero = /^0x0{40}$/i.test(address);
  const onL1 = chainId === undefined || chainId === l1;
  const onEra = l1 !== undefined && chainId === ERA_CHAIN[l1];
  const href = zero
    ? null
    : onL1
      ? explorer.address(address)
      : onEra
        ? explorer.l2Address(address)
        : null;
  const label = zero
    ? "zero address"
    : (onL1 ? labels[address.toLowerCase()] : undefined) ?? addressLabel(address, chainId ?? l1);
  return (
    <>
      <span className={cn("mono break-all", zero ? "text-slate-500" : "text-code-addr")}>
        {address}
      </span>
      {label && (
        <span className="whitespace-nowrap rounded border border-slate-300 bg-white px-1.5 font-sans font-semibold text-[12.5px] text-slate-800">
          {label}
        </span>
      )}
      {!zero && (
        <span className="inline-flex items-center gap-0.5 self-center">
          <MiniCopy value={address} label="Copy address" />
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in the explorer"
              title="Open in the explorer"
              className="grid h-6 w-6 place-items-center rounded-md text-slate-600 opacity-80 hover:bg-slate-100 hover:text-brand-700 hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </span>
      )}
    </>
  );
}

// A value's copy button: faint until the row is hovered or the button focused, so values stay
// readable and the button still shows where it is (also on touch screens).
function MiniCopy({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton
      value={value}
      label={label}
      className="h-6 w-6 self-center text-slate-600 opacity-80 focus-visible:opacity-100 group-hover/row:opacity-100 sm:h-6 sm:w-6"
    />
  );
}

/** Calldata no known ABI matches: its selector and 32-byte words, with their offsets. */
function RawWords({ data, selector }: { data: string; selector: string }) {
  const known = functionsWithSelector(selector);
  return (
    <div className="space-y-1.5 px-4 py-1">
      {known.length > 0 ? (
        <NotExact signatures={known} />
      ) : (
        <p className="text-[13px] text-slate-700">
          No known ABI has selector <span className="mono">{selector}</span>. Its 32-byte words:
        </p>
      )}
      <Words data={data} />
    </div>
  );
}

/**
 * Bytes that start with a known function's selector yet do not decode to it exactly (extra or
 * malformed data): shown raw, and said, since a call that looks like it is not one.
 */
function NotExact({ signatures, inline = false }: { signatures: string[]; inline?: boolean }) {
  const text = (
    <>
      Starts with the selector of <span className="mono">{signatures.join(" or ")}</span>, but does
      not decode to it exactly: extra or malformed bytes. Shown raw.
    </>
  );
  return inline ? (
    <span className="basis-full font-medium font-sans text-[12px] text-amber-900" role="note">
      <AlertTriangle aria-hidden className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
      {text}
    </span>
  ) : (
    <p
      className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 font-medium text-[13px] text-amber-950"
      role="note"
      data-testid="not-exact"
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
