import { CHAINS, LIMITS, PARALLEL_CALLS } from "./tx-sim-config.mjs";

export const same = (_a, _b) =>
  typeof _a === "string" && typeof _b === "string" && _a.toLowerCase() === _b.toLowerCase();
export const hex = (_value) => `0x${BigInt(_value).toString(16)}`;
export async function authorizedWallet(_provider) {
  const [accounts, chain] = await Promise.all([
    _provider.request({ method: "eth_accounts" }),
    _provider.request({ method: "eth_chainId" }),
  ]);
  return { account: accounts[0] ?? "", chainId: Number(BigInt(chain)) };
}
export function walletRequirement(_row, _state) {
  if (!_state.provider || !_state.account) return "connect";
  if (!same(_state.account, _row.from)) return "account";
  if (_state.chainId !== _row.chainId) return "network";
  return null;
}
export function requireThat(_ok, _message) {
  if (!_ok) throw new Error(_message);
}
export function uint(_value, _field) {
  requireThat(
    typeof _value === "string" && /^(0|[1-9]\d*)$/.test(_value),
    `${_field} must be an unsigned decimal string.`
  );
  const value = BigInt(_value);
  requireThat(value < 2n ** 256n, `${_field} exceeds uint256.`);
  return value;
}
export function ethToWei(_value) {
  const value = _value === 0 ? "0" : _value;
  requireThat(
    typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value),
    "value must be an ETH decimal string with at most 18 decimal places."
  );
  const [whole, fraction = ""] = value.split(".");
  return uint((BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))).toString(), "value");
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const FLAGS = ["testOnly", "alreadyExecuted", "skipPriorityOps", "emulateAllBatchesExecuted"];
const FEES = ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"];
const FIELDS = new Set([
  "network",
  "from",
  "to",
  "data",
  "value",
  "description",
  "tag",
  "valueToMint",
  ...FLAGS,
  ...FEES,
]);
export function parseTransactions(_json) {
  requireThat(
    new TextEncoder().encode(_json).length <= LIMITS.maxFileBytes,
    "File exceeds the 8 MB limit."
  );
  const source = JSON.parse(_json);
  requireThat(
    Array.isArray(source) && source.length > 0 && source.length <= LIMITS.maxTransactions,
    "Expected a nonempty tx-sim transaction array (up to 1,000 calls)."
  );
  const skipped = [];
  const rows = [];
  source.forEach((_tx, _index) => {
    const prefix = `Call ${_index + 1}: `;
    requireThat(
      _tx && typeof _tx === "object" && !Array.isArray(_tx),
      `${prefix}expected an object.`
    );
    for (const field of Object.keys(_tx))
      requireThat(
        FIELDS.has(field),
        `${prefix}unsupported field ${field}; it will not be silently discarded.`
      );
    for (const flag of FLAGS)
      requireThat(
        _tx[flag] === undefined || typeof _tx[flag] === "boolean",
        `${prefix}${flag} must be boolean.`
      );
    if (_tx.testOnly || _tx.alreadyExecuted) {
      skipped.push({
        index: _index,
        reason: _tx.testOnly ? "Test only" : "Already executed in source",
      });
      return;
    }
    requireThat(
      Object.hasOwn(CHAINS, _tx.network),
      `${prefix}unsupported network ${_tx.network}. Supported: Sepolia and ZKsync Testnet 3.`
    );
    requireThat(
      ADDRESS.test(_tx.from) && ADDRESS.test(_tx.to),
      `${prefix}from and to must be 20-byte addresses.`
    );
    requireThat(BYTES.test(_tx.data), `${prefix}data must be even-length hex bytes.`);
    for (const field of ["description", "tag"])
      requireThat(
        _tx[field] === undefined || typeof _tx[field] === "string",
        `${prefix}${field} must be text.`
      );
    const valueWei = ethToWei(_tx.value);
    const fees = {};
    for (const field of FEES)
      if (_tx[field] !== undefined) fees[field] = uint(_tx[field], field).toString();
    requireThat(
      !(fees.gasPrice && (fees.maxFeePerGas || fees.maxPriorityFeePerGas)),
      `${prefix}gasPrice cannot be combined with EIP-1559 fees.`
    );
    requireThat(
      !fees.maxPriorityFeePerGas || fees.maxFeePerGas,
      `${prefix}maxPriorityFeePerGas requires maxFeePerGas.`
    );
    requireThat(
      !fees.maxPriorityFeePerGas || BigInt(fees.maxPriorityFeePerGas) <= BigInt(fees.maxFeePerGas),
      `${prefix}priority fee exceeds the fee cap.`
    );
    rows.push({
      ..._tx,
      ...fees,
      valueWei: valueWei.toString(),
      chainId: CHAINS[_tx.network].id,
      sourceIndex: _index,
    });
  });
  return { rows, skipped };
}
export function walletTransaction(_row) {
  const tx = {
    from: _row.from,
    to: _row.to,
    data: _row.data,
    value: hex(_row.valueWei),
    chainId: hex(_row.chainId),
  };
  for (const field of FEES) if (_row[field] !== undefined) tx[field] = hex(_row[field]);
  return tx;
}
export function canonical(_row) {
  return JSON.stringify([
    _row.chainId,
    _row.from.toLowerCase(),
    _row.to.toLowerCase(),
    _row.data.toLowerCase(),
    _row.valueWei,
    ...FEES.map((_key) => _row[_key] ?? null),
  ]);
}
export async function sha256(_text) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(_text))),
    (_byte) => _byte.toString(16).padStart(2, "0")
  ).join("");
}
export async function identifyRows(_rows, _namespace) {
  return Promise.all(
    _rows.map(async (_row, _index) => ({
      ..._row,
      id: await sha256(`${_namespace}:${_index}:${canonical(_row)}`),
    }))
  );
}
// Only read requests are time-bounded. A wallet submission must remain ambiguous
// until MetaMask answers; a timer must never make it appear safe to resend.
export async function walletRead(_provider, _request, _timeoutMs = LIMITS.rpcTimeoutMs) {
  requireThat(
    ["eth_accounts", "eth_chainId"].includes(_request.method),
    "Wallet read method is not permitted."
  );
  let timer;
  try {
    return await Promise.race([
      _provider.request(_request),
      new Promise((_resolve, _reject) => {
        timer = setTimeout(
          () =>
            _reject(
              new Error(
                `MetaMask ${_request.method} did not respond. Reconnect the wallet and retry.`
              )
            ),
          _timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function assertWallet(_provider, _row) {
  const [chain, accounts] = await Promise.all([
    walletRead(_provider, { method: "eth_chainId" }),
    walletRead(_provider, { method: "eth_accounts" }),
  ]);
  requireThat(
    BigInt(chain) === BigInt(_row.chainId),
    `Switch MetaMask to ${CHAINS[_row.network].name} (${_row.chainId}).`
  );
  requireThat(
    accounts.length > 0 && same(accounts[0], _row.from),
    `Select the required sender ${_row.from} in MetaMask.`
  );
}
export async function preflight(_provider, _row, _reads = _provider) {
  await assertWallet(_provider, _row);
  const readChain = await _reads.request({ method: "eth_chainId" });
  requireThat(BigInt(readChain) === BigInt(_row.chainId), "Simulation RPC is on the wrong chain.");
  const tx = walletTransaction(_row);
  // Simulate the requested call. MetaMask may later wrap it in a smart-account
  // transaction, so this estimate must not become the wallet's gas limit.
  const [result, estimated, balance, latest, gasPrice] = await Promise.all([
    _reads.request({ method: "eth_call", params: [tx, "pending"] }),
    _reads.request({ method: "eth_estimateGas", params: [tx] }),
    _reads.request({
      method: "eth_getBalance",
      params: [_row.from, "pending"],
    }),
    _reads.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
    _reads.request({ method: "eth_gasPrice" }),
  ]);
  const fee =
    _row.maxFeePerGas !== undefined
      ? BigInt(_row.maxFeePerGas)
      : _row.gasPrice !== undefined
        ? BigInt(_row.gasPrice)
        : BigInt(gasPrice);
  if (latest.baseFeePerGas !== undefined)
    requireThat(
      fee >= BigInt(latest.baseFeePerGas),
      "The current base fee exceeds the transaction fee cap. Reprice/regenerate the reviewed package."
    );
  if (_row.maxFeePerGas !== undefined && _row.maxPriorityFeePerGas === undefined) {
    const tip = BigInt(await _reads.request({ method: "eth_maxPriorityFeePerGas" }));
    const room = fee - BigInt(latest.baseFeePerGas ?? "0x0");
    tx.maxPriorityFeePerGas = hex(tip < room ? tip : room);
  }
  const gas = (BigInt(estimated) * LIMITS.gasMarginPercent + LIMITS.percent - 1n) / LIMITS.percent;
  requireThat(
    BigInt(balance) >= BigInt(_row.valueWei) + gas * fee,
    "Sender balance is insufficient for the value and preliminary gas estimate. MetaMask checks the final transaction cost."
  );
  await assertWallet(_provider, _row);
  return { tx, result, gas: gas.toString(), checkedAt: Date.now() };
}
export function assertMatches(_row, _tx) {
  requireThat(
    _tx &&
      same(_row.from, _tx.from) &&
      same(_row.to, _tx.to) &&
      same(_row.data, _tx.input ?? _tx.data) &&
      BigInt(_row.valueWei) === BigInt(_tx.value),
    "Transaction differs from the reviewed sender, recipient, value, or calldata."
  );
  if (_tx.chainId !== undefined)
    requireThat(BigInt(_tx.chainId) === BigInt(_row.chainId), "Transaction chain differs.");
  for (const field of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) {
    if (_row[field] !== undefined)
      requireThat(
        _tx[field] !== undefined && BigInt(_tx[field]) <= BigInt(_row[field]),
        `Transaction exceeds the reviewed ${field} cap.`
      );
  }
}
/** @param {(_row: any, _tx: any, _rpc: any, _block: any) => unknown} [_match] */
export async function inspectReceipt(_row, _hash, _rpc, _match = assertMatches) {
  requireThat(HASH.test(_hash), "Enter a 32-byte transaction hash.");
  const chain = await _rpc(_row.network, "eth_chainId", []);
  requireThat(BigInt(chain) === BigInt(_row.chainId), "Receipt RPC is on the wrong chain.");
  const [tx, receipt] = await Promise.all([
    _rpc(_row.network, "eth_getTransactionByHash", [_hash]),
    _rpc(_row.network, "eth_getTransactionReceipt", [_hash]),
  ]);
  if (!tx)
    return {
      status: "pending",
      hash: _hash,
      detail: "Transaction is not visible to this RPC yet.",
    };
  if (!receipt) return { status: "pending", hash: _hash, detail: "Waiting for a receipt." };
  await _match(_row, tx, _rpc, receipt.blockNumber);
  requireThat(same(receipt.transactionHash, _hash), "Receipt transaction hash differs.");
  const [block, head] = await Promise.all([
    _rpc(_row.network, "eth_getBlockByNumber", [receipt.blockNumber, false]),
    _rpc(_row.network, "eth_blockNumber", []),
  ]);
  if (!block || !same(block.hash, receipt.blockHash))
    return {
      status: "pending",
      hash: _hash,
      detail: "Receipt is not in the canonical chain.",
    };
  const confirmations = BigInt(head) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < LIMITS.receiptConfirmations)
    return {
      status: "pending",
      hash: _hash,
      detail: "Waiting for confirmation.",
    };
  requireThat(
    receipt.status === "0x1" || receipt.status === "0x0",
    "Receipt is missing an execution status."
  );
  return {
    status: receipt.status === "0x1" ? "confirmed" : "reverted",
    hash: _hash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    nonce: tx.nonce,
    receipt,
    detail:
      receipt.status === "0x1"
        ? `Confirmed in block ${BigInt(receipt.blockNumber)}`
        : "Reverted on chain. This call has not completed.",
  };
}
export function dependencyPlan(_rows, _index, _independent = false) {
  requireThat(
    Number.isInteger(_index) && _index >= 0 && _index < _rows.length,
    "Select a valid call."
  );
  const earlier = (_end) => Array.from({ length: _end }, (_unused, _i) => _i);
  if (_independent) return { indices: [], group: [], label: "Marked independent by you" };
  const row = _rows[_index];
  const rule = PARALLEL_CALLS[row.tag];
  const matches = (_candidate) =>
    rule &&
    _candidate &&
    _candidate.tag === row.tag &&
    _candidate.chainId === row.chainId &&
    same(_candidate.from, row.from) &&
    _candidate.valueWei === "0" &&
    same(_candidate.data.slice(0, 10), rule.selector) &&
    (_candidate.data.length - 2) / 2 === rule.bytes;
  if (!matches(row)) return { indices: earlier(_index), group: [], label: "Source order" };
  let start = _index;
  let end = _index + 1;
  while (start > 0 && matches(_rows[start - 1])) start--;
  while (end < _rows.length && matches(_rows[end])) end++;
  // Two nominations of the same owner slot are not independent. Role groups must
  // operate on one token and approval groups must use distinct member Safes.
  const group = Array.from({ length: end - start }, (_unused, _i) => start + _i);
  const separateTargets = ["approve_acceptance", "nominate_owner"].includes(row.tag);
  const distinct = new Set(
    group.map((_i) => (separateTargets ? _rows[_i].to.toLowerCase() : _rows[_i].data.toLowerCase()))
  );
  const oneToken = separateTargets || group.every((_i) => same(_rows[_i].to, row.to));
  if (group.length < 2 || distinct.size !== group.length || !oneToken)
    return { indices: earlier(_index), group: [], label: "Source order" };
  return { indices: earlier(start), group, label: rule.label };
}
export async function verifyDependencies(
  _rows,
  _indices,
  _journal,
  _rpc,
  _save,
  _match = assertMatches,
  _progress = () => {}
) {
  for (const index of _indices)
    requireThat(
      _journal[_rows[index].id]?.hash,
      `Complete required call ${index + 1} first, or attach its existing transaction hash.`
    );
  let cursor = 0;
  let completed = 0;
  let failure;
  _progress(`Verifying ${_indices.length} required receipts…`);
  const worker = async () => {
    while (!failure && cursor < _indices.length) {
      const index = _indices[cursor++];
      const row = _rows[index];
      try {
        const checked = await inspectReceipt(row, _journal[row.id].hash, _rpc, _match);
        _save(row.id, checked);
        requireThat(
          checked.status === "confirmed",
          `Required call ${index + 1} is ${checked.status}; it must confirm before this call.`
        );
        _progress(
          `Verified ${++completed}/${_indices.length} required receipts (call ${index + 1}).`
        );
      } catch (_error) {
        failure = new Error(`Checking required call ${index + 1}: ${_error.message}`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LIMITS.dependencyConcurrency, _indices.length) }, worker)
  );
  if (failure) throw failure;
}
export async function verifyPredecessors(
  _rows,
  _index,
  _journal,
  _rpc,
  _save,
  _match = assertMatches
) {
  return verifyDependencies(
    _rows,
    Array.from({ length: _index }, (_unused, _i) => _i),
    _journal,
    _rpc,
    _save,
    _match
  );
}

export async function sendOne({
  provider: _provider,
  row: _row,
  beforeSend: _beforeSend,
  save: _save,
  current: _current,
  readProvider: _readProvider = _provider,
  progress: _progress = () => {},
}) {
  requireThat(_provider, "Connect MetaMask first.");
  const entry = _current(_row.id);
  requireThat(
    !entry || ["ready", "rejected", "reverted"].includes(entry.status),
    "This call already has a pending or confirmed attempt. Check its receipt or attach the replacement hash."
  );
  await _beforeSend();
  _progress("Simulating the call and estimating its gas using the configured RPC…");
  const checked = await preflight(_provider, _row, _readProvider);
  const latest = _current(_row.id);
  requireThat(
    !latest || ["ready", "rejected", "reverted"].includes(latest.status),
    "Another tab recorded this transaction while it was being checked. Refresh its receipt before continuing."
  );
  // Persist before opening MetaMask. A reload or ambiguous RPC error must never trigger an automatic retry.
  _save(_row.id, {
    status: "awaiting",
    detail:
      "Awaiting MetaMask. If the page reloads, attach the submitted transaction hash before continuing.",
    checkedAt: checked.checkedAt,
  });
  try {
    await assertWallet(_provider, _row);
    _progress("Wallet request sent. Review and confirm the transaction in your connected wallet…");
    const hash = await _provider.request({
      method: "eth_sendTransaction",
      params: [checked.tx],
    });
    requireThat(HASH.test(hash), "MetaMask returned an invalid transaction hash.");
    _save(_row.id, {
      status: "pending",
      hash,
      detail: "Submitted. Waiting for the receipt.",
    });
    return hash;
  } catch (_error) {
    const rejected = _error.code === 4001;
    _save(_row.id, {
      status: rejected ? "rejected" : "uncertain",
      detail: rejected
        ? "Rejected in MetaMask. No transaction was submitted by this request."
        : `Submission status is uncertain. Check MetaMask and attach its hash. ${_error.message}`,
    });
    throw _error;
  }
}
