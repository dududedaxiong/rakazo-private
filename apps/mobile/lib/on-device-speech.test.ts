import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDPOINT_SILENCE_MS } from "./dictation";
import type { OnDeviceSpeechNative } from "./on-device-speech";
import {
  deleteOnDeviceSpeechModels,
  downloadOnDeviceSpeechModelFromAddress,
  downloadOnDeviceSpeechModels,
  downloadOnDeviceSpeechModelsFromAddress,
  finishOnDeviceSpeech,
  floatSamplesToWavBase64,
  getOnDeviceSpeechModelDiagnostics,
  getTtsInitJournal,
  importOnDeviceSpeechModel,
  listenOnDeviceSpeech,
  loadOnDeviceSpeechEnabled,
  loadOnDeviceSpeechModelBaseUrl,
  onDeviceSpeechAvailable,
  onDeviceSpeechModelSizes,
  onDeviceSpeechModelsStatus,
  saveOnDeviceSpeechEnabled,
  saveOnDeviceSpeechModelBaseUrl,
  setOnDeviceSpeechNative,
  speakOnDeviceSpeech,
  stopOnDeviceSpeech,
  stopOnDeviceSpeechPlayback,
  TtsChineseVoiceMissingError,
} from "./on-device-speech";

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
vi.mock("./i18n", () => ({
  t: (text: string, vars?: Record<string, string | number>) =>
    vars
      ? Object.entries(vars).reduce(
          (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
          text,
        )
      : text,
}));
vi.mock("./monitoring", () => ({ reportMobileError: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const sessionUser = { id: "user-1" };
vi.mock("./session", () => ({
  loadVerifiedIntegrationsScope: vi.fn(async () => ({
    apiBase: "https://api.example",
    userId: sessionUser.id,
    spaceId: "space-1",
    selectionId: null,
  })),
}));
vi.mock("./native-log", () => ({
  readNativeMemory: vi.fn(async () => ({ memTotalKB: 8_000_000, memAvailableKB: 2_000_000 })),
  readNativeLog: vi.fn(async () => null),
}));

const players: {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  emitFinish: () => void;
}[] = [];
vi.mock("expo-audio", () => ({
  createAudioPlayer: vi.fn(() => {
    const listeners = new Set<(status: Record<string, unknown>) => void>();
    const player = {
      play: vi.fn(() => {
        for (const listener of [...listeners]) listener({ didJustFinish: true });
      }),
      pause: vi.fn(),
      release: vi.fn(),
      addListener: vi.fn((_event: string, listener: (status: Record<string, unknown>) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      }),
      emitFinish: () => {
        for (const listener of [...listeners]) listener({ didJustFinish: true });
      },
    };
    players.push(player);
    return player;
  }),
  setAudioModeAsync: vi.fn(async () => undefined),
}));
const fsState = vi.hoisted(() => ({
  files: new Set<string>(),
  dirs: new Set<string>(),
  fileSizes: new Map<string, number>(),
  contents: new Map<string, string>(),
  copies: [] as Array<{ from: string; to: string }>,
  downloads: [] as Array<{ url: string; to: string }>,
  createdDirs: [] as string[],
  deleted: [] as string[],
}));
vi.mock("expo-file-system", () => {
  const joinUri = (...parts: unknown[]): string => {
    const strings = parts.flatMap((part) => {
      if (typeof part === "string") return [part];
      if (part && typeof part === "object" && "uri" in part) return [String(part.uri)];
      return [];
    });
    let out = "";
    for (const segment of strings) {
      if (!segment) continue;
      out = out ? `${out.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}` : segment;
    }
    return out;
  };
  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = joinUri(...parts);
    }
    get name() {
      return this.uri.replace(/\/+$/, "").split("/").pop() ?? "";
    }
    get exists() {
      return fsState.files.has(this.uri);
    }
    info() {
      return {
        exists: fsState.files.has(this.uri),
        size: fsState.files.has(this.uri) ? (fsState.fileSizes.get(this.uri) ?? 1) : 0,
      };
    }
    create() {
      fsState.files.add(this.uri);
    }
    write(content?: unknown) {
      fsState.files.add(this.uri);
      if (typeof content === "string") fsState.contents.set(this.uri, content);
    }
    async text() {
      return fsState.contents.get(this.uri) ?? "";
    }
    async copy(target: FakeFile, options?: { overwrite?: boolean }) {
      // Mirror the real File.copy: it rejects when the destination
      // already exists unless overwrite is passed.
      if (fsState.files.has(target.uri) && options?.overwrite !== true) {
        throw new Error("Destination already exists");
      }
      fsState.copies.push({ from: this.uri, to: target.uri });
      fsState.files.add(target.uri);
    }
    delete() {
      fsState.files.delete(this.uri);
      fsState.deleted.push(this.uri);
    }
    static createDownloadTask(url: string, destination: FakeFile) {
      fsState.downloads.push({ url, to: destination.uri });
      return {
        downloadAsync: async () => {
          fsState.files.add(destination.uri);
          return { uri: destination.uri };
        },
        release: () => undefined,
      };
    }
  }
  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = joinUri(...parts);
    }
    get name() {
      return this.uri.replace(/\/+$/, "").split("/").pop() ?? "";
    }
    get exists() {
      return fsState.files.has(this.uri) || fsState.dirs.has(this.uri);
    }
    create() {
      fsState.files.add(this.uri);
      fsState.dirs.add(this.uri);
      fsState.createdDirs.push(this.uri);
    }
    list() {
      const prefix = `${this.uri.replace(/\/+$/, "")}/`;
      const children = new Map<string, "file" | "dir">();
      for (const uri of fsState.dirs) {
        if (!uri.startsWith(prefix)) continue;
        const rest = uri.slice(prefix.length);
        if (rest && !rest.includes("/")) children.set(rest, "dir");
      }
      for (const uri of fsState.files) {
        if (!uri.startsWith(prefix)) continue;
        const rest = uri.slice(prefix.length);
        if (rest && !rest.includes("/")) children.set(rest, children.get(rest) ?? "file");
      }
      return [...children.entries()].map(([name, kind]) =>
        kind === "dir" ? new FakeDirectory(this.uri, name) : new FakeFile(this.uri, name),
      );
    }
  }
  return {
    File: FakeFile,
    Directory: FakeDirectory,
    Paths: { cache: "cache", document: "file:///doc" },
  };
});

