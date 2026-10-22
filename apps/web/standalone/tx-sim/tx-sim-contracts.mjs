import {
  ADDRESSES,
  CHAINS,
  UPGRADE_TUPLE,
  METAMASK,
  WALLET_ABIS,
  GOVERNOR_STATES,
} from "./tx-sim-config.mjs";
import {
  requireThat,
  uint,
  same,
  parseTransactions,
  inspectReceipt,
  assertMatches,
} from "./tx-sim-core.mjs";

export function contracts(_abis, _ethers) {
  const interfaces = Object.fromEntries(
    Object.entries(_abis).map(([_name, _abi]) => [_name, new _ethers.utils.Interface(_abi)])
  );
  return {
    interfaces,
    utils: _ethers.utils,
    match: (_row, _tx, _rpc, _block) =>
      matchWalletTransaction(_row, _tx, _rpc, _block, _ethers.utils),
    async read(_rpc, _network, _name, _address, _method, _args = [], _block = "latest") {
      const iface = interfaces[_name];
      const data = iface.encodeFunctionData(_method, _args);
      const output = await _rpc(_network, "eth_call", [{ to: _address, data }, _block]);
      return iface.decodeFunctionResult(_method, output);
    },
    encode(_name, _method, _args) {
      return interfaces[_name].encodeFunctionData(_method, _args);
    },
  };
}
export async function matchWalletTransaction(_row, _tx, _rpc, _block, _utils) {
  if (same(_tx.to, _row.to)) return assertMatches(_row, _tx);
  requireThat(
    _row.chainId === METAMASK.chainId &&
      same(_tx.from, _row.from) &&
      same(_tx.to, METAMASK.manager) &&
      BigInt(_tx.value) === 0n,
    "Transaction differs from the reviewed call and is not a supported MetaMask wrapper."
  );
  const iface = new _utils.Interface(WALLET_ABIS.manager);
  const decoded = iface.decodeFunctionData("redeemDelegations", _tx.input ?? _tx.data);
  requireThat(
    decoded.permissionContexts.length === 1 &&
      decoded.modes.length === 1 &&
      decoded.executionCallDatas.length === 1 &&
      same(decoded.modes[0], METAMASK.singleRevertingMode),
    "Only one reverting MetaMask call is supported; batches and try-execution cannot verify this receipt."
  );
  const delegations = _utils.defaultAbiCoder.decode(
    [WALLET_ABIS.delegations],
    decoded.permissionContexts[0]
  )[0];
  requireThat(
    delegations.length === 1 &&
      same(delegations[0].delegate, _row.from) &&
      same(delegations[0].delegator, _row.from) &&
      same(delegations[0].authority, METAMASK.rootAuthority),
    "MetaMask wrapper must execute through the reviewed sender's self-delegation."
  );
  requireThat(
    delegations[0].caveats.every((_caveat) => same(_caveat.enforcer, METAMASK.balanceEnforcer)),
    "MetaMask wrapper contains an unsupported caveat enforcer."
  );
  const [manager, implementation, sender, enforcer] = await Promise.all(
    [METAMASK.manager, METAMASK.implementation, _row.from, METAMASK.balanceEnforcer].map(
      (_address) => _rpc(_row.network, "eth_getCode", [_address, _block])
    )
  );
  requireThat(
    same(_utils.keccak256(manager), METAMASK.managerCodeHash) &&
      same(_utils.keccak256(implementation), METAMASK.implementationCodeHash) &&
      same(sender, `0xef0100${METAMASK.implementation.slice(2)}`) &&
      same(_utils.keccak256(enforcer), METAMASK.balanceEnforcerCodeHash),
    "MetaMask wrapper runtime code differs from the supported deployment."
  );
  const execution = decoded.executionCallDatas[0];
  requireThat(_utils.hexDataLength(execution) >= 52, "Malformed MetaMask execution.");
  assertMatches(_row, {
    ..._tx,
    to: _utils.hexDataSlice(execution, 0, 20),
    value: _utils.hexDataSlice(execution, 20, 52),
    input: _utils.hexDataSlice(execution, 52),
  });
}
export function makeVote(_input, _description, _c) {
  requireThat(
    _input && Array.isArray(_input.calls) && _input.calls.length > 0,
    "Payload needs calls[]."
  );
  requireThat(
    /^0x[0-9a-fA-F]{40}$/.test(_input.executor),
    "Payload executor must be an explicit address."
  );
  requireThat(/^0x[0-9a-fA-F]{64}$/.test(_input.salt), "Payload salt must be 32-byte hex.");
  requireThat(
    typeof _description === "string" && _description.trim().length > 0,
    "Enter the proposal description."
  );
  const payload = {
    calls: _input.calls.map((_call) => {
      requireThat(
        /^0x[0-9a-fA-F]{40}$/.test(_call.target) && /^0x(?:[0-9a-fA-F]{2})*$/.test(_call.data),
        "Every call needs an address target and hex data."
      );
      return {
        target: _call.target,
        value: uint(_call.value, "Inner call value (wei)").toString(),
        data: _call.data,
      };
    }),
    executor: _input.executor,
    salt: _input.salt,
  };
  const message = _c.utils.defaultAbiCoder.encode([UPGRADE_TUPLE], [payload]);
  const targets = [ADDRESSES.messenger];
  const values = ["0"];
  const calldatas = [_c.encode("IL1Messenger", "sendToL1", [message])];
  const descriptionHash = _c.utils.id(_description);
  const proposalId = _c.utils.keccak256(
    _c.utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "bytes[]", "bytes32"],
      [targets, values, calldatas, descriptionHash]
    )
  );
  return {
    payload,
    description: _description,
    message,
    targets,
    values,
    calldatas,
    descriptionHash,
    proposalId,
    upgradeId: _c.utils.keccak256(message),
  };
}
export function actionRow(
  _c,
  _method,
  _args,
  _description,
  _network = "zksync-testnet3",
  _to = ADDRESSES.governor,
  _abi = "Testnet3Governor"
) {
  return parseTransactions(
    JSON.stringify([
      {
        network: _network,
        from: ADDRESSES.control,
        to: _to,
        value: "0",
        data: _c.encode(_abi, _method, _args),
        description: _description,
        tag: _method,
      },
    ])
  ).rows[0];
}
export function voteRows(_vote, _c) {
  const args = [_vote.targets, _vote.values, _vote.calldatas, _vote.descriptionHash];
  return [
    actionRow(
      _c,
      "delegate",
      [ADDRESSES.control],
      "Delegate test ZK votes to the control EOA",
      "zksync-testnet3",
      ADDRESSES.token,
      "Testnet3ZkTokenV3"
    ),
    actionRow(
      _c,
      "propose",
      [_vote.targets, _vote.values, _vote.calldatas, _vote.description],
      "Create the L2 protocol proposal"
    ),
    actionRow(_c, "castVote", [_vote.proposalId, 1], "Vote FOR the L2 protocol proposal"),
    actionRow(_c, "queue", args, "Queue the successful L2 proposal"),
    actionRow(_c, "execute", args, "Execute on L2: timelock sends the exact upgrade message to L1"),
  ];
}
// Decode the actual imported calldata, rather than trusting its source tag. These
// checks also apply when the operator marks the call independent of earlier rows.
export function governorAction(_row, _c) {
  if (_row.network !== "zksync-testnet3" || !same(_row.to, ADDRESSES.governor)) return null;
  const iface = _c.interfaces.Testnet3Governor;
  const method = ["propose", "castVote", "queue", "execute"].find((_method) =>
    same(_row.data.slice(0, 10), iface.getSighash(_method))
  );
  if (!method) return null;
  const args = iface.decodeFunctionData(method, _row.data);
  requireThat(
    same(iface.encodeFunctionData(method, args), _row.data),
    "Governor calldata is not canonical."
  );
  const proposalId =
    method === "castVote"
      ? args[0].toString()
      : BigInt(
          _c.utils.keccak256(
            _c.utils.defaultAbiCoder.encode(
              ["address[]", "uint256[]", "bytes[]", "bytes32"],
              [args[0], args[1], args[2], method === "propose" ? _c.utils.id(args[3]) : args[3]]
            )
          )
        ).toString();
  return { method, proposalId };
}
export async function governorCallStatus(_row, _rpc, _c) {
  const action = governorAction(_row, _c);
  if (!action) return null;
  // Pin all governance reads to one block. Browser wall time must never open voting.
  const block = await _rpc(_row.network, "eth_getBlockByNumber", ["latest", false]);
  requireThat(block?.number && block.timestamp, "RPC returned no current L2 block.");
  const read = async (_method, _args = []) =>
    (
      await _c.read(_rpc, _row.network, "Testnet3Governor", _row.to, _method, _args, block.number)
    )[0];
  const [snapshot, clock, mode] = await Promise.all([
    read("proposalSnapshot", [action.proposalId]),
    read("clock"),
    read("CLOCK_MODE"),
  ]);
  const result = {
    ...action,
    snapshot: snapshot.toString(),
    clock: clock.toString(),
    mode,
    blockNumber: block.number,
    blockTimestamp: BigInt(block.timestamp).toString(),
    state: null,
    hasVoted: false,
    checkedAt: Date.now(),
  };
  if (BigInt(result.snapshot) > 0n) {
    const [state, deadline, hasVoted, eta] = await Promise.all([
      read("state", [action.proposalId]),
      read("proposalDeadline", [action.proposalId]),
      read("hasVoted", [action.proposalId, _row.from]),
      read("proposalEta", [action.proposalId]),
    ]);
    Object.assign(result, {
      state: Number(state),
      deadline: deadline.toString(),
      hasVoted,
      eta: eta.toString(),
    });
  }
  if (action.method === "propose" && result.state === null) {
    const [token, threshold] = await Promise.all([read("token"), read("proposalThreshold")]);
    requireThat(same(token, ADDRESSES.token), "Governor token differs from the pinned deployment.");
    const votes = (
      await _c.read(
        _rpc,
        _row.network,
        "Testnet3ZkTokenV3",
        token,
        "getPastVotes",
        [_row.from, (BigInt(result.clock) - 1n).toString()],
        block.number
      )
    )[0];
    Object.assign(result, { votes: votes.toString(), threshold: threshold.toString() });
  }
  return result;
}
export function governorTime(_value, _mode) {
  return new URLSearchParams(_mode).get("mode") === "timestamp"
    ? `${new Date(Number(_value) * 1000).toLocaleString(undefined, { timeZoneName: "short" })} (chain timestamp ${_value})`
    : `chain clock ${_value}`;
}
export function governorActionReason(_status) {
  const state = _status.state === null ? "Not proposed" : GOVERNOR_STATES[_status.state];
  if (_status.method === "propose") {
    if (_status.state !== null) return `Proposal already exists (${state}).`;
    return BigInt(_status.votes) < BigInt(_status.threshold)
      ? "Insufficient past delegated votes to propose."
      : "";
  }
  if (_status.state === null)
    return "This proposal is not on chain yet. Confirm the propose transaction first.";
  if (_status.method === "castVote") {
    if (_status.state === 0)
      return `Voting has not opened. Vote after ${governorTime(_status.snapshot, _status.mode)}, once the governor reports Active. Current chain clock: ${_status.clock}.`;
    if (_status.state !== 1)
      return `Voting is closed or unavailable: ${state}. Voting deadline: ${governorTime(_status.deadline, _status.mode)}.`;
    if (_status.hasVoted) return "This account has already voted on this proposal.";
    return "";
  }
  if (_status.method === "queue")
    return _status.state === 4
      ? ""
      : `Queue requires Succeeded; this proposal is ${state}. Voting deadline: ${governorTime(_status.deadline, _status.mode)}. Late quorum may extend it.`;
  if (_status.method === "execute") {
    if (_status.state !== 5) return `Execution requires Queued; this proposal is ${state}.`;
    if (BigInt(_status.blockTimestamp) < BigInt(_status.eta))
      return `The timelock is not ready. Execute at ${governorTime(_status.eta, "mode=timestamp")}.`;
  }
  return "";
}
export async function voteStatus(_vote, _rpc, _c) {
  const block = await _rpc("zksync-testnet3", "eth_getBlockByNumber", ["latest", false]);
  requireThat(block?.number && block?.timestamp, "Could not read the current L2 block.");
  const read = (_method, _args = []) =>
    _c
      .read(
        _rpc,
        "zksync-testnet3",
        "Testnet3Governor",
        ADDRESSES.governor,
        _method,
        _args,
        block.number
      )
      .then((_r) => _r[0]);
  const [timelock, token, proposalId, snapshot, clock, mode, votes, threshold] = await Promise.all([
    read("timelock"),
    read("token"),
    read("hashProposal", [_vote.targets, _vote.values, _vote.calldatas, _vote.descriptionHash]),
    read("proposalSnapshot", [_vote.proposalId]),
    read("clock"),
    read("CLOCK_MODE"),
    _c
      .read(
        _rpc,
        "zksync-testnet3",
        "Testnet3ZkTokenV3",
        ADDRESSES.token,
        "getVotes",
        [ADDRESSES.control],
        block.number
      )
      .then((_r) => _r[0]),
    read("proposalThreshold"),
  ]);
  requireThat(
    same(timelock, ADDRESSES.timelock) && same(token, ADDRESSES.token),
    "Governor token/timelock differ from the pinned deployment."
  );
  requireThat(
    BigInt(proposalId.toString()) === BigInt(_vote.proposalId),
    "Governor hashProposal differs from the locally encoded proposal."
  );
  const result = {
    snapshot: snapshot.toString(),
    clock: clock.toString(),
    mode,
    votes: votes.toString(),
    threshold: threshold.toString(),
    state: null,
    hasVoted: false,
    blockNumber: block.number,
    blockTimestamp: BigInt(block.timestamp).toString(),
  };
  if (BigInt(result.snapshot) > 0n) {
    const [state, deadline, voted, eta, totals] = await Promise.all([
      read("state", [_vote.proposalId]),
      read("proposalDeadline", [_vote.proposalId]),
      read("hasVoted", [_vote.proposalId, ADDRESSES.control]),
      read("proposalEta", [_vote.proposalId]),
      _c.read(
        _rpc,
        "zksync-testnet3",
        "Testnet3Governor",
        ADDRESSES.governor,
        "proposalVotes",
        [_vote.proposalId],
        block.number
      ),
    ]);
    Object.assign(result, {
      state: Number(state),
      deadline: deadline.toString(),
      hasVoted: voted,
      eta: eta.toString(),
      forVotes: totals[1].toString(),
    });
  } else {
    result.votes = (
      await _c.read(
        _rpc,
        "zksync-testnet3",
        "Testnet3ZkTokenV3",
        ADDRESSES.token,
        "getPastVotes",
        [ADDRESSES.control, (BigInt(result.clock) - 1n).toString()],
        block.number
      )
    )[0].toString();
  }
  return result;
}
export function allowedVoteAction(_status, _method) {
  if (_method === "delegate") return _status.state === null;
  if (_method === "propose")
    return _status.state === null && BigInt(_status.votes) >= BigInt(_status.threshold);
  if (_method === "castVote") return _status.state === 1 && !_status.hasVoted;
  if (_method === "queue") return _status.state === 4;
  if (_method === "execute")
    return _status.state === 5 && BigInt(_status.blockTimestamp) >= BigInt(_status.eta);
  return false;
}
export async function buildStart(_vote, _executeRow, _hash, _rpc, _c) {
  const checked = await inspectReceipt(_executeRow, _hash, _rpc);
  requireThat(
    checked.status === "confirmed",
    "The exact L2 execute transaction must be confirmed first."
  );
  const receipt = checked.receipt;
  const iface = _c.interfaces.IL1Messenger;
  const events = receipt.logs
    .filter(
      (_log) =>
        same(_log.address, ADDRESSES.messenger) &&
        same(_log.topics[0], iface.getEventTopic("L1MessageSent"))
    )
    .map((_log) => iface.parseLog(_log));
  const matches = events.filter(
    (_event) =>
      same(_event.args._sender, ADDRESSES.timelock) &&
      same(_event.args._message, _vote.message) &&
      same(_event.args._hash, _vote.upgradeId)
  );
  requireThat(
    matches.length === 1,
    "L2 receipt must contain the exact L1MessageSent event from the governor timelock."
  );
  const key = _c.utils.hexZeroPad(ADDRESSES.timelock, 32);
  const logs = receipt.l2ToL1Logs ?? [];
  const indices = logs
    .map((_log, _index) => ({ log: _log, index: _index }))
    .filter(
      ({ log: _log }) =>
        same(_log.sender, ADDRESSES.messenger) &&
        same(_log.key, key) &&
        same(_log.value, _vote.upgradeId)
    );
  requireThat(
    indices.length === 1,
    "Expected one matching native L2-to-L1 log in the execution receipt."
  );
  const { log, index } = indices[0];
  requireThat(
    receipt.l1BatchNumber !== undefined && receipt.l1BatchNumber !== null,
    "The L2 transaction is not assigned to a batch yet."
  );
  // l1BatchTxIndex is the batch index; Ethereum transactionIndex is the miniblock index.
  const txIndex = receipt.l1BatchTxIndex ?? log.txIndexInL1Batch;
  requireThat(
    txIndex !== undefined && txIndex !== null && BigInt(txIndex) < 2n ** 16n,
    "Missing or invalid L2 transaction number in the L1 batch."
  );
  const [sender, chain, executed] = await Promise.all([
    _c.read(_rpc, "sepolia", "ProtocolUpgradeHandlerV31", ADDRESSES.puh, "L2_PROTOCOL_GOVERNOR"),
    _c.read(_rpc, "sepolia", "ProtocolUpgradeHandlerV31", ADDRESSES.puh, "ERA_CHAIN_ID"),
    _c.read(_rpc, "sepolia", "IZkSyncHyperchain", ADDRESSES.diamond, "getTotalBatchesExecuted"),
  ]);
  requireThat(
    same(sender[0], ADDRESSES.timelock) &&
      BigInt(chain[0].toString()) === BigInt(CHAINS["zksync-testnet3"].id),
    "PUH must be configured for chain 312 and the governor timelock sender. Complete the handover first."
  );
  requireThat(
    BigInt(executed[0].toString()) >= BigInt(receipt.l1BatchNumber),
    `Waiting for L2 batch ${BigInt(receipt.l1BatchNumber)} to execute on L1. Latest executed: ${executed[0]}.`
  );
  const proof = await _rpc("zksync-testnet3", "zks_getL2ToL1LogProof", [_hash, index]);
  requireThat(
    proof &&
      Number.isSafeInteger(proof.id) &&
      proof.id >= 0 &&
      Array.isArray(proof.proof) &&
      proof.proof.every((_part) => /^0x[0-9a-fA-F]{64}$/.test(_part)),
    "The RPC has not returned a valid inclusion proof yet."
  );
  if (proof.batchNumber !== undefined)
    requireThat(
      BigInt(proof.batchNumber) === BigInt(receipt.l1BatchNumber),
      "Proof batch differs from receipt."
    );
  const message = {
    txNumberInBatch: BigInt(txIndex).toString(),
    sender: ADDRESSES.timelock,
    data: _vote.message,
  };
  const included = await _c.read(
    _rpc,
    "sepolia",
    "IZkSyncHyperchain",
    ADDRESSES.diamond,
    "proveL2MessageInclusion",
    [BigInt(receipt.l1BatchNumber).toString(), proof.id, message, proof.proof]
  );
  requireThat(included[0] === true, "L1 rejected the native message inclusion proof.");
  const row = actionRow(
    _c,
    "startUpgrade",
    [
      BigInt(receipt.l1BatchNumber).toString(),
      proof.id,
      BigInt(txIndex).toString(),
      proof.proof,
      _vote.payload,
    ],
    "Start the L2-voted upgrade on L1 using the verified inclusion proof",
    "sepolia",
    ADDRESSES.puh,
    "ProtocolUpgradeHandlerV31"
  );
  return {
    row,
    batch: BigInt(receipt.l1BatchNumber).toString(),
    proofId: proof.id,
    executionHash: _hash,
  };
}
