import { modelOptionKey, resolveSelectableModelId } from "@rakazo/core";

/** Which model list a timeline model name points at. */
export type ModelLocateKind = "chat" | "translation" | "image" | "video";

/** A model named in a switch timeline, with the bot that owns its list. */
export type ModelLocateTarget = {
  kind: ModelLocateKind;
  botId: string;
  model: string;
  /** The connection display name; distinguishes same-named models. */
  provider?: string;
};

/** A locate request: a target plus a fresh id so repeats re-fire the effect. */
export type ModelLocateRequest = ModelLocateTarget & { requestId: number };

/** The settings row key for a target: the bot's model-option key. */
export function modelLocateKey(target: Pick<ModelLocateTarget, "model" | "provider">): string {
  return modelOptionKey(target.provider ?? "", target.model);
}

/** The token a model id compares by: case and punctuation dropped. */
function modelToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Whether a settings row key is the target's model: the exact key first,
 * then the model token, so a display id the settings canonicalize (e.g.
 * `deepseek-v4.1-flash` shown as `deepseek-flash`) still finds its row.
 * The canonicalization is the shared one, so it tracks the settings.
 */
export function modelLocateRowMatches(
  rowKey: string,
  target: Pick<ModelLocateTarget, "model" | "provider">,
): boolean {
  if (rowKey === modelLocateKey(target)) return true;
  const rowModel = rowKey.includes("::") ? rowKey.slice(rowKey.indexOf("::") + 2) : rowKey;
  const resolved = resolveSelectableModelId([], target.provider ?? "", target.model);
  return (
    modelToken(rowModel) === modelToken(resolved) ||
    modelToken(rowModel) === modelToken(target.model)
  );
}