type PcmListener = (samples: Float32Array, sampleRate: number) => void;

function fakeNative(
  options: {
    sttDownloaded?: boolean;
    ttsDownloaded?: boolean;
    sttPath?: string | null;
    ttsPath?: string | null;
    endpoint?: boolean;
  } = {},
) {
  const sttDownloaded = options.sttDownloaded ?? true;
  const ttsDownloaded = options.ttsDownloaded ?? true;
  const sttPath = options.sttPath === undefined ? "/models/stt" : options.sttPath;
  const ttsPath = options.ttsPath === undefined ? "/models/tts" : options.ttsPath;
  let text = "";
  let endpoint = options.endpoint ?? false;
  const dataListeners = new Set<PcmListener>();
  const errorListeners = new Set<(message: string) => void>();
  const stream = {
    processAudioChunk: vi.fn(async (_samples: Float32Array, _sampleRate: number) => ({
      result: { text },
      isEndpoint: endpoint,
    })),
    inputFinished: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const engine = {
    createStream: vi.fn(async () => stream),
    destroy: vi.fn(async () => undefined),
  };
  const pcm = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onData: vi.fn((callback: PcmListener) => {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    }),
    onError: vi.fn((callback: (message: string) => void) => {
      errorListeners.add(callback);
      return () => errorListeners.delete(callback);
    }),
  };
  const ttsEngine = {
    // Half a second of speech at 24 kHz: the smoke check in loadTtsEngine
    // speaks "你好" and needs a realistic length to pass.
    generateSpeech: vi.fn(async (_text: string, _options?: { sid?: number }) => ({
      samples: new Array<number>(12_000).fill(0.1),
      sampleRate: 24000,
    })),
    destroy: vi.fn(async () => undefined),
  };
  const native: OnDeviceSpeechNative = {
    createStreamingStt: vi.fn(async () => engine),
    createPcmLiveStream: vi.fn(() => pcm),
    createTts: vi.fn(async () => ttsEngine),
    ensureModel: vi.fn(
      async (
        _category: string,
        _id: string,
        opts?: { onProgress?: (p: { percent: number; phase: string }) => void },
      ) => {
        opts?.onProgress?.({ percent: 100, phase: "downloading" });
        return { localPath: "/models/downloaded" };
      },
    ),
    isModelDownloaded: vi.fn(async (category: string) =>
      category === "stt" ? sttDownloaded : ttsDownloaded,
    ),
    getModelPath: vi.fn(async (category: string) => (category === "stt" ? sttPath : ttsPath)),
    deleteModel: vi.fn(async () => undefined),
    refreshModels: vi.fn(async () => []),
    extractModel: vi.fn(async () => ({ localPath: "/models/extracted" })),
    getStorageBasePath: vi.fn(async () => "/doc"),
  };
  return {
    native,
    engine,
    stream,
    pcm,
    ttsEngine,
    hear: (next: string, end = false) => {
      text = next;
      endpoint = end;
      for (const listener of [...dataListeners]) listener(new Float32Array([0.1]), 16000);
    },
    failMic: (message = "mic failed") => {
      for (const listener of [...errorListeners]) listener(message);
    },
  };
}

