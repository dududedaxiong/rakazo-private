import type { ModelHealthReport, ModelHealthSummary } from "@rakazo/contracts";
import { parseModelFallbackFailure } from "@rakazo/core";
import type { MobileModel, MobileModelCredential } from "./mobile-types";

/** A model a health check answered, ready to switch to. */
export type AvailableModel = {
  provider: string;
  modelId: string;
  /** The catalog label when the model is in it, otherwise the model id. */
  label: string;
};

/** The probe a failed run's error card and details sheet share. */
export type AvailableModelProbe = {
  /** False for errors no provider test can fix, or once the run is handled. */
  available: boolean;
  status: "idle" | "testing" | "done" | "failed";
  models: AvailableModel[];
  /** "provider:modelId" of the model being switched to, while a switch runs. */
  switchingKey: string | null;
  onTest: () => void;
  onSelect: (model: AvailableModel) => void;
};

export function availableModelKey(model: AvailableModel): string {
  return `${model.provider}:${model.modelId}`;
}

/** Only provider and model failures can be fixed by testing other models. */
export function isProviderModelError(
  error: {
    recovery?: "connection" | "model";
    kind?: string;
  } | null,
): boolean {
  return error?.recovery === "connection" || error?.recovery === "model";
}

/**
 * The providers a failed run involved: the bot's main provider first, then
 * the fallback models the run actually tried. A rejected main key takes its
 * whole provider down, so the fallbacks are what may still answer.
 */
export function probeProviderIds(
  details: string | null,
  mainProvider: string | null | undefined,
): string[] {
  const providers: string[] = [];
  const add = (provider: string | null | undefined) => {
    const id = provider?.trim();
    if (id && !providers.includes(id)) providers.push(id);
  };
  add(mainProvider);
  const fallback = details ? parseModelFallbackFailure(details) : undefined;
  for (const backup of fallback?.backups ?? []) add(backup.provider);
  return providers;
}

/**
 * The models that answered, one button each. Labels come from the catalog;
 * when two providers offer the same label, the connection label tells them apart.
 */
export function availableModelsFromReports(
  reports: readonly ModelHealthReport[],
  catalog: readonly MobileModel[],
): AvailableModel[] {
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const report of reports) {
    for (const modelId of report.ok) {
      const key = JSON.stringify([report.provider, modelId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = catalog.find(
        (item) => item.provider === report.provider && item.id === modelId,
      );
      models.push({ provider: report.provider, modelId, label: entry?.label ?? modelId });
    }
  }
  const labelCounts = new Map<string, number>();
  for (const model of models) labelCounts.set(model.label, (labelCounts.get(model.label) ?? 0) + 1);
  if ([...labelCounts.values()].every((count) => count === 1)) return models;
  return models.map((model) => {
    if ((labelCounts.get(model.label) ?? 0) <= 1) return model;
    const connection = reports.find((report) => report.provider === model.provider)?.label;
    return { ...model, label: connection ? `${model.label} (${connection})` : model.label };
  });
}

/** How long one provider test may run, as on the model connection screen. */
export const TEST_PROVIDER_TIMEOUT_MS = 120_000;

/**
 * Merges one report per connection into a single report for a dialog: totals
 * and summaries add up, and a model offered by several connections gets its
 * connection label so the rows stay distinct.
 */
export function mergeHealthReports(
  reports: readonly ModelHealthReport[],
): ModelHealthReport | null {
  if (reports.length === 0) return null;
  const modelCounts = new Map<string, number>();
  for (const report of reports) {
    for (const row of report.results) {
      modelCounts.set(row.model, (modelCounts.get(row.model) ?? 0) + 1);
    }
  }
  const summary: ModelHealthSummary = {
    ok: 0,
    empty: 0,
    limited: 0,
    auth: 0,
    notfound: 0,
    badreq: 0,
    servererr: 0,
    timeout: 0,
    neterr: 0,
  };
  for (const report of reports) {
    for (const [key, count] of Object.entries(report.summary)) {
      summary[key as keyof ModelHealthSummary] += count;
    }
  }
  return {
    label: reports.map((report) => report.label).join(" · "),
    provider: reports[0]?.provider ?? "",
    total: reports.reduce((sum, report) => sum + report.total, 0),
    truncated: reports.some((report) => report.truncated),
    ok: reports.flatMap((report) => report.ok),
    results: reports.flatMap((report) =>
      report.results.map((row) => ({
        ...row,
        model: (modelCounts.get(row.model) ?? 0) > 1 ? `${row.model} (${report.label})` : row.model,
      })),
    ),
    summary,
  };
}

/** The RPC surface the probe needs; the hook adapts the real rpc to it. */
export type AvailableModelProbeDeps = {
  credentials: () => Promise<readonly MobileModelCredential[]>;
  catalog: () => Promise<readonly MobileModel[]>;
  testProvider: (credentialId: string) => Promise<ModelHealthReport>;
};

/**
 * Tests every connection of the failed run's providers and returns the models
 * that answered. One provider failing does not hide the others; when every
 * test fails the probe itself failed and the caller reports that instead of
 * an empty list.
 */
export async function probeAvailableModels(
  deps: AvailableModelProbeDeps,
  details: string | null,
  mainProvider: string | null | undefined,
): Promise<AvailableModel[]> {
  const providers = probeProviderIds(details, mainProvider);
  if (providers.length === 0) return [];
  const [credentials, catalog] = await Promise.all([deps.credentials(), deps.catalog()]);
  const targets = credentials.filter((credential) => providers.includes(credential.provider));
  const settled = await Promise.allSettled(
    targets.map((credential) => deps.testProvider(credential.id)),
  );
  const reports = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (targets.length > 0 && reports.length === 0) {
    throw new Error("Could not test these models");
  }
  return availableModelsFromReports(reports, catalog);
}
