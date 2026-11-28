import type { RpcPath, SettingsScope } from "@rakazo_mickvvw/contracts";
import type { RpcArgs } from "./api";
import { captureApiRequestContext, rpc } from "./api";

/** Which copy a settings screen edits: the account's, or one Space's override. */
export type SettingsTarget = { scope: "account" } | { scope: "space"; spaceId: string };

export const ACCOUNT_SETTINGS: SettingsTarget = { scope: "account" };

/** A screen opened with a Space edits that Space's override; without one, the account's. */
export function settingsTarget(spaceId: string | string[] | undefined): SettingsTarget {
  return typeof spaceId === "string" && spaceId ? { scope: "space", spaceId } : ACCOUNT_SETTINGS;
}

/**
 * The body a vault call sends for this target. A Space's own vault exists only when the Space
 * customized credentials, so a Space target sends no scope and the server resolves whichever
 * vault the Space uses — its own, or the account's when it has none. The account's vault is
 * explicit, so it never follows another Space's override.
 */
export function vaultScopeBody(target: SettingsTarget): { scope: SettingsScope } | undefined {
  return target.scope === "account" ? { scope: "account" } : undefined;
}

/**
 * Calls for a settings screen. A Space override is sent to that Space even when another one is
 * selected, so its settings can be edited from the inbox's Space menu without switching.
 */
export function settingsRpc(target: SettingsTarget): typeof rpc {
  if (target.scope === "account") return rpc;
  const { spaceId } = target;
  return async <P extends RpcPath>(proc: P, ...[body, options]: RpcArgs<P>) => {
    const requestContext = await captureApiRequestContext(spaceId);
    return rpc(proc, ...([body, { ...options, requestContext }] as RpcArgs<P>));
  };
}