let fake: ReturnType<typeof fakeNative>;

// Both models fully on disk, matching the fake engine's downloaded
// state: the recognizer's encoder, decoder and joiner plus its token
// list, and the voice model's file, voice table, token list and
// pronunciation data directory.
function seedModelFiles() {
  for (const name of [
    "encoder-epoch-99-avg-1.int8.onnx",
    "decoder-epoch-99-avg-1.int8.onnx",
    "joiner-epoch-99-avg-1.int8.onnx",
    "tokens.txt",
  ]) {
    fsState.files.add(`file:///models/stt/${name}`);
  }
  for (const name of ["model.int8.onnx", "voices.bin", "tokens.txt"]) {
    fsState.files.add(`file:///models/tts/${name}`);
  }
  for (const name of ["phontab", "phonindex", "phondata"]) {
    fsState.files.add(`file:///models/tts/espeak-ng-data/${name}`);
  }
  fsState.dirs.add("file:///models/stt");
  fsState.dirs.add("file:///models/tts");
  fsState.dirs.add("file:///models/tts/espeak-ng-data");
  fsState.files.add("file:///models/stt");
  fsState.files.add("file:///models/tts");
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  fsState.files.clear();
  fsState.dirs.clear();
  fsState.fileSizes.clear();
  fsState.contents.clear();
  fsState.copies.length = 0;
  fsState.downloads.length = 0;
  fsState.createdDirs.length = 0;
  fsState.deleted.length = 0;
  players.length = 0;
  sessionUser.id = "user-1";
  fake = fakeNative();
  setOnDeviceSpeechNative(fake.native);
  seedModelFiles();
});

afterEach(() => {
  stopOnDeviceSpeech();
  stopOnDeviceSpeechPlayback();
  setOnDeviceSpeechNative(null);
  vi.useRealTimers();
});

describe("on-device speech settings", () => {
  it("is off by default and keeps one choice per account", async () => {
    expect(await loadOnDeviceSpeechEnabled()).toBe(false);
    await saveOnDeviceSpeechEnabled(true);
    expect(await loadOnDeviceSpeechEnabled()).toBe(true);
    sessionUser.id = "user-2";
    expect(await loadOnDeviceSpeechEnabled()).toBe(false);
    sessionUser.id = "user-1";
    expect(await loadOnDeviceSpeechEnabled()).toBe(true);
    await saveOnDeviceSpeechEnabled(false);
    expect(await loadOnDeviceSpeechEnabled()).toBe(false);
  });

  it("reports the model download sizes", () => {
    expect(onDeviceSpeechModelSizes()).toEqual({ sttMb: 71, ttsMb: 141, totalMb: 212 });
  });
});

describe("on-device speech availability", () => {
  it("is false when switched off", async () => {
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });

  it("is false when a model is missing", async () => {
    await saveOnDeviceSpeechEnabled(true);
    fake = fakeNative({ ttsDownloaded: false });
    setOnDeviceSpeechNative(fake.native);
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });

  it("is true when switched on and both models are downloaded", async () => {
    await saveOnDeviceSpeechEnabled(true);
    expect(await onDeviceSpeechAvailable()).toBe(true);
    expect(fake.native.isModelDownloaded).toHaveBeenCalledWith("stt", expect.any(String));
    expect(fake.native.isModelDownloaded).toHaveBeenCalledWith("tts", expect.any(String));
  });

  it("is false when a model's files are incomplete", async () => {
    await saveOnDeviceSpeechEnabled(true);
    // The download manager still reports the model downloaded, but the
    // token list is missing, so the engine could not load it.
    fsState.files.delete("file:///models/stt/tokens.txt");
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });

  it("is false when a required file is empty", async () => {
    await saveOnDeviceSpeechEnabled(true);
    fsState.fileSizes.set("file:///models/tts/voices.bin", 0);
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });

  it("is false when the pronunciation data directory is empty", async () => {
    await saveOnDeviceSpeechEnabled(true);
    // The folder survives a partial extraction while its files do not,
    // so the directory alone must not count as a usable voice model.
    for (const name of ["phontab", "phonindex", "phondata"]) {
      fsState.files.delete(`file:///models/tts/espeak-ng-data/${name}`);
    }
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });

  it("is true when the pronunciation data directory has its files", async () => {
    await saveOnDeviceSpeechEnabled(true);
    expect(await onDeviceSpeechAvailable()).toBe(true);
  });

  it("is false when a pronunciation data file is missing", async () => {
    await saveOnDeviceSpeechEnabled(true);
    fsState.files.delete("file:///models/tts/espeak-ng-data/phondata");
    expect(await onDeviceSpeechAvailable()).toBe(false);
  });
});

