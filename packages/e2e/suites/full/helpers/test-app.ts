import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { exec, killProcessByPid, spawnBackground } from "./cli.js";
import path from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { type Hex, hexToNumber, numberToHex } from "viem";
import ora from "ora";
import z from "zod";
import fs from "node:fs/promises";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ROOT_DIR = path.join(__dirname, "../../../../..");
const LOGS_DIR = path.join(process.cwd(), "logs");
const PIDS_FILE = path.join(LOGS_DIR, "pids.json");

export class TestApp {
  readonly webDir = path.join(ROOT_DIR, "apps/web");
  readonly contractsDir = path.join(ROOT_DIR, "packages/contracts");

  private readonly devDatabaseUrl = "postgresql://user:password@localhost:5432/webapp";
  readonly testDatabaseUrl = "postgresql://user:password@localhost:5432/webapp_e2e_tests";
  readonly testDatabaseName = "webapp_e2e_tests";

  readonly appPort = 4000;
  readonly appUrl = `http://localhost:${this.appPort}`;
  readonly backupNodePort = 8560;
  readonly backupNodeUrl = `http://localhost:${this.backupNodePort}`;
  readonly mainNodePort = 8561;
  readonly mainNodeUrl = `http://localhost:${this.mainNodePort}`;
  readonly l2NodePort = 8570;
  readonly l2NodeUrl = `http://localhost:${this.l2NodePort}`;

  readonly walletMnemonic =
    "draw drastic exercise toilet stove bone grit clutch any stand phone ten";

  private latestBackupNodeBlock: number | null = null;

  db: PostgresJsDatabase;

  readonly logPaths = {
    app: path.join(LOGS_DIR, "app.log"),
    backupNode: path.join(LOGS_DIR, "backup-node.log"),
    mainNode: path.join(LOGS_DIR, "main-node.log"),
    l2Node: path.join(LOGS_DIR, "l2-node.log"),
  };

  constructor() {
    const client = postgres(this.testDatabaseUrl);
    this.db = drizzle(client);
  }

  async up() {
    const spinner = ora().start();

    spinner.start("Building app");
    await this.buildApp();

    spinner.start("Setting up database");
    await this.setupDb();

    spinner.start("Starting backup node");
    const backupNode = await this.startBackupNode();

    spinner.start("Starting main node");
    const mainNode = await this.startMainHardhatNode();

    spinner.start("Starting l2 node");
    const l2Node = await this.startL2Node();

    spinner.start("Starting app");
    const app = await this.startApp();

    await this.savePids({ backupNode, mainNode, app, l2Node });

    spinner.succeed("Test app started");
  }

  async down() {
    const spinner = ora().start();
    const pids = await this.getPids();

    spinner.start("Stopping app");
    await killProcessByPid(pids.app).catch(() =>
      console.log(`error stopping app, pid=${pids.app}`)
    );

    spinner.start("Stopping backup node");
    await killProcessByPid(pids.backupNode).catch(() =>
      console.log(`error stopping backup node, pid=${pids.backupNode}`)
    );

    spinner.start("Stopping main node");
    await killProcessByPid(pids.mainNode).catch(() =>
      console.log(`error stopping main node, pid=${pids.mainNode}`)
    );

    spinner.start("Stopping l2 node");
    await killProcessByPid(pids.l2Node).catch(() =>
      console.log(`error stopping l2 node, pid=${pids.l2Node}`)
    );

    spinner.succeed("Test app stopped");
  }

  async reset() {
    await this.cleanupDb();
    await this.resetMainNode();
  }

  async resetApp({ env }: { env: Record<string, string> }) {
    const pids = await this.getPids();
    await killProcessByPid(pids.app);
    const app = await this.startApp({ env });
    await this.savePids({ ...pids, app });
  }

