// Deploys the ZKsync governance contracts to Sepolia for the single file's test build
// (dist/verifier-sepolia-test.html, see README.md), then starts the test upgrades in seeds.ts.
// Resumable: whatever already has code is skipped, and so is an upgrade already started.
//
//   corepack pnpm exec tsx standalone/sepolia-test/deploy.ts
//
// SEPOLIA_RPC_URL (default: PublicNode's), MAINNET_RPC_URL (the seeds' content, read
// only; default: Tenderly's), DEPLOYER_KEY_FILE (default: .cache/sepolia-test/deployer.key),
// SAFE_OWNER. On an anvil fork the result goes to deployment.fork.json, not deployment.json.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Abi,
  type Address,
  type Hex,
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  hexToBigInt,
  http,
  isAddressEqual,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import {
  emergencyUpgradeBoardAbi,
  guardiansAbi,
  safeAbi,
  securityCouncilAbi,
  upgradeHandlerAbi,
} from "../../app/common/abis";
import { MAINNET_HANDLER, SEEDS, seedProposal } from "./seeds";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CACHE = at("../../.cache/sepolia-test");
const KEY_FILE = process.env.DEPLOYER_KEY_FILE ?? `${CACHE}/deployer.key`;
const OWNER = (process.env.SAFE_OWNER ?? "0xF378708B88841Abb63e2316E4Fc8f29469beE885") as Address;

// zk-governance at the commit of the contracts mainnet runs (the 8-member Security Council). Compiled
// as mainnet's were: SecurityCouncil and EmergencyUpgradeBoard without the optimizer, Guardians, the
// handler and its proxy with 200 runs. Their code then equals mainnet's but for immutables and
// metadata, and the handler's two periods (TestnetProtocolUpgradeHandler: no legal veto, no delay).
const ZK_GOVERNANCE = {
  repo: "https://github.com/zksync-association/zk-governance.git",
  commit: "58df93fc38a0d439c9d2dff4563779251f1c0b64",
  dir: process.env.ZK_GOVERNANCE_DIR ?? `${CACHE}/zk-governance`,
};
// ZkProtocolGovernor.timelock() on ZKsync Era Sepolia (governor 0x5a68…): the sender of the L2 → L1
// message that starts an upgrade, as the app's Sepolia L2 governors expect.
const L2_PROTOCOL_GOVERNOR: Address = "0xa0eD7885B408961430F89d797cD1cc87530D8fBe";
// Safe 1.3.0, as every mainnet member Safe and the ZK Foundation's.
const SAFE = {
  factory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
  singleton: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
  fallbackHandler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4",
} as const;
// Public RPCs answer bursts with 429: retried, backing off.
const RETRY = { retryCount: 8, retryDelay: 1_000 };
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(
    process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    RETRY
  ),
});
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.MAINNET_RPC_URL ?? "https://mainnet.gateway.tenderly.co", RETRY),
});
const account = privateKeyToAccount(readFileSync(KEY_FILE, "utf8").trim() as Hex);
const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(
    process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    RETRY
  ),
});