describe("on-device speech model diagnostics", () => {
  const expectedSizes: Record<string, number> = {
    "file:///models/stt/encoder-epoch-99-avg-1.int8.onnx": 21_621_684,
    "file:///models/stt/decoder-epoch-99-avg-1.int8.onnx": 1_888_682,
    "file:///models/stt/joiner-epoch-99-avg-1.int8.onnx": 1_795_562,
    "file:///models/stt/encoder-epoch-99-avg-1.onnx": 40_948_171,
    "file:///models/stt/decoder-epoch-99-avg-1.onnx": 7_509_745,
    "file:///models/stt/joiner-epoch-99-avg-1.onnx": 7_109_975,
    "file:///models/stt/tokens.txt": 48_697,
    "file:///models/tts/model.int8.onnx": 114_203_914,
    "file:///models/tts/voices.bin": 53_790_720,
    "file:///models/tts/tokens.txt": 1_111,
    "file:///models/tts/lexicon-zh.txt": 2_120_131,
    "file:///models/tts/lexicon-us-en.txt": 5_956_885,
    "file:///models/tts/lexicon-gb-en.txt": 6_366_635,
    "file:///models/tts/phone-zh.fst": 88_630,
    "file:///models/tts/date-zh.fst": 59_154,
    "file:///models/tts/number-zh.fst": 64_482,
    "file:///models/tts/espeak-ng-data/phontab": 55_796,
    "file:///models/tts/espeak-ng-data/phonindex": 39_074,
    "file:///models/tts/espeak-ng-data/phondata": 550_424,
  };

  function seedCompleteDiagnostics() {
    for (const name of [
      "encoder-epoch-99-avg-1.onnx",
      "decoder-epoch-99-avg-1.onnx",
      "joiner-epoch-99-avg-1.onnx",
    ]) {
      fsState.files.add(`file:///models/stt/${name}`);
    }
    for (const name of [
      "lexicon-zh.txt",
      "lexicon-us-en.txt",
      "lexicon-gb-en.txt",
      "phone-zh.fst",
      "date-zh.fst",
      "number-zh.fst",
    ]) {
      fsState.files.add(`file:///models/tts/${name}`);
    }
    for (const [uri, size] of Object.entries(expectedSizes)) {
      fsState.fileSizes.set(uri, size);
    }
    // The release ships 391 entries under espeak-ng-data (files and
    // subdirectories, counted recursively); the seed has 3 top-level
    // files, so add 383 flat entries plus a nested voice directory.
    for (let i = 0; i < 383; i += 1) {
      fsState.files.add(`file:///models/tts/espeak-ng-data/entry-${i}`);
    }
    fsState.dirs.add("file:///models/tts/espeak-ng-data/voices");
    fsState.files.add("file:///models/tts/espeak-ng-data/voices/en");
    fsState.files.add("file:///models/tts/espeak-ng-data/voices/zh");
    fsState.dirs.add("file:///models/tts/espeak-ng-data/voices/!v");
    fsState.files.add("file:///models/tts/espeak-ng-data/voices/!v/voice1");
  }

  it("reports every file at its release size when the extraction is complete", async () => {
    seedCompleteDiagnostics();
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    expect(diagnostics.stt.dirExists).toBe(true);
    expect(diagnostics.tts.dirExists).toBe(true);
    for (const file of [...diagnostics.stt.files, ...diagnostics.tts.files]) {
      expect(file.actualSize).toBe(file.expectedSize);
    }
    expect(diagnostics.tts.dataDirEntries).toEqual({ expected: 391, actual: 391 });
    expect(diagnostics.stt.dataDirEntries).toBeNull();
  });

  it("reports a missing file", async () => {
    seedCompleteDiagnostics();
    fsState.files.delete("file:///models/tts/lexicon-zh.txt");
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    const lexicon = diagnostics.tts.files.find((file) => file.name === "lexicon-zh.txt");
    expect(lexicon?.actualSize).toBeNull();
  });

  it("reports a truncated file", async () => {
    seedCompleteDiagnostics();
    fsState.fileSizes.set("file:///models/tts/model.int8.onnx", 1_024);
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    const model = diagnostics.tts.files.find((file) => file.name === "model.int8.onnx");
    expect(model?.actualSize).toBe(1_024);
    expect(model?.expectedSize).toBe(114_203_914);
  });

  it("reports an empty pronunciation data directory", async () => {
    seedCompleteDiagnostics();
    for (const name of ["phontab", "phonindex", "phondata"]) {
      fsState.files.delete(`file:///models/tts/espeak-ng-data/${name}`);
    }
    for (let i = 0; i < 383; i += 1) {
      fsState.files.delete(`file:///models/tts/espeak-ng-data/entry-${i}`);
    }
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/en");
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/zh");
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/!v/voice1");
    fsState.dirs.delete("file:///models/tts/espeak-ng-data/voices/!v");
    fsState.dirs.delete("file:///models/tts/espeak-ng-data/voices");
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    expect(diagnostics.tts.dataDirEntries).toEqual({ expected: 391, actual: 0 });
  });

  it("reports missing nested pronunciation data when only the top level is intact", async () => {
    seedCompleteDiagnostics();
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/en");
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/zh");
    fsState.files.delete("file:///models/tts/espeak-ng-data/voices/!v/voice1");
    fsState.dirs.delete("file:///models/tts/espeak-ng-data/voices/!v");
    fsState.dirs.delete("file:///models/tts/espeak-ng-data/voices");
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    // 3 seed files + 383 flat entries; the 5 nested entries are gone.
    expect(diagnostics.tts.dataDirEntries).toEqual({ expected: 391, actual: 386 });
  });

  it("reports both models missing when their directories are gone", async () => {
    fsState.files.delete("file:///models/stt");
    fsState.files.delete("file:///models/tts");
    fsState.dirs.delete("file:///models/stt");
    fsState.dirs.delete("file:///models/tts");
    const diagnostics = await getOnDeviceSpeechModelDiagnostics();
    expect(diagnostics.stt.dirExists).toBe(false);
    expect(diagnostics.tts.dirExists).toBe(false);
    expect(diagnostics.stt.files.every((file) => file.actualSize === null)).toBe(true);
    expect(diagnostics.tts.files.every((file) => file.actualSize === null)).toBe(true);
  });
});

