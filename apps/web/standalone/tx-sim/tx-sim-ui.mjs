import {
  CHAINS,
  ADDRESSES,
  LIMITS,
  STORAGE,
  GOVERNOR_STATES,
  UPGRADE_STATES,
  UPGRADE_TUPLE,
} from "./tx-sim-config.mjs";
import {
  same,
  hex,
  requireThat,
  parseTransactions,
  walletTransaction,
  sha256,
  identifyRows,
  inspectReceipt,
  dependencyPlan,
  verifyDependencies,
  preflight,
  sendOne,
  authorizedWallet,
  walletRequirement,
} from "./tx-sim-core.mjs";
import {
  contracts,
  governorAction,
  governorCallStatus,
  governorActionReason,
  governorTime,
  makeVote,
  voteRows,
  voteStatus,
  allowedVoteAction,
  actionRow,
  buildStart,
} from "./tx-sim-contracts.mjs";
import { canRepropose, proposalFromCall, upgradeSources, votingRetry } from "./tx-sim-source.mjs";

const $ = (_id) => document.getElementById(_id);
const bootstrap = window.__TX_SIM_BOOTSTRAP__;
const walletConnectBridge = window.__TX_SIM_WALLET__;
const desktopAvailable = ["http:", "https:"].includes(window.location.protocol);
let walletBridge = desktopAvailable ? null : walletConnectBridge;
let walletLabel = walletBridge ? "wallet" : "MetaMask";
let retryInfo = bootstrap?.prepared ?? readStored(STORAGE.vote, null)?.retryInfo ?? null;
function el(_tag, _props = {}, ..._children) {
  const node = document.createElement(_tag);
  for (const [key, value] of Object.entries(_props)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else node[key] = value;
  }
  for (const child of _children.flat())
    if (child !== undefined && child !== null && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function notice(_text, _error = false) {
  $("notice").textContent = _text;
  $("notice").className = _error ? "error" : "";
  $("notice").hidden = !_text;
}
let busy = false;
let provider = null;
let account = "";
let walletChain = null;
let snapshot;
let c;
let bundles = [];
let selectedBundle = 0;
let selectedRow = 0;
let activeView = "bundle";
let journal = readStored(STORAGE.journal, {});
let rpcs = readStored(STORAGE.rpc, {});
let vote = null;
let normalRows = [];
let status = null;
let start = null;
let normalSelected = null;
const normalSaved = readStored(STORAGE.vote, null);
const gates = new Set();
const independentCalls = new Set();
const importedGovernors = new Map();
const discovered = new Map();
let initialized = false;
let restoring = null;
function readStored(_key, _fallback) {
  try {
    return JSON.parse(localStorage.getItem(_key)) ?? _fallback;
  } catch {
    return _fallback;
  }
}
function save(_id, _entry) {
  // Read again to retain receipts saved by another tab. Wallet requests also use a browser-wide lock.
  journal = readStored(STORAGE.journal, {});
  const { receipt, ...entry } = _entry;
  journal[_id] = entry;
  localStorage.setItem(STORAGE.journal, JSON.stringify(journal));
  render();
}
function current(_id) {
  journal = readStored(STORAGE.journal, {});
  return journal[_id];
}
async function run(_fn) {
  if (busy) return;
  busy = true;
  render();
  try {
    await _fn();
  } catch (_error) {
    notice(
      _error.code === 4001
        ? "Request rejected in your wallet. You can retry when ready."
        : _error.message,
      true
    );
  } finally {
    busy = false;
    render();
  }
}
async function rpc(_network, _method, _params = []) {
  const url = rpcs[_network] || CHAINS[_network].rpc;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: _method,
        params: _params,
      }),
      signal: AbortSignal.timeout(LIMITS.rpcTimeoutMs),
    });
    requireThat(response.ok, `${CHAINS[_network].name} RPC returned HTTP ${response.status}.`);
    const result = await response.json();
    requireThat(!result.error, `${CHAINS[_network].name}: ${result.error?.message}`);
    requireThat(Object.hasOwn(result, "result"), "RPC response has no result.");
    return result.result;
  } catch (_error) {
    throw new Error(
      `${CHAINS[_network].name} ${_method}: ${_error.name === "TimeoutError" ? "RPC did not respond within 30 seconds. Retry the read or change the configured RPC." : _error.message}`
    );
  }
}
async function checkChains() {
  await Promise.all(
    Object.entries(CHAINS).map(async ([_network, _chain]) =>
      requireThat(
        BigInt(await rpc(_network, "eth_chainId")) === BigInt(_chain.id),
        `${_chain.name} RPC is connected to the wrong chain.`
      )
    )
  );
}
function findMetaMask() {
  if (discovered.has("io.metamask")) return discovered.get("io.metamask");
  const candidates = window.ethereum?.providers ?? [window.ethereum];
  return candidates.find(
    (_p) => _p?.isMetaMask && !_p.isBraveWallet && !_p.isRabby && !_p.isCoinbaseWallet
  );
}
window.addEventListener("eip6963:announceProvider", (_event) => {
  const detail = _event.detail;
  if (detail?.info?.rdns && detail?.provider?.request)
    discovered.set(detail.info.rdns, detail.provider);
  if (initialized && !provider) restoreWallet().catch((_error) => notice(_error.message, true));
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
async function refreshWallet() {
  if (!provider) return;
  const state = await authorizedWallet(provider);
  account = state.account;
  walletChain = state.chainId;
  render();
}
function bindProvider(_found) {
  if (provider === _found) return;
  if (provider?.removeListener)
    for (const event of ["accountsChanged", "chainChanged", "disconnect"])
      provider.removeListener(event, onWalletChange);
  provider = _found;
  for (const event of ["accountsChanged", "chainChanged", "disconnect"])
    provider?.on?.(event, onWalletChange);
}
async function restoreWallet() {
  if (provider || restoring) return restoring;
  if (walletBridge) {
    const found = await walletBridge.restore();
    if (found) {
      bindProvider(found);
      await refreshWallet();
    }
    return;
  }
  const found = findMetaMask();
  if (!found) return;
  restoring = (async () => {
    const state = await authorizedWallet(found);
    if (!provider && state.account) {
      bindProvider(found);
      await refreshWallet();
    }
  })();
  try {
    await restoring;
  } finally {
    restoring = null;
  }
}
async function connect() {
  if (walletBridge) {
    const row = normalSelected ?? bundles[selectedBundle]?.rows[selectedRow];
    bindProvider(await walletBridge.connect(row?.chainId ?? CHAINS["zksync-testnet3"].id));
    await refreshWallet();
    notice("Wallet connected. The transaction panel checks its exact required sender and network.");
    return;
  }
  const found = findMetaMask();
  requireThat(
    found,
    "MetaMask extension was not detected. Open this URL in your desktop browser with MetaMask enabled."
  );
  bindProvider(found);
  await provider.request({ method: "eth_requestAccounts" });
  await refreshWallet();
  notice(
    same(account, ADDRESSES.control)
      ? "MetaMask connected. Choose a call and send it when ready."
      : `Connected account differs from the required owner. Select ${ADDRESSES.control} in MetaMask.`,
    !same(account, ADDRESSES.control)
  );
}
async function chooseAccount() {
  if (walletBridge) {
    await walletBridge.disconnect();
    bindProvider(null);
    account = "";
    walletChain = null;
    await connect();
    return;
  }
  requireThat(provider, "Connect your wallet first.");
  await provider.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {} }],
  });
  await refreshWallet();
  notice(
    same(account, ADDRESSES.control)
      ? "Required owner connected. Switch to the transaction network if needed."
      : `The site still sees ${account || "no account"}. Connect ${ADDRESSES.control} to this site in MetaMask.`,
    !same(account, ADDRESSES.control)
  );
}
function onWalletChange() {
  refreshWallet().catch((_error) => notice(_error.message, true));
}
async function refreshImportedGovernor(_row) {
  if (importedGovernors.get(_row.id)?.loading) return;
  importedGovernors.set(_row.id, { ...importedGovernors.get(_row.id), loading: true });
  try {
    const state = await governorCallStatus(_row, rpc, c);
    importedGovernors.set(_row.id, { state, checkedAt: Date.now(), loading: false });
    return state;
  } catch (_error) {
    importedGovernors.set(_row.id, {
      error: _error.message,
      checkedAt: Date.now(),
      loading: false,
    });
    return null;
  } finally {
    render();
  }
}
function importedGovernorContext(_row) {
  let action;
  try {
    action = governorAction(_row, c);
  } catch (_error) {
    return { blocked: _error.message };
  }
  if (!action) return null;
  let entry = importedGovernors.get(_row.id);
  if (!entry) {
    importedGovernors.set(_row.id, { scheduled: true });
    Promise.resolve().then(() => refreshImportedGovernor(_row));
    entry = { loading: true };
  }
  const panel = el("section", { class: "step" }, el("h3", {}, "Live governor state"));
  panel.append(el("p", { class: "mono" }, `Proposal: ${action.proposalId}`));
  panel.append(
    el(
      "button",
      { disabled: busy || entry.loading, onclick: () => run(() => refreshImportedGovernor(_row)) },
      "Refresh governance state"
    )
  );
  if (entry.error) return { panel, blocked: `Could not verify governor state: ${entry.error}` };
  if (entry.loading || !entry.state) return { panel, blocked: "Reading live governor state…" };
  const state = entry.state;
  panel.append(
    el(
      "p",
      {},
      `State: ${state.state === null ? "Not proposed" : GOVERNOR_STATES[state.state]} · Governor clock: ${governorTime(state.clock, state.mode)}`
    )
  );
  if (state.state !== null)
    panel.append(
      el("p", {}, `Voting opens after ${governorTime(state.snapshot, state.mode)}.`),
      el(
        "p",
        {},
        `Voting deadline: ${governorTime(state.deadline, state.mode)}. Late quorum may extend this deadline.`
      )
    );
  if (canRepropose(state.state))
    panel.append(
      el(
        "button",
        {
          class: "primary",
          disabled: busy,
          onclick: () => run(() => prepareImportedRetry(_row)),
        },
        "Prepare voting retry"
      )
    );
  return { panel, blocked: governorActionReason(state) };
}
async function prepareImportedRetry(_row) {
  const family = upgradeSources(bundles, vote, c);
  const currentRow =
    vote &&
    (family.some((_source) => _source.bundle.rows.some((_item) => _item.id === _row.id)) ||
      BigInt(governorAction(_row, c).proposalId) === BigInt(vote.proposalId))
      ? normalRows.find((_item) => _item.tag === "propose")
      : _row;
  const state = await governorCallStatus(currentRow, rpc, c);
  requireThat(
    canRepropose(state.state),
    "This proposal has not ended unsuccessfully. Refresh its current state."
  );
  let original;
  if (vote && family.length && BigInt(state.proposalId) === BigInt(vote.proposalId)) {
    original = {
      ...vote,
      source: retryInfo?.source ?? family[0].bundle.path,
      from: currentRow.from,
      rows: normalRows,
      originalDescription: retryInfo?.originalDescription,
      history:
        retryInfo?.history ??
        (retryInfo?.retryOf
          ? [
              {
                proposalId: retryInfo.retryOf,
                description: retryInfo.originalDescription,
                source: retryInfo.source,
                rows: family[0].bundle.rows,
              },
            ]
          : []),
    };
  }
  for (const bundle of bundles) {
    for (const row of bundle.rows) {
      const candidate = proposalFromCall(row, c);
      if (candidate && BigInt(candidate.proposalId) === BigInt(state.proposalId))
        original ??= { ...candidate, from: row.from, source: bundle.path, rows: bundle.rows };
    }
  }
  requireThat(
    original,
    "The source propose call is missing. Refresh the PR's transaction files before preparing a retry."
  );
  requireThat(
    same(original.from, ADDRESSES.control),
    "This workflow must use the source's required voting account."
  );
  retryInfo = votingRetry(
    original,
    `${original.description}\n\nVoting retry: ${new Date().toISOString()}`,
    c
  );
  $("payload").value = JSON.stringify(retryInfo.payload, null, 2);
  $("description").value = retryInfo.description;
  $("execution-hash").value = "";
  setView("normal");
  await prepareVote();
  normalSelected = normalRows.find((_candidate) => _candidate.tag === "propose");
  render();
  notice(
    "Retry prepared from the tx-sim proposal. Only the L2 description changed; the L1 upgrade is identical. Review the new proposal and send it when ready."
  );
}
async function guardImportedGovernor(_row) {
  if (!governorAction(_row, c)) return;
  notice("Checking current governor state and voting/timelock requirements…");
  const state = await refreshImportedGovernor(_row);
  requireThat(state, importedGovernors.get(_row.id)?.error || "Could not verify governor state.");
  requireThat(!governorActionReason(state), governorActionReason(state));
}
async function switchChain(_row) {
  requireThat(provider, "Connect your wallet first.");
  const chain = CHAINS[_row.network];
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex(chain.id) }],
    });
  } catch (_error) {
    if (_error.code !== 4902) throw _error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex(chain.id),
          chainName: chain.name,
          rpcUrls: [rpcs[_row.network] || chain.rpc],
          blockExplorerUrls: [chain.explorer],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex(chain.id) }],
    });
  }
  await refreshWallet();
  requireThat(walletChain === _row.chainId, "The wallet has not switched to the required network.");
}
function link(_text, _url) {
  return el("a", { href: _url, target: "_blank", rel: "noopener" }, _text);
}
function badge(_row) {
  const entry = journal[_row.id];
  return el("span", { class: `badge ${entry?.status ?? ""}` }, entry?.status ?? "Ready");
}
function setView(_view) {
  activeView = _view;
  $("normal-view").hidden = _view !== "normal";
  $("bundle-view").hidden = _view !== "bundle";
  render();
}

