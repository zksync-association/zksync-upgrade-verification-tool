import test from "node:test";
// Wallet/RPC mocks isolate the submission boundary: no owner key or live financial
// action is used in tests. Signing fields are checked against synthetic source inputs; the MetaMask fixture is public on-chain data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CHAINS, ADDRESSES, UPGRADE_TUPLE, WALLET_ABIS } from "./tx-sim-config.mjs";
import {
  authorizedWallet,
  walletRequirement,
  walletRead,
  ethToWei,
  parseTransactions,
  walletTransaction,
  preflight,
  sendOne,
  inspectReceipt,
  verifyPredecessors,
  dependencyPlan,
  verifyDependencies,
  sha256,
} from "./tx-sim-core.mjs";
import {
  contracts,
  governorAction,
  governorCallStatus,
  governorActionReason,
  makeVote,
  voteRows,
  allowedVoteAction,
  buildStart,
} from "./tx-sim-contracts.mjs";

const require = createRequire(import.meta.url);
const ethers = require("ethers");
const abis = JSON.parse(readFileSync(new URL("./tx-sim-abis.json", import.meta.url)));
const c = contracts(abis, ethers);
const raw = {
  network: "sepolia",
  from: ADDRESSES.control,
  to: ADDRESSES.puh,
  data: "0x12345678",
  value: "0",
};
const row = { ...parseTransactions(JSON.stringify([raw])).rows[0], id: "one" };
const HASH = `0x${"12".repeat(32)}`;
const BLOCK = `0x${"34".repeat(32)}`;

test("wallet blockers distinguish disconnected, wrong account, wrong chain, and ready", () => {
  assert.equal(walletRequirement(row, { provider: null, account: "", chainId: null }), "connect");
  assert.equal(
    walletRequirement(row, { provider: {}, account: "", chainId: row.chainId }),
    "connect"
  );
  assert.equal(
    walletRequirement(row, {
      provider: {},
      account: ADDRESSES.puh,
      chainId: row.chainId,
    }),
    "account"
  );
  assert.equal(walletRequirement(row, { provider: {}, account: row.from, chainId: 1 }), "network");
  assert.equal(
    walletRequirement(row, {
      provider: {},
      account: row.from.toLowerCase(),
      chainId: row.chainId,
    }),
    null
  );
});
test("connection restoration reads existing authorization without permission or transaction requests", async () => {
  const requests = [];
  const state = await authorizedWallet({
    request: async (_request) => {
      requests.push(_request.method);
      return _request.method === "eth_accounts" ? [row.from] : "0xaa36a7";
    },
  });
  assert.deepEqual(state, { account: row.from, chainId: row.chainId });
  assert.deepEqual(requests.sort(), ["eth_accounts", "eth_chainId"]);
});

function wallet(_overrides = {}) {
  const calls = [];
  const journal = {};
  const values = {
    eth_accounts: [ADDRESSES.control],
    eth_chainId: "0xaa36a7",
    eth_call: "0x",
    eth_estimateGas: "0x5208",
    eth_getBalance: "0x10000000000000000000",
    eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
    eth_gasPrice: "0x77359400",
    eth_maxPriorityFeePerGas: "0x3b9aca00",
    eth_sendTransaction: HASH,
    ..._overrides,
  };
  const provider = {
    async request(_request) {
      calls.push(_request);
      const value = values[_request.method];
      if (value instanceof Error) throw value;
      return typeof value === "function" ? value(_request) : value;
    },
  };
  return {
    provider,
    calls,
    journal,
    save: (_id, _entry) => {
      journal[_id] = _entry;
    },
    current: (_id) => journal[_id],
  };
}
function receiptRpc(_row = row, _changes = {}) {
  const values = {
    eth_chainId: `0x${_row.chainId.toString(16)}`,
    eth_getTransactionByHash: {
      hash: HASH,
      from: _row.from,
      to: _row.to,
      input: _row.data,
      value: `0x${BigInt(_row.valueWei).toString(16)}`,
      chainId: `0x${_row.chainId.toString(16)}`,
      nonce: "0x1",
      ...Object.fromEntries(
        ["maxFeePerGas", "maxPriorityFeePerGas", "gasPrice"]
          .filter((_key) => _row[_key] !== undefined)
          .map((_key) => [_key, `0x${BigInt(_row[_key]).toString(16)}`])
      ),
    },
    eth_getTransactionReceipt: {
      transactionHash: HASH,
      blockNumber: "0x10",
      blockHash: BLOCK,
      status: "0x1",
      logs: [],
    },
    eth_getBlockByNumber: { hash: BLOCK },
    eth_blockNumber: "0x11",
    ..._changes,
  };
  return async (_network, _method) => {
    assert.equal(CHAINS[_network].id, _row.chainId);
    assert.ok(Object.hasOwn(values, _method), _method);
    return values[_method];
  };
}

