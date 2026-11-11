import type { ModelHealthReport } from "@rakazo/contracts";
import { modelFallbackFailure } from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import type { AvailableModelProbeDeps } from "./available-model-probe";
import {
  availableModelsFromReports,
  isProviderModelError,
  probeAvailableModels,
  probeProviderIds,
} from "./available-model-probe";
import type { MobileModel, MobileModelCredential } from "./mobile-types";

function credential(id: string, provider: string): MobileModelCredential {
  return { id, provider, label: provider, hasKey: true, isDefault: false };
}

function catalogEntry(provider: string, id: string, label: string): MobileModel {
  return { provider, id, label, billing: "api" };
}

function report(provider: string, ok: string[], label = provider): ModelHealthReport {
  return {
    label,
    provider,
    total: ok.length,
    truncated: false,
    ok,
    results: ok.map((model) => ({ model, state: "ok" as const, detail: "2", seconds: 1 })),
    summary: {
      ok: ok.length,
      empty: 0,
      limited: 0,
      auth: 0,
      notfound: 0,
      badreq: 0,
      servererr: 0,
      timeout: 0,
      neterr: 0,
    },
  };
}

describe("isProviderModelError", () => {
  it.each([{ recovery: "connection" }, { recovery: "model" }] as const)(
    "offers the probe for recovery %s",
    (error) => {
      expect(isProviderModelError(error)).toBe(true);
    },
  );

  it.each([{ recovery: undefined }, { kind: "rate" }, null] as const)(
    "offers no probe without a provider recovery: %s",
    (error) => {
      expect(isProviderModelError(error)).toBe(false);
    },
  );
});

describe("probeProviderIds", () => {
  it("tests only the bot's main provider when the run tried no fallbacks", () => {
    expect(probeProviderIds(null, "openai-compatible")).toEqual(["openai-compatible"]);
  });

  it("adds the fallback providers after the main provider, deduplicated", () => {
    const details = modelFallbackFailure("401: key rejected", [
      { provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" },
      { provider: "openai-compatible", modelId: "kimi", status: "failed", reason: "401" },
      { provider: "anthropic", modelId: "claude-haiku", status: "failed", reason: "401" },
    ]);
    expect(probeProviderIds(details, "openai-compatible")).toEqual([
      "openai-compatible",
      "anthropic",
    ]);
  });

  it("falls back to the tried providers when the bot has no main provider", () => {
    const details = modelFallbackFailure("401: key rejected", [
      { provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" },
    ]);
    expect(probeProviderIds(details, null)).toEqual(["anthropic"]);
  });

  it("returns no providers when nothing was tried and no main provider is set", () => {
    expect(probeProviderIds("plain failure text", undefined)).toEqual([]);
  });
});

describe("availableModelsFromReports", () => {
  it("flattens the answering models with catalog labels", () => {
    const models = availableModelsFromReports(
      [report("openai-compatible", ["kimi-k2", "deepseek-chat"])],
      [
        catalogEntry("openai-compatible", "kimi-k2", "Kimi K2"),
        catalogEntry("openai-compatible", "deepseek-chat", "DeepSeek Chat"),
      ],
    );
    expect(models).toEqual([
      { provider: "openai-compatible", modelId: "kimi-k2", label: "Kimi K2" },
      { provider: "openai-compatible", modelId: "deepseek-chat", label: "DeepSeek Chat" },
    ]);
  });

  it("falls back to the model id when the catalog does not know the model", () => {
    const models = availableModelsFromReports([report("openai-compatible", ["custom-model"])], []);
    expect(models).toEqual([
      { provider: "openai-compatible", modelId: "custom-model", label: "custom-model" },
    ]);
  });

  it("keeps one button per provider and model", () => {
    const models = availableModelsFromReports(
      [report("openai-compatible", ["kimi-k2"]), report("openai-compatible", ["kimi-k2", "other"])],
      [catalogEntry("openai-compatible", "kimi-k2", "Kimi K2")],
    );
    expect(models.map((model) => model.modelId)).toEqual(["kimi-k2", "other"]);
  });

  it("tells identical labels apart by connection", () => {
    const models = availableModelsFromReports(
      [
        report("openai-compatible", ["shared-model"], "GB relay"),
        report("anthropic", ["shared-model"], "Anthropic"),
      ],
      [
        catalogEntry("openai-compatible", "shared-model", "Shared"),
        catalogEntry("anthropic", "shared-model", "Shared"),
      ],
    );
    expect(models.map((model) => model.label)).toEqual(["Shared (GB relay)", "Shared (Anthropic)"]);
  });
});

describe("probeAvailableModels", () => {
  function deps(overrides: Partial<AvailableModelProbeDeps> = {}): AvailableModelProbeDeps {
    return {
      credentials: async () => [
        credential("cred-main", "openai-compatible"),
        credential("cred-backup", "anthropic"),
        credential("cred-other", "openai"),
      ],
      catalog: async () => [catalogEntry("anthropic", "claude-sonnet", "Claude Sonnet")],
      testProvider: async (credentialId) =>
        credentialId === "cred-main"
          ? report("openai-compatible", [])
          : report("anthropic", ["claude-sonnet"]),
      ...overrides,
    };
  }

  it("tests the main and fallback providers and returns the models that answered", async () => {
    const probe = deps();
    const testProvider = vi.fn(probe.testProvider);
    const details = modelFallbackFailure("401: key rejected", [
      { provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" },
    ]);
    const models = await probeAvailableModels(
      { ...probe, testProvider },
      details,
      "openai-compatible",
    );
    expect(testProvider).toHaveBeenCalledTimes(2);
    expect(testProvider).toHaveBeenCalledWith("cred-main");
    expect(testProvider).toHaveBeenCalledWith("cred-backup");
    expect(models).toEqual([
      { provider: "anthropic", modelId: "claude-sonnet", label: "Claude Sonnet" },
    ]);
  });

  it("does not test providers the failed run never touched", async () => {
    const probe = deps();
    const testProvider = vi.fn(probe.testProvider);
    await probeAvailableModels({ ...probe, testProvider }, null, "openai-compatible");
    expect(testProvider).toHaveBeenCalledTimes(1);
    expect(testProvider).toHaveBeenCalledWith("cred-main");
  });

  it("keeps the models that answered when another provider's test fails", async () => {
    const probe = deps({
      testProvider: async (credentialId) => {
        if (credentialId === "cred-main") throw new Error("unreachable");
        return report("anthropic", ["claude-sonnet"]);
      },
    });
    const details = modelFallbackFailure("401: key rejected", [
      { provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" },
    ]);
    const models = await probeAvailableModels(probe, details, "openai-compatible");
    expect(models).toEqual([
      { provider: "anthropic", modelId: "claude-sonnet", label: "Claude Sonnet" },
    ]);
  });

  it("reports a failed probe instead of an empty list when every test fails", async () => {
    const probe = deps({
      testProvider: async () => {
        throw new Error("unreachable");
      },
    });
    await expect(probeAvailableModels(probe, null, "openai-compatible")).rejects.toThrow(
      "Could not test these models",
    );
  });

  it("returns no models when no connection serves the failed providers", async () => {
    const probe = deps({ credentials: async () => [] });
    await expect(probeAvailableModels(probe, null, "openai-compatible")).resolves.toEqual([]);
  });
});
