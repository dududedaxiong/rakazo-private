import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOverlayChainMessageIds,
  getOverlaySpeakingMessageIds,
  getOverlaySpeechProgress,
  readAloudUsesOnDevice,
  speakOverlayChain,
  stopAllOverlaySpeech,
  stopOverlayChainForMessage,
  subscribeOverlaySpeech,
} from "./overlay-speech";

const mocks = vi.hoisted(() => ({
  source: "auto",
  onDeviceAvailable: true,
  ttsReady: true,
  speakImpl: null as
    | ((
        text: string,
        opts: { signal?: AbortSignal; onPlayback?: (playback: unknown) => void },
      ) => Promise<boolean>)
    | null,
  speakCalls: [] as {
    text: string;
    signal?: AbortSignal;
    playback: { stop: ReturnType<typeof vi.fn> };
    resolve: (value: boolean) => void;
  }[],
  TtsChineseVoiceMissingError: class extends Error {},
}));

vi.mock("./on-device-speech", () => ({
  onDeviceSpeechAvailable: async () => mocks.onDeviceAvailable,
  onDeviceTtsReady: async () => mocks.ttsReady,
  speakOnDeviceSpeech: async (
    text: string,
    opts: { signal?: AbortSignal; onPlayback?: (playback: unknown) => void },
  ) => {
    if (mocks.speakImpl) return mocks.speakImpl(text, opts);
    const playback = { pause: () => undefined, resume: () => undefined, stop: vi.fn() };
    opts.onPlayback?.(playback);
    return new Promise<boolean>((resolve) => {
      // A real playback ends when its signal aborts; the pending call must
      // not hang the chain after a stop.
      opts.signal?.addEventListener("abort", () => resolve(false), { once: true });
      mocks.speakCalls.push({ text, signal: opts.signal, playback, resolve });
    });
  },
  TtsChineseVoiceMissingError: mocks.TtsChineseVoiceMissingError,
}));

vi.mock("./voice-direction", () => ({
  loadVoiceSource: async () => mocks.source,
  serverProviderOf: (source: string) =>
    source.startsWith("server:") ? source.slice("server:".length) || undefined : undefined,
}));

beforeEach(() => {
  mocks.source = "auto";
  mocks.onDeviceAvailable = true;
  mocks.ttsReady = true;
  mocks.speakImpl = null;
  mocks.speakCalls = [];
});

afterEach(() => {
  stopAllOverlaySpeech();
  mocks.speakCalls = [];
});

const item = (messageId: string, text = "hello") => ({ text, messageId });

describe("readAloudUsesOnDevice", () => {
  it("uses on-device when pinned and ready", async () => {
    mocks.source = "on-device";
    await expect(readAloudUsesOnDevice()).resolves.toBe(true);
  });

  it("falls back when pinned on-device is not ready", async () => {
    mocks.source = "on-device";
    mocks.ttsReady = false;
    await expect(readAloudUsesOnDevice()).resolves.toBe(false);
  });

  it("falls back for the system voice", async () => {
    mocks.source = "system";
    await expect(readAloudUsesOnDevice()).resolves.toBe(false);
  });

  it("falls back for a pinned server provider", async () => {
    mocks.source = "server:openrouter";
    await expect(readAloudUsesOnDevice()).resolves.toBe(false);
  });

  it("uses on-device for auto when its models are present", async () => {
    await expect(readAloudUsesOnDevice()).resolves.toBe(true);
  });

  it("falls back for auto without on-device models", async () => {
    mocks.onDeviceAvailable = false;
    await expect(readAloudUsesOnDevice()).resolves.toBe(false);
  });
});