test("ETH conversion is exact and rejects unsafe formats", () => {
  assert.equal(ethToWei("0.008866666676"), 8866666676000000n);
  assert.equal(ethToWei("0.000000000000000001"), 1n);
  for (const value of ["-1", "1e-8", "0.0000000000000000001", "NaN", 0.1, 1])
    assert.throws(() => ethToWei(value));
});
test("source flags exclude test/deployment calls without changing real fields", () => {
  const result = parseTransactions(
    JSON.stringify([
      { ...raw, testOnly: true },
      { ...raw, alreadyExecuted: true },
      {
        ...raw,
        skipPriorityOps: true,
        emulateAllBatchesExecuted: true,
        valueToMint: "1",
      },
    ])
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(walletTransaction(result.rows[0]), {
    from: raw.from,
    to: raw.to,
    data: raw.data,
    value: "0x0",
    chainId: "0xaa36a7",
  });
  for (const change of [
    { network: "mainnet" },
    { data: "0x1" },
    { from: "0x0" },
    { testOnly: "true" },
    { gasLimit: "123" },
    { maxFeePerGas: 20000000000 },
    { gasPrice: "1", maxFeePerGas: "2" },
  ])
    assert.throws(() => parseTransactions(JSON.stringify([{ ...raw, ...change }])));
});
test("imported source transactions preserve recipient, sender, ETH value, calldata and fee caps", async () => {
  const rawSource = JSON.stringify([
    raw,
    { ...raw, network: "zksync-testnet3", value: "0.000000000000000001" },
    { ...raw, testOnly: true },
  ]);
  const data = { stages: [{ raw: rawSource, sha256: await sha256(rawSource) }] };
  let count = 0;
  for (const file of data.stages) {
    assert.equal(await sha256(file.raw), file.sha256);
    const parsed = parseTransactions(file.raw);
    const original = JSON.parse(file.raw).filter((_row) => !_row.testOnly && !_row.alreadyExecuted);
    assert.equal(parsed.rows.length, original.length);
    parsed.rows.forEach((_row, _index) => {
      const source = original[_index];
      const request = walletTransaction(_row);
      for (const field of ["from", "to", "data"]) assert.equal(request[field], source[field]);
      assert.equal(BigInt(request.value), ethToWei(source.value));
      if (source.maxFeePerGas)
        assert.equal(BigInt(request.maxFeePerGas), BigInt(source.maxFeePerGas));
    });
    count += parsed.rows.length;
  }
  assert.ok(data.stages.length > 0);
  assert.ok(count > 0);
});
test("preflight sends only the exact call and respects the fee budget", async () => {
  const capped = parseTransactions(
    JSON.stringify([{ ...raw, value: "0.008866666676", maxFeePerGas: "20000000000" }])
  ).rows[0];
  const w = wallet();
  const checked = await preflight(w.provider, capped);
  assert.equal(BigInt(checked.tx.value), 8866666676000000n);
  assert.equal(BigInt(checked.tx.maxFeePerGas), 20000000000n);
  assert.equal(checked.gas, "25200");
  assert.ok(
    !Object.hasOwn(checked.tx, "gas"),
    "MetaMask must estimate the final smart-account envelope"
  );
  assert.ok(!w.calls.some((_call) => _call.method === "eth_sendTransaction"));
  await assert.rejects(
    preflight(wallet({ eth_getBlockByNumber: { baseFeePerGas: "0x1000000000" } }).provider, capped),
    /base fee/
  );
  await assert.rejects(preflight(wallet({ eth_getBalance: "0x0" }).provider, capped), /balance/);
});
test("wrong account, wrong chain and an RPC revert never open a send request", async () => {
  for (const override of [
    { eth_accounts: ["0x0000000000000000000000000000000000000001"] },
    { eth_chainId: "0x1" },
    { eth_call: new Error("execution reverted") },
  ]) {
    const w = wallet(override);
    await assert.rejects(sendOne({ ...w, row, beforeSend: async () => {} }));
    assert.ok(!w.calls.some((_call) => _call.method === "eth_sendTransaction"));
  }
});
test("one transaction opens one wallet request; pending/confirmed calls cannot be resent", async () => {
  const w = wallet();
  assert.equal(await sendOne({ ...w, row, beforeSend: async () => {} }), HASH);
  assert.equal(w.calls.filter((_call) => _call.method === "eth_sendTransaction").length, 1);
  assert.equal(w.journal.one.status, "pending");
  await assert.rejects(sendOne({ ...w, row, beforeSend: async () => {} }), /pending or confirmed/);
});
test("rejection is retryable; ambiguous submission is preserved and blocked", async () => {
  for (const [code, expected] of [
    [4001, "rejected"],
    [-32000, "uncertain"],
  ]) {
    const error = Object.assign(new Error("wallet request failed"), { code });
    const w = wallet({ eth_sendTransaction: error });
    await assert.rejects(sendOne({ ...w, row, beforeSend: async () => {} }));
    assert.equal(w.journal.one.status, expected);
    if (expected === "uncertain")
      await assert.rejects(
        sendOne({ ...w, row, beforeSend: async () => {} }),
        /pending or confirmed/
      );
  }
});
test("receipt must match call, chain, status, and canonical block", async () => {
  assert.equal((await inspectReceipt(row, HASH, receiptRpc())).status, "confirmed");
  assert.equal(
    (await inspectReceipt(row, HASH, receiptRpc(row, { eth_getTransactionReceipt: null }))).status,
    "pending"
  );
  assert.equal(
    (await inspectReceipt(row, HASH, receiptRpc(row, { eth_getBlockByNumber: { hash: HASH } })))
      .status,
    "pending"
  );
  await assert.rejects(
    inspectReceipt(row, HASH, receiptRpc(row, { eth_chainId: "0x1" })),
    /wrong chain/
  );
  const original = await receiptRpc()("sepolia", "eth_getTransactionByHash");
  for (const change of [
    { input: "0x" },
    { to: ADDRESSES.control },
    { from: ADDRESSES.puh },
    { value: "0x1" },
  ])
    await assert.rejects(
      inspectReceipt(
        row,
        HASH,
        receiptRpc(row, {
          eth_getTransactionByHash: { ...original, ...change },
        })
      ),
      /differs/
    );
});
test("prior successful receipt is required, and is rechecked rather than trusted from storage", async () => {
  await assert.rejects(
    verifyPredecessors([row, row], 1, {}, receiptRpc(), () => {}),
    /Complete required call/
  );
  await verifyPredecessors(
    [row, row],
    1,
    { one: { hash: HASH, status: "confirmed" } },
    receiptRpc(),
    () => {}
  );
  await assert.rejects(
    verifyPredecessors(
      [row, row],
      1,
      { one: { hash: HASH, status: "confirmed" } },
      receiptRpc(row, { eth_getTransactionReceipt: null }),
      () => {}
    ),
    /pending/
  );
});

const message = ethers.utils.defaultAbiCoder.encode(
  [UPGRADE_TUPLE],
  [
    {
      calls: [{ target: ADDRESSES.puh, value: "0", data: "0x12345678" }],
      executor: ADDRESSES.puh,
      salt: `0x${"42".repeat(32)}`,
    },
  ]
);
const description =
  "Testnet3 normal protocol proposal: validate governor timelock is L2-to-L1 sender";
const messenger = new ethers.utils.Interface(abis.IL1Messenger);
const calldatas = [messenger.encodeFunctionData("sendToL1", [message])];
const _governor = new ethers.utils.Interface(abis.Testnet3Governor);
const rehearsal = {
  message,
  messageHash: ethers.utils.keccak256(message),
  proposalId: ethers.BigNumber.from(
    ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address[]", "uint256[]", "bytes[]", "bytes32"],
        [[ADDRESSES.messenger], [0], calldatas, ethers.utils.id(description)]
      )
    )
  ).toString(),
};
test("arbitrary L2 calldata and ETH value reach the wallet unchanged", async () => {
  const l2 = {
    ...parseTransactions(
      JSON.stringify([
        {
          ...raw,
          network: "zksync-testnet3",
          to: ADDRESSES.token,
          value: "0.000000000000000001",
          data: "0xdeadbeef11223344",
        },
      ])
    ).rows[0],
    id: "l2-arbitrary",
  };
  const w = wallet({ eth_chainId: "0x138" });
  await sendOne({ ...w, row: l2, beforeSend: async () => {} });
  const sent = w.calls.find((_call) => _call.method === "eth_sendTransaction").params[0];
  assert.equal(sent.chainId, "0x138");
  assert.equal(sent.to, ADDRESSES.token);
  assert.equal(sent.data, "0xdeadbeef11223344");
  assert.equal(sent.value, "0x1");
  assert.equal(w.journal["l2-arbitrary"].hash, HASH);
});
test("a concurrent receipt recorded during preflight prevents another submission", async () => {
  const w = wallet({
    eth_estimateGas: () => {
      w.journal.one = { status: "pending", hash: HASH };
      return "0x5208";
    },
  });
  await assert.rejects(sendOne({ ...w, row, beforeSend: async () => {} }), /Another tab recorded/);
  assert.equal(w.calls.filter((_call) => _call.method === "eth_sendTransaction").length, 0);
});
const [decodedPayload] = ethers.utils.defaultAbiCoder.decode([UPGRADE_TUPLE], rehearsal.message);
const payload = {
  calls: decodedPayload.calls.map((_call) => ({
    target: _call.target,
    value: _call.value.toString(),
    data: _call.data,
  })),
  executor: decodedPayload.executor,
  salt: decodedPayload.salt,
};
const vote = makeVote(
  payload,
  "Testnet3 normal protocol proposal: validate governor timelock is L2-to-L1 sender",
  c
);
test("normal proposal matches independently encoded proposal ID and native message", () => {
  assert.equal(vote.message, rehearsal.message);
  assert.equal(BigInt(vote.proposalId).toString(), rehearsal.proposalId);
  assert.equal(vote.upgradeId, rehearsal.messageHash);
  const rows = voteRows(vote, c);
  assert.deepEqual(
    rows.map((_row) => _row.tag),
    ["delegate", "propose", "castVote", "queue", "execute"]
  );
  assert.equal(c.interfaces.Testnet3Governor.decodeFunctionData("castVote", rows[2].data)[1], 1);
  assert.throws(() =>
    makeVote({ ...payload, calls: [{ ...payload.calls[0], value: 1 }] }, "description", c)
  );
});
test("governor gates pending, active, success, timelock, and completed states", () => {
  assert.equal(allowedVoteAction({ state: null, votes: "10", threshold: "11" }, "propose"), false);
  assert.equal(allowedVoteAction({ state: null, votes: "11", threshold: "11" }, "propose"), true);
  assert.equal(allowedVoteAction({ state: 0 }, "castVote"), false);
  assert.equal(allowedVoteAction({ state: 1, hasVoted: false }, "castVote"), true);
  assert.equal(allowedVoteAction({ state: 1, hasVoted: true }, "castVote"), false);
  assert.equal(allowedVoteAction({ state: 4 }, "queue"), true);
  assert.equal(allowedVoteAction({ state: 5, clock: "10", eta: "11" }, "execute"), false);
  assert.equal(allowedVoteAction({ state: 5, clock: "11", eta: "11" }, "execute"), true);
  assert.equal(allowedVoteAction({ state: 7 }, "execute"), false);
});
test("native proof uses the batch transaction index, verifies sender/message and L1 inclusion", async () => {
  const executeRow = voteRows(vote, c)[4];
  const event = c.interfaces.IL1Messenger.encodeEventLog(
    c.interfaces.IL1Messenger.getEvent("L1MessageSent"),
    [ADDRESSES.timelock, vote.upgradeId, vote.message]
  );
  const baseRpc = receiptRpc(executeRow);
  const receipt = {
    ...(await baseRpc(executeRow.network, "eth_getTransactionReceipt")),
    l1BatchNumber: "0x20",
    l1BatchTxIndex: "0x17",
    logs: [{ address: ADDRESSES.messenger, ...event }],
    l2ToL1Logs: [
      {
        sender: ADDRESSES.messenger,
        key: ethers.utils.hexZeroPad(ADDRESSES.timelock, 32),
        value: vote.upgradeId,
        transactionIndex: "0x2",
      },
    ],
  };
  let validProof = true;
  let executedBatch = "32";
  const rpc = async (_network, _method, _params) => {
    if (_method === "eth_getTransactionReceipt") return receipt;
    if (_method === "zks_getL2ToL1LogProof") {
      assert.deepEqual(_params, [HASH, 0]);
      return { id: 7, proof: [BLOCK], batchNumber: 32 };
    }
    if (_method === "eth_call") {
      const call = _params[0];
      for (const [abi, method, result] of [
        ["ProtocolUpgradeHandlerV31", "L2_PROTOCOL_GOVERNOR", [ADDRESSES.timelock]],
        ["ProtocolUpgradeHandlerV31", "ERA_CHAIN_ID", [312]],
        ["IZkSyncHyperchain", "getTotalBatchesExecuted", [executedBatch]],
        ["IZkSyncHyperchain", "proveL2MessageInclusion", [validProof]],
      ]) {
        if (call.data.startsWith(c.interfaces[abi].getSighash(method)))
          return c.interfaces[abi].encodeFunctionResult(method, result);
      }
      throw new Error("Unexpected eth_call");
    }
    return baseRpc(_network, _method, _params);
  };
  const built = await buildStart(vote, executeRow, HASH, rpc, c);
  const args = c.interfaces.ProtocolUpgradeHandlerV31.decodeFunctionData(
    "startUpgrade",
    built.row.data
  );
  assert.equal(args[0].toString(), "32");
  assert.equal(args[1].toString(), "7");
  assert.equal(args[2], 23);
  validProof = false;
  await assert.rejects(buildStart(vote, executeRow, HASH, rpc, c), /L1 rejected/);
  validProof = true;
  executedBatch = "31";
  await assert.rejects(buildStart(vote, executeRow, HASH, rpc, c), /Waiting for L2 batch/);
  executedBatch = "32";
  receipt.logs = [];
  await assert.rejects(buildStart(vote, executeRow, HASH, rpc, c), /exact L1MessageSent/);
});

