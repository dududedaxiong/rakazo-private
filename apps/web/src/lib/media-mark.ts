/**
 * A generated-media attribution line, persisted as its own text block after
 * the image or video: "当前模型: <model>" or "当前模型: <model> · <preset>".
 * Older stored marks still read "经 <model>" and parse the same way.
 */
export type MediaMark = {
  modelId: string;
  presetName?: string;
};

export function parseMediaMark(text: string): MediaMark | null {
  const trimmed = text.trim();
  const prefix = trimmed.startsWith("当前模型:")
    ? "当前模型:"
    : trimmed.startsWith("经 ")
      ? "经 "
      : null;
  if (!prefix || trimmed.includes("\n")) return null;
  const rest = trimmed.slice(prefix.length).trim();
  if (!rest) return null;
  const sep = rest.indexOf(" · ");
  if (sep === -1) return { modelId: rest };
  const modelId = rest.slice(0, sep).trim();
  const presetName = rest.slice(sep + 3).trim();
  if (!modelId) return null;
  return presetName ? { modelId, presetName } : { modelId };
}
