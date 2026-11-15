/**
 * The media viewer title bar lays its three segments (prompt preset,
 * supplementary prompt, model) on one line when they fit, and drops the
 * longest segment to a second line when they do not — the longest segment
 * is the one most likely to be the model name.
 */

export type MediaTitleBarSegment = {
  key: "preset" | "supplementary" | "model";
  /** The full segment text, label included, as it renders. */
  text: string;
};

/** Rough rendered width: CJK and emoji run full-width, Latin runs half. */
export function estimateSegmentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[\u1100-\u115f\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 14 : 7;
  }
  return width;
}

const SEGMENT_GAP = 16;

/**
 * Splits the segments into one or two rows for `availableWidth` pixels.
 * One row when everything fits (labels, values, and gaps); otherwise the
 * longest segment goes on the second row alone and the rest stay on top.
 */
export function mediaTitleBarRows<T extends MediaTitleBarSegment>(
  segments: readonly T[],
  availableWidth: number,
): T[][] {
  if (segments.length === 0) return [];
  const total =
    segments.reduce((sum, segment) => sum + estimateSegmentWidth(segment.text), 0) +
    SEGMENT_GAP * (segments.length - 1);
  if (total <= availableWidth) return [[...segments]];
  let longest = segments[0]!;
  for (const segment of segments) {
    if (estimateSegmentWidth(segment.text) > estimateSegmentWidth(longest.text)) {
      longest = segment;
    }
  }
  const firstRow = segments.filter((segment) => segment !== longest);
  return firstRow.length ? [firstRow, [longest]] : [[longest]];
}