test("MetaMask estimates the final envelope for EOA and delegated wallet sends", async () => {
  for (const candidate of [row, { ...row, network: "zksync-testnet3", chainId: 312 }]) {
    const w = wallet({
      eth_chainId: `0x${candidate.chainId.toString(16)}`,
      eth_estimateGas: "0x21880",
    });
    await sendOne({ ...w, row: candidate, beforeSend: async () => {} });
    const sent = w.calls.find((_call) => _call.method === "eth_sendTransaction").params[0];
    assert.equal(sent.to, candidate.to);
    assert.equal(sent.data, candidate.data);
    assert.equal(sent.from, candidate.from);
    assert.ok(!Object.hasOwn(sent, "gas"));
    assert.ok(!Object.hasOwn(sent, "authorizationList"));
  }
});

test("real MetaMask wrapper matches only its exact single reverting owner call", async () => {
  const tx = JSON.parse(
    readFileSync(new URL("./fixtures/failed-transaction-rpc.json", import.meta.url))
  );
  const codes = JSON.parse(
    readFileSync(new URL("./fixtures/wallet-code-evidence.json", import.meta.url))
  );
  const iface = new c.utils.Interface(WALLET_ABIS.manager);
  const decoded = iface.decodeFunctionData("redeemDelegations", tx.input);
  const execution = decoded.executionCallDatas[0];
  const reviewed = {
    ...row,
    from: tx.from,
    to: c.utils.hexDataSlice(execution, 0, 20),
    data: c.utils.hexDataSlice(execution, 52),
    valueWei: BigInt(c.utils.hexDataSlice(execution, 20, 52)).toString(),
  };
  const rpc = async (_network, _method, _args) => {
    assert.equal(_method, "eth_getCode");
    assert.equal(_args[1], tx.blockNumber);
    return _args[0].toLowerCase() === tx.from
      ? "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"
      : codes[_args[0].toLowerCase()];
  };
  await c.match(reviewed, tx, rpc, tx.blockNumber);
  for (const change of [
    { to: row.to },
    { data: "0x12345678" },
    { valueWei: "1" },
    { from: row.to },
  ])
    await assert.rejects(c.match({ ...reviewed, ...change }, tx, rpc, tx.blockNumber));
  const rewrite = (_contexts, _modes, _calls) => ({
    ...tx,
    input: iface.encodeFunctionData("redeemDelegations", [_contexts, _modes, _calls]),
  });
  await assert.rejects(
    c.match(
      reviewed,
      rewrite(
        decoded.permissionContexts,
        [`0x00${"01"}${"00".repeat(30)}`],
        decoded.executionCallDatas
      ),
      rpc,
      tx.blockNumber
    ),
    /reverting/
  );
  await assert.rejects(
    c.match(
      reviewed,
      rewrite(
        [...decoded.permissionContexts, ...decoded.permissionContexts],
        [...decoded.modes, ...decoded.modes],
        [execution, execution]
      ),
      rpc,
      tx.blockNumber
    ),
    /batches/
  );
  await assert.rejects(
    c.match(reviewed, tx, async () => "0x", tx.blockNumber),
    /runtime code/
  );
  const receipt = JSON.parse(
    readFileSync(new URL("./fixtures/failed-receipt.json", import.meta.url))
  ).result;
  const checkRpc = async (_network, _method, _args) => {
    if (_method === "eth_chainId") return tx.chainId;
    if (_method === "eth_getTransactionByHash") return tx;
    if (_method === "eth_getTransactionReceipt") return receipt;
    if (_method === "eth_getBlockByNumber") return { hash: tx.blockHash };
    if (_method === "eth_blockNumber") return tx.blockNumber;
    return rpc(_network, _method, _args);
  };
  assert.equal((await inspectReceipt(reviewed, tx.hash, checkRpc, c.match)).status, "reverted");
  assert.equal(
    (
      await inspectReceipt(
        reviewed,
        tx.hash,
        async (..._args) =>
          _args[1] === "eth_getTransactionReceipt"
            ? { ...receipt, status: "0x1" }
            : checkRpc(..._args),
        c.match
      )
    ).status,
    "confirmed"
  );
});

