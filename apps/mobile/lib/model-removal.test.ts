import { describe, expect, it, vi } from "vitest";
import type { MobileModelCredential } from "./mobile-types";
import { removableModel, removeModelFromConnection } from "./model-removal";

vi.mock("./api", () => ({
  rpc: vi.fn(),
}));

import { rpc } from "./api";

const mockedRpc = vi.mocked(rpc);

function credential(overrides: Partial<MobileModelCredential> = {}): MobileModelCredential {
  return {
    id: "credential-1",
    provider: "openai-compatible",
    label: "OpenRouter",
    hasKey: true,
    isDefault: false,
    baseUrl: "https://example.com/v1",
    modelId: "vendor/model-1",
    enabledModelIds: ["vendor/model-1", "vendor/model-2", "vendor/model-3"],
    ...overrides,
  };
}

function choice(overrides: Record<string, unknown> = {}) {
  return {
    key: "openai-compatible:vendor/model-2",
    label: "vendor/model-2 (OpenRouter)",
    provider: "openai-compatible",
    providerLabel: "OpenRouter",
    modelId: "vendor/model-2",
    ...overrides,
  } as never;
}

describe("removableModel", () => {
  it("returns the remaining list for a model in the stored list", () => {
    expect(removableModel([credential()], choice())).toEqual({
      credential: credential(),
      remainingModelIds: ["vendor/model-1", "vendor/model-3"],
      nextModelId: "vendor/model-1",
    });
  });

  it("points the connection at the first remaining model when its default is removed", () => {
    expect(removableModel([credential()], choice({ modelId: "vendor/model-1" }))).toMatchObject({
      remainingModelIds: ["vendor/model-2", "vendor/model-3"],
      nextModelId: "vendor/model-2",
    });
  });

  it("returns null for a row with no backing connection", () => {
    expect(removableModel([credential()], choice({ providerLabel: "Other" }))).toBeNull();
  });

  it("returns null for a model that is not in the stored list", () => {
    expect(removableModel([credential()], choice({ modelId: "vendor/model-9" }))).toBeNull();
  });

  it("returns null for the connection's last model", () => {
    expect(
      removableModel(
        [credential({ enabledModelIds: ["vendor/model-1"] })],
        choice({ modelId: "vendor/model-1" }),
      ),
    ).toBeNull();
  });

  it("returns null for the space default row", () => {
    expect(
      removableModel(
        [credential()],
        choice({ provider: undefined, providerLabel: undefined, modelId: undefined }),
      ),
    ).toBeNull();
  });
});

describe("removeModelFromConnection", () => {
  it("saves the remaining list through models/connect", async () => {
    mockedRpc.mockResolvedValueOnce({ id: "credential-1" } as never);
    const target = removableModel([credential()], choice());
    expect(target).not.toBeNull();
    await removeModelFromConnection(target!);
    expect(mockedRpc).toHaveBeenCalledWith(
      "models/connect",
      {
        provider: "openai-compatible",
        credentialId: "credential-1",
        baseUrl: "https://example.com/v1",
        modelId: "vendor/model-1",
        enabledModelIds: ["vendor/model-1", "vendor/model-3"],
        makeDefault: false,
      },
      { timeoutMs: 60_000 },
    );
  });
});
