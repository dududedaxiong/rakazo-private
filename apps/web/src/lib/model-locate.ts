import { modelOptionKey, sameModelId } from "@rakazo/core";

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

/**
 * Whether a settings row key is the target's model: the exact key first,
 * then the shared model-id match, so an API id and its catalog id
 * (`deepseek-flash` and `deepseek-v4.1-flash`) find each other on any
 * provider — native or a third-party connection — and in either direction.
 */
export function modelLocateRowMatches(
  rowKey: string,
  target: Pick<ModelLocateTarget, "model" | "provider">,
): boolean {
  if (rowKey === modelLocateKey(target)) return true;
  const rowModel = rowKey.includes("::") ? rowKey.slice(rowKey.indexOf("::") + 2) : rowKey;
  return sameModelId(rowModel, target.model);
}
