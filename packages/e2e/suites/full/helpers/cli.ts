import { exec as execSync, spawn, type ChildProcess } from "node:child_process";
import util from "node:util";
import fs from "node:fs";
import path from "node:path";

export const exec = util.promisify(execSync);

export function spawnBackground(
  command: string,
  { cwd, env, outputFile }: { cwd?: string; env?: Record<string, string>; outputFile?: string } = {}
) {
  let fileStream: number | undefined;

  if (outputFile) {
    const outputDir = path.dirname(outputFile);
    fs.mkdirSync(outputDir, { recursive: true });

    fileStream = fs.openSync(outputFile, "a");
  }

  const stdio = fileStream ? ["ignore", fileStream, fileStream] : "ignore";
  const [cmd, ...cmdArgs] = command.split(/\s+/);
  if (!cmd) {
    throw new Error("Command is required");
  }

  const proc: ChildProcess = spawn(cmd, cmdArgs, {
    cwd,
    stdio: stdio as any,
    detached: true,
    env: { ...process.env, ...env },
  });

  proc.unref();

  const pid = proc.pid;
  if (!pid) {
    throw new Error("Failed to start process");
  }

  return pid;
}

export async function killProcessByPid(pid: number, name?: string) {
  // Kills the process and its children with "-pid"
  try {
    process.kill(-pid);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ESRCH") {
      console.warn(`${name ?? "Process"} was not running`);
      return;
    }
    console.error("Failed to kill process", err);
    throw err;
  }
  await waitForProcessToExit(pid);
}

async function waitForProcessToExit(pid: number, maxIterations = 100) {
  for (let i = 0; i < maxIterations; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Process ${pid} did not exit after ${maxIterations} checks`);
}
