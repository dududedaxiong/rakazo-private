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

describe("removableModel without a stored list", () => {
  const deepseekConnection = () =>
    credential({
      id: "credential-test",
      label: "测试",
      modelId: "deepseek-v4.1-flash",
      enabledModelIds: undefined,
    });
  const glmConnection = () =>
    credential({
      id: "credential-test-2",
      label: "测试",
      modelId: "glm-5.3-flash",
      enabledModelIds: undefined,
    });
  const deepseekRow = () =>
    choice({
      key: "openai-compatible::deepseek-v4.1-flash",
      label: "deepseek-v4.1-flash (测试)",
      providerLabel: "测试",
      modelId: "deepseek-v4.1-flash",
    });
  const glmRow = () =>
    choice({
      key: "openai-compatible::glm-5.3-flash",
      label: "glm-5.3-flash (测试)",
      providerLabel: "测试",
      modelId: "glm-5.3-flash",
    });

  it("writes the first stored list from the picker's other models", () => {
    expect(
      removableModel([deepseekConnection(), glmConnection()], deepseekRow(), [
        deepseekRow(),
        glmRow(),
      ]),
    ).toEqual({
      credential: deepseekConnection(),
      remainingModelIds: ["glm-5.3-flash"],
      nextModelId: "glm-5.3-flash",
    });
  });

  it("returns null when the connection's only shown model is removed", () => {
    expect(removableModel([deepseekConnection()], deepseekRow(), [deepseekRow()])).toBeNull();
  });

  it("returns null without the shown rows", () => {
    expect(removableModel([deepseekConnection(), glmConnection()], deepseekRow())).toBeNull();
  });

  it("returns null when the row is not the connection's default model", () => {
    expect(
      removableModel(
        [deepseekConnection(), glmConnection()],
        choice({ providerLabel: "测试", modelId: "other-model" }),
        [deepseekRow(), glmRow()],
      ),
    ).toBeNull();
  });

  it("returns null for a native provider, which stores no enabled list", () => {
    const native = credential({
      id: "credential-native",
      provider: "openrouter",
      label: "OpenRouter",
      modelId: "vendor/model-1",
      enabledModelIds: undefined,
    });
    expect(
      removableModel(
        [native],
        choice({ provider: "openrouter", providerLabel: "OpenRouter", modelId: "vendor/model-1" }),
        [
          choice({
            provider: "openrouter",
            providerLabel: "OpenRouter",
            modelId: "vendor/model-1",
          }),
          choice({
            provider: "openrouter",
            providerLabel: "OpenRouter",
            modelId: "vendor/model-2",
          }),
        ],
      ),
    ).toBeNull();
  });

  it("prefers the connection whose stored list holds the model when labels repeat", () => {
    const unlisted = credential({
      id: "credential-a",
      label: "测试",
      modelId: "vendor/model-2",
      enabledModelIds: undefined,
    });
    const listed = credential({
      id: "credential-b",
      label: "测试",
      modelId: "vendor/model-1",
      enabledModelIds: ["vendor/model-1", "vendor/model-2"],
    });
    expect(removableModel([unlisted, listed], choice({ providerLabel: "测试" }))).toEqual({
      credential: listed,
      remainingModelIds: ["vendor/model-1"],
      nextModelId: "vendor/model-1",
    });
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

  it("saves the first stored list through models/connect", async () => {
    mockedRpc.mockResolvedValueOnce({ id: "credential-test" } as never);
    const target = removableModel(
      [
        credential({
          id: "credential-test",
          label: "测试",
          modelId: "deepseek-v4.1-flash",
          enabledModelIds: undefined,
        }),
        credential({
          id: "credential-test-2",
          label: "测试",
          modelId: "glm-5.3-flash",
          enabledModelIds: undefined,
        }),
      ],
      choice({
        key: "openai-compatible::deepseek-v4.1-flash",
        label: "deepseek-v4.1-flash (测试)",
        providerLabel: "测试",
        modelId: "deepseek-v4.1-flash",
      }),
      [
        choice({
          key: "openai-compatible::deepseek-v4.1-flash",
          label: "deepseek-v4.1-flash (测试)",
          providerLabel: "测试",
          modelId: "deepseek-v4.1-flash",
        }),
        choice({
          key: "openai-compatible::glm-5.3-flash",
          label: "glm-5.3-flash (测试)",
          providerLabel: "测试",
          modelId: "glm-5.3-flash",
        }),
      ],
    );
    expect(target).not.toBeNull();
    await removeModelFromConnection(target!);
    expect(mockedRpc).toHaveBeenCalledWith(
      "models/connect",
      {
        provider: "openai-compatible",
        credentialId: "credential-test",
        baseUrl: "https://example.com/v1",
        modelId: "glm-5.3-flash",
        enabledModelIds: ["glm-5.3-flash"],
        makeDefault: false,
      },
      { timeoutMs: 60_000 },
    );
  });
});