function build() {
  const root = `${ZK_GOVERNANCE.dir}/l1-contracts`;
  if (!existsSync(root)) {
    const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" });
    git("clone", "--quiet", ZK_GOVERNANCE.repo, ZK_GOVERNANCE.dir);
    git("-C", ZK_GOVERNANCE.dir, "checkout", "--quiet", ZK_GOVERNANCE.commit);
    git(
      "-C",
      ZK_GOVERNANCE.dir,
      "submodule",
      "update",
      "--init",
      "--recursive",
      "l1-contracts/lib"
    );
  }
  const head = execFileSync("git", ["-C", ZK_GOVERNANCE.dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== ZK_GOVERNANCE.commit)
    throw new Error(`${ZK_GOVERNANCE.dir} is at ${head}, expected ${ZK_GOVERNANCE.commit}`);
  mkdirSync(`${root}/src/sepolia-test`, { recursive: true });
  copyFileSync(at("./ZKsyncTestStub.sol"), `${root}/src/sepolia-test/ZKsyncTestStub.sol`);
  // The handler's proxy, as zk-governance's Redeploy script imports it (its scripts are not built).
  writeFileSync(
    `${root}/src/sepolia-test/Proxy.sol`,
    'import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";\n'
  );
  const forge = (out: string, ...flags: string[]) =>
    execFileSync(
      "forge",
      ["build", "--root", root, "--skip", "test", "--out", `${CACHE}/${out}`, ...flags],
      { stdio: ["ignore", "ignore", "inherit"] }
    );
  forge("out-plain", "--cache-path", `${CACHE}/cache-plain`);
  forge(
    "out-opt200",
    "--optimize",
    "--optimizer-runs",
    "200",
    "--cache-path",
    `${CACHE}/cache-opt200`
  );
}

function artifact(out: "out-plain" | "out-opt200", name: string): { abi: Abi; bytecode: Hex } {
  const a = JSON.parse(readFileSync(`${CACHE}/${out}/${name}.sol/${name}.json`, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

async function hasCode(address: Address) {
  const code = await publicClient.getCode({ address });
  return !!code && code !== "0x";
}

async function confirm(hash: Hex, what: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== "success") throw new Error(`${what}: transaction ${hash} reverted`);
  console.log(`  ${what}: ${hash} (block ${receipt.blockNumber})`);
  return receipt;
}

// ---- Member Safes: 1-of-1, owned by OWNER, created through Safe's own factory -------------------

type Role = "securityCouncil" | "guardians" | "zkFoundation";
const MEMBERS: { role: Role; index: number; label: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    role: "securityCouncil" as const,
    index: i,
    label: `Security Council member ${i + 1}`,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    role: "guardians" as const,
    index: i,
    label: `Guardian ${i + 1}`,
  })),
  { role: "zkFoundation", index: 0, label: "ZK Foundation" },
];

const factoryAbi = parseAbi([
  "function proxyCreationCode() pure returns (bytes)",
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);
const setupAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);

async function deploySafes() {
  const initializer = encodeFunctionData({
    abi: setupAbi,
    functionName: "setup",
    args: [[OWNER], 1n, zeroAddress, "0x", SAFE.fallbackHandler, zeroAddress, 0n, zeroAddress],
  });
  const creationCode = await publicClient.readContract({
    address: SAFE.factory,
    abi: factoryAbi,
    functionName: "proxyCreationCode",
  });
  const safes = MEMBERS.map((m) => {
    const saltNonce = hexToBigInt(
      keccak256(toBytes(`zksync-governance-verifier/sepolia-test/${m.role}/${m.index}`))
    );
    const address = getContractAddress({
      opcode: "CREATE2",
      from: SAFE.factory,
      salt: keccak256(encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce])),
      bytecode: concat([creationCode, pad(SAFE.singleton)]),
    });
    return { ...m, address, saltNonce };
  });
  let nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const sent: { hash: Hex; label: string }[] = [];
  for (const safe of safes) {
    if (await hasCode(safe.address)) continue;
    const hash = await wallet.writeContract({
      address: SAFE.factory,
      abi: factoryAbi,
      functionName: "createProxyWithNonce",
      args: [SAFE.singleton, initializer, safe.saltNonce],
      nonce: nonce++,
    });
    sent.push({ hash, label: safe.label });
  }
  for (const { hash, label } of sent) await confirm(hash, label);
  for (const safe of safes)
    if (!(await hasCode(safe.address)))
      throw new Error(`${safe.label}: no Safe at ${safe.address}`);
  return safes;
}

// ---- Governance: the stub, the handler (implementation and proxy), the councils, the board ------