test("independent Safe approvals can be sent while earlier approvals are pending or reverted", async () => {
  const approval = (_i) => ({
    ...row,
    id: `approval-${_i}`,
    tag: "approve_acceptance",
    to: `0x${String(_i + 1).padStart(40, "0")}`,
    data: `0xd4d9bdcd${"42".repeat(32)}`,
  });
  const rows = [
    approval(0),
    approval(1),
    approval(2),
    { ...row, id: "execute", tag: "accept_ownership" },
  ];
  const journal = { [rows[0].id]: { status: "pending", hash: HASH } };
  const plan = dependencyPlan(rows, 2);
  assert.deepEqual(plan.indices, []);
  assert.deepEqual(plan.group, [0, 1, 2]);
  const w = wallet();
  await sendOne({
    ...w,
    row: rows[2],
    beforeSend: () =>
      verifyDependencies(
        rows,
        plan.indices,
        journal,
        async () => {
          throw new Error("No dependency RPC required");
        },
        w.save
      ),
  });
  assert.equal(w.journal[rows[2].id].status, "pending");
  assert.equal(w.calls.filter((_call) => _call.method === "eth_sendTransaction").length, 1);
  assert.equal(
    w.calls.find((_call) => _call.method === "eth_sendTransaction").params[0].to,
    rows[2].to
  );
  const dependent = dependencyPlan(rows, 3);
  assert.deepEqual(dependent.indices, [0, 1, 2]);
  await assert.rejects(
    verifyDependencies(
      rows,
      [dependent.indices[0]],
      journal,
      receiptRpc(rows[0], { eth_getTransactionReceipt: null }),
      w.save
    ),
    /pending/
  );
  await assert.rejects(
    verifyDependencies(rows, dependent.indices, {}, receiptRpc(rows[0]), w.save),
    /required call 1/
  );
  journal[rows[0].id].status = "reverted";
  await verifyDependencies(
    rows,
    dependencyPlan(rows, 1).indices,
    journal,
    async () => {
      throw new Error("Still independent");
    },
    w.save
  );
});

