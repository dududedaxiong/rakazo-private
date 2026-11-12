import { describe, expect, it, vi } from "vitest";
import { humanVerificationFromSecret, verifyHumanToken } from "./human-verification.js";

function response(ok: boolean, body: unknown) {
  return { ok, json: async () => body } as Response;
}

describe("human verification", () => {
  it("trusts a token the provider confirms", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(true, { success: true }));
    expect(await verifyHumanToken("secret", "token", "203.0.113.7", fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain("siteverify");
    expect(String(url)).not.toContain("secret");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("response=token");
    expect(String(init?.body)).toContain("remoteip=203.0.113.7");
  });

  it("fails closed on a refused token, a bad status, and a network error", async () => {
    expect(
      await verifyHumanToken(
        "secret",
        "token",
        undefined,
        vi.fn(async () => response(true, { success: false })),
      ),
    ).toBe(false);
    expect(
      await verifyHumanToken(
        "secret",
        "token",
        undefined,
        vi.fn(async () => response(false, { success: true })),
      ),
    ).toBe(false);
    expect(
      await verifyHumanToken(
        "secret",
        "token",
        undefined,
        vi.fn(async () => {
          throw new Error("network down");
        }),
      ),
    ).toBe(false);
    expect(await verifyHumanToken("", "token")).toBe(false);
    expect(await verifyHumanToken("secret", "")).toBe(false);
  });

  it("is off without a secret and on with one", () => {
    expect(humanVerificationFromSecret(undefined)).toBeUndefined();
    expect(humanVerificationFromSecret("  ")).toBeUndefined();
    expect(humanVerificationFromSecret("secret")).toBeDefined();
  });
});
