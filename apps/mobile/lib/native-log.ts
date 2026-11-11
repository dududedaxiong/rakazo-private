/**
 * The app's own native log (logcat) and memory, for the on-device speech
 * diagnostics. Android only: the speech engine's native loader logs to
 * logcat and dies with a native abort, which no JS catch can see.
 * Absent on iOS/web and in binaries built before the module existed.
 *
 * The native bridge loads lazily, so importing this module never touches
 * the native layer: screens that show the log can import it freely.
 */
type NativeLogModule = {
  readLog(maxLines: number): Promise<string>;
  memoryInfo(): Promise<{ memTotalKB: number; memAvailableKB: number }>;
};

async function nativeLogModule(): Promise<NativeLogModule | null> {
  try {
    const { requireOptionalNativeModule } = await import("expo-modules-core");
    return requireOptionalNativeModule<NativeLogModule>("RakazoNativeLog");
  } catch {
    return null;
  }
}

/** The last native log lines for the speech tags, or null when unavailable. */
export async function readNativeLog(maxLines = 500): Promise<string | null> {
  const mod = await nativeLogModule();
  if (!mod) return null;
  try {
    const text = await mod.readLog(maxLines);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export type NativeMemoryInfo = { memTotalKB: number; memAvailableKB: number };

/** Total and available RAM in KiB, or null when unavailable. */
export async function readNativeMemory(): Promise<NativeMemoryInfo | null> {
  const mod = await nativeLogModule();
  if (!mod) return null;
  try {
    const info = await mod.memoryInfo();
    if (!info || typeof info.memTotalKB !== "number" || typeof info.memAvailableKB !== "number") {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}
