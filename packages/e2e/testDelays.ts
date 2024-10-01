import { setTimeout } from "node:timers/promises";

export default async () => {
  (globalThis as any).__vitest_delay__ = async () => {
    await setTimeout(1000);
  };
};