test("admin groups preserve dependencies before the group and unknown calls keep source order", () => {
  const nomination = (_i) => ({
    ...row,
    id: `nominate-${_i}`,
    tag: "nominate_owner",
    to: `0x${String(_i + 1).padStart(40, "0")}`,
    data: `0xf2fde38b${"42".repeat(32)}`,
  });
  const rows = [row, nomination(0), nomination(1), { ...row, id: "later" }];
  assert.deepEqual(dependencyPlan(rows, 2).indices, [0]);
  assert.deepEqual(dependencyPlan(rows, 2).group, [1, 2]);
  assert.deepEqual(dependencyPlan(rows, 3).indices, [0, 1, 2]);
  assert.deepEqual(dependencyPlan(rows, 3, true).indices, []);
  // A repeated target could overwrite an earlier nomination; mismatched calldata and
  // value also prevent an unknown operation from being classified as independent.
  for (const change of [
    { to: rows[1].to },
    { data: "0x12345678" },
    { valueWei: "1" },
    { chainId: 312 },
    { tag: "unknown" },
  ]) {
    assert.deepEqual(dependencyPlan([row, rows[1], { ...rows[2], ...change }], 2).indices, [0, 1]);
  }
  for (const tag of ["grant_puh_admin", "renounce_eoa_admin"]) {
    const selector = tag === "grant_puh_admin" ? "0x2f2ff15d" : "0x36568abe";
    const grants = [0, 1].map((_i) => ({
      ...row,
      tag,
      data: `${selector}${String(_i).padStart(64, "0")}${"42".repeat(32)}`,
    }));
    assert.deepEqual(dependencyPlan([row, ...grants], 2).indices, [0]);
  }
});

