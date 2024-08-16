import { setTimeout } from "node:timers/promises";

export default async () => {
  globalThis.__vitest_delay__ = async () => {
    await setTimeout(1000);
  };
};
