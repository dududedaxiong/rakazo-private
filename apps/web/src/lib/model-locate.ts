import { sameModelId } from "@rakazo/core";

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

/** A row of a model list: the key, the model id, and the connection that owns it. */
export type ModelLocateChoice = {
  key: string;
  modelId?: string | null;
  provider?: string | null;
  providerLabel?: string | null;
};

/**
 * The list row a timeline model name points at, by model id plus the
 * connection display name — so two rows for the same model on different
 * connections stay distinct. The model comparison bridges an API id and
 * its catalog id (`deepseek-flash` and `deepseek-v4.1-flash`) on any
 * provider, so a third-party connection locates exactly like a native
 * one. Falls back to the model id alone, then to null when the model is
 * not listed.
 *
 * A locate without a connection (a trailing mark names only the model)
 * prefers the bot's current model row when it names that model: the reply
 * was most likely produced by the model the bot still uses, and every
 * connection here shares one provider id, so the model alone cannot tell
 * two rows for it apart.
 */
export function locateModelChoiceKey(
  choices: readonly ModelLocateChoice[],
  target: Pick<ModelLocateTarget, "model" | "provider">,
  /** The bot's current model row for this list, when the locate names no connection. */
  preferredKey?: string | null,
): string | null {
  const byConnection = choices.find(
    (choice) =>
      choice.modelId != null &&
      sameModelId(choice.modelId, target.model) &&
      (choice.providerLabel === target.provider || choice.provider === target.provider),
  );
  if (byConnection) return byConnection.key;
  if (!target.provider && preferredKey) {
    const preferred = choices.find(
      (choice) =>
        choice.key === preferredKey &&
        choice.modelId != null &&
        sameModelId(choice.modelId, target.model),
    );
    if (preferred) return preferred.key;
  }
  return (
    choices.find((choice) => choice.modelId != null && sameModelId(choice.modelId, target.model))
      ?.key ?? null
  );
}
