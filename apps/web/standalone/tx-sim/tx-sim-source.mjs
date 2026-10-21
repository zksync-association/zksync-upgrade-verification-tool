import { ADDRESSES, CHAINS, GOVERNOR_RETRY_STATES, UPGRADE_TUPLE } from "./tx-sim-config.mjs";
import { parseTransactions, requireThat, same, sha256 } from "./tx-sim-core.mjs";
import { makeVote } from "./tx-sim-contracts.mjs";

export const canRepropose = (_state) => GOVERNOR_RETRY_STATES.includes(_state);

// The PR supplies the complete call payload. A retry changes only the governor
// description: its L1 message and upgrade ID must stay byte-identical.
export function proposalFromCall(_row, _c) {
  if (_row.chainId !== CHAINS["zksync-testnet3"].id || !same(_row.to, ADDRESSES.governor))
    return null;
  const governor = _c.interfaces.Testnet3Governor;
  if (!same(_row.data.slice(0, 10), governor.getSighash("propose"))) return null;
  requireThat(_row.valueWei === "0", "A prepared governor proposal must send zero ETH.");
  const args = governor.decodeFunctionData("propose", _row.data);
  requireThat(
    same(governor.encodeFunctionData("propose", args), _row.data),
    "Noncanonical proposal calldata."
  );
  requireThat(
    args[0].length === 1 &&
      args[1].length === 1 &&
      args[2].length === 1 &&
      same(args[0][0], ADDRESSES.messenger) &&
      BigInt(args[1][0].toString()) === 0n,
    "The normal upgrade proposal must contain one zero-value L1 messenger call."
  );
  const messenger = _c.interfaces.IL1Messenger;
  const [message] = messenger.decodeFunctionData("sendToL1", args[2][0]);
  requireThat(
    same(messenger.encodeFunctionData("sendToL1", [message]), args[2][0]),
    "Noncanonical messenger calldata."
  );
  const [payload] = _c.utils.defaultAbiCoder.decode([UPGRADE_TUPLE], message);
  const vote = makeVote(
    {
      calls: payload.calls.map((_call) => ({
        target: _call.target,
        value: _call.value.toString(),
        data: _call.data,
      })),
      executor: payload.executor,
      salt: payload.salt,
    },
    args[3],
    _c
  );
  requireThat(same(vote.message, message), "Decoded proposal changes the exact L1 message.");
  requireThat(
    !same(vote.payload.executor, ADDRESSES.board),
    "The imported proposal uses the superseded Board route."
  );
  return vote;
}

export async function preparedProposals(_snapshot, _c) {
  requireThat(/^[0-9a-f]{40}$/.test(_snapshot.commit), "Snapshot must pin a Git commit.");
  const proposals = new Map();
  for (const source of _snapshot.stages) {
    requireThat(
      (await sha256(source.raw)) === source.sha256,
      `Source hash differs for ${source.path}.`
    );
    for (const row of parseTransactions(source.raw).rows) {
      const vote = proposalFromCall(row, _c);
      if (vote) proposals.set(vote.proposalId, { ...vote, source: source.path, from: row.from });
    }
  }
  return [...proposals.values()];
}

export function votingRetry(_original, _description, _c) {
  requireThat(
    _description !== _original.description,
    "A voting retry needs a new description to create a new L2 proposal ID."
  );
  const retry = makeVote(_original.payload, _description, _c);
  requireThat(
    !same(retry.proposalId, _original.proposalId),
    "The retry proposal ID did not change."
  );
  requireThat(
    same(retry.message, _original.message) && same(retry.upgradeId, _original.upgradeId),
    "The voting retry changed the reviewed L1 upgrade payload."
  );
  return {
    ...retry,
    retryOf: _original.proposalId,
    originalDescription: _original.description,
    source: _original.source,
    from: _original.from,
  };
}
