import * as SecureStore from "expo-secure-store";

export type VoiceDirection = "input" | "readAloud";

/**
 * What one direction uses. `auto` keeps the existing fallback order
 * (on-device, then the phone's own, then the default voice connection);
 * anything else pins that direction to one source, so input and read-aloud
 * can complement each other — e.g. server transcription in, on-device
 * speech out. A server source names its provider id.
 */
export type VoiceSourceId = string;

export const VOICE_SOURCE_AUTO = "auto";
export const VOICE_SOURCE_ON_DEVICE = "on-device";
export const VOICE_SOURCE_SYSTEM = "system";

export function serverVoiceSource(provider: string): VoiceSourceId {
  return `server:${provider}`;
}

/** The provider a server source names, or undefined for a local source. */
export function serverProviderOf(source: VoiceSourceId): string | undefined {
  if (!source.startsWith("server:")) return undefined;
  const provider = source.slice("server:".length);
  return provider && !/\s/.test(provider) ? provider : undefined;
}

function keyFor(direction: VoiceDirection): string {
  return direction === "input" ? "rakazo.voice-input-source" : "rakazo.voice-readaloud-source";
}

function validSource(value: string | null): VoiceSourceId {
  if (value === VOICE_SOURCE_AUTO) return value;
  if (value === VOICE_SOURCE_ON_DEVICE) return value;
  if (value === VOICE_SOURCE_SYSTEM) return value;
  if (value !== null && serverProviderOf(value)) return value;
  return VOICE_SOURCE_AUTO;
}

// Counts explicit choices, so a default worked out meanwhile never overwrites one.
let choices = 0;
let lastWrite: Promise<unknown> = Promise.resolve();

function write(direction: VoiceDirection, source: VoiceSourceId): Promise<void> {
  const next = lastWrite.then(() => SecureStore.setItemAsync(keyFor(direction), source));
  lastWrite = next.catch(() => undefined);
  return next;
}

/** The direction's saved source, or `auto` when nothing was ever picked. */
export async function loadVoiceSource(direction: VoiceDirection): Promise<VoiceSourceId> {
  const seen = choices;
  const stored = await SecureStore.getItemAsync(keyFor(direction));
  const source = validSource(stored);
  if (choices !== seen) return loadVoiceSource(direction);
  return source;
}

export function saveVoiceSource(direction: VoiceDirection, source: VoiceSourceId): Promise<void> {
  choices += 1;
  return write(direction, validSource(source));
}
