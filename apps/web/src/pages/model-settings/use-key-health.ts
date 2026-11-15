import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyHealth } from "../../lib/key-health";
import { checkKeys, credentialKeyHealth } from "../../lib/key-health";
import type { ModelCredential } from "../../lib/model-auth";
import type { createSpaceRpc } from "../../lib/rpc";

/**
 * Key health for the connections on the Models page. Opening the page checks
 * every connection once through the list probe (no tokens); a slow or failed
 * connection yields no result instead of blocking the page. "Check all"
 * re-runs the same probe for every connection. The last persisted check on a
 * connection seeds its row until a fresh result lands.
 */
export function useKeyHealth({
  rpc,
  credentials,
  enabled,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  credentials: ModelCredential[];
  enabled: boolean;
}) {
  const [healthById, setHealthById] = useState<Record<string, KeyHealth>>({});
  const [checkingIds, setCheckingIds] = useState<ReadonlySet<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  // Connections already probed this visit; a re-render must not re-probe them.
  const checkedRef = useRef(new Set<string>());

  // A persisted check is the row's state until a fresh probe replaces it.
  useEffect(() => {
    setHealthById((prev) => {
      let next = prev;
      for (const credential of credentials) {
        const persisted = credentialKeyHealth(credential);
        if (persisted && prev[credential.id]?.checkedAt !== persisted.checkedAt) {
          if (next === prev) next = { ...prev };
          next[credential.id] = persisted;
        }
      }
      return next;
    });
  }, [credentials]);

  const runCheck = useCallback(
    async (ids: string[], all: boolean) => {
      if (ids.length === 0) return;
      if (all) setCheckingAll(true);
      setCheckingIds(new Set(ids));
      try {
        const results = await checkKeys(rpc, ids);
        setHealthById((prev) => {
          let next = prev;
          for (const result of results) {
            const health = { status: result.status, checkedAt: result.checkedAt };
            if (prev[result.credentialId]?.checkedAt !== health.checkedAt) {
              if (next === prev) next = { ...prev };
              next[result.credentialId] = health;
            }
          }
          return next;
        });
      } finally {
        setCheckingIds(new Set());
        if (all) setCheckingAll(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    if (!enabled) return;
    const fresh = credentials
      .map((credential) => credential.id)
      .filter((id) => !checkedRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) checkedRef.current.add(id);
    void runCheck(fresh, false);
  }, [credentials, enabled, runCheck]);

  const checkAll = useCallback(() => {
    const ids = credentials.map((credential) => credential.id);
    for (const id of ids) checkedRef.current.add(id);
    return runCheck(ids, true);
  }, [credentials, runCheck]);

  return { healthById, checkingIds, checkingAll, checkAll };
}
