// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VoiceSettings from "../app/(settings)/voice";
import { saveDeviceVoiceEnabled } from "./device-voice";
import { queryClient } from "./query";
import { loadVoiceSource } from "./voice-direction";

const mocks = vi.hoisted(() => ({
  calls: vi.fn(),
  waiting: vi.fn(),
  greeting: vi.fn(),
  saveGreeting: vi.fn(),
  saveCalls: vi.fn(),
  saveWaiting: vi.fn(),
  cue: vi.fn(),
  focused: true,
  failStatus: false,
  loadDevice: vi.fn(),
  loadOnDevice: vi.fn(async () => false),
  saveOnDevice: vi.fn(async () => undefined),
  onDeviceStatus: vi.fn(async () => ({ stt: "missing", tts: "missing", progress: null })),
  reads: [] as string[],
  sent: [] as Array<{ method: string; input?: unknown }>,
  rpc: null as null | ((method: string) => Promise<unknown>),
  typed: {} as Record<string, (value: string) => void>,
  t: (text: string) => text,
}));
vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => {
    useEffect(() => {
      if (mocks.focused) callback();
    }, [callback, mocks.focused]);
  },
  useLocalSearchParams: () => ({}),
}));
vi.mock("./call-sounds", () => ({
  loadCallSoundsEnabled: mocks.calls,
  loadWaitSoundEnabled: mocks.waiting,
  loadCallGreetingEnabled: mocks.greeting,
  saveCallGreetingEnabled: mocks.saveGreeting,
  saveCallSoundsEnabled: mocks.saveCalls,
  saveWaitSoundEnabled: mocks.saveWaiting,
  playCallCue: mocks.cue,
}));
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  currentApiBase: () => "https://app.example.test",
  selectedSpaceId: () => "space-fixture",
  captureApiRequestContext: async () => ({ apiBase: "https://app.example.test", headers: {} }),
  rpc: async (method: string, input?: unknown) => {
    mocks.sent.push({ method, input });
    if (mocks.rpc) return mocks.rpc(method);
    if (mocks.failStatus && method === "voice/status") throw new Error("offline");
    mocks.reads.push(method);
    if (method === "voice/catalog")
      return [{ id: "elevenlabs", name: "ElevenLabs", description: "", transcribe: true }];
    return method === "voice/status" ? { configured: false, ready: false, provider: null } : [];
  },
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => 1 }));
vi.mock("./device-voice", () => ({
  loadDeviceVoiceEnabled: mocks.loadDevice,
  saveDeviceVoiceEnabled: vi.fn(),
}));
// The screen reads the per-direction sources from SecureStore; the real
// module pulls the native module graph into this jsdom test.
vi.mock("./voice-direction", () => ({
  VOICE_SOURCE_AUTO: "auto",
  loadVoiceSource: vi.fn(async () => "auto"),
  saveVoiceSource: vi.fn(async () => undefined),
  serverVoiceSource: (provider: string) => `server:${provider}`,
  serverProviderOf: (source: string) => {
    if (!source.startsWith("server:")) return undefined;
    const provider = source.slice("server:".length);
    return provider && !/\s/.test(provider) ? provider : undefined;
  },
}));
vi.mock("./dictation", () => ({ recognitionSupported: vi.fn(async () => false) }));
vi.mock("./on-device-speech", () => ({
  loadOnDeviceSpeechEnabled: mocks.loadOnDevice,
  saveOnDeviceSpeechEnabled: mocks.saveOnDevice,
  onDeviceSpeechModelsStatus: mocks.onDeviceStatus,
  getOnDeviceSpeechModelDiagnostics: vi.fn(async () => ({
    stt: { category: "stt", dirExists: false, files: [], dataDirEntries: null },
    tts: {
      category: "tts",
      dirExists: false,
      files: [],
      dataDirEntries: { expected: 392, actual: null },
    },
  })),
  onDeviceSpeechModelSizes: () => ({ sttMb: 71, ttsMb: 141, totalMb: 212 }),
  downloadOnDeviceSpeechModels: vi.fn(async () => undefined),
  downloadOnDeviceSpeechModelsFromAddress: vi.fn(async () => undefined),
  importOnDeviceSpeechModel: vi.fn(async () => undefined),
  loadOnDeviceSpeechModelBaseUrl: vi.fn(async () => ""),
  saveOnDeviceSpeechModelBaseUrl: vi.fn(async () => undefined),
  deleteOnDeviceSpeechModels: vi.fn(async () => undefined),
  getTtsInitJournal: vi.fn(async () => null),
}));
vi.mock("./voice", () => ({ speakText: vi.fn() }));
vi.mock("./i18n", () => ({ t: mocks.t, useI18n: () => ({ t: mocks.t }) }));
vi.mock("./appearance", () => ({ mobileTokens: () => ({ destructive: "red" }) }));
vi.mock("./native", () => ({ native: {}, useThemedStyles: (factory: () => unknown) => factory() }));
vi.mock("../components/row-accessories", () => ({ Checkmark: () => null, Chevron: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/native-switch", () => ({
  NativeSwitch: (props: {
    accessibilityLabel: string;
    value: boolean;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={props.accessibilityLabel}
      checked={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onValueChange(event.target.checked)}
    />
  ),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View,
    ScrollView: View,
    Text: View,
    ActivityIndicator: () => null,
    TextInput: (props: {
      accessibilityLabel?: string;
      value?: string;
      onChangeText?: (value: string) => void;
    }) => {
      if (props.accessibilityLabel && props.onChangeText)
        mocks.typed[props.accessibilityLabel] = props.onChangeText;
      return (
        <input
          aria-label={props.accessibilityLabel}
          value={props.value ?? ""}
          onChange={(event) => props.onChangeText?.(event.target.value)}
        />
      );
    },
    Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    StyleSheet: { create: (styles: unknown) => styles },
    useWindowDimensions: () => ({ fontScale: 1 }),
  };
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  queryClient.clear();
  mocks.focused = true;
  mocks.failStatus = false;
  mocks.loadDevice.mockReset().mockResolvedValue(false);
  mocks.reads.length = 0;
  mocks.sent.length = 0;
  mocks.rpc = null;
  mocks.calls.mockResolvedValue(true);
  mocks.waiting.mockResolvedValue(true);
  mocks.greeting.mockResolvedValue(true);
  mocks.saveGreeting.mockResolvedValue(undefined);
  mocks.saveCalls.mockResolvedValue(undefined);
  mocks.saveWaiting.mockResolvedValue(undefined);
  mocks.cue.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<VoiceSettings />));
}
function toggle(label: string) {
  return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}

