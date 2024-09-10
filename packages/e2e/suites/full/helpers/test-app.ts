import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { exec, killProcessByPort, spawnBackground } from "./cli.js";
import path from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { type Hex, hexToNumber } from "viem";
import ora from "ora";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ROOT_DIR = path.join(__dirname, "../../../../..");
const LOGS_DIR = path.join(__dirname, "logs");

export class TestApp {
  readonly webDir = path.join(ROOT_DIR, "apps/web");
  readonly contractsDir = path.join(ROOT_DIR, "packages/contracts");

  private readonly devDatabaseUrl = "postgresql://user:password@localhost:5432/webapp";
  readonly testDatabaseUrl = "postgresql://user:password@localhost:5432/webapp_e2e_tests";
  readonly testDatabaseName = "webapp_e2e_tests";

  readonly appPort = 4000;
  readonly backupNodePort = 8560;
  readonly backupNodeUrl = `http://localhost:${this.backupNodePort}`;
  readonly mainNodePort = 8561;
  readonly mainNodeUrl = `http://localhost:${this.mainNodePort}`;

  private latestBackupNodeBlock: number | null = null;

  db: PostgresJsDatabase;

  readonly logPaths = {
    app: path.join(LOGS_DIR, "app.log"),
    backupNode: path.join(LOGS_DIR, "backup-node.log"),
    mainNode: path.join(LOGS_DIR, "main-node.log"),
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
    await this.startBackupNode();

    spinner.start("Starting main node");
    await this.startMainHardhatNode();

    spinner.start("Starting app");
    await this.startApp();

    spinner.succeed("Test app started");
  }

  async down() {
    const spinner = ora().start();

    spinner.start("Stopping app");
    await killProcessByPort(this.appPort);

    spinner.start("Stopping backup node");
    await killProcessByPort(this.backupNodePort);

    spinner.start("Stopping main node");
    await killProcessByPort(this.mainNodePort);

    spinner.succeed("Test app stopped");
  }

  async reset() {
    await this.cleanupDb();
    await this.resetMainNode();
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
    const node = spawnBackground(`pnpm hardhat node --port ${this.backupNodePort}`, {
      cwd: this.contractsDir,
      outputFile: this.logPaths.backupNode,
    });
    await this.waitForHardhatNode(this.backupNodeUrl);
    await exec("pnpm deploy:setup", {
      cwd: this.contractsDir,
      env: { ...process.env, L1_RPC_URL: this.backupNodeUrl },
    });
    return node;
  }

  private async startMainHardhatNode() {
    const latestBlock = await this.getLatestBlock(this.backupNodeUrl);
    this.latestBackupNodeBlock = latestBlock;

    const node = spawnBackground(
      `pnpm hardhat node --port ${this.mainNodePort} --fork ${this.backupNodeUrl} --fork-block-number ${latestBlock}`,
      {
        cwd: this.contractsDir,
        outputFile: this.logPaths.mainNode,
      }
    );
    await this.waitForHardhatNode(this.mainNodeUrl);
    return node;
  }

  private async startApp() {
    return spawnBackground("pnpm start", {
      cwd: this.webDir,
      env: {
        ...process.env,
        DATABASE_URL: this.testDatabaseUrl,
        SERVER_PORT: this.appPort.toString(),
        L1_RPC_URL: this.mainNodeUrl,
        L2_RPC_URL: this.mainNodeUrl,
      },
      outputFile: this.logPaths.app,
    });
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

    const data = await response.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "result" in data &&
      typeof data.result === "string"
    ) {
      return hexToNumber(data.result as Hex);
    }
    throw new Error("Unexpected response format");
  }
}