async function useSnapshot(_snapshot) {
  requireThat(
    /^[0-9a-f]{40}$/.test(_snapshot.commit) && Array.isArray(_snapshot.stages),
    "Invalid PR snapshot."
  );
  const next = [];
  for (const source of _snapshot.stages) {
    requireThat(
      (await sha256(source.raw)) === source.sha256,
      `Source hash differs for ${source.path}.`
    );
    const parsed = parseTransactions(source.raw);
    const rows = await identifyRows(parsed.rows, `${_snapshot.repo}:${source.path}`);
    // The user chose normal L2 voting. Old v33 Board calls must not masquerade as that route.
    const superseded = rows.some(
      (_row) => _row.tag === "v33_ecosystem_execute" && same(_row.to, ADDRESSES.board)
    );
    next.push({ ...source, ...parsed, rows, superseded });
  }
  snapshot = _snapshot;
  bundles = next;
  selectedBundle = 0;
  selectedRow = 0;
  gates.clear();
  independentCalls.clear();
  importedGovernors.clear();
  renderCandidates();
  render();
  if (next.some((_bundle) => _bundle.superseded))
    notice(
      "This PR revision still includes the old Board-based v33 bundle. That bundle is disabled here. Refresh from GitHub after the normal L2 → L1 update lands. Handover and administration files remain available."
    );
}
async function refreshSource() {
  requireThat(
    !bootstrap,
    "This file contains the PR revision shown above. Regenerate the HTML to fetch the latest private tx-sim revision through your gh login."
  );
  notice("Reading the current PR #386 files from GitHub…");
  const response = await fetch("./api/pr386", {
    headers: { "X-TxSim-Request": "1" },
    signal: AbortSignal.timeout(120000),
    cache: "no-store",
  });
  requireThat(
    response.ok,
    "GitHub refresh is unavailable on this server. Run server.py, or upload the corrected JSON files."
  );
  const data = await response.json();
  requireThat(!data.error, data.error);
  if (data) await useSnapshot(data);
  else {
    $("source-title").textContent = "Load reviewed transaction files";
    $("source-info").textContent =
      "Refresh from GitHub using your local gh login, or open a JSON file.";
    render();
  }
  notice(
    `Loaded all PR #386 transaction files at ${data.commit.slice(0, 12)}. Saved receipts are retained for unchanged calls.${bundles.some((_bundle) => _bundle.superseded) ? " The old Board-based v33 file is superseded for the requested L2 voting route." : ""}`
  );
}
function decodeProposal(_targets, _values, _calldatas, _description) {
  requireThat(
    _targets.length === 1 &&
      same(_targets[0], ADDRESSES.messenger) &&
      BigInt(_values[0].toString()) === 0n,
    "Normal proposal must contain the reviewed L1 messenger call."
  );
  const decoded = c.interfaces.IL1Messenger.decodeFunctionData("sendToL1", _calldatas[0]);
  const [payload] = c.utils.defaultAbiCoder.decode([UPGRADE_TUPLE], decoded[0]);
  const plain = {
    calls: payload.calls.map((_call) => ({
      target: _call.target,
      value: _call.value.toString(),
      data: _call.data,
    })),
    executor: payload.executor,
    salt: payload.salt,
  };
  return { payload: plain, description: _description };
}
function voteCandidates() {
  const result = [];
  const seen = new Set();
  function add(_candidate, _label) {
    if (same(_candidate.payload.executor, ADDRESSES.board)) return;
    const built = makeVote(_candidate.payload, _candidate.description, c);
    if (seen.has(built.proposalId)) return;
    seen.add(built.proposalId);
    result.push({ ..._candidate, label: _label });
  }
  for (const bundle of bundles)
    for (const row of bundle.rows) {
      if (
        row.chainId !== CHAINS["zksync-testnet3"].id ||
        !same(row.to, ADDRESSES.governor) ||
        !row.data.startsWith(c.interfaces.Testnet3Governor.getSighash("propose"))
      )
        continue;
      const decoded = c.interfaces.Testnet3Governor.decodeFunctionData("propose", row.data);
      add(decodeProposal(decoded[0], decoded[1], decoded[2], decoded[3]), bundle.title);
    }
  function walk(_value, _path) {
    if (!_value || typeof _value !== "object") return;
    if (!/rehearsal|history|reviewLiveAudit/i.test(_path)) {
      if (
        Array.isArray(_value.targets) &&
        Array.isArray(_value.calldatas) &&
        Array.isArray(_value.values) &&
        typeof _value.description === "string"
      )
        add(
          decodeProposal(_value.targets, _value.values, _value.calldatas, _value.description),
          _path
        );
      const payload = _value.payload ?? _value.proposal ?? _value.upgradeProposal;
      if (
        payload?.calls &&
        payload.executor &&
        payload.salt &&
        typeof _value.description === "string"
      )
        add({ payload, description: _value.description }, _path);
    }
    for (const [key, value] of Object.entries(_value))
      if (value && typeof value === "object") walk(value, `${_path}.${key}`);
  }
  for (const file of snapshot?.proposalSources ?? []) walk(JSON.parse(file.raw), file.path);
  return result;
}
function renderCandidates() {
  const panel = $("vote-candidates");
  panel.replaceChildren();
  let candidates;
  try {
    candidates = voteCandidates();
  } catch (_error) {
    panel.append(
      el("p", { class: "warning" }, `Prepared proposal could not be verified: ${_error.message}`)
    );
    return;
  }
  if (!candidates.length) {
    panel.append(
      el(
        "p",
        { class: "warning" },
        "No prepared normal-governance payload was found in this revision. Refresh after the PR update, or open its exact proposal JSON below."
      )
    );
    return;
  }
  for (const _candidate of candidates) {
    panel.append(
      el(
        "button",
        {
          class: "bundle-button",
          onclick: () => {
            if (
              vote &&
              same(
                vote.upgradeId,
                makeVote(_candidate.payload, _candidate.description, c).upgradeId
              )
            ) {
              setView("normal");
              notice(
                "Showing the latest voting attempt for this upgrade. Earlier attempts are available in history."
              );
              return;
            }
            $("payload").value = JSON.stringify(_candidate.payload, null, 2);
            $("description").value = _candidate.description;
            render();
          },
        },
        `Load ${_candidate.label}`
      )
    );
  }
}
async function prepareVote() {
  const input = JSON.parse($("payload").value);
  const previousId = vote?.proposalId;
  const next = makeVote(
    input.payload ?? input.proposal ?? input.upgradeProposal ?? input,
    $("description").value,
    c
  );
  if (vote && same(next.upgradeId, vote.upgradeId) && !same(next.proposalId, vote.proposalId)) {
    requireThat(
      !votingAttempts().some((_attempt) => BigInt(_attempt.proposalId) === BigInt(next.proposalId)),
      "Earlier voting attempts are read only. Use the latest attempt for this upgrade."
    );
    const latest = await voteStatus(vote, rpc, c);
    requireThat(
      canRepropose(latest.state),
      "The latest voting attempt has not ended unsuccessfully. Continue with that attempt instead of creating another proposal."
    );
  }
  vote = next;
  normalRows = await identifyRows(voteRows(vote, c), `normal:${vote.proposalId}`);
  if (previousId && previousId !== vote.proposalId) $("execution-hash").value = "";
  start = null;
  normalSelected = null;
  status = null;
  localStorage.setItem(
    STORAGE.vote,
    JSON.stringify({
      input: vote.payload,
      description: vote.description,
      executionHash: $("execution-hash").value,
      retryInfo: retryInfo && same(retryInfo.proposalId, vote.proposalId) ? retryInfo : null,
    })
  );
  notice("Prepared the exact L2 governor calls. Reading the live proposal state…");
  setView("normal");
  await refreshVote();
  notice("Proposal prepared. Live governance state is shown alongside the exact transactions.");
}
function draftMatches() {
  if (!vote) return false;
  try {
    const input = JSON.parse($("payload").value);
    return (
      makeVote(
        input.payload ?? input.proposal ?? input.upgradeProposal ?? input,
        $("description").value,
        c
      ).proposalId === vote.proposalId
    );
  } catch {
    return false;
  }
}
async function refreshVote() {
  requireThat(vote, "Prepare a proposal first.");
  await checkChains();
  status = await voteStatus(vote, rpc, c);
  status.l1State = Number(
    (
      await c.read(rpc, "sepolia", "ProtocolUpgradeHandlerV31", ADDRESSES.puh, "upgradeState", [
        vote.upgradeId,
      ])
    )[0]
  );
  const executed = current(normalRows.find((_row) => _row.tag === "execute").id);
  if (executed?.hash && !$("execution-hash").value) $("execution-hash").value = executed.hash;
  render();
}
async function prepareProof() {
  requireThat(vote, "Prepare the exact proposal first.");
  requireThat(draftMatches(), "The proposal draft changed. Prepare the workflow again.");
  await checkChains();
  const hash = $("execution-hash").value.trim();
  start = await buildStart(
    vote,
    normalRows.find((_row) => _row.tag === "execute"),
    hash,
    rpc,
    c
  );
  [start.row] = await identifyRows([start.row], `start:${vote.upgradeId}`);
  normalSelected = start.row;
  const stored = readStored(STORAGE.vote, {});
  stored.executionHash = hash;
  localStorage.setItem(STORAGE.vote, JSON.stringify(stored));
  $("proof-status").replaceChildren(
    el(
      "p",
      {},
      `L1 verified batch ${start.batch}, proof index ${start.proofId}. Ready to simulate startUpgrade.`
    )
  );
  notice("L2 → L1 proof verified on L1. Review the generated startUpgrade transaction below.");
  render();
}
async function normalGuard(_row) {
  requireThat(
    draftMatches(),
    "The proposal draft changed. Prepare the workflow again before sending."
  );
  await checkChains();
  if (_row.tag === "startUpgrade") {
    requireThat(
      start &&
        same(
          _row.data,
          (
            await buildStart(
              vote,
              normalRows.find((_r) => _r.tag === "execute"),
              start.executionHash,
              rpc,
              c
            )
          ).row.data
        ),
      "The current proof differs; refresh it before sending."
    );
    return;
  }
  if (_row.tag === "executeL1") {
    const state = await c.read(
      rpc,
      "sepolia",
      "ProtocolUpgradeHandlerV31",
      ADDRESSES.puh,
      "upgradeState",
      [vote.upgradeId]
    );
    requireThat(Number(state[0]) === 4, "The L1 upgrade is not Ready to execute yet.");
    return;
  }
  status = await voteStatus(vote, rpc, c);
  requireThat(
    allowedVoteAction(status, _row.tag),
    `${_row.tag} is not available in the current governor state. Refresh and wait for the required voting/timelock period.`
  );
}
function simulationProvider(_row) {
  return {
    request: ({ method: _method, params: _params = [] }) => rpc(_row.network, _method, _params),
  };
}
async function send(_row, _guard) {
  requireThat(
    navigator.locks,
    "This browser does not support the execution lock. Use an up-to-date desktop browser."
  );
  await navigator.locks.request(STORAGE.lock, { ifAvailable: true }, async (_lock) => {
    requireThat(_lock, "Another tab is already opening a wallet request. Finish it first.");
    notice(`Checking the sender, chain, contract execution and gas for ${_row.description}…`);
    const hash = await sendOne({
      provider,
      row: _row,
      beforeSend: _guard,
      save,
      current,
      readProvider: simulationProvider(_row),
      progress: notice,
    });
    notice(`Submitted ${hash}. You can submit another independent call while this one is pending.`);
    await checkRow(_row);
  });
}
async function checkRow(_row) {
  const entry = current(_row.id);
  requireThat(entry?.hash, "Attach or submit a transaction hash first.");
  const checked = await inspectReceipt(_row, entry.hash, rpc, c.match);
  save(_row.id, checked);
  notice(checked.detail, checked.status === "reverted");
  if (activeView === "normal" && checked.status === "confirmed" && vote) await refreshVote();
}
function fields(_row) {
  const dl = el("dl");
  for (const [key, value] of [
    ["Network", `${CHAINS[_row.network].name} · ${_row.chainId}`],
    ["From", _row.from],
    ["To", _row.to],
    ["Value", `${_row.value} ETH (${_row.valueWei} wei)`],
    ["Selector", _row.data.slice(0, 10)],
    ["Calldata", `${(_row.data.length - 2) / 2} bytes`],
  ])
    dl.append(el("dt", {}, key), el("dd", { class: "mono" }, value));
  for (const key of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"])
    if (_row[key] !== undefined)
      dl.append(el("dt", {}, key), el("dd", { class: "mono" }, `${_row[key]} wei`));
  return dl;
}
function renderTransaction(_panel, _row, _guard, _blocked = "") {
  _panel.replaceChildren(
    el("h2", {}, _row.description || `Call ${_row.sourceIndex + 1}`),
    badge(_row),
    fields(_row)
  );
  const entry = journal[_row.id];
  const requirement = walletRequirement(_row, {
    provider,
    account,
    chainId: walletChain,
  });
  const walletOk = requirement === null;
  const walletReason =
    requirement === "connect"
      ? `This page is not connected to a wallet. Connect your ${walletLabel} to continue.`
      : requirement === "account"
        ? `This page sees ${account}. Connect the required sender ${_row.from}. A Safe sends from its own address; it cannot substitute for the voting EOA.`
        : requirement === "network"
          ? `Your wallet is on chain ${walletChain}. Switch to ${CHAINS[_row.network].name} (${_row.chainId}) to continue.`
          : "";
  if (_blocked) _panel.append(el("p", { class: "warning" }, _blocked));
  if (walletReason) _panel.append(el("p", { class: "warning" }, walletReason));
  const actions = el("div", { class: "actions" });
  if (requirement === "connect")
    actions.append(
      el(
        "button",
        { class: "primary", disabled: busy, onclick: () => run(connect) },
        walletBridge ? "Connect via WalletConnect" : "Connect MetaMask to continue"
      )
    );
  if (requirement === "account")
    actions.append(
      el(
        "button",
        { class: "primary", disabled: busy, onclick: () => run(chooseAccount) },
        walletBridge ? "Reconnect the required account" : "Choose account in MetaMask"
      )
    );
  if (provider && walletChain !== _row.chainId)
    actions.append(
      el(
        "button",
        { disabled: busy, onclick: () => run(() => switchChain(_row)) },
        `Switch to ${CHAINS[_row.network].name}`
      )
    );
  actions.append(
    el(
      "button",
      {
        disabled: busy || !walletOk || !!_blocked,
        title: busy ? "A request is in progress." : _blocked || walletReason,
        onclick: () =>
          run(async () => {
            await _guard();
            const checked = await preflight(provider, _row, simulationProvider(_row));
            notice(
              `Simulation succeeded. Direct-call estimate with margin: ${checked.gas}. Your wallet estimates the full transaction, including any smart-account wrapper. Rechecked when you send.`
            );
          }),
      },
      "Simulate"
    )
  );
  const canSend = !entry || ["rejected", "reverted", "ready"].includes(entry.status);
  actions.append(
    el(
      "button",
      {
        class: "primary",
        disabled: busy || !walletOk || !!_blocked || !canSend,
        title: busy
          ? "A request is in progress."
          : _blocked ||
            walletReason ||
            (!canSend ? "Check the existing transaction receipt before continuing." : ""),
        onclick: () => run(() => send(_row, _guard)),
      },
      entry?.status === "reverted" ? `Retry in ${walletLabel}` : `Send to ${walletLabel}`
    )
  );
  _panel.append(
    actions,
    el(
      "p",
      { class: "muted" },
      "Your wallet receives the exact recipient, value and calldata, and estimates gas for its full transaction. Review the gas and fees before confirming."
    )
  );
  if (entry) {
    _panel.append(el("p", {}, entry.detail || entry.status));
    if (entry.hash)
      _panel.append(
        link(
          `${entry.hash.slice(0, 14)}… · View transaction ↗`,
          `${CHAINS[_row.network].explorer}/tx/${entry.hash}`
        ),
        el("button", { disabled: busy, onclick: () => run(() => checkRow(_row)) }, "Check receipt")
      );
  }
  const attach = el(
    "details",
    {},
    el("summary", {}, "Already sent? Attach or replace the transaction hash")
  );
  const input = el("input", {
    placeholder: "0x…",
    ariaLabel: "Existing transaction hash",
    class: "mono",
  });
  attach.append(
    input,
    el(
      "button",
      {
        disabled: busy,
        onclick: () =>
          run(async () => {
            const hash = input.value.trim();
            const checked = await inspectReceipt(_row, hash, rpc, c.match);
            // A hash unknown to the RPC is not evidence of a submitted transaction.
            const tx = await rpc(_row.network, "eth_getTransactionByHash", [hash]);
            requireThat(tx, "Transaction was not found. Recheck the hash and RPC.");
            save(_row.id, checked);
            notice(checked.detail);
            if (vote && activeView === "normal") await refreshVote();
          }),
      },
      "Verify & attach hash"
    )
  );
  _panel.append(attach);
  const raw = el("details", {}, el("summary", {}, "Exact wallet request & calldata"));
  raw.append(
    el("pre", {}, JSON.stringify(walletTransaction(_row), null, 2)),
    el(
      "button",
      {
        disabled: busy,
        onclick: () =>
          run(async () => {
            await navigator.clipboard.writeText(_row.data);
            notice("Calldata copied.");
          }),
      },
      "Copy calldata"
    )
  );
  _panel.append(raw);
  if (_row.skipPriorityOps || _row.emulateAllBatchesExecuted || _row.valueToMint)
    _panel.append(
      el(
        "p",
        { class: "warning" },
        "This source includes simulation-only flags. No balances, batches, or storage are changed by the sender. Any L2 priority operations still need their real completion checks."
      )
    );
}
function votingAttempts() {
  if (!vote) return [];
  const attempts = new Map();
  const add = (_attempt) => {
    const id = BigInt(_attempt.proposalId).toString();
    const previous = attempts.get(id);
    attempts.set(id, {
      ...previous,
      ..._attempt,
      proposalId: id,
      rows: [
        ...new Map(
          [...(previous?.rows ?? []), ...(_attempt.rows ?? [])].map((_row) => [_row.id, _row])
        ).values(),
      ],
    });
  };
  for (const source of upgradeSources(bundles, vote, c))
    add({ ...source.proposal, source: source.bundle.path, rows: source.bundle.rows });
  for (const attempt of retryInfo?.history ?? []) add(attempt);
  if (retryInfo?.retryOf && !attempts.has(BigInt(retryInfo.retryOf).toString()))
    add({ proposalId: retryInfo.retryOf, description: retryInfo.originalDescription, rows: [] });
  add({ ...vote, rows: normalRows, current: true });
  return [...attempts.values()];
}
function nextWorkflowRow() {
  const state = status?.state === null ? "Not proposed" : GOVERNOR_STATES[status?.state];
  const method =
    state === "Not proposed" || canRepropose(status?.state)
      ? "propose"
      : state === "Pending" || (state === "Active" && !status.hasVoted)
        ? "castVote"
        : state === "Active" || state === "Succeeded"
          ? "queue"
          : "execute";
  return normalRows.find((_row) => _row.tag === method);
}
function renderAttemptHistory() {
  const attempts = votingAttempts();
  $("voting-history").hidden = !vote;
  const panel = $("attempt-history");
  panel.replaceChildren(
    el(
      "p",
      { class: "muted" },
      "The latest attempt is used for voting and execution. Earlier attempts and receipts are read only."
    )
  );
  attempts.forEach((_attempt, _index) => {
    const item = el(
      "section",
      { class: "step" },
      el("strong", {}, `Attempt ${_index + 1} · ${_attempt.current ? "current" : "earlier"}`),
      el("p", { class: "mono" }, `L2 proposal: ${_attempt.proposalId}`),
      el("p", {}, _attempt.description)
    );
    for (const row of _attempt.rows) {
      const entry = journal[row.id];
      if (entry?.hash)
        item.append(
          el(
            "p",
            {},
            link(`${row.tag} · ${entry.hash}`, `${CHAINS[row.network].explorer}/tx/${entry.hash}`)
          )
        );
    }
    panel.append(item);
  });
}
function renderNormal() {
  const panel = $("vote-status");
  const actions = $("vote-actions");
  const workflowActions = $("workflow-actions");
  actions.replaceChildren();
  workflowActions.replaceChildren();
  $("normal-transaction").hidden = !normalSelected;
  $("proof-panel").hidden = !vote;
  if (!vote) {
    panel.replaceChildren(el("p", {}, "Choose the reviewed payload to begin."));
    $("normal-transaction").hidden = true;
    return;
  }
  const identifiers = el(
    "details",
    { class: "proposal-identifiers" },
    el("summary", {}, "Proposal IDs and reviewed source"),
    el("p", { class: "mono" }, `L2 proposal: ${BigInt(vote.proposalId)}`),
    el("p", { class: "mono" }, `L1 upgrade: ${vote.upgradeId}`)
  );
  panel.replaceChildren(identifiers);
  renderAttemptHistory();
  if (retryInfo && same(vote.proposalId, retryInfo.proposalId))
    identifiers.append(
      el(
        "p",
        { class: "warning" },
        `Voting retry of L2 proposal ${BigInt(retryInfo.retryOf)}. Only the L2 description changed; the L1 message, calls, executor, salt and upgrade ID are identical to ${retryInfo.source}.`
      )
    );
  panel.append(
    el("button", { disabled: busy, onclick: () => run(refreshVote) }, "Refresh governance state")
  );
  if (!status) {
    panel.append(el("p", {}, "Reading live state…"));
    return;
  }
  panel.append(
    el(
      "div",
      { class: "state-title" },
      status.state === null ? "Not proposed" : GOVERNOR_STATES[status.state]
    ),
    el(
      "p",
      {},
      `Delegated votes: ${c.utils.formatEther(status.votes)} ZK · Proposal threshold: ${c.utils.formatEther(status.threshold)} ZK`
    )
  );
  const time = (_value) =>
    status.mode.includes("mode=timestamp")
      ? `${new Date(Number(_value) * 1000).toLocaleString()} (chain clock ${_value})`
      : `chain clock ${_value}`;
  if (status.state === 0)
    panel.append(
      el(
        "p",
        {},
        `Voting opens after ${time(status.snapshot)}. Initial deadline: ${time(status.deadline)}. This page refreshes automatically and enables voting only when the governor reports Active.`
      )
    );
  if (status.state === 1)
    panel.append(
      el(
        "p",
        {},
        `${status.hasVoted ? "Your vote is recorded. " : ""}Voting ends after ${time(status.deadline)}. Late quorum may extend this deadline.`
      )
    );
  if (status.state === 5)
    panel.append(el("p", {}, `Timelock execution available at ${time(status.eta)}.`));
  if (status.state === 7)
    panel.append(
      el(
        "p",
        {},
        "L2 execution is complete. Check batch finality and build the inclusion proof below."
      )
    );
  if (canRepropose(status.state))
    workflowActions.append(
      el(
        "button",
        {
          class: "primary",
          disabled: busy,
          onclick: () =>
            run(() => prepareImportedRetry(normalRows.find((_row) => _row.tag === "propose"))),
        },
        "Prepare voting retry"
      )
    );
  for (const [index, row] of normalRows.entries()) {
    const entry = journal[row.id];
    const completed =
      entry?.status === "confirmed" ||
      (row.tag === "propose" && status.state !== null) ||
      (row.tag === "castVote" && status.hasVoted) ||
      (row.tag === "queue" && [5, 7].includes(status.state)) ||
      (row.tag === "execute" && status.state === 7);
    const pending = ["pending", "awaiting", "uncertain"].includes(entry?.status);
    const allowed = draftMatches() && allowedVoteAction(status, row.tag) && !completed && !pending;
    const label = completed
      ? "Completed"
      : entry?.status === "pending"
        ? "Pending confirmation"
        : entry?.status === "awaiting"
          ? "Wallet request open"
          : entry?.status === "uncertain"
            ? "Check transaction hash"
            : allowed
              ? "Review transaction"
              : row.tag === "castVote" && status.state === 0
                ? "Waiting for voting to open"
                : row.tag === "queue" && status.state === 1
                  ? "Waiting for voting to close"
                  : row.tag === "queue"
                    ? "Requires a successful vote"
                    : row.tag === "execute" && status.state === 5
                      ? "Waiting for timelock"
                      : row.tag === "execute"
                        ? "Queue the proposal first"
                        : "Waiting for required state";
    const step = el(
      "button",
      {
        class: `call-button ${normalSelected?.id === row.id ? "active" : ""}`,
        disabled: busy,
        onclick: () => {
          normalSelected = row;
          render();
        },
      },
      `${index + 1}. ${row.description}`,
      el("small", {}, CHAINS[row.network].name),
      completed && entry?.status !== "confirmed"
        ? el("span", { class: "badge confirmed" }, "Recorded on chain")
        : badge(row),
      el("small", { class: "step-state" }, label)
    );
    actions.append(step);
  }
  actions.append(
    el(
      "button",
      {
        class: `call-button ${start && normalSelected?.id === start.row.id ? "active" : ""}`,
        disabled: busy,
        onclick: () => {
          if (start) normalSelected = start.row;
          $("proof-panel").open = true;
          render();
        },
      },
      start ? "6. Start the upgrade on L1" : "6. Relay the upgrade message to L1",
      el("small", {}, CHAINS.sepolia.name),
      start
        ? badge(start.row)
        : el("small", {}, "Check the L2 execution receipt and inclusion proof")
    )
  );
  const l1 = el(
    "div",
    { class: "step" },
    el("strong", {}, `L1 upgrade: ${UPGRADE_STATES[status.l1State]}`)
  );
  l1.append(
    el(
      "p",
      {},
      "After startUpgrade confirms, the normal legal-veto and approval periods apply. Use the governance verifier for Council/Guardian approvals."
    ),
    link("Open this L1 upgrade in governance ↗", `./index.html#/app/proposals/${vote.upgradeId}`)
  );
  if (status.l1State === 4)
    l1.append(
      el(
        "button",
        {
          disabled: busy,
          onclick: () =>
            run(async () => {
              const row = actionRow(
                c,
                "execute",
                [vote.payload],
                "Execute the approved normal upgrade on L1",
                "sepolia",
                ADDRESSES.puh,
                "ProtocolUpgradeHandlerV31"
              );
              row.tag = "executeL1";
              [normalSelected] = await identifyRows([row], `executeL1:${vote.upgradeId}`);
              render();
            }),
        },
        "Review L1 execution"
      )
    );
  if (status.state === 7 || status.l1State > 0) panel.append(l1);
  $("normal-transaction").hidden = !normalSelected;
  if (normalSelected) {
    let blocked = draftMatches()
      ? ""
      : "The payload or description changed. Prepare the workflow again.";
    if (
      !["startUpgrade", "executeL1"].includes(normalSelected.tag) &&
      !allowedVoteAction(status, normalSelected.tag)
    )
      blocked =
        governorActionReason({ ...status, method: normalSelected.tag }) ||
        "This action is not available in the current governance state.";
    renderTransaction(
      $("normal-transaction"),
      normalSelected,
      () => normalGuard(normalSelected),
      blocked
    );
  }
}
function renderBundles() {
  const list = $("bundles");
  list.replaceChildren(el("h2", {}, "Transaction files"));
  const family = upgradeSources(bundles, vote, c);
  const familyIndices = new Set(family.map((_source) => _source.index));
  let workflowAdded = false;
  const appendWorkflow = () => {
    workflowAdded = true;
    const version = family[0]?.bundle.path?.match(/-(v[0-9.]+)-/i)?.[1];
    const count = votingAttempts().length;
    list.append(
      el(
        "button",
        {
          id: "upgrade-workflow",
          class: `bundle-button ${activeView === "normal" ? "active" : ""}`,
          disabled: busy,
          onclick: () => {
            setView("normal");
            if (!vote) $("proposal-settings").open = true;
          },
        },
        version ? `${version} upgrade` : "Protocol upgrade",
        el(
          "small",
          {},
          vote
            ? `Attempt ${count}${status?.state !== null && status?.state !== undefined ? ` · ${GOVERNOR_STATES[status.state]}` : ""} · ${normalRows.filter((_row) => journal[_row.id]?.status === "confirmed").length}/${normalRows.length} confirmed`
            : "Prepare a reviewed proposal"
        )
      )
    );
  };
  bundles.forEach((_bundle, _index) => {
    if (familyIndices.has(_index)) {
      if (!workflowAdded) appendWorkflow();
      return;
    }

    const done = _bundle.rows.filter((_row) => journal[_row.id]?.status === "confirmed").length;
    list.append(
      el(
        "button",
        {
          class: `bundle-button ${activeView === "bundle" && _index === selectedBundle ? "active" : ""}`,
          disabled: busy,
          onclick: () => {
            selectedBundle = _index;
            selectedRow = Math.max(
              0,
              _bundle.rows.findIndex((_row) => journal[_row.id]?.status !== "confirmed")
            );
            setView("bundle");
          },
        },
        _bundle.title,
        el(
          "small",
          {},
          `${done}/${_bundle.rows.length} confirmed${_bundle.superseded ? " · superseded Board route" : ""}`
        )
      )
    );
  });
  if (!workflowAdded && (vote || !bundles.length)) appendWorkflow();
  if (activeView === "normal") return;
  const bundle = bundles[selectedBundle];
  if (!bundle) return;
  const summary = $("bundle-summary");
  summary.replaceChildren(
    el("h2", {}, bundle.title),
    el("p", { class: "mono" }, bundle.path),
    el(
      "p",
      {},
      `${bundle.rows.length} executable calls · ${bundle.skipped.length} source-marked test/already-executed calls excluded.`
    )
  );
  if (bundle.path && snapshot)
    summary.append(
      link(
        "Pinned source ↗",
        `https://github.com/${snapshot.repo}/blob/${snapshot.commit}/${bundle.path}`
      )
    );
  if (bundle.superseded)
    summary.append(
      el(
        "p",
        { class: "warning" },
        "Superseded for this workflow: v33 must go through normal L2 voting. Refresh the PR after the update."
      )
    );
  if (bundle.gate) {
    const gate = el("input", {
      type: "checkbox",
      checked: gates.has(bundle.sha256),
      disabled: busy,
      onchange: (_event) => {
        if (_event.target.checked) gates.add(bundle.sha256);
        else gates.delete(bundle.sha256);
        render();
      },
    });
    summary.append(
      el("div", { class: "gate" }, el("label", {}, gate, bundle.gate)),
      el(
        "p",
        { class: "muted" },
        "This is your prerequisite confirmation; the sender does not claim to have run the runbook checks."
      )
    );
  }
  $("calls").replaceChildren();
  bundle.rows.forEach((_row, _index) =>
    $("calls").append(
      el(
        "button",
        {
          class: `call-button ${_index === selectedRow ? "active" : ""}`,
          disabled: busy,
          onclick: () => {
            selectedRow = _index;
            render();
          },
        },
        `${_index + 1}. ${_row.tag || "Transaction"}`,
        el("small", {}, CHAINS[_row.network].name),
        badge(_row)
      )
    )
  );
  const row = bundle.rows[selectedRow];
  if (!row) {
    $("transaction").replaceChildren(el("p", {}, "No executable calls in this file."));
    return;
  }
  const governance = importedGovernorContext(row);
  let blocked = bundle.superseded
    ? "This is the superseded Board-based v33 route."
    : bundle.gate && !gates.has(bundle.sha256)
      ? "Confirm the bundle prerequisites above first."
      : "";
  if (!blocked && governance?.blocked) blocked = governance.blocked;
  const plan = dependencyPlan(bundle.rows, selectedRow, independentCalls.has(row.id));
  if (!blocked && plan.indices.some((_i) => journal[bundle.rows[_i].id]?.status !== "confirmed"))
    blocked = `Waiting for required calls ${plan.indices
      .filter((_i) => journal[bundle.rows[_i].id]?.status !== "confirmed")
      .map((_i) => _i + 1)
      .join(", ")}.`;
  const scheduling = el("details", {}, el("summary", {}, "Transaction dependencies"));
  scheduling.append(
    el(
      "p",
      {},
      plan.group.length
        ? `${plan.label}: calls ${plan.group.map((_i) => _i + 1).join(", ")} can be submitted without waiting for each other's receipts. Confirm each request in your wallet; the wallet manages nonces.`
        : plan.indices.length
          ? `Requires confirmed calls: ${plan.indices.map((_i) => _i + 1).join(", ")}.`
          : "No earlier receipt is required."
    )
  );
  scheduling.append(
    el(
      "label",
      {},
      el("input", {
        type: "checkbox",
        checked: independentCalls.has(row.id),
        disabled: busy,
        onchange: (_event) => {
          if (_event.target.checked) independentCalls.add(row.id);
          else independentCalls.delete(row.id);
          render();
        },
      }),
      "I checked the runbook: this call is independent of earlier calls."
    ),
    el(
      "p",
      { class: "muted" },
      "This choice applies only to this call until reload. Simulation, account/network checks, pending-request protection, and wallet confirmation still apply."
    )
  );
  summary.append(scheduling);
  if (plan.group.length)
    summary.append(
      el(
        "p",
        {},
        `${plan.label} can be submitted without waiting for each other to mine. Later dependent calls still wait for their required receipts.`
      )
    );
  renderTransaction(
    $("transaction"),
    row,
    async () => {
      requireThat(!bundle.superseded, "The superseded Board-based v33 route is disabled.");
      requireThat(
        !bundle.gate || gates.has(bundle.sha256),
        "Confirm the bundle prerequisites first."
      );
      await guardImportedGovernor(row);
      await verifyDependencies(
        bundle.rows,
        dependencyPlan(bundle.rows, selectedRow, independentCalls.has(row.id)).indices,
        readStored(STORAGE.journal, {}),
        rpc,
        save,
        c.match,
        notice
      );
    },
    blocked
  );
  if (governance?.panel) $("transaction").prepend(governance.panel);
}
function render() {
  $("normal-view").hidden = activeView !== "normal";
  $("bundle-view").hidden = activeView !== "bundle";
  for (const element of document.querySelectorAll("button, input, textarea, select"))
    element.disabled = busy;
  $("wallet-state").textContent = account
    ? `${account.slice(0, 8)}…${account.slice(-4)} · chain ${walletChain}`
    : "Wallet disconnected";
  $("connect").textContent = desktopAvailable
    ? account && !walletBridge
      ? "Reconnect MetaMask"
      : "Connect desktop MetaMask"
    : "Connect via WalletConnect";
  if (snapshot) {
    $("source-title").textContent = `${snapshot.repo} #${snapshot.number} · ${snapshot.commit}`;
    $("source-info").replaceChildren(
      "Pinned ",
      new Date(snapshot.pinnedAt).toLocaleString(),
      " · ",
      `${bundles.reduce((_count, _bundle) => _count + _bundle.rows.filter((_row) => _row.network === "sepolia").length, 0)} Sepolia / ${bundles.reduce((_count, _bundle) => _count + _bundle.rows.filter((_row) => _row.network === "zksync-testnet3").length, 0)} chain 312 calls · `,
      link("Review this revision ↗", `https://github.com/${snapshot.repo}/tree/${snapshot.commit}`)
    );
  }
  renderNormal();
  renderBundles();
}
async function importBundle(_text, _name) {
  const parsed = parseTransactions(_text);
  const digest = await sha256(_text);
  const known = bundles.findIndex((_bundle) => _bundle.sha256 === digest);
  if (known >= 0) {
    selectedBundle = known;
    selectedRow = 0;
    setView(
      upgradeSources(bundles, vote, c).some((_source) => _source.index === known)
        ? "normal"
        : "bundle"
    );
    return;
  }
  const rows = await identifyRows(parsed.rows, `import:${digest}`);
  bundles.push({
    title: _name,
    path: "",
    sha256: digest,
    ...parsed,
    rows,
    gate: "I checked this file’s order and prerequisites against its reviewed runbook.",
    superseded: rows.some(
      (_row) => _row.tag === "v33_ecosystem_execute" && same(_row.to, ADDRESSES.board)
    ),
  });
  selectedBundle = bundles.length - 1;
  selectedRow = 0;
  setView(
    upgradeSources(bundles, vote, c).some((_source) => _source.index === selectedBundle)
      ? "normal"
      : "bundle"
  );
  notice(
    `Loaded ${rows.length} executable calls; ${parsed.skipped.length} excluded by source flags.`
  );
}
async function fileText(_file) {
  requireThat(_file && _file.size <= LIMITS.maxFileBytes, "Choose a JSON file smaller than 8 MB.");
  return _file.text();
}
function download(_name, _value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(_value, null, 2)], { type: "application/json" })
  );
  const a = el("a", { href: url, download: _name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("connect").onclick = () =>
  run(async () => {
    if (desktopAvailable && walletBridge) {
      await walletBridge.disconnect();
      walletBridge = null;
      walletLabel = "MetaMask";
      bindProvider(null);
      account = "";
      walletChain = null;
    }
    await connect();
  });
$("connect-walletconnect").onclick = () =>
  run(async () => {
    requireThat(walletConnectBridge, "Use the single-file build for WalletConnect.");
    walletBridge = walletConnectBridge;
    walletLabel = "wallet";
    bindProvider(null);
    account = "";
    walletChain = null;
    await connect();
  });
$("refresh-source").onclick = () => run(refreshSource);
$("prepare-vote").onclick = () => run(prepareVote);
$("payload").oninput = () => {
  if (vote) render();
};
$("description").oninput = () => {
  if (vote) render();
};
$("clear-vote").onclick = () => {
  vote = null;
  normalRows = [];
  status = null;
  start = null;
  normalSelected = null;
  $("payload").value = "";
  $("description").value = "";
  $("execution-hash").value = "";
  localStorage.removeItem(STORAGE.vote);
  notice("Workflow cleared. Saved transaction receipts are retained.");
  render();
};
$("load-proof").onclick = () => run(prepareProof);
$("paste-toggle").onclick = () => {
  $("import-panel").hidden = !$("import-panel").hidden;
};
$("bundle-file").onchange = (_event) =>
  run(async () => {
    const file = _event.target.files[0];
    await importBundle(await fileText(file), file.name);
    _event.target.value = "";
  });
$("vote-file").onchange = (_event) =>
  run(async () => {
    const input = JSON.parse(await fileText(_event.target.files[0]));
    let payload = input.payload ?? input.proposal ?? input.upgradeProposal ?? input;
    if (input.targets && input.calldatas && input.description) {
      const decoded = decodeProposal(
        input.targets,
        input.values,
        input.calldatas,
        input.description
      );
      payload = decoded.payload;
    }
    $("payload").value = JSON.stringify(payload, null, 2);
    if (input.description) $("description").value = input.description;
    _event.target.value = "";
    notice("Proposal file loaded. Check the description and prepare the workflow.");
  });
$("import-paste").onclick = () =>
  run(() => importBundle($("import-json").value, "Pasted tx-sim file"));
$("import-fetch").onclick = () =>
  run(async () => {
    let url = new URL($("import-url").value.trim());
    requireThat(
      url.protocol === "https:" && !url.username && !url.password,
      "Use an HTTPS URL without embedded credentials."
    );
    if (
      url.hostname === "github.com" &&
      url.pathname === "/matter-labs/transaction-simulator/pull/386"
    )
      return refreshSource();
    if (url.hostname === "github.com" && url.pathname.includes("/blob/"))
      url = new URL(`https://raw.githubusercontent.com${url.pathname.replace("/blob/", "/")}`);
    const response = await fetch(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(LIMITS.rpcTimeoutMs),
    });
    requireThat(
      response.ok,
      `Could not fetch JSON (HTTP ${response.status}). For private files use Refresh from GitHub or download and open the file.`
    );
    await importBundle(await response.text(), url.pathname.split("/").pop());
  });
$("export-progress").onclick = () =>
  download("testnet3-execution-receipts.json", {
    sourceCommit: snapshot?.commit,
    exportedAt: new Date().toISOString(),
    journal: readStored(STORAGE.journal, {}),
  });
$("save-rpcs").onclick = () =>
  run(async () => {
    const next = {
      sepolia: $("l1-rpc").value.trim(),
      "zksync-testnet3": $("l2-rpc").value.trim(),
    };
    for (const value of Object.values(next)) {
      const url = new URL(value);
      requireThat(
        url.protocol === "https:" ||
          (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)),
        "Use HTTPS RPCs, or a local HTTP RPC."
      );
    }
    const before = rpcs;
    rpcs = next;
    try {
      await checkChains();
      localStorage.setItem(STORAGE.rpc, JSON.stringify(rpcs));
      notice("RPCs verified and saved in this browser.");
    } catch (_error) {
      rpcs = before;
      throw _error;
    }
  });