test("marking a call independent cannot bypass its existing pending request", async () => {
  const w = wallet();
  w.journal[row.id] = { status: "pending", hash: HASH };
  await assert.rejects(
    sendOne({
      ...w,
      row,
      beforeSend: async () => {
        await verifyDependencies(
          [row],
          dependencyPlan([row], 0, true).indices,
          {},
          receiptRpc(),
          w.save
        );
      },
    }),
    /pending or confirmed attempt/
  );
  assert.equal(w.calls.length, 0);
});

test("preflight reads through the configured RPC and keeps wallet requests separate", async () => {
  const w = wallet({
    eth_call: () => {
      throw new Error("Do not simulate through MetaMask");
    },
    eth_estimateGas: () => {
      throw new Error("Do not estimate through MetaMask");
    },
  });
  const reads = wallet();
  const progress = [];
  await sendOne({
    ...w,
    row,
    readProvider: reads.provider,
    progress: (_message) => progress.push(_message),
    beforeSend: async () => {},
  });
  assert.ok(reads.calls.some((_call) => _call.method === "eth_estimateGas"));
  assert.ok(
    !w.calls.some((_call) => ["eth_call", "eth_estimateGas", "eth_gasPrice"].includes(_call.method))
  );
  assert.ok(!reads.calls.some((_call) => _call.method === "eth_sendTransaction"));
  assert.equal(w.journal[row.id].status, "pending");
  assert.equal(progress.length, 2);
  await assert.rejects(
    preflight(w.provider, row, wallet({ eth_chainId: "0x1" }).provider),
    /Simulation RPC is on the wrong chain/
  );
});

