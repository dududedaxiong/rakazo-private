import type { BotModelEntry, BotPromptPreset } from "@rakazo_mickvvw/contracts";

/** True when two ordered model lists hold the same entries in the same order. */
export function sameModelList(
  a: readonly BotModelEntry[] | null | undefined,
  b: readonly BotModelEntry[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((item, i) => item.provider === right[i]?.provider && item.model === right[i]?.model)
  );
}

/** True when two preset lists hold the same names and prompts in the same order. */
export function samePresetList(
  a: readonly BotPromptPreset[] | null | undefined,
  b: readonly BotPromptPreset[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((item, i) => item.name === right[i]?.name && item.prompt === right[i]?.prompt)
  );
}
