import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CHAINS, ADDRESSES, STORAGE } from "./tx-sim-config.mjs";
import { contracts, makeVote, voteRows } from "./tx-sim-contracts.mjs";
import { sha256, identifyRows } from "./tx-sim-core.mjs";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const ethers = require("ethers");
const abis = JSON.parse(readFileSync(new URL("./tx-sim-abis.json", import.meta.url)));
const c = contracts(abis, ethers);

// Isolate DOM and wallet/RPC boundaries: exercise the actual UI's retry button
// without a wallet, live chain, browser automation or financial submission.
for (const protocol of ["file:", "http:"])
  test(`ended proposal opens an automatic retry over ${protocol} without a wallet request`, async () => {
    const vote = makeVote(
      {
        calls: [{ target: ADDRESSES.token, value: "0", data: "0x12345678" }],
        executor: ADDRESSES.puh,
        salt: `0x${"ab".repeat(32)}`,
      },
      "Reviewed upgrade",
      c
    );
    const row = voteRows(vote, c)[1];
    const raw = JSON.stringify([
      {
        network: row.network,
        from: row.from,
        to: row.to,
        value: "0",
        data: row.data,
        tag: "v33_propose",
      },
    ]);
    const snapshot = {
      repo: "matter-labs/transaction-simulator",
      number: 386,
      commit: "a".repeat(40),
      pinnedAt: "2026-10-21T17:00:00Z",
      stages: [
        {
          path: "l2-transactions/upgrade.json",
          title: "Upgrade",
          gate: "Reviewed prerequisites",
          raw,
          sha256: await sha256(raw),
        },
        {
          path: "l2-transactions/admin.json",
          title: "Administration",
          gate: "Reviewed",
          raw: JSON.stringify([
            {
              network: "zksync-testnet3",
              from: ADDRESSES.control,
              to: ADDRESSES.token,
              value: "0",
              data: "0x12345678",
            },
          ]),
          sha256: await sha256(
            JSON.stringify([
              {
                network: "zksync-testnet3",
                from: ADDRESSES.control,
                to: ADDRESSES.token,
                value: "0",
                data: "0x12345678",
              },
            ])
          ),
        },
      ],
    };
    const dom = new JSDOM(readFileSync(new URL("./tx-sim.html", import.meta.url), "utf8"), {
      url:
        protocol === "file:" ? "file:///review/tx-sim.html" : "http://127.0.0.1:8765/tx-sim.html",
    });
    const storage = new Map();
    Object.defineProperty(dom.window, "localStorage", {
      value: {
        getItem: (_key) => storage.get(_key) ?? null,
        setItem: (_key, _value) => storage.set(_key, _value),
        removeItem: (_key) => storage.delete(_key),
      },
    });
    dom.window.ethers = ethers;
    dom.window.__TX_SIM_BOOTSTRAP__ = { snapshot, abis };
    const walletRequests = [];
    dom.window.__TX_SIM_WALLET__ = {
      restore: async () => null,
      connect: async () => {
        walletRequests.push("connect");
        throw Error("No wallet in this test");
      },
    };
    const saved = Object.fromEntries(
      [
        "window",
        "document",
        "Node",
        "Event",
        "localStorage",
        "navigator",
        "fetch",
        "setInterval",
      ].map((_key) => [_key, Object.getOwnPropertyDescriptor(globalThis, _key)])
    );
    const oldReceipt = { status: "confirmed", hash: `0x${"cd".repeat(32)}` };
    dom.window.localStorage.setItem(STORAGE.journal, JSON.stringify({ oldProposal: oldReceipt }));
    const values = {
      timelock: ADDRESSES.timelock,
      token: ADDRESSES.token,
      clock: "1100",
      CLOCK_MODE: "mode=timestamp",
      proposalThreshold: "10",
      getVotes: "100",
      getPastVotes: "100",
      state: 3,
      hasVoted: false,
      proposalDeadline: "1000",
      proposalEta: "0",
      upgradeState: 0,
      proposalVotes: ["0", "0", "0"],
    };
    let proposedRetry = false;
    const response = (_result) => ({ ok: true, json: async () => ({ result: _result }) });
    try {
      for (const [_key, _value] of Object.entries({
        window: dom.window,
        document: dom.window.document,
        Node: dom.window.Node,
        Event: dom.window.Event,
        localStorage: dom.window.localStorage,
        navigator: dom.window.navigator,
        setInterval: () => 0,
      }))
        Object.defineProperty(globalThis, _key, {
          value: _value,
          configurable: true,
          writable: true,
        });
      globalThis.fetch = async (_url, _options) => {
        const body = JSON.parse(_options.body);
        if (body.method === "eth_chainId")
          return response(
            `0x${Object.values(CHAINS)
              .find((_chain) => _chain.rpc === _url)
              .id.toString(16)}`
          );
        if (body.method === "eth_getBlockByNumber")
          return response({ number: "0x42", timestamp: "0x44c" });
        if (["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(body.method))
          return response(null);
        assert.equal(body.method, "eth_call");
        const call = body.params[0];
        const iface =
          call.to === ADDRESSES.token
            ? c.interfaces.Testnet3ZkTokenV3
            : call.to === ADDRESSES.puh
              ? c.interfaces.ProtocolUpgradeHandlerV31
              : c.interfaces.Testnet3Governor;
        const decoded = iface.parseTransaction({ data: call.data });
        let value = values[decoded.name];
        if (decoded.name === "proposalSnapshot")
          value =
            BigInt(decoded.args[0].toString()) === BigInt(vote.proposalId)
              ? "100"
              : proposedRetry
                ? "1200"
                : "0";
        if (decoded.name === "hashProposal")
          value = c.utils.keccak256(
            c.utils.defaultAbiCoder.encode(
              ["address[]", "uint256[]", "bytes[]", "bytes32"],
              decoded.args
            )
          );
        assert.notEqual(value, undefined, decoded.name);
        return response(
          iface.encodeFunctionResult(decoded.name, Array.isArray(value) ? value : [value])
        );
      };
      await import(`./tx-sim-ui.mjs?ui-test=${Date.now()}`);
      const waitFor = async (_predicate) => {
        const until = Date.now() + 3000;
        while (!_predicate()) {
          assert.ok(Date.now() < until, dom.window.document.body.textContent);
          await new Promise((_resolve) => setTimeout(_resolve, 5));
        }
      };
      const retryButton = () =>
        [...document.querySelectorAll("button")].find(
          (_button) => _button.textContent === "Prepare voting retry"
        );
      await waitFor(() => retryButton() && !retryButton().disabled);
      retryButton().click();
      await waitFor(() =>
        document.getElementById("notice").textContent.startsWith("Retry prepared")
      );
      assert.equal(document.getElementById("normal-view").hidden, false);
      assert.deepEqual(JSON.parse(document.getElementById("payload").value), vote.payload);
      assert.match(
        document.getElementById("description").value,
        /Reviewed upgrade\n\nVoting retry:/
      );
      const stored = JSON.parse(dom.window.localStorage.getItem(STORAGE.vote));
      assert.equal(stored.retryInfo.retryOf, vote.proposalId);
      assert.notEqual(stored.retryInfo.proposalId, vote.proposalId);
      assert.equal(stored.retryInfo.upgradeId, vote.upgradeId);
      assert.equal(stored.retryInfo.message, vote.message);
      assert.match(document.getElementById("vote-status").textContent, /Not proposed/);
      assert.match(
        document.getElementById("vote-status").textContent,
        /Only the L2 description changed/
      );
      assert.ok(
        [...document.querySelectorAll("#normal-transaction button")].find(
          (_button) =>
            _button.textContent === (protocol === "file:" ? "Send to wallet" : "Send to MetaMask")
        ).disabled
      );
      assert.deepEqual(
        JSON.parse(dom.window.localStorage.getItem(STORAGE.journal)).oldProposal,
        oldReceipt
      );
      assert.deepEqual(walletRequests, []);
      const retry = makeVote(stored.input, stored.description, c);
      const rows = await identifyRows(voteRows(retry, c), `normal:${retry.proposalId}`);
      const receipts = JSON.parse(localStorage.getItem(STORAGE.journal));
      receipts[rows[0].id] = oldReceipt;
      receipts[rows[1].id] = oldReceipt;
      localStorage.setItem(STORAGE.journal, JSON.stringify(receipts));
      window.dispatchEvent(new window.StorageEvent("storage", { key: STORAGE.journal }));
      proposedRetry = true;
      values.state = 0;
      values.proposalDeadline = "1500";
      [...document.querySelectorAll("#vote-status button")]
        .find((_button) => _button.textContent === "Refresh governance state")
        .click();
      await waitFor(() =>
        document.getElementById("vote-status").textContent.includes("Initial deadline")
      );
      const steps = [...document.querySelectorAll("#vote-actions .call-button")];
      assert.equal(steps[0].querySelector(".step-state").textContent, "Completed");
      assert.equal(steps[1].querySelector(".step-state").textContent, "Completed");
      assert.equal(steps[2].querySelector(".step-state").textContent, "Waiting for voting to open");
      await waitFor(() => !document.querySelectorAll("#vote-actions .call-button")[2].disabled);
      document.querySelectorAll("#vote-actions .call-button")[2].click();
      assert.match(document.getElementById("normal-transaction").textContent, /0x56781388/);
      assert.ok(
        [...document.querySelectorAll("#normal-transaction button")].find(
          (_button) =>
            _button.textContent === (protocol === "file:" ? "Send to wallet" : "Send to MetaMask")
        ).disabled
      );
      assert.deepEqual(
        [...document.querySelectorAll("nav[aria-label='Governance navigation'] a")].map(
          (_link) => _link.textContent
        ),
        ["Overview", "Upgrades", "Chain upgrade", "Emergency", "Freeze", "Veto", "Tx-sim"]
      );
      assert.equal(document.getElementById("normal-tab"), null);
      assert.equal(document.getElementById("bundle-tab"), null);
      const currentId = stored.retryInfo.proposalId;
      [...document.querySelectorAll("#bundles .bundle-button")]
        .find((_button) => _button.textContent.startsWith("Administration"))
        .click();
      assert.equal(document.getElementById("bundle-view").hidden, false);
      assert.equal(document.getElementById("normal-view").hidden, true);
      const workflow = document.getElementById("upgrade-workflow");
      assert.equal(document.querySelectorAll("#bundles .bundle-button").length, 2);
      assert.match(
        document.getElementById("attempt-history").textContent,
        new RegExp(BigInt(vote.proposalId).toString())
      );
      assert.equal(document.querySelectorAll("#attempt-history button").length, 0);
      workflow.click();
      assert.equal(document.getElementById("normal-view").hidden, false);
      assert.equal(JSON.parse(localStorage.getItem(STORAGE.vote)).retryInfo.proposalId, currentId);
      values.state = 1;
      values.hasVoted = true;
      values.proposalDeadline = "1600";
      [...document.querySelectorAll("#vote-status button")]
        .find((_button) => _button.textContent === "Refresh governance state")
        .click();
      await waitFor(() =>
        document.getElementById("vote-status").textContent.includes("Your vote is recorded")
      );
      await waitFor(() => !document.querySelectorAll("#vote-actions .call-button")[3].disabled);
      const queue = document.querySelectorAll("#vote-actions .call-button")[3];
      assert.equal(queue.querySelector(".step-state").textContent, "Waiting for voting to close");
      queue.click();
      assert.match(
        document.getElementById("normal-transaction").textContent,
        /Queue requires Succeeded/
      );
      assert.match(document.getElementById("normal-transaction").textContent, /Voting deadline:/);
      assert.ok(
        [...document.querySelectorAll("#normal-transaction button")].find(
          (_button) =>
            _button.textContent === (protocol === "file:" ? "Send to wallet" : "Send to MetaMask")
        ).disabled
      );
      values.state = 4;
      [...document.querySelectorAll("#vote-status button")]
        .find((_button) => _button.textContent === "Refresh governance state")
        .click();
      await waitFor(() => document.getElementById("vote-status").textContent.includes("Succeeded"));
      assert.equal(
        [...document.querySelectorAll("#workflow-actions button")].some(
          (_button) => _button.textContent === "Prepare voting retry"
        ),
        false
      );
      assert.match(document.getElementById("upgrade-workflow").textContent, /Succeeded/);
      assert.equal(document.querySelectorAll("#bundles .bundle-button").length, 2);
      const executedReceipts = JSON.parse(localStorage.getItem(STORAGE.journal));
      executedReceipts[rows.find((_row) => _row.tag === "execute").id] = oldReceipt;
      localStorage.setItem(STORAGE.journal, JSON.stringify(executedReceipts));
      window.dispatchEvent(new window.StorageEvent("storage", { key: STORAGE.journal }));
      // Finish step 5 while viewing it: advance to a real step-6 detail panel.
      document.querySelectorAll("#vote-actions .call-button")[4].click();
      values.state = 7;
      [...document.querySelectorAll("#vote-status button")]
        .find((_button) => _button.textContent === "Refresh governance state")
        .click();
      await waitFor(() => document.getElementById("vote-status").textContent.includes("Executed"));
      await waitFor(() => !document.querySelectorAll("#vote-actions .call-button")[5].disabled);
      const proofPanel = document.getElementById("proof-panel");
      assert.equal(proofPanel.hidden, false);
      assert.equal(proofPanel.open, true);
      assert.equal(document.getElementById("normal-transaction").hidden, true);
      assert.equal(document.getElementById("execution-hash").value, oldReceipt.hash);
      assert.ok(proofPanel.closest(".transaction-detail"));
      assert.ok(
        document.querySelectorAll("#vote-actions .call-button")[5].classList.contains("active")
      );
      // Reviewing an earlier completed call and returning must restore relay controls.
      document.querySelectorAll("#vote-actions .call-button")[4].click();
      assert.equal(proofPanel.hidden, true);
      document.querySelectorAll("#vote-actions .call-button")[5].click();
      assert.equal(proofPanel.hidden, false);
      assert.equal(document.getElementById("normal-transaction").hidden, true);
      document.getElementById("load-proof").click();
      await waitFor(() =>
        document.getElementById("notice").textContent.includes("must be confirmed first")
      );
      assert.equal(proofPanel.hidden, false);
      assert.deepEqual(walletRequests, []);
    } finally {
      dom.window.close();
      for (const [_key, _descriptor] of Object.entries(saved)) {
        if (_descriptor) Object.defineProperty(globalThis, _key, _descriptor);
        else delete globalThis[_key];
      }
    }
  });

test("another PR opens its own execution plan without restoring Testnet 3 voting", async () => {
  const raw = JSON.stringify([
    {
      network: "sepolia",
      from: ADDRESSES.control,
      to: ADDRESSES.token,
      value: "0",
      data: "0x12345678",
    },
  ]);
  const dom = new JSDOM(readFileSync(new URL("./tx-sim.html", import.meta.url), "utf8"), {
    url: "http://127.0.0.1:8765/tx-sim.html",
  });
  dom.window.ethers = ethers;
  dom.window.localStorage.setItem(
    STORAGE.vote,
    JSON.stringify({ description: "An unrelated saved Testnet 3 vote" })
  );
  dom.window.__TX_SIM_BOOTSTRAP__ = {
    abis,
    snapshot: {
      repo: "matter-labs/transaction-simulator",
      number: 387,
      commit: "b".repeat(40),
      pinnedAt: "2026-10-22T09:00:00Z",
      label: "ERA STAGE · EraBender",
      executionPlan: {},
      stages: [
        {
          title: "ERA upgrade",
          path: "prepared.json",
          sourceUrl: "https://github.com/matter-labs/era-contracts/blob/pinned/runbook.json",
          raw,
          sha256: await sha256(raw),
        },
      ],
    },
  };
  dom.window.__TX_SIM_WALLET__ = { restore: async () => null };
  const currentSnapshot = structuredClone(dom.window.__TX_SIM_BOOTSTRAP__.snapshot);
  dom.window.__TX_SIM_BOOTSTRAP__.snapshot.number = 386;
  dom.window.__TX_SIM_BOOTSTRAP__.prepared = {
    payload: "unrelated embedded retry must not be restored",
  };
  const values = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Event: dom.window.Event,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    setInterval: () => 0,
    fetch: async (url) => {
      assert.equal(url, "./tx-sim-package.json");
      return { ok: true, json: async () => currentSnapshot };
    },
  };
  const saved = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  );
  try {
    for (const [k, v] of Object.entries(values))
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    await import(`./tx-sim-ui.mjs?era=${Date.now()}`);
    for (
      let i = 0;
      i < 100 && !document.getElementById("source-title").textContent.includes("#387");
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert.match(document.getElementById("source-title").textContent, /#387/);
    assert.equal(document.getElementById("bundle-view").hidden, false);
    assert.equal(document.getElementById("normal-view").hidden, true);
    assert.equal(
      document.getElementById("pr-link").href,
      "https://github.com/matter-labs/transaction-simulator/pull/387"
    );
    assert.match(document.title, /EraBender/);
    assert.equal(document.querySelectorAll("nav a:not([aria-current]):not([hidden])").length, 0);
    assert.match(document.getElementById("bundle-summary").textContent, /ERA upgrade/);
    assert.equal(document.getElementById("notice").hidden, true);
    assert.equal(
      JSON.parse(localStorage.getItem(STORAGE.vote)).description,
      "An unrelated saved Testnet 3 vote"
    );
    const fetched = [];
    const next = structuredClone(currentSnapshot);
    next.number = 388;
    next.commit = "c".repeat(40);
    next.label = "Next reviewed upgrade";
    next.stages[0].title = "Next transaction file";
    globalThis.fetch = async (url, options) => {
      fetched.push(url);
      assert.equal(options.headers["X-TxSim-Request"], "1");
      return { ok: true, json: async () => next };
    };
    document.getElementById("pr-input").value =
      "https://github.com/matter-labs/transaction-simulator/pull/388";
    document.getElementById("load-pr").click();
    for (
      let i = 0;
      i < 100 && !document.getElementById("notice").textContent.includes("Loaded PR #388");
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(fetched, ["./api/pr/388"]);
    assert.match(document.getElementById("source-title").textContent, /#388/);
    assert.match(document.getElementById("bundle-summary").textContent, /Next transaction file/);
    assert.equal(document.getElementById("normal-view").hidden, true);
    assert.match(document.title, /Next reviewed upgrade/);
    assert.equal(
      JSON.parse(localStorage.getItem(STORAGE.vote)).description,
      "An unrelated saved Testnet 3 vote"
    );
    document.getElementById("pr-input").value = "https://attacker.example/pull/389";
    document.getElementById("load-pr").click();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(fetched.length, 1);
    assert.match(document.getElementById("source-title").textContent, /#388/);
    assert.match(
      document.getElementById("notice").textContent,
      /valid|Enter a transaction-simulator/
    );
  } finally {
    dom.window.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  }
});