test("stalled wallet reads time out without making a submission retryable", async () => {
  await assert.rejects(
    walletRead({ request: () => new Promise(() => {}) }, { method: "eth_chainId" }, 5),
    /did not respond/
  );
  await assert.rejects(
    walletRead({ request: async () => HASH }, { method: "eth_sendTransaction" }, 5),
    /not permitted/
  );
});

test("receipt verification uses bounded concurrency and reports progress", async () => {
  const rows = Array.from({ length: 8 }, (_unused, _i) => ({ ...row, id: `required-${_i}` }));
  const journal = Object.fromEntries(rows.map((_row) => [_row.id, { hash: HASH }]));
  const checked = [];
  const progress = [];
  let active = 0;
  let maximum = 0;
  await verifyDependencies(
    rows,
    rows.map((_row, _i) => _i),
    journal,
    receiptRpc(),
    (_id, _entry) => checked.push([_id, _entry.status]),
    async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((_resolve) => setTimeout(_resolve, 5));
      active--;
    },
    (_message) => progress.push(_message)
  );
  assert.equal(maximum, 4);
  assert.equal(checked.length, rows.length);
  assert.ok(checked.every(([_id, _status]) => _status === "confirmed"));
  assert.match(progress.at(-1), /Verified 8\/8/);
});

test("imported governor calldata determines the action and proposal regardless of source tags", () => {
  for (const candidate of voteRows(vote, c).filter((_row) => _row.tag !== "delegate")) {
    const decoded = governorAction({ ...candidate, tag: "arbitrary source label" }, c);
    assert.equal(decoded.method, candidate.tag);
    assert.equal(BigInt(decoded.proposalId), BigInt(vote.proposalId));
  }
  const candidate = voteRows(vote, c)[2];
  assert.equal(governorAction({ ...candidate, to: ADDRESSES.token }, c), null);
  assert.equal(governorAction({ ...candidate, network: "sepolia" }, c), null);
  assert.throws(
    () => governorAction({ ...candidate, data: `${candidate.data}00` }, c),
    /canonical/
  );
});