describe("on-device speech dictation", () => {
  it("reports interim text and finishes on endpoint", async () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    await listenOnDeviceSpeech({ onInterim, onFinal });
    fake.hear("你好");
    await vi.advanceTimersByTimeAsync(0);
    expect(onInterim).toHaveBeenCalledWith("你好");
    fake.hear("你好世界", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinal).toHaveBeenCalledWith("你好世界");
  });

  it("finishes the turn after the quiet gap when no endpoint fires", async () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    await listenOnDeviceSpeech({ onInterim, onFinal });
    fake.hear("你好");
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ENDPOINT_SILENCE_MS);
    expect(onFinal).toHaveBeenCalledWith("你好");
  });

  it("delivers what was heard when finished early", async () => {
    const onFinal = vi.fn();
    await listenOnDeviceSpeech({ onFinal });
    fake.hear("你好");
    await vi.advanceTimersByTimeAsync(0);
    finishOnDeviceSpeech();
    expect(onFinal).toHaveBeenCalledWith("你好");
  });

  it("stops without delivering when nothing was heard", async () => {
    const onFinal = vi.fn();
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal, onGiveUp });
    stopOnDeviceSpeech();
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinal).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up idle when the endpoint fires without hearing anything", async () => {
    const onFinal = vi.fn();
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal, onGiveUp });
    fake.hear("", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFinal).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledWith("idle");
  });

  it("gives up idle when the turn times out without hearing anything", async () => {
    const onFinal = vi.fn();
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal, onGiveUp });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onFinal).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledWith("idle");
  });

  it("gives up failed after repeated decode errors", async () => {
    const onFinal = vi.fn();
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal, onGiveUp });
    vi.mocked(fake.stream.processAudioChunk).mockRejectedValue(new Error("decode failed"));
    for (let i = 0; i < 5; i++) {
      fake.hear("", false);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(onFinal).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledWith("failed");
  });

  it("gives up when the speech model is not downloaded", async () => {
    fake = fakeNative({ sttPath: null });
    setOnDeviceSpeechNative(fake.native);
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal: vi.fn(), onGiveUp });
    expect(onGiveUp).toHaveBeenCalledWith("failed");
    expect(fake.native.createStreamingStt).not.toHaveBeenCalled();
  });

  it("gives up when the recognition model's files are incomplete", async () => {
    fsState.files.delete("file:///models/stt/tokens.txt");
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal: vi.fn(), onGiveUp });
    expect(onGiveUp).toHaveBeenCalledWith("failed");
    expect(fake.native.createStreamingStt).not.toHaveBeenCalled();
  });

  it("gives up when the recognizer cannot start", async () => {
    fake.native.createStreamingStt = vi.fn(async () => {
      throw new Error("no engine");
    });
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal: vi.fn(), onGiveUp });
    expect(onGiveUp).toHaveBeenCalledWith("failed");
  });

  it("gives up when the microphone errors", async () => {
    const onGiveUp = vi.fn();
    await listenOnDeviceSpeech({ onFinal: vi.fn(), onGiveUp });
    fake.failMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(onGiveUp).toHaveBeenCalledWith("failed");
  });
});

