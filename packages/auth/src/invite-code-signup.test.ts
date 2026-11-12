import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index.js";

/**
 * The registration form sends inviteCode and humanVerificationToken as extra body
 * fields. Better Auth strips unknown fields from the validated body, so this test
 * proves the before-hook still sees them on a real request through auth.handler.
 */
describe("invite code through the real sign-up endpoint", () => {
  function signupAuth() {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn(async () => ({
          signupsEnabled: true,
          inviteCodeEnabled: true,
          signupAllowlist: "",
          ipRegistrationLimit: 5,
          ipRegistrationHourlyThreshold: 10,
          ipCollectiveBanEnabled: false,
        })),
      },
      inviteCode: {
        findUnique: vi.fn(async () => null),
      },
      inviteCodeRedemption: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(prisma)),
    } as never;
    return createAuth(prisma, {
      secret: "test-secret-for-invite-code-signup",
      baseURL: "https://api.example.test",
      webOrigin: "https://app.example.test",
      signupsEnabled: "true",
      signupAllowlist: "",
      logger: { level: "error", log: () => undefined },
    });
  }

  const postSignup = (auth: ReturnType<typeof createAuth>, body: Record<string, unknown>) =>
    auth.handler(
      new Request("https://api.example.test/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.test" },
        body: JSON.stringify(body),
      }),
    );

  it("rejects an unknown invite code before creating the account", async () => {
    const auth = signupAuth();
    const response = await postSignup(auth, {
      email: "new@example.test",
      password: "correct horse battery staple",
      name: "New",
      inviteCode: "BADCODE12345",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INVITE_CODE" });
  });

  it("rejects a missing invite code while invite codes are required", async () => {
    const auth = signupAuth();
    const response = await postSignup(auth, {
      email: "new@example.test",
      password: "correct horse battery staple",
      name: "New",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INVITE_CODE" });
  });
});