it.each([
  ["Call sounds", "calls", "Waiting sound"],
  ["Waiting sound", "waiting", "Call sounds"],
  ["Call greeting", "greeting", "Call sounds"],
] as const)("keeps %s off and disabled when its read fails", async (label, read, other) => {
  mocks[read].mockRejectedValue(new Error("Could not load voice settings"));
  await render();
  expect(toggle(label).checked).toBe(false);
  expect(toggle(label).disabled).toBe(true);
  expect(toggle(other).checked).toBe(true);
  expect(toggle(other).disabled).toBe(false);
  expect(container.textContent).toContain("Could not load voice settings");
});

it("disables a previously loaded switch after a subsequent read failure", async () => {
  await render();
  expect(toggle("Call sounds").checked).toBe(true);
  mocks.focused = false;
  await render();
  mocks.calls.mockRejectedValue(new Error("Could not load voice settings"));
  mocks.focused = true;
  await render();
  expect(toggle("Call sounds").checked).toBe(false);
  expect(toggle("Call sounds").disabled).toBe(true);
});

it("previews only when call sounds are turned on and saved", async () => {
  mocks.calls.mockResolvedValue(false);
  await render();
  await act(async () => toggle("Call sounds").click());
  expect(mocks.saveCalls).toHaveBeenCalledWith(true);
  expect(mocks.cue).toHaveBeenCalledWith("start");
  await act(async () => toggle("Call sounds").click());
  expect(mocks.saveCalls).toHaveBeenLastCalledWith(false);
  expect(mocks.cue).toHaveBeenCalledTimes(1);
});

it("saves the call greeting switch without a preview", async () => {
  await render();
  expect(toggle("Call greeting").checked).toBe(true);
  await act(async () => toggle("Call greeting").click());
  expect(mocks.saveGreeting).toHaveBeenCalledWith(false);
  expect(toggle("Call greeting").checked).toBe(false);
  await act(async () => toggle("Call greeting").click());
  expect(mocks.saveGreeting).toHaveBeenLastCalledWith(true);
  expect(mocks.cue).not.toHaveBeenCalled();
});

