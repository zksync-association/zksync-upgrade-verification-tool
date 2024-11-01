import type { MetaFunction } from "@remix-run/node";
import type { Routes } from "remix-routes";

export const AppName = "Governance Authentication";

export const Meta = {
  "/": () => [{ title: AppName }],
  "/app/denied": () => [{ title: `Access Denied | ${AppName}` }],
  "/app/down": () => [{ title: `Service Unavailable | ${AppName}` }],
  "/app/emergency": () => [{ title: `Emergency Upgrades | ${AppName}` }],
  "/app/emergency/:id": ({ params }) => [{ title: `Emergency Upgrade ${params.id} | ${AppName}` }],
  "/app/emergency/new": () => [{ title: `Create Emergency Upgrade | ${AppName}` }],
  "/app/freeze": () => [{ title: `Freeze Requests | ${AppName}` }],
  "/app/freeze/:id": ({ params }) => [{ title: `Freeze Request ${params.id} | ${AppName}` }],
  "/app/proposals": () => [{ title: `Upgrades | ${AppName}` }],
  "/app/proposals/:id": ({ params }) => [{ title: `Upgrade ${params.id} | ${AppName}` }],
  "/app/proposals/new": () => [{ title: `Create Upgrade | ${AppName}` }],
  "/app/l2-cancellations": () => [{ title: `Guardian Veto | ${AppName}` }],
  "/app/l2-cancellations/:id": ({ params }) => [
    { title: `Guardian Veto ${params.id} | ${AppName}` },
  ],
  "/app/l2-cancellations/new": () => [{ title: `Create Guardian Veto | ${AppName}` }],
  "/app/transactions/:hash": ({ params }) => [{ title: `Transaction ${params.hash} | ${AppName}` }],
} satisfies Meta;

type PageRoutes = Omit<
  Routes,
  | ""
  | "/*"
  | "/app"
  | "/app/freeze/:id/write-transaction"
  | "/app/l2-cancellations/:id/write-transaction"
  | "/resources/validate-account"
  | "/resources/zk-admin-sign"
>;

type Meta = Record<keyof PageRoutes, MetaFunction>;