type Plan = {
  firstNonce: number;
  stub: Address;
  handlerImplementation: Address;
  handler: Address;
  securityCouncil: Address;
  guardians: Address;
  emergencyUpgradeBoard: Address;
  handlerBlock?: number;
};
const ORDER = [
  "stub",
  "handlerImplementation",
  "handler",
  "securityCouncil",
  "guardians",
  "emergencyUpgradeBoard",
] as const;

async function deployGovernance(
  safes: Awaited<ReturnType<typeof deploySafes>>,
  planFile: string
): Promise<Plan & { handlerBlock: number }> {
  // Each address follows from the deployer's nonce, so the proxy is initialized with the councils'
  // addresses and is its own ProxyAdmin's owner, as on mainnet, before they exist.
  let plan: Plan;
  if (existsSync(planFile)) plan = JSON.parse(readFileSync(planFile, "utf8"));
  else {
    const firstNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const nth = (i: number) =>
      getContractAddress({ from: account.address, nonce: BigInt(firstNonce + i) });
    plan = { firstNonce, ...Object.fromEntries(ORDER.map((k, i) => [k, nth(i)])) } as Plan;
    writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  }
  const sorted = (role: Role) =>
    safes
      .filter((s) => s.role === role)
      .map((s) => s.address)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const zkFoundation = safes.find((s) => s.role === "zkFoundation")?.address as Address;
  const stub = artifact("out-plain", "ZKsyncTestStub");
  const handlerArtifact = artifact("out-opt200", "TestnetProtocolUpgradeHandler");
  const deploys: Record<(typeof ORDER)[number], { abi: Abi; bytecode: Hex; args: unknown[] }> = {
    stub: { ...stub, args: [] },
    handlerImplementation: {
      ...handlerArtifact,
      args: [L2_PROTOCOL_GOVERNOR, ...Array(7).fill(plan.stub)],
    },
    handler: {
      ...artifact("out-opt200", "TransparentUpgradeableProxy"),
      args: [
        plan.handlerImplementation,
        plan.handler,
        encodeFunctionData({
          abi: handlerArtifact.abi,
          functionName: "initialize",
          args: [plan.securityCouncil, plan.guardians, plan.emergencyUpgradeBoard],
        }),
      ],
    },
    securityCouncil: {
      ...artifact("out-plain", "SecurityCouncil"),
      args: [plan.handler, sorted("securityCouncil")],
    },
    guardians: {
      ...artifact("out-opt200", "Guardians"),
      args: [plan.handler, plan.stub, sorted("guardians")],
    },
    emergencyUpgradeBoard: {
      ...artifact("out-plain", "EmergencyUpgradeBoard"),
      args: [plan.handler, plan.securityCouncil, plan.guardians, zkFoundation],
    },
  };
  for (const [i, key] of ORDER.entries()) {
    if (await hasCode(plan[key])) continue;
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    if (nonce !== plan.firstNonce + i)
      throw new Error(
        `${key} is planned at nonce ${plan.firstNonce + i} (${plan[key]}), the next is ${nonce}: delete ${planFile} to plan again`
      );
    const hash = await wallet.deployContract({ ...deploys[key], nonce } as never);
    const receipt = await confirm(hash, key);
    // Its first event, ChangeSecurityCouncil(0 → …), marks the handler's deployment.
    if (key === "handler") {
      plan.handlerBlock = Number(receipt.blockNumber);
      writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    }
  }
  if (plan.handlerBlock === undefined) throw new Error(`${planFile} has no handlerBlock`);
  return plan as Plan & { handlerBlock: number };
}

// ---- Checks: the deployment reads back as the app will read it -------------------------------