it("rolls a failed save back without playing a preview", async () => {
  mocks.calls.mockResolvedValue(false);
  mocks.saveCalls.mockRejectedValue(new Error("write failed"));
  await render();
  await act(async () => toggle("Call sounds").click());
  expect(toggle("Call sounds").checked).toBe(false);
  expect(mocks.cue).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Could not save that preference");
});

it("offers a retry when the first load fails, then loads the providers again", async () => {
  mocks.failStatus = true;
  await render();
  const retry = () =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === "Retry");
  expect(container.textContent).toContain("offline");
  expect(container.textContent).not.toContain("ElevenLabs");
  const statusReads = () => mocks.reads.filter((method) => method === "voice/status").length;
  expect(statusReads()).toBe(0);

  mocks.failStatus = false;
  await act(async () => retry()!.click());
  expect(statusReads()).toBe(1);
  expect(container.textContent).toContain("ElevenLabs");
  expect(container.textContent).not.toContain("offline");
  expect(retry()).toBeUndefined();
});

it("clears a failed refresh's banner once a provider choice succeeds", async () => {
  await render();
  expect(container.textContent).toContain("ElevenLabs");
  mocks.focused = false;
  await render();
  mocks.failStatus = true;
  mocks.focused = true;
  await render();
  expect(container.textContent).toContain("offline");

  mocks.failStatus = false;
  const provider = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("ElevenLabs"),
  );
  await act(async () => provider!.click());
  expect(container.textContent).not.toContain("offline");
});

it("keeps Retry when saving 'This device' fails before the first load succeeds", async () => {
  mocks.failStatus = true;
  await render();
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
  expect(button("Retry")).toBeDefined();

  vi.mocked(saveDeviceVoiceEnabled).mockRejectedValueOnce(new Error("write failed"));
  await act(async () => button("This device")!.click());
  expect(container.textContent).toContain("write failed");
  expect(button("Retry")).toBeDefined();

  mocks.failStatus = false;
  await act(async () => button("Retry")!.click());
  expect(container.textContent).toContain("ElevenLabs");
  expect(button("Retry")).toBeUndefined();
});

it("keeps Retry when saving 'This device' succeeds before the first load does", async () => {
  mocks.failStatus = true;
  await render();
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
  await act(async () => button("This device")!.click());
  expect(saveDeviceVoiceEnabled).toHaveBeenCalledWith(true);
  expect(button("Retry")).toBeDefined();

  mocks.failStatus = false;
  await act(async () => button("Retry")!.click());
  expect(container.textContent).toContain("ElevenLabs");
  expect(button("Retry")).toBeUndefined();
});

it("keeps a device-voice read error after Retry reloads the providers", async () => {
  mocks.failStatus = true;
  mocks.loadDevice.mockRejectedValueOnce(new Error("device read failed"));
  await render();
  const retry = () =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === "Retry");
  expect(container.textContent).toContain("device read failed");

  mocks.failStatus = false;
  await act(async () => retry()!.click());
  expect(container.textContent).toContain("ElevenLabs");
  expect(container.textContent).toContain("device read failed");
});

it("drops a speech model typed for the provider an opening refresh replaces", async () => {
  const catalog = [
    { id: "fish-audio", name: "Fish Audio", description: "", transcribe: true, speechModel: true },
    { id: "elevenlabs", name: "ElevenLabs", description: "", transcribe: true, speechModel: true },
  ];
  const credentials = [
    { provider: "fish-audio", speechModel: "s1" },
    { provider: "elevenlabs", speechModel: "eleven_v3" },
  ];
  let status: Promise<unknown> = Promise.resolve({
    configured: true,
    ready: true,
    provider: "fish-audio",
  });
  mocks.rpc = async (method) =>
    method === "voice/catalog"
      ? catalog
      : method === "voice/credentials"
        ? credentials
        : method === "voice/status"
          ? status
          : [];
  await render();
  const field = () =>
    container.querySelector<HTMLInputElement>('input[aria-label="Speech model"]')!;
  expect(field().value).toBe("s1");

  mocks.focused = false;
  await render();
  let switched!: (value: unknown) => void;
  status = new Promise((resolve) => {
    switched = resolve;
  });
  mocks.focused = true;
  await render();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), "s2");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(field().value).toBe("s2");
  // The handler of the field as it showed Fish Audio, for typing that lands after the switch.
  const typeIntoFish = mocks.typed["Speech model"]!;

  await act(async () => switched({ configured: true, ready: true, provider: "elevenlabs" }));
  expect(field().value).toBe("eleven_v3");
  await act(async () => typeIntoFish("s3"));
  expect(field().value).toBe("eleven_v3");
});

