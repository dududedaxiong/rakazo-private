import { useSyncExternalStore } from "react";

/**
 * The AI's pointer on the computer screen, as the server observed it.
 *
 * The server captures the live desktop pointer after each computer action
 * (ComputerObservation.cursor) and sends it with the tool-completion event
 * (see tool-completion-audit: the audit payload copies cursor, width and
 * height from the observation details). The app draws a marker from this —
 * never from the noVNC cursor canvas, which follows only the user's own
 * mouse and would point at a stale place.
 *
 * Coordinates are desktop pixels, in the same space as the observed frame's
 * width/height, so the marker maps them to the displayed screen with
 * pointerDisplayPoint (which corrects for letterboxing when the frame's
 * aspect differs from the view's).
 */
export type ComputerPointer = {
  /** The bot whose pointer this is; a marker only shows its own bot's pointer. */
  botId: string;
  /** Pointer position in desktop pixels. */
  x: number;
  /** Pointer position in desktop pixels. */
  y: number;
  /** The observed frame's width, in the same desktop pixels. */
  width: number;
  /** The observed frame's height, in the same desktop pixels. */
  height: number;
  /** Monotonic sequence; a new pointer is a new object, so views re-render. */
  seq: number;
};

let pointer: ComputerPointer | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Pull the AI's pointer out of a thread event, or null when the event is not
 * a computer action with a usable pointer. Only computer_act counts: its
 * pointer is the desktop pointer the screen shows. Other tools' pointers (if
 * any) belong to other surfaces.
 */
export function extractComputerPointer(event: {
  type: string;
  botId?: string;
  payload?: Record<string, unknown> | null;
}): Omit<ComputerPointer, "seq"> | null {
  if (event.type !== "agent.tool.completed") return null;
  if (!isRecord(event.payload)) return null;
  // Only computer_act counts: its pointer is the desktop pointer the screen
  // shows. Other tools' pointers (if any) belong to other surfaces.
  if (event.payload.name !== "computer_act") return null;
  const botId = event.botId;
  if (typeof botId !== "string" || botId.length === 0) return null;
  const cursor = event.payload.cursor;
  if (!isRecord(cursor)) return null;
  const { x, y } = cursor;
  const { width, height } = event.payload;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { botId, x, y, width, height };
}

export function setComputerPointer(next: Omit<ComputerPointer, "seq">): void {
  seq += 1;
  pointer = { ...next, seq };
  notify();
}

export function computerPointer(): ComputerPointer | null {
  return pointer;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ComputerPointer | null {
  return pointer;
}

export function useComputerPointer(): ComputerPointer | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Where the pointer lands on the displayed screen, in container pixels.
 * The frame is drawn into the container preserving its aspect, so when the
 * aspects differ the frame is letterboxed; the point is mapped inside the
 * letterboxed frame rect, not the whole container. Returns null when the
 * sizes are unusable.
 */
export function pointerDisplayPoint(
  value: Pick<ComputerPointer, "x" | "y" | "width" | "height">,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } | null {
  if (
    !isFiniteNumber(containerWidth) ||
    !isFiniteNumber(containerHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null;
  }
  const frameAspect = value.width / value.height;
  const containerAspect = containerWidth / containerHeight;
  let frameWidth: number;
  let frameHeight: number;
  let offsetX: number;
  let offsetY: number;
  if (frameAspect > containerAspect) {
    frameWidth = containerWidth;
    frameHeight = containerWidth / frameAspect;
    offsetX = 0;
    offsetY = (containerHeight - frameHeight) / 2;
  } else {
    frameHeight = containerHeight;
    frameWidth = containerHeight * frameAspect;
    offsetX = (containerWidth - frameWidth) / 2;
    offsetY = 0;
  }
  return {
    x: offsetX + (value.x / value.width) * frameWidth,
    y: offsetY + (value.y / value.height) * frameHeight,
  };
}