async function check(gov: Plan, safes: Awaited<ReturnType<typeof deploySafes>>) {
  const read = <T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi, functionName, args }) as Promise<T>;
  const expect = (what: string, actual: Address, expected: Address) => {
    if (!isAddressEqual(actual, expected))
      throw new Error(`${what} is ${actual}, expected ${expected}`);
  };
  const h = gov.handler;
  expect(
    "handler.securityCouncil()",
    await read(h, upgradeHandlerAbi, "securityCouncil"),
    gov.securityCouncil
  );
  expect("handler.guardians()", await read(h, upgradeHandlerAbi, "guardians"), gov.guardians);
  expect(
    "handler.emergencyUpgradeBoard()",
    await read(h, upgradeHandlerAbi, "emergencyUpgradeBoard"),
    gov.emergencyUpgradeBoard
  );
  expect(
    "handler.L2_PROTOCOL_GOVERNOR()",
    await read(h, upgradeHandlerAbi, "L2_PROTOCOL_GOVERNOR"),
    L2_PROTOCOL_GOVERNOR
  );
  const adminSlot = await publicClient.getStorageAt({ address: h, slot: ADMIN_SLOT });
  const proxyAdmin = `0x${(adminSlot ?? "0x").slice(26)}` as Address;
  expect(
    "ProxyAdmin.owner()",
    await read(proxyAdmin, parseAbi(["function owner() view returns (address)"]), "owner"),
    h
  );
  for (const [role, multisig, abi] of [
    ["securityCouncil", gov.securityCouncil, securityCouncilAbi],
    ["guardians", gov.guardians, guardiansAbi],
  ] as const) {
    expect(
      `${role}.PROTOCOL_UPGRADE_HANDLER()`,
      await read(multisig, abi, "PROTOCOL_UPGRADE_HANDLER"),
      h
    );
    const members = safes.filter((s) => s.role === role).map((s) => s.address);
    const onChain = await Promise.all(
      members.map((_, i) => read<Address>(multisig, abi, "members", [BigInt(i)]))
    );
    if (
      new Set(onChain.map((a) => a.toLowerCase())).size !== 8 ||
      !members.every((m) => onChain.some((a) => isAddressEqual(a, m)))
    )
      throw new Error(`${role}.members() differ from its Safes`);
  }
  const eub = gov.emergencyUpgradeBoard;
  expect(
    "board.PROTOCOL_UPGRADE_HANDLER()",
    await read(eub, emergencyUpgradeBoardAbi, "PROTOCOL_UPGRADE_HANDLER"),
    h
  );
  expect(
    "board.SECURITY_COUNCIL()",
    await read(eub, emergencyUpgradeBoardAbi, "SECURITY_COUNCIL"),
    gov.securityCouncil
  );
  expect(
    "board.GUARDIANS()",
    await read(eub, emergencyUpgradeBoardAbi, "GUARDIANS"),
    gov.guardians
  );
  expect(
    "board.ZK_FOUNDATION_SAFE()",
    await read(eub, emergencyUpgradeBoardAbi, "ZK_FOUNDATION_SAFE"),
    safes.find((s) => s.role === "zkFoundation")?.address as Address
  );
  for (const safe of safes) {
    const owners = await read<Address[]>(safe.address, safeAbi, "getOwners");
    const threshold = await read<bigint>(safe.address, safeAbi, "getThreshold");
    if (owners.length !== 1 || !isAddressEqual(owners[0] as Address, OWNER) || threshold !== 1n)
      throw new Error(`${safe.label} (${safe.address}) is not a 1-of-1 Safe of ${OWNER}`);
  }
  return proxyAdmin;
}

// ---- Seeds: upgrades started on the handler (the stub proves any message) --------------------

