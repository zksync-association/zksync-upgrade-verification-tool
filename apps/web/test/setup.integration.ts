import { execSync } from "node:child_process";
import path from "node:path";

const scriptPath = path.resolve(__dirname, "../scripts/init_db.sh");

export function setup() {
  execSync(`${scriptPath} --reset`, {
    stdio: "inherit",
    encoding: "utf-8",
  });
}

export function teardown() {
  execSync(`${scriptPath} --down`, {
    stdio: "inherit",
    encoding: "utf-8",
  });
}
