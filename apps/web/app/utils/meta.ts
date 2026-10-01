import type { MetaFunction } from "@remix-run/node";

export const AppName = "ZKsync Governance";

const short = (id?: string) =>
  id && id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id ?? "";
const title = (t: string): ReturnType<MetaFunction> => [{ title: `${t} · ${AppName}` }];

export const Meta = {
  "/": (() => [{ title: AppName }]) satisfies MetaFunction,
  "/app/proposals": (() => title("Protocol upgrades")) satisfies MetaFunction,
  "/app/proposals/:id": (({ params }) =>
    title(`Upgrade ${short(params.id)}`)) satisfies MetaFunction,
  "/app/proposals/new": (() => title("Start an upgrade")) satisfies MetaFunction,
  "/app/emergency": (() => title("Emergency upgrades")) satisfies MetaFunction,
  "/app/emergency/:id": (({ params }) =>
    title(`Emergency upgrade ${short(params.id)}`)) satisfies MetaFunction,
  "/app/emergency/new": (() => title("Prepare an emergency upgrade")) satisfies MetaFunction,
  "/app/freeze": (() => title("Freeze requests")) satisfies MetaFunction,
  "/app/freeze/:action": (() => title("Freeze request")) satisfies MetaFunction,
  "/app/l2-cancellations": (() => title("Guardian veto")) satisfies MetaFunction,
  "/app/l2-cancellations/:id": (({ params }) =>
    title(`Veto of L2 proposal ${short(params.id)}`)) satisfies MetaFunction,
  "/app/l2-cancellations/new": (() => title("Prepare a veto")) satisfies MetaFunction,
  "/app/transactions/:hash": (({ params }) =>
    title(`Transaction ${short(params.hash)}`)) satisfies MetaFunction,
};