  async cleanupDb() {
    const tablenames = await this.db.execute<{ tablename: string }>(
      sql.raw(`SELECT tablename FROM pg_tables WHERE schemaname='public';`)
    );
    const tables = tablenames
      .map(({ tablename }) => tablename)
      .map((name) => `"public"."${name}"`)
      .join(", ");

    await this.db.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE;`));
  }

  async resetMainNode() {
    const mainBefore = await this.getLatestBlock(this.mainNodeUrl);
    const response = await fetch(this.mainNodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "hardhat_reset",
        params: [
          {
            forking: {
              jsonRpcUrl: this.backupNodeUrl,
              blockNumber: await this.getLatestBackupNodeBlock(),
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to reset main node");
    }
    await this.waitForHardhatNode(this.mainNodeUrl);
    const mainAfter = await this.getLatestBlock(this.mainNodeUrl);
    await this.mineBlocks(this.mainNodeUrl, mainBefore - mainAfter);
  }

  async mineBlocksInMainNode(blocks: number) {
    await fetch(this.mainNodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "hardhat_mine",
        params: [numberToHex(blocks)],
      }),
    });
  }

  async increaseBlockTimestamp({
    days,
    hours,
    minutes,
    seconds,
  }: { days?: number; hours?: number; minutes?: number; seconds?: number }) {
    const increaseBySeconds =
      (days ?? 0) * 24 * 60 * 60 + (hours ?? 0) * 60 * 60 + (minutes ?? 0) * 60 + (seconds ?? 0);
    if (increaseBySeconds === 0) {
      throw new Error("Increase by seconds must be greater than 0");
    }

    // Increase time method works on the next block, so we need to mine one block
    // after executing the method.
    await fetch(this.mainNodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "evm_increaseTime",
        params: [increaseBySeconds],
      }),
    });
    await this.mineBlocksInMainNode(1);
  }

  private async buildApp() {
    await exec("pnpm build", { cwd: this.webDir });
  }

  private async setupDb() {
    const client = postgres(this.devDatabaseUrl, { max: 1 });
    const db = drizzle(client);
    await db.execute(sql.raw(`DROP DATABASE IF EXISTS ${this.testDatabaseName};`));
    await db.execute(sql.raw(`CREATE DATABASE ${this.testDatabaseName};`));
    await client.end();

    const testClient = postgres(this.testDatabaseUrl, { max: 1 });
    const testDb = drizzle(testClient);
    await migrate(testDb, { migrationsFolder: path.join(ROOT_DIR, "apps/web/drizzle") });
    await testClient.end();
  }

  private async startBackupNode() {
    const pid = spawnBackground(`pnpm hardhat node --port ${this.backupNodePort}`, {
      cwd: this.contractsDir,
      outputFile: this.logPaths.backupNode,
    });
    await this.waitForHardhatNode(this.backupNodeUrl);
    await exec("pnpm deploy:setup", {
      cwd: this.contractsDir,
      env: { ...process.env, L1_RPC_URL: this.backupNodeUrl, MNEMONIC: this.walletMnemonic },
    });
    return pid;
  }

  private async startMainHardhatNode() {
    const latestBlock = await this.getLatestBlock(this.backupNodeUrl);
    this.latestBackupNodeBlock = latestBlock;

    // Wait for the backup node latest block timestamp to be older,
    // so that we don't face "current time must be after fork block" error.
    await new Promise((resolve) => setTimeout(resolve, 20000));

    const pid = spawnBackground(
      `pnpm hardhat node --port ${this.mainNodePort} --fork ${this.backupNodeUrl} --fork-block-number ${latestBlock}`,
      {
        cwd: this.contractsDir,
        outputFile: this.logPaths.mainNode,
      }
    );
    await this.waitForHardhatNode(this.mainNodeUrl);
    return pid;
  }

  private async startL2Node() {
    const pid = spawnBackground(
      `pnpm hardhat --config hardhat-l2.config.cts node-zksync --port ${this.l2NodePort}`,
      {
        cwd: this.contractsDir,
        env: {
          L1_RPC_URL: this.mainNodeUrl,
          L2_RPC_URL: this.l2NodeUrl,
        },
        outputFile: this.logPaths.l2Node,
      }
    );
    await this.waitForHardhatNode(this.l2NodeUrl);
    await exec("pnpm deploy:setup:l2", {
      cwd: this.contractsDir,
      env: {
        ...process.env,
        L1_RPC_URL: this.backupNodeUrl,
        L2_RPC_URL: this.l2NodeUrl,
      },
    });
    return pid;
  }

  private async startApp({ env }: { env?: Record<string, string> } = {}) {
    const pid = spawnBackground("pnpm start", {
      cwd: this.webDir,
      env: {
        ...process.env,
        DATABASE_URL: this.testDatabaseUrl,
        SERVER_PORT: this.appPort.toString(),
        L1_RPC_URL: this.mainNodeUrl,
        L2_RPC_URL: this.l2NodeUrl,
        ALLOW_PRIVATE_ACTIONS: "true",
        NODE_ENV: "production",
        UPGRADE_HANDLER_ADDRESS: "0xab3ab5d67ed26ac1935dd790f4f013d222ba5073",
        ZK_GOV_OPS_GOVERNOR_ADDRESS: "0xaAF5f437fB0524492886fbA64D703df15BF619AE",
        ZK_TOKEN_GOVERNOR_ADDRESS: "0x99E12239CBf8112fBB3f7Fd473d0558031abcbb5",
        ZK_PROTOCOL_GOVERNOR_ADDRESS: "0x23b13d016E973C9915c6252271fF06cCA2098885",
        WALLET_CONNECT_PROJECT_ID: "test",
        ETHERSCAN_API_KEY: "test",
        ETH_NETWORK: "local",
        LOCAL_CHAIN_PORT: this.mainNodePort.toString(),
        ...env,
      },
      outputFile: this.logPaths.app,
    });
    await this.waitForApp();
    return pid;
  }

  private async getLatestBackupNodeBlock() {
    if (!this.latestBackupNodeBlock) {
      this.latestBackupNodeBlock = await this.getLatestBlock(this.backupNodeUrl);
    }
    return this.latestBackupNodeBlock;
  }

  private async waitForHardhatNode(url: string, maxRetries = 30, retryInterval = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: [],
          }),
        });
        if (response.ok) {
          return; // Node is up and running
        }
      } catch {
        // Node not ready yet, will retry
      }
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
    throw new Error(`Hardhat node on ${url} did not become ready in time`);
  }

  private async getLatestBlock(url: string) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to get latest block");
    }
    const responseData = await response.json();
    const data = z
      .object({
        jsonrpc: z.string(),
        id: z.number(),
        result: z
          .string()
          .regex(/^0x[0-9a-fA-F]+$/)
          .transform((hex) => hexToNumber(hex as Hex)),
      })
      .safeParse(responseData);
    if (!data.success) {
      throw new Error("Unexpected response format");
    }
    return data.data.result;
  }

  private async mineBlocks(url: string, howManyBlocks: number) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "hardhat_mine",
        params: [howManyBlocks, 0],
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to mineBlocks");
    }
  }

  private async waitForApp(maxRetries = 10, retryInterval = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(this.appUrl);
        if (response.ok) {
          return; // App is up and running
        }
      } catch {
        // App not ready yet, will retry
      }
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
    throw new Error(`App on ${this.appUrl} did not become ready in time`);
  }

  private async savePids({
    app,
    backupNode,
    mainNode,
    l2Node,
  }: {
    app: number;
    backupNode: number;
    mainNode: number;
    l2Node: number;
  }) {
    return fs.writeFile(PIDS_FILE, JSON.stringify({ app, backupNode, mainNode, l2Node }, null, 2));
  }

  private async getPids() {
    const pids = JSON.parse(await fs.readFile(PIDS_FILE, "utf-8"));
    return z
      .object({
        app: z.number(),
        backupNode: z.number(),
        mainNode: z.number(),
        l2Node: z.number(),
      })
      .parse(pids);
  }
}