function governorReads(_changes = {}) {
  const calls = [];
  const values = {
    proposalSnapshot: "100",
    clock: "100",
    CLOCK_MODE: "mode=timestamp",
    state: 0,
    proposalDeadline: "1000",
    hasVoted: false,
    proposalEta: "0",
    token: ADDRESSES.token,
    proposalThreshold: "10",
    getPastVotes: "11",
    ..._changes,
  };
  const at = {
    ...c,
    read: async (_rpc, _network, _abi, _address, _method, _args, _block) => {
      calls.push({ method: _method, args: _args, block: _block });
      assert.equal(_block, "0x42");
      return [values[_method]];
    },
  };
  const rpc = async (_network, _method, _args) => {
    assert.equal(_method, "eth_getBlockByNumber");
    assert.deepEqual(_args, ["latest", false]);
    return { number: "0x42", timestamp: "0x66" };
  };
  return { at, rpc, calls };
}

test("imported vote waits on the actual governor state at the snapshot boundary", async () => {
  const candidate = voteRows(vote, c)[2];
  const reads = governorReads();
  const state = await governorCallStatus(candidate, reads.rpc, reads.at);
  assert.equal(state.state, 0);
  assert.equal(state.snapshot, state.clock);
  assert.match(governorActionReason(state), /Voting has not opened/);
  assert.match(governorActionReason(state), /once the governor reports Active/);
  assert.match(governorActionReason({ ...state, clock: "9999999999" }), /not opened/);
  const w = wallet({ eth_chainId: "0x138" });
  await assert.rejects(
    sendOne({
      ...w,
      row: { ...candidate, id: "vote" },
      beforeSend: async () => {
        const fresh = await governorCallStatus(candidate, reads.rpc, reads.at);
        const reason = governorActionReason(fresh);
        if (reason) throw new Error(reason);
      },
    }),
    /Voting has not opened/
  );
  assert.equal(w.calls.length, 0);
});

test("imported governor gating covers active, already-voted, closed, unproposed and failed proposals", async () => {
  const candidate = voteRows(vote, c)[2];
  const active = governorReads({ state: 1, clock: "101" });
  const state = await governorCallStatus(candidate, active.rpc, active.at);
  assert.equal(governorActionReason(state), "");
  assert.match(governorActionReason({ ...state, hasVoted: true }), /already voted/);
  for (const code of [2, 3, 4, 5, 6, 7])
    assert.match(governorActionReason({ ...state, state: code }), /closed or unavailable/);
  const absent = governorReads({ proposalSnapshot: "0" });
  assert.match(
    governorActionReason(await governorCallStatus(candidate, absent.rpc, absent.at)),
    /not on chain yet/
  );
  assert.ok(!absent.calls.some((_call) => _call.method === "state"));
  const proposal = voteRows(vote, c)[1];
  const unproposed = await governorCallStatus(proposal, absent.rpc, absent.at);
  assert.equal(governorActionReason(unproposed), "");
  assert.deepEqual(absent.calls.find((_call) => _call.method === "getPastVotes").args, [
    proposal.from,
    "99",
  ]);
  assert.match(governorActionReason({ ...unproposed, votes: "9" }), /Insufficient past/);
  assert.match(governorActionReason({ ...unproposed, state: 0 }), /already exists/);
});

test("imported queue and execute enforce successful voting and the timestamp timelock", async () => {
  const rows = voteRows(vote, c);
  const queued = governorReads({ state: 5, clock: "99999", proposalEta: "103" });
  const state = await governorCallStatus(rows[4], queued.rpc, queued.at);
  assert.equal(state.blockTimestamp, "102");
  assert.match(governorActionReason(state), /timelock is not ready/);
  assert.equal(governorActionReason({ ...state, blockTimestamp: "103" }), "");
  assert.match(governorActionReason({ ...state, state: 7 }), /requires Queued/);
  const succeeded = governorReads({ state: 4 });
  const queue = await governorCallStatus(rows[3], succeeded.rpc, succeeded.at);
  assert.equal(governorActionReason(queue), "");
  assert.match(governorActionReason({ ...queue, state: 1 }), /requires Succeeded/);
});