describe("speakOverlayChain", () => {
  it("reads the chain in order and reports the sounding message", async () => {
    const changes: string[][] = [];
    const unsubscribe = subscribeOverlaySpeech(() =>
      changes.push([...getOverlaySpeakingMessageIds()]),
    );
    const done = speakOverlayChain([item("m1", "one"), item("m2", "two")]);
    expect(mocks.speakCalls.map((call) => call.text)).toEqual(["one"]);
    expect(getOverlaySpeakingMessageIds()).toEqual(new Set(["m1"]));
    mocks.speakCalls[0]!.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.speakCalls.map((call) => call.text)).toEqual(["one", "two"]);
    expect(getOverlaySpeakingMessageIds()).toEqual(new Set(["m2"]));
    mocks.speakCalls[1]!.resolve(true);
    await expect(done).resolves.toBe(true);
    expect(getOverlaySpeakingMessageIds()).toEqual(new Set());
    expect(changes).toContainEqual(["m1"]);
    expect(changes).toContainEqual(["m2"]);
    unsubscribe();
  });

  it("reports read-aloud progress per utterance of a message", async () => {
    const first = { text: "one", messageId: "m1", segmentIndex: 0, segmentTotal: 2 };
    const second = { text: "two", messageId: "m1", segmentIndex: 1, segmentTotal: 2 };
    const done = speakOverlayChain([first, second]);
    expect(getOverlaySpeechProgress()).toEqual({
      messageId: "m1",
      segmentIndex: 0,
      segmentTotal: 2,
      text: "one",
    });
    mocks.speakCalls[0]!.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOverlaySpeechProgress()).toEqual({
      messageId: "m1",
      segmentIndex: 1,
      segmentTotal: 2,
      text: "two",
    });
    mocks.speakCalls[1]!.resolve(true);
    await expect(done).resolves.toBe(true);
    expect(getOverlaySpeechProgress()).toBeNull();
  });

  it("reports no progress for a single-utterance read", async () => {
    const done = speakOverlayChain([item("m1", "one")]);
    expect(getOverlaySpeechProgress()).toBeNull();
    mocks.speakCalls[0]!.resolve(true);
    await expect(done).resolves.toBe(true);
    expect(getOverlaySpeechProgress()).toBeNull();
  });

  it("carries the translation source on the progress, so the row can show it under the panel", async () => {
    const first = {
      text: "one",
      messageId: "m1",
      segmentIndex: 0,
      segmentTotal: 2,
      source: "translation" as const,
    };
    const second = {
      text: "two",
      messageId: "m1",
      segmentIndex: 1,
      segmentTotal: 2,
      source: "translation" as const,
    };
    const done = speakOverlayChain([first, second]);
    expect(getOverlaySpeechProgress()).toEqual({
      messageId: "m1",
      segmentIndex: 0,
      segmentTotal: 2,
      text: "one",
      source: "translation",
    });
    mocks.speakCalls[0]!.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOverlaySpeechProgress()).toEqual({
      messageId: "m1",
      segmentIndex: 1,
      segmentTotal: 2,
      text: "two",
      source: "translation",
    });
    mocks.speakCalls[1]!.resolve(true);
    await expect(done).resolves.toBe(true);
    expect(getOverlaySpeechProgress()).toBeNull();
  });

  it("plays two chains at once without either stopping the other", async () => {
    const first = speakOverlayChain([item("a1", "aaa")]);
    const second = speakOverlayChain([item("b1", "bbb")]);
    expect(mocks.speakCalls.map((call) => call.text)).toEqual(["aaa", "bbb"]);
    expect(mocks.speakCalls.every((call) => !call.signal?.aborted)).toBe(true);
    expect(getOverlaySpeakingMessageIds()).toEqual(new Set(["a1", "b1"]));
    mocks.speakCalls[0]!.resolve(true);
    mocks.speakCalls[1]!.resolve(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("stopping one chain leaves the other playing", async () => {
    const first = speakOverlayChain([item("a1", "aaa")]);
    const second = speakOverlayChain([item("b1", "bbb")]);
    expect(stopOverlayChainForMessage("a1")).toBe(true);
    expect(mocks.speakCalls[0]!.signal?.aborted).toBe(true);
    expect(mocks.speakCalls[0]!.playback.stop).toHaveBeenCalled();
    expect(mocks.speakCalls[1]!.signal?.aborted).toBe(false);
    await expect(first).resolves.toBe(true);
    mocks.speakCalls[1]!.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(getOverlaySpeakingMessageIds()).toEqual(new Set());
  });

  it("stops a chain by any of its messages, not only the sounding one", async () => {
    const done = speakOverlayChain([item("a1", "aaa"), item("a2", "aab")]);
    expect(stopOverlayChainForMessage("a2")).toBe(true);
    await expect(done).resolves.toBe(true);
    expect(getOverlayChainMessageIds()).toEqual(new Set());
  });

  it("stops every chain at once", async () => {
    const first = speakOverlayChain([item("a1", "aaa")]);
    const second = speakOverlayChain([item("b1", "bbb")]);
    stopAllOverlaySpeech();
    expect(mocks.speakCalls.every((call) => call.signal?.aborted)).toBe(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("returns false when nothing was spoken", async () => {
    const done = speakOverlayChain([item("a1", "aaa")]);
    mocks.speakCalls[0]!.resolve(false);
    await expect(done).resolves.toBe(false);
  });

  it("a missing lexicon aborts the chain", async () => {
    mocks.speakImpl = async () => {
      throw new mocks.TtsChineseVoiceMissingError("no lexicon");
    };
    await expect(speakOverlayChain([item("a1", "aaa"), item("a2", "aab")])).rejects.toThrow(
      "no lexicon",
    );
    expect(getOverlayChainMessageIds()).toEqual(new Set());
  });

  it("a message that will not speak does not end the chain", async () => {
    mocks.speakImpl = async (text: string) => {
      if (text === "bad") throw new Error("bad clip");
      return true;
    };
    const done = speakOverlayChain([item("a1", "bad"), item("a2", "good")]);
    await expect(done).resolves.toBe(true);
  });
});