describe("on-device speech read-aloud", () => {
  it("synthesizes and plays the text", async () => {
    const spoken = await speakOnDeviceSpeech("你好世界");
    expect(spoken).toBe(true);
    expect(fake.ttsEngine.generateSpeech).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sid: expect.any(Number) }),
    );
    expect(players.length).toBeGreaterThan(0);
  });

  it("is silent for text with nothing to say", async () => {
    expect(await speakOnDeviceSpeech("   ")).toBe(false);
    expect(fake.ttsEngine.generateSpeech).not.toHaveBeenCalled();
  });

  it("is silent when the voice model is not downloaded", async () => {
    fake = fakeNative({ ttsPath: null });
    setOnDeviceSpeechNative(fake.native);
    expect(await speakOnDeviceSpeech("你好")).toBe(false);
    expect(fake.ttsEngine.generateSpeech).not.toHaveBeenCalled();
  });

  it("is silent when the voice model's files are incomplete", async () => {
    fsState.files.delete("file:///models/tts/voices.bin");
    expect(await speakOnDeviceSpeech("你好")).toBe(false);
    expect(fake.native.createTts).not.toHaveBeenCalled();
    expect(fake.ttsEngine.generateSpeech).not.toHaveBeenCalled();
  });
});

describe("on-device speech TTS init journal", () => {
  const journalUri = "file:///doc/sherpa-onnx/tts-init-journal.json";

  it("records a successful init with memory and debug logging", async () => {
    expect(await speakOnDeviceSpeech("你好")).toBe(true);
    expect(fake.native.createTts).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: "kokoro", debug: true }),
    );
    const journal = await getTtsInitJournal();
    expect(journal).toMatchObject({
      phase: "ready",
      memAvailableKB: 2_000_000,
      memTotalKB: 8_000_000,
      smokeSamples: 12_000,
      smokeSeconds: 0.5,
    });
    expect(typeof journal?.at).toBe("string");
  });

  it("records a failed init", async () => {
    vi.mocked(fake.native.createTts).mockRejectedValueOnce(new Error("boom"));
    expect(await speakOnDeviceSpeech("你好")).toBe(false);
    const journal = await getTtsInitJournal();
    expect(journal).toMatchObject({ phase: "failed", error: "boom" });
  });

  it("reports a missing Chinese lexicon instead of playing a blip", async () => {
    // Two samples at 24 kHz is a few tens of microseconds: what the engine
    // returns for Chinese when only the English lexicon is loaded.
    vi.mocked(fake.ttsEngine.generateSpeech).mockResolvedValueOnce({
      samples: [0.1, -0.2],
      sampleRate: 24000,
    });
    await expect(speakOnDeviceSpeech("你好")).rejects.toThrow(TtsChineseVoiceMissingError);
    const journal = await getTtsInitJournal();
    expect(journal).toMatchObject({
      phase: "failed",
      error: "The on-device Chinese voice data is not loaded.",
      smokeSamples: 2,
    });
    expect(journal?.smokeSeconds).toBeCloseTo(2 / 24000);
    expect(players.length).toBe(0);
  });

  it("returns null when no journal was recorded", async () => {
    expect(await getTtsInitJournal()).toBeNull();
  });

  it("returns null for a corrupt journal", async () => {
    fsState.files.add(journalUri);
    fsState.contents.set(journalUri, "not json");
    expect(await getTtsInitJournal()).toBeNull();
  });

  it("does not record an init when the model is not downloaded", async () => {
    fake = fakeNative({ ttsPath: null });
    setOnDeviceSpeechNative(fake.native);
    expect(await speakOnDeviceSpeech("你好")).toBe(false);
    expect(fake.native.createTts).not.toHaveBeenCalled();
    expect(await getTtsInitJournal()).toBeNull();
  });
});

