/**
 * Human verification for registration: the server checks the token the client got from the
 * verification provider's challenge. The provider's name and endpoint stay in this adapter;
 * settings, contracts, routes, and UI only ever say "human verification".
 */

/** The provider's token-check endpoint (its direct API). */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** A checker the server composes from its secret. Absent means verification is off. */
export interface HumanVerification {
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

export function humanVerificationFromSecret(
  secret: string | undefined,
): HumanVerification | undefined {
  const key = secret?.trim();
  if (!key) return undefined;
  return { verify: (token, remoteIp) => verifyHumanToken(key, token, remoteIp) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Checks one token against the provider. Fails closed: a network error, a bad response,
 * or a non-JSON body all mean the token is not trusted.
 */
export async function verifyHumanToken(
  secret: string,
  token: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return isRecord(data) && data.success === true;
  } catch {
    return false;
  }
}
