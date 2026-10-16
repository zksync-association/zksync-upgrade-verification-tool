// The site's routes for React Router's hash router (verifier.html#/app/proposals/0x…), from the
// same route modules the server build uses.
import * as index from "@/routes/_index/_route";
import * as notFound from "@/routes/$";
import * as emergencyId from "@/routes/app/emergency/$id/_route";
import * as emergencyIndex from "@/routes/app/emergency/_index/_route";
import * as emergencyNew from "@/routes/app/emergency/new/_route";
import * as freezeAction from "@/routes/app/freeze/$action/_route";
import * as freezeIndex from "@/routes/app/freeze/_index/_route";
import * as vetoId from "@/routes/app/l2-cancellations/$id/_route";
import * as vetoIndex from "@/routes/app/l2-cancellations/_index/_route";
import * as vetoNew from "@/routes/app/l2-cancellations/new/_route";
import * as proposalId from "@/routes/app/proposals/$id/_route";
import * as proposalIndex from "@/routes/app/proposals/_index/_route";
import * as proposalNew from "@/routes/app/proposals/new/_route";
import * as transaction from "@/routes/app/transactions.$hash/_route";
import * as presence from "@/routes/resources+/presence";
import * as refresh from "@/routes/resources+/refresh";
import * as safeCheck from "@/routes/resources+/safe-check";
import * as settings from "@/routes/settings/_route";
import type { ComponentType } from "react";
import type { ActionFunctionArgs, RouteObject, ShouldRevalidateFunction } from "react-router-dom";
import { localRequest } from "./local-request";
import * as root from "./root";
import { hasRpcSetting } from "./shims/local-settings";
import { serialized } from "./shims/remix-node";

// Route modules are typed for Remix; React Router calls them with the same arguments.
// biome-ignore lint/suspicious/noExplicitAny: Remix's and React Router's argument types differ only nominally
type Handler = (args: any) => unknown;
type Module = {
  default?: ComponentType;
  loader?: Handler;
  action?: Handler;
  ErrorBoundary?: ComponentType;
  shouldRevalidate?: ShouldRevalidateFunction;
  handle?: unknown;
};

// Remix sends plain loader data as JSON; Responses (json()) and defer() data are already shaped.
const shaped = (value: unknown) =>
  value instanceof Response || (value && typeof value === "object" && "deferredKeys" in value)
    ? value
    : serialized(value);

function route(
  id: string,
  path: string | undefined,
  mod: Module,
  extra: Partial<RouteObject> = {}
): RouteObject {
  return {
    id,
    ...(path === undefined ? { index: true } : { path }),
    // Until an RPC URL is saved only the settings page loads anything (root.tsx shows only it).
    loader:
      mod.loader &&
      (async (args) =>
        !hasRpcSetting() && id !== "routes/settings"
          ? null
          : shaped(await mod.loader?.({ ...args, request: localRequest(args.request) }))),
    action:
      mod.action &&
      (async (args) =>
        shaped(await mod.action?.({ ...args, request: localRequest(args.request) }))),
    Component: mod.default,
    ErrorBoundary: mod.ErrorBoundary,
    shouldRevalidate: mod.shouldRevalidate,
    handle: mod.handle,
    ...extra,
  } as RouteObject;
}

// Saving settings starts over with them: a reload gives every module the new RPC and key.
const settingsModule: Module = {
  ...settings,
  action: async (args) => {
    const response = (await settings.action(
      args as Parameters<typeof settings.action>[0]
    )) as Response;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body?.saved) setTimeout(() => window.location.reload(), 400);
    return response;
  },
};

export const routes = [
  {
    ...(route("root", "/", root as Module) as object),
    children: [
      route("routes/_index", undefined, index as Module),
      route("routes/app/proposals/_index", "app/proposals", proposalIndex as Module),
      route("routes/app/proposals/new", "app/proposals/new", proposalNew as Module),
      route("routes/app/proposals/$id", "app/proposals/:id", proposalId as Module),
      route("routes/app/emergency/_index", "app/emergency", emergencyIndex as Module),
      route("routes/app/emergency/new", "app/emergency/new", emergencyNew as Module),
      route("routes/app/emergency/$id", "app/emergency/:id", emergencyId as Module),
      route("routes/app/freeze/_index", "app/freeze", freezeIndex as Module),
      route("routes/app/freeze/$action", "app/freeze/:action", freezeAction as Module),
      route("routes/app/l2-cancellations/_index", "app/l2-cancellations", vetoIndex as Module),
      route("routes/app/l2-cancellations/new", "app/l2-cancellations/new", vetoNew as Module),
      route("routes/app/l2-cancellations/$id", "app/l2-cancellations/:id", vetoId as Module),
      route("routes/app/transactions.$hash", "app/transactions/:hash", transaction as Module),
      route("routes/settings", "settings", settingsModule),
      route("routes/resources+/refresh", "resources/refresh", refresh as Module),
      route("routes/$", "*", notFound as Module),
    ],
  },
] as RouteObject[];

/** The two endpoints the pages fetch() themselves (beats, Fetch signatures), answered in the page. */
export const pageEndpoints: Record<string, (args: ActionFunctionArgs) => unknown> = {
  "/resources/presence": presence.action as (args: ActionFunctionArgs) => unknown,
  "/resources/safe-check": safeCheck.action as (args: ActionFunctionArgs) => unknown,
};