describe("on-device speech models", () => {
  it("reports which models are on disk", async () => {
    expect(await onDeviceSpeechModelsStatus()).toEqual({
      stt: "ready",
      tts: "ready",
      progress: null,
    });
    fake = fakeNative({ sttDownloaded: false, ttsDownloaded: false });
    setOnDeviceSpeechNative(fake.native);
    expect(await onDeviceSpeechModelsStatus()).toEqual({
      stt: "missing",
      tts: "missing",
      progress: null,
    });
  });

  it("reports a model missing when its files are incomplete", async () => {
    fsState.files.delete("file:///models/tts/voices.bin");
    expect(await onDeviceSpeechModelsStatus()).toEqual({
      stt: "ready",
      tts: "missing",
      progress: null,
    });
  });

  it("downloads both models and reports progress", async () => {
    const seen: number[] = [];
    await downloadOnDeviceSpeechModels((status) => {
      if (status.progress !== null) seen.push(status.progress);
    });
    expect(fake.native.ensureModel).toHaveBeenCalledTimes(2);
    expect(fake.native.ensureModel).toHaveBeenNthCalledWith(
      1,
      "stt",
      expect.any(String),
      expect.anything(),
    );
    expect(fake.native.ensureModel).toHaveBeenNthCalledWith(
      2,
      "tts",
      expect.any(String),
      expect.anything(),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("clears a model that is marked ready but incomplete before downloading", async () => {
    fsState.files.delete("file:///models/stt/tokens.txt");
    await downloadOnDeviceSpeechModels();
    expect(fake.native.deleteModel).toHaveBeenCalledWith("stt", expect.any(String));
    expect(fake.native.deleteModel).not.toHaveBeenCalledWith("tts", expect.any(String));
    expect(fake.native.ensureModel).toHaveBeenCalledTimes(2);
  });

  it("refreshes the model lists before downloading", async () => {
    await downloadOnDeviceSpeechModels();
    expect(fake.native.refreshModels).toHaveBeenNthCalledWith(1, "stt");
    expect(fake.native.refreshModels).toHaveBeenNthCalledWith(2, "tts");
    // Without the refresh the download manager's cache starts empty and
    // ensureModel throws "Unknown model id".
    const refreshOrder = vi.mocked(fake.native.refreshModels).mock.invocationCallOrder;
    const ensureOrder = vi.mocked(fake.native.ensureModel).mock.invocationCallOrder;
    expect(refreshOrder[0]!).toBeLessThan(ensureOrder[0]!);
  });

  it("deletes both models", async () => {
    await deleteOnDeviceSpeechModels();
    expect(fake.native.deleteModel).toHaveBeenCalledWith("stt", expect.any(String));
    expect(fake.native.deleteModel).toHaveBeenCalledWith("tts", expect.any(String));
  });
});

describe("on-device speech model import", () => {
  const STT_ARCHIVE = "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23.tar.bz2";
  const TTS_ARCHIVE = "kokoro-int8-multi-lang-v1_1.tar.bz2";

  it("imports a picked STT archive to the fixed path and extracts it verified", async () => {
    await importOnDeviceSpeechModel("stt", `file:///picked/${STT_ARCHIVE}`, STT_ARCHIVE);
    expect(fsState.copies).toContainEqual({
      from: `file:///picked/${STT_ARCHIVE}`,
      to: `file:///doc/sherpa-onnx/models/stt/${STT_ARCHIVE}`,
    });
    expect(fake.native.refreshModels).toHaveBeenCalledWith("stt");
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "stt",
      expect.any(String),
      expect.objectContaining({ verifyChecksum: true }),
    );
  });

  it("imports a picked TTS archive without checksum verification", async () => {
    await importOnDeviceSpeechModel("tts", `file:///picked/${TTS_ARCHIVE}`, TTS_ARCHIVE);
    expect(fsState.copies).toContainEqual({
      from: `file:///picked/${TTS_ARCHIVE}`,
      to: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}`,
    });
    // The tts-models checksum.txt is stale upstream, so verification
    // would reject the official archive on every attempt.
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "tts",
      expect.any(String),
      expect.objectContaining({ verifyChecksum: false }),
    );
  });

  it("replaces an archive that is already at the fixed path", async () => {
    // A previous download or import may already have left an archive
    // there; the import must replace it instead of failing.
    fsState.files.add(`file:///doc/sherpa-onnx/models/stt/${STT_ARCHIVE}`);
    await importOnDeviceSpeechModel("stt", `file:///picked/${STT_ARCHIVE}`, STT_ARCHIVE);
    expect(fsState.copies).toContainEqual({
      from: `file:///picked/${STT_ARCHIVE}`,
      to: `file:///doc/sherpa-onnx/models/stt/${STT_ARCHIVE}`,
    });
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "stt",
      expect.any(String),
      expect.objectContaining({ verifyChecksum: true }),
    );
  });

  it("refuses an import whose extracted files are incomplete", async () => {
    fsState.files.delete("file:///models/stt/tokens.txt");
    await expect(
      importOnDeviceSpeechModel("stt", `file:///picked/${STT_ARCHIVE}`, STT_ARCHIVE),
    ).rejects.toThrow("Could not import the voice models.");
    expect(fake.native.deleteModel).toHaveBeenCalledWith("stt", expect.any(String));
  });

  it("refuses a picked file with the wrong name", async () => {
    await expect(
      importOnDeviceSpeechModel("stt", `file:///picked/${TTS_ARCHIVE}`, TTS_ARCHIVE),
    ).rejects.toThrow(STT_ARCHIVE);
    expect(fsState.copies).toEqual([]);
    expect(fake.native.extractModel).not.toHaveBeenCalled();
  });

  it("downloads a model from a custom address and extracts it", async () => {
    await downloadOnDeviceSpeechModelFromAddress("tts", "https://example.com/models/");
    expect(fsState.downloads).toContainEqual({
      url: `https://example.com/models/${TTS_ARCHIVE}`,
      to: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}.tmp`,
    });
    expect(fsState.copies).toContainEqual({
      from: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}.tmp`,
      to: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}`,
    });
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "tts",
      expect.any(String),
      expect.objectContaining({ verifyChecksum: false }),
    );
  });

  it("replaces an archive that is already at the fixed path when downloading from a custom address", async () => {
    fsState.files.add(`file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}`);
    await downloadOnDeviceSpeechModelFromAddress("tts", "https://example.com/models/");
    expect(fsState.copies).toContainEqual({
      from: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}.tmp`,
      to: `file:///doc/sherpa-onnx/models/tts/${TTS_ARCHIVE}`,
    });
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "tts",
      expect.any(String),
      expect.objectContaining({ verifyChecksum: false }),
    );
  });

  it("refuses a download from a custom address whose extracted files are incomplete", async () => {
    fsState.files.delete("file:///models/tts/voices.bin");
    await expect(
      downloadOnDeviceSpeechModelFromAddress("tts", "https://example.com/models/"),
    ).rejects.toThrow("Could not download the voice models.");
    expect(fake.native.deleteModel).toHaveBeenCalledWith("tts", expect.any(String));
  });

  it("refuses an empty custom address", async () => {
    await expect(downloadOnDeviceSpeechModelFromAddress("stt", "  ")).rejects.toThrow();
    expect(fsState.downloads).toEqual([]);
    expect(fake.native.extractModel).not.toHaveBeenCalled();
  });

  it("downloads only the missing models from a custom address", async () => {
    fake = fakeNative({ sttDownloaded: true, ttsDownloaded: false });
    setOnDeviceSpeechNative(fake.native);
    const seen: number[] = [];
    await downloadOnDeviceSpeechModelsFromAddress("https://example.com/models", (status) => {
      if (status.progress !== null) seen.push(status.progress);
    });
    expect(fake.native.extractModel).toHaveBeenCalledTimes(1);
    expect(fake.native.extractModel).toHaveBeenCalledWith(
      "tts",
      expect.any(String),
      expect.anything(),
    );
    expect(fsState.downloads).toHaveLength(1);
    expect(fsState.downloads[0]?.url).toBe(`https://example.com/models/${TTS_ARCHIVE}`);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("keeps one model download address per account and clears it when empty", async () => {
    expect(await loadOnDeviceSpeechModelBaseUrl()).toBe("");
    await saveOnDeviceSpeechModelBaseUrl("https://example.com/models");
    expect(await loadOnDeviceSpeechModelBaseUrl()).toBe("https://example.com/models");
    sessionUser.id = "user-2";
    expect(await loadOnDeviceSpeechModelBaseUrl()).toBe("");
    sessionUser.id = "user-1";
    expect(await loadOnDeviceSpeechModelBaseUrl()).toBe("https://example.com/models");
    await saveOnDeviceSpeechModelBaseUrl("   ");
    expect(await loadOnDeviceSpeechModelBaseUrl()).toBe("");
  });
});

describe("floatSamplesToWavBase64", () => {
  it("writes a 16-bit PCM WAV header for the samples", () => {
    const base64 = floatSamplesToWavBase64([0.5, -0.5, 0], 16000);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.subarray(start, end));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    expect(ascii(12, 16)).toBe("fmt ");
    expect(ascii(36, 40)).toBe("data");
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(bytes.length).toBe(44 + 6);
  });
});