async function startSeeds(gov: Plan) {
  const started: { title: string; id: Hex; txHash: Hex | null }[] = [];
  for (const [i, seed] of SEEDS.entries()) {
    const [log] = await mainnetClient.getLogs({
      address: MAINNET_HANDLER,
      event: upgradeHandlerAbi.find(
        (x) => x.type === "event" && x.name === "UpgradeStarted"
      ) as never,
      args: { _id: seed.from.id } as never,
      fromBlock: seed.from.block,
      toBlock: seed.from.block,
    });
    if (!log)
      throw new Error(`no UpgradeStarted ${seed.from.id} at mainnet block ${seed.from.block}`);
    const proposal = seedProposal(seed, i, log as never, gov.stub);
    const id = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "((address target, uint256 value, bytes data)[] calls, address executor, bytes32 salt)"
        ),
        [proposal]
      )
    );
    const state = await publicClient.readContract({
      address: gov.handler,
      abi: upgradeHandlerAbi,
      functionName: "upgradeState",
      args: [id],
    });
    let txHash: Hex | null = null;
    if (state === 0) {
      txHash = await wallet.writeContract({
        address: gov.handler,
        abi: upgradeHandlerAbi,
        functionName: "startUpgrade",
        args: [0n, 0n, 0, [], proposal],
      });
      await confirm(txHash, `upgrade ${id.slice(0, 10)}…`);
    }
    started.push({ title: seed.title, id, txHash });
  }
  return started;
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) throw new Error(`chain ${chainId} is not Sepolia`);
  const client = String(await publicClient.request({ method: "web3_clientVersion" }));
  const fork = /anvil|hardhat/i.test(client);
  const suffix = fork ? ".fork" : "";
  mkdirSync(CACHE, { recursive: true });
  console.log(`Deployer ${account.address} on ${fork ? "an anvil fork of Sepolia" : "Sepolia"}`);
  build();
  console.log("Member Safes");
  const safes = await deploySafes();
  console.log("Governance contracts");
  const gov = await deployGovernance(safes, `${CACHE}/plan${suffix}.json`);
  const proxyAdmin = await check(gov, safes);
  console.log("Test upgrades");
  const upgrades = await startSeeds(gov);
  const codeHash = async (address: Address) =>
    keccak256((await publicClient.getCode({ address })) as Hex);
  const memberSafe = (s: (typeof safes)[number]) => ({ label: s.label, address: s.address });
  const deployment = {
    chainId,
    deployer: account.address,
    owner: OWNER,
    zkGovernance: { repo: ZK_GOVERNANCE.repo, commit: ZK_GOVERNANCE.commit },
    l2ProtocolGovernor: L2_PROTOCOL_GOVERNOR,
    handlerDeployBlock: gov.handlerBlock,
    contracts: {
      protocolUpgradeHandler: gov.handler,
      protocolUpgradeHandlerImplementation: gov.handlerImplementation,
      proxyAdmin,
      securityCouncil: gov.securityCouncil,
      guardians: gov.guardians,
      emergencyUpgradeBoard: gov.emergencyUpgradeBoard,
      zksyncStub: gov.stub,
    },
    safes: {
      securityCouncil: safes.filter((s) => s.role === "securityCouncil").map(memberSafe),
      guardians: safes.filter((s) => s.role === "guardians").map(memberSafe),
      zkFoundation: memberSafe(
        safes.find((s) => s.role === "zkFoundation") as (typeof safes)[number]
      ),
    },
    codeHashes: {
      securityCouncil: await codeHash(gov.securityCouncil),
      guardians: await codeHash(gov.guardians),
      emergencyUpgradeBoard: await codeHash(gov.emergencyUpgradeBoard),
      safeProxy: await codeHash(safes[0]?.address as Address),
    },
    upgrades: upgrades.map(({ title, id }) => ({ title, id })),
  };
  writeFileSync(at(`./deployment${suffix}.json`), `${JSON.stringify(deployment, null, 2)}\n`);
  // Safe{Wallet} → Address book → Import: names for the 17 Safes.
  writeFileSync(
    at(`./safe-address-book${suffix}.csv`),
    `address,name,chainId\n${safes.map((s) => `${s.address},${s.label} (test),${chainId}`).join("\n")}\n`
  );
  console.log(`Wrote deployment${suffix}.json and safe-address-book${suffix}.csv`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
