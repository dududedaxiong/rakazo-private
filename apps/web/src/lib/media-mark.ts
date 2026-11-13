/**
 * A generated-media attribution line, persisted as its own text block after
 * the image or video: "经 <model>" or "经 <model> · <preset>".
 */
export type MediaMark = {
  modelId: string;
  presetName?: string;
};

export function parseMediaMark(text: string): MediaMark | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("经 ") || trimmed.includes("\n")) return null;
  const rest = trimmed.slice(2).trim();
  if (!rest) return null;
  const sep = rest.indexOf(" · ");
  if (sep === -1) return { modelId: rest };
  const modelId = rest.slice(0, sep).trim();
  const presetName = rest.slice(sep + 3).trim();
  if (!modelId) return null;
  return presetName ? { modelId, presetName } : { modelId };
}
