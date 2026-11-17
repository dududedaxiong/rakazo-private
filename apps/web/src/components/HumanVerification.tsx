import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo_mickvvw/ui-web";
import { useEffect, useRef, useState } from "react";

// The verification provider's challenge script. The URL lives only here and in the
// server-side check; settings, contracts, routes, and copy just say "human verification".
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

type Turnstile = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let scriptPromise: Promise<void> | undefined;

function loadTurnstileScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("Could not load the verification challenge"));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

/**
 * The registration challenge. Reports a token when the visitor passes, null when it
 * expires or errors, so the form only submits with a fresh token.
 */
export function HumanVerification({
  siteKey,
  onToken,
  resetKey = 0,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Bump to render a fresh challenge, e.g. after a failed submit spent the token. */
  resetKey?: number;
}) {
  const { t } = useLingui();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setReady(false);
    onTokenRef.current(null);
    void loadTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return;
        widgetRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            if (active) onTokenRef.current(token);
          },
          "expired-callback": () => {
            if (active) onTokenRef.current(null);
          },
          "error-callback": () => {
            if (active) setFailed(true);
          },
        });
        setReady(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [siteKey, resetKey, retry]);

  if (failed)
    return (
      <div role="alert" className="w-full text-center">
        <p className="text-body text-destructive">
          <Trans>Could not load human verification</Trans>
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => setRetry((count) => count + 1)}
        >
          <Trans>Retry</Trans>
        </Button>
      </div>
    );

  return (
    <div className="flex w-full justify-center">
      <div ref={containerRef} />
      {!ready ? (
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      ) : null}
    </div>
  );
}
