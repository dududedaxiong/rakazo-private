import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

describe("voice direction sources", () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
    });
  });

  it("defaults to auto for both directions when nothing is stored", async () => {
    const { loadVoiceSource } = await import("./voice-direction");
    expect(await loadVoiceSource("input")).toBe("auto");
    expect(await loadVoiceSource("readAloud")).toBe("auto");
  });

  it("keeps input and read-aloud independent", async () => {
    const { loadVoiceSource, saveVoiceSource } = await import("./voice-direction");
    await saveVoiceSource("input", "server:groq");
    await saveVoiceSource("readAloud", "on-device");
    expect(await loadVoiceSource("input")).toBe("server:groq");
    expect(await loadVoiceSource("readAloud")).toBe("on-device");
    await saveVoiceSource("input", "auto");
    expect(await loadVoiceSource("input")).toBe("auto");
    expect(await loadVoiceSource("readAloud")).toBe("on-device");
  });

  it("falls back to auto for a stored value it does not recognise", async () => {
    const { loadVoiceSource } = await import("./voice-direction");
    store.set("rakazo.voice-input-source", "server:");
    expect(await loadVoiceSource("input")).toBe("auto");
    store.set("rakazo.voice-input-source", "carrier-pigeon");
    expect(await loadVoiceSource("input")).toBe("auto");
    store.set("rakazo.voice-input-source", "server:  ");
    expect(await loadVoiceSource("input")).toBe("auto");
  });

  it("builds and reads back server source ids", async () => {
    const { serverProviderOf, serverVoiceSource } = await import("./voice-direction");
    expect(serverVoiceSource("groq")).toBe("server:groq");
    expect(serverProviderOf("server:groq")).toBe("groq");
    expect(serverProviderOf("auto")).toBeUndefined();
    expect(serverProviderOf("on-device")).toBeUndefined();
    expect(serverProviderOf("system")).toBeUndefined();
    expect(serverProviderOf("server:")).toBeUndefined();
    expect(serverProviderOf("server:  ")).toBeUndefined();
  });

  it("stores auto instead of a source it does not recognise", async () => {
    const { loadVoiceSource, saveVoiceSource } = await import("./voice-direction");
    await saveVoiceSource("input", "server:");
    expect(await loadVoiceSource("input")).toBe("auto");
    expect(store.get("rakazo.voice-input-source")).toBe("auto");
  });

  it("rejects when SecureStore cannot read, instead of silently falling back", async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("device locked"));
    const { loadVoiceSource } = await import("./voice-direction");
    await expect(loadVoiceSource("input")).rejects.toThrow("device locked");
  });
});