it("keeps the on-device voice section collapsed until its header is opened", async () => {
  mocks.loadOnDevice.mockResolvedValueOnce(true);
  await render();
  const header = () =>
    [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("On-device voice"),
    );
  expect(container.textContent).not.toContain("Download voice models");
  await act(async () => header()!.click());
  expect(container.textContent).toContain("Download voice models");
  await act(async () => header()!.click());
  expect(container.textContent).not.toContain("Download voice models");
});

it("toggles on-device voice without expanding its section", async () => {
  mocks.loadOnDevice.mockResolvedValue(false);
  await render();
  await act(async () => toggle("On-device voice").click());
  expect(mocks.saveOnDevice).toHaveBeenCalledWith(true);
  expect(toggle("On-device voice").checked).toBe(true);
  expect(container.textContent).not.toContain("Download voice models");
});

const groqCatalog = [
  { id: "fish-audio", name: "Fish Audio", description: "", transcribe: true },
  {
    id: "groq",
    name: "Groq",
    description: "",
    transcribe: true,
    preset: {
      provider: "openai-compatible",
      baseUrl: "https://api.groq.com/openai/v1",
      sttModel: "whisper-large-v3-turbo",
    },
  },
  { id: "openai-compatible", name: "Third-party model", description: "", transcribe: true },
];
const groqCredential = {
  id: "cred-groq",
  provider: "openai-compatible",
  hasKey: true,
  isDefault: true,
  voiceId: "",
  speechModel: "",
  transcribe: true,
  endpoint: "https://api.groq.com/openai/v1",
  sttModel: "whisper-large-v3-turbo",
};

it("prefills a preset entry and connects it under its provider", async () => {
  mocks.rpc = async (method) =>
    method === "voice/catalog"
      ? groqCatalog
      : method === "voice/credentials"
        ? []
        : method === "voice/status"
          ? { configured: false, ready: false, provider: null }
          : method === "voice/connect"
            ? groqCredential
            : [];
  await render();
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
  await act(async () => button("Groq")!.click());
  const field = (label: string) =>
    container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(field("Server URL").value).toBe("https://api.groq.com/openai/v1");
  expect(field("Transcription model").value).toBe("whisper-large-v3-turbo");
  expect(container.querySelector('input[aria-label="Speech model"]')).toBeNull();
  expect(container.textContent).toContain(
    "Groq only transcribes speech. Reading aloud still uses the on-device voice.",
  );

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field("API key"),
      "gsk-test-key-123",
    );
    field("API key").dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Connect")!.click());
  const sent = mocks.sent.filter((entry) => entry.method === "voice/connect");
  expect(sent).toHaveLength(1);
  expect(sent[0]?.input).toEqual({
    provider: "openai-compatible",
    scope: "account",
    apiKey: "gsk-test-key-123",
    voiceId: undefined,
    baseUrl: "https://api.groq.com/openai/v1",
    sttModel: "whisper-large-v3-turbo",
  });
});

it("shows a connected preset entry as a voice source with a read-aloud note", async () => {
  mocks.rpc = async (method) =>
    method === "voice/catalog"
      ? groqCatalog
      : method === "voice/credentials"
        ? [groqCredential]
        : method === "voice/status"
          ? {
              configured: true,
              ready: true,
              transcribe: true,
              provider: "openai-compatible",
              voiceId: "",
            }
          : [];
  vi.mocked(loadVoiceSource).mockImplementation(async (direction) =>
    direction === "readAloud" ? "server:openai-compatible" : "auto",
  );
  try {
    await render();
    const groqButtons = [...container.querySelectorAll("button")].filter(
      (node) => node.textContent === "Groq",
    );
    expect(groqButtons).toHaveLength(3);
    expect(container.textContent).toContain(
      "Not supported in Chinese yet. Reading aloud still uses the on-device voice.",
    );
  } finally {
    vi.mocked(loadVoiceSource).mockImplementation(async () => "auto");
  }
});
