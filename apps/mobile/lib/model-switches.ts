import type { MessageBlock, ModelSwitchAttempt, ModelSwitches } from "@rakazo/contracts";

/** A timeline a sheet can render, whether it came from a message or a translation. */
export type ModelSwitchTimeline = {
  attempts: readonly ModelSwitchAttempt[];
  finalModel: string;
};

/** The attempt that produced the message: the succeeded one, else the last try. */
export function finalSwitchAttempt(switches: ModelSwitchTimeline): ModelSwitchAttempt | undefined {
  return (
    switches.attempts.find((attempt) => attempt.outcome === "succeeded") ?? switches.attempts.at(-1)
  );
}

/** The connection that ran the final attempt; distinguishes same-named models. */
export function finalSwitchProvider(switches: ModelSwitchTimeline): string | undefined {
  return finalSwitchAttempt(switches)?.provider;
}

export type ModelSwitchTimelineRow =
  | { kind: "attempt"; attempt: ModelSwitchAttempt }
  | { kind: "switch"; model: string; provider?: string }
  | { kind: "done"; model: string; provider?: string };

/**
 * The timeline rows for a switch history: each failed or skipped try, a
 * "switched to" line before the next try, and one done line for the model
 * that finally produced the message. A single successful try is just the
 * done line.
 */
export function modelSwitchTimelineRows(switches: ModelSwitchTimeline): ModelSwitchTimelineRow[] {
  const rows: ModelSwitchTimelineRow[] = [];
  const attempts = switches.attempts;
  attempts.forEach((attempt, index) => {
    if (attempt.outcome === "succeeded") {
      rows.push({ kind: "done", model: attempt.model, provider: attempt.provider });
      return;
    }
    rows.push({ kind: "attempt", attempt });
    const next = attempts[index + 1];
    if (next) rows.push({ kind: "switch", model: next.model, provider: next.provider });
  });
  if (!attempts.some((attempt) => attempt.outcome === "succeeded")) {
    rows.push({
      kind: "done",
      model: switches.finalModel,
      provider: attempts.at(-1)?.provider,
    });
  }
  return rows;
}

/**
 * The short error tag a failed attempt shows in the timeline; the full
 * errorMessage stays behind a "view error" tap. Returns an English source
 * string for t().
 */
export function switchAttemptErrorLabel(attempt: ModelSwitchAttempt): string {
  if (attempt.outcome === "skipped") return "Skipped";
  const code = (attempt.errorCode ?? "").toLowerCase();
  if (
    code === "rate_limit" ||
    code === "rate_limited" ||
    code === "429" ||
    /429/.test(attempt.errorMessage ?? "")
  ) {
    return "Rate limit (429)";
  }
  if (code === "connection" || code === "connection_error" || code === "network") {
    return "Connection error";
  }
  if (code === "timeout" || code === "timed_out") return "Timed out";
  return "Failed";
}

const CURRENT_MODEL_MARK_LINE = /(?:^|\n)当前模型: ([^\n·]+?)(?: · ([^\n]+))?\s*$/;

/**
 * Parses the trailing "当前模型: <模型名>" line the server appends to a
 * reply answered by a fallback model, or to generated media ("当前模型: X ·
 * 预设名"). Returns null when the text does not end with that line.
 */
export function parseCurrentModelMark(text: string): {
  modelId: string;
  presetName?: string;
} | null {
  const match = CURRENT_MODEL_MARK_LINE.exec(text);
  if (!match) return null;
  const modelId = match[1]?.trim();
  if (!modelId) return null;
  const presetName = match[2]?.trim();
  return presetName ? { modelId, presetName } : { modelId };
}

/** Drops the trailing "当前模型:" line from rendered text, if it is there. */
export function stripCurrentModelMark(text: string): string {
  return text.replace(CURRENT_MODEL_MARK_LINE, "");
}

/**
 * Drops the trailing "当前模型:" mark from a message's blocks, so the row
 * can show it once as the tappable bottom bar instead of as plain text.
 * Only the last block is touched, and only when it ends with the mark line.
 */
export function stripCurrentModelMarkBlocks(blocks: readonly MessageBlock[]): MessageBlock[] {
  const last = blocks.at(-1);
  if (!last || last.kind !== "text" || !last.text) return [...blocks];
  const stripped = stripCurrentModelMark(last.text);
  if (stripped === last.text) return [...blocks];
  if (!stripped) return blocks.slice(0, -1);
  return [...blocks.slice(0, -1), { ...last, text: stripped }];
}

/** Whether a message carries a switch timeline worth opening. */
export function hasModelSwitches(message: { modelSwitches?: ModelSwitches }): boolean {
  return (message.modelSwitches?.attempts.length ?? 0) > 0;
}

/** Which tappable "当前模型:" bar a bot reply gets, if any. */
export type CurrentModelBar =
  | { kind: "timeline"; switches: ModelSwitches; presetName?: string }
  | { kind: "mark"; model: string; presetName?: string };

/**
 * The bar for a bot reply: the switch-history bar when it carries a
 * timeline, the model-list bar when it only carries the trailing mark,
 * none otherwise. A user message, or a reply with neither, keeps its
 * text as-is.
 */
export function currentModelBar(
  message: { role: string; modelSwitches?: ModelSwitches },
  mark: { modelId: string; presetName?: string } | null,
): CurrentModelBar | null {
  if (message.role !== "bot" || !mark) return null;
  if (message.modelSwitches && hasModelSwitches(message)) {
    return { kind: "timeline", switches: message.modelSwitches, presetName: mark.presetName };
  }
  return { kind: "mark", model: mark.modelId, presetName: mark.presetName };
}

/**
 * The picker row a switch-history tap locates, by model id plus the
 * connection display name — so two rows for the same model on different
 * connections stay distinct. Falls back to the model id alone, then to
 * null when the model is not listed.
 */
export function locateModelChoiceKey(
  choices: readonly {
    key: string;
    modelId?: string | null;
    provider?: string | null;
    providerLabel?: string | null;
  }[],
  locate: { model: string; provider?: string | null } | null | undefined,
): string | null {
  if (!locate) return null;
  const byConnection = choices.find(
    (choice) =>
      choice.modelId === locate.model &&
      (choice.providerLabel === locate.provider || choice.provider === locate.provider),
  );
  if (byConnection) return byConnection.key;
  return choices.find((choice) => choice.modelId === locate.model)?.key ?? null;
}

/**
 * The timeline for a translation result: the attempts the server returned,
 * or a single succeeded attempt when it did not (yet) send any. The
 * translation never enters the message table, so its timeline lives only
 * in the panel that translated it.
 */
export function translationModelSwitches(
  result: { modelId: string; attempts?: readonly ModelSwitchAttempt[] },
  provider?: string | null,
): ModelSwitchTimeline {
  if (result.attempts?.length) {
    return { attempts: result.attempts, finalModel: result.modelId };
  }
  return {
    attempts: [
      {
        model: result.modelId,
        ...(provider ? { provider } : {}),
        outcome: "succeeded",
        at: new Date().toISOString(),
      },
    ],
    finalModel: result.modelId,
  };
}