window.addEventListener("storage", (_event) => {
  if (_event.key === STORAGE.journal) {
    journal = readStored(STORAGE.journal, {});
    render();
  }
});
$("required-owner").textContent = ADDRESSES.control;
$("l1-rpc").value = rpcs.sepolia || CHAINS.sepolia.rpc;
$("l2-rpc").value = rpcs["zksync-testnet3"] || CHAINS["zksync-testnet3"].rpc;

async function initialize() {
  const [abis, data] = bootstrap
    ? [bootstrap.abis, bootstrap.snapshot]
    : await Promise.all([
        fetch("./tx-sim-abis.json").then((_r) => _r.json()),
        fetch("./tx-sim-package.json", { cache: "no-store" }).then((_r) =>
          _r.ok ? _r.json() : null
        ),
      ]);
  c = contracts(abis, window.ethers);
  if (data) await useSnapshot(data);
  else {
    $("source-title").textContent = "Load reviewed transaction files";
    $("source-info").textContent =
      "Refresh from GitHub using your local gh login, or open a JSON file.";
    render();
  }
  let keepSavedAttempt = false;
  if (bootstrap?.prepared && normalSaved?.retryInfo) {
    const saved = makeVote(normalSaved.input, normalSaved.description, c);
    keepSavedAttempt =
      same(saved.upgradeId, bootstrap.prepared.upgradeId) &&
      [
        normalSaved.retryInfo.retryOf,
        ...(normalSaved.retryInfo.history ?? []).map((_attempt) => _attempt.proposalId),
      ].some((_id) => _id && BigInt(_id) === BigInt(bootstrap.prepared.proposalId));
    if (keepSavedAttempt) retryInfo = normalSaved.retryInfo;
  }
  if (bootstrap?.prepared && !keepSavedAttempt) {
    $("payload").value = JSON.stringify(bootstrap.prepared.payload, null, 2);
    $("description").value = bootstrap.prepared.description;
    if (normalSaved?.description === bootstrap.prepared.description)
      $("execution-hash").value = normalSaved.executionHash || "";
    setView("normal");
    try {
      await prepareVote();
      normalSelected = nextWorkflowRow();
      render();
    } catch (_error) {
      notice(
        `Proposal imported automatically; live RPC checks need attention: ${_error.message}`,
        true
      );
    }
  } else if (normalSaved) {
    $("payload").value = JSON.stringify(normalSaved.input, null, 2);
    $("description").value = normalSaved.description;
    $("execution-hash").value = normalSaved.executionHash || "";
    // Rebuilding is local; no automatic wallet connection or transaction request.
    vote = makeVote(normalSaved.input, normalSaved.description, c);
    normalRows = await identifyRows(voteRows(vote, c), `normal:${vote.proposalId}`);
    setView("normal");
    try {
      await refreshVote();
      normalSelected = nextWorkflowRow();
      render();
    } catch (_error) {
      status = null;
      notice(`Workflow restored; live RPC checks need attention: ${_error.message}`, true);
      render();
    }
  }
  initialized = true;
  await restoreWallet();
}
if (bootstrap) {
  $("refresh-source").hidden = true;
  $("connect-walletconnect").hidden = !desktopAvailable;
  document.querySelector(".heading p").textContent =
    "Transactions imported from the pinned tx-sim PR. Connect the required sender and review each request in your wallet.";
  const note = el(
    "p",
    { class: "muted" },
    "This single HTML contains the imported PR revision. Regenerate it to fetch updates. When served over HTTP(S), desktop MetaMask connects directly. Opened from disk, use WalletConnect. Safe approvals use the Safe address; this L2 vote uses the voting EOA."
  );
  document.querySelector(".source").after(note);
}
initialize().catch((_error) => notice(_error.message, true));
let polling = false;
setInterval(async () => {
  if (busy || polling || document.hidden) return;
  polling = true;
  try {
    if (activeView === "normal" && vote) {
      await refreshVote();
      if (busy) return;
    }
    const selected = bundles[selectedBundle]?.rows[selectedRow];
    if (activeView === "bundle" && selected && importedGovernors.has(selected.id)) {
      await refreshImportedGovernor(selected);
      if (busy) return;
    }
    const rows = [
      ...bundles.flatMap((_bundle) => _bundle.rows),
      ...normalRows,
      ...(start ? [start.row] : []),
      ...(normalSelected ? [normalSelected] : []),
    ];
    const pending = rows.filter((_row) => journal[_row.id]?.status === "pending");
    if (!pending.length) return;
    await run(async () => {
      for (const row of pending) await checkRow(row);
    });
  } catch (_error) {
    status = null;
    notice(`Live refresh failed: ${_error.message}`, true);
    render();
  } finally {
    polling = false;
  }
}, LIMITS.pollMs);
