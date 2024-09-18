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

  const process: ChildProcess = spawn(cmd, cmdArgs, {
    cwd,
    stdio: stdio as any,
    detached: true,
    env,
  });

  process.unref();

  const pid = process.pid;
  if (!pid) {
    throw new Error("Failed to start process");
  }

  return pid;
}

export async function killProcessByPid(pid: number) {
  // Kills the process and its children with "-pid"
  process.kill(-pid, "SIGKILL");
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
