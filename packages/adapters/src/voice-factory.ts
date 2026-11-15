import type { VoiceProvider } from "@rakazo/adapter-kit";
import type { VoiceCatalogEntry } from "@rakazo/contracts";
import { CartesiaVoiceProvider } from "./cartesia-voice.js";
import { ElevenLabsVoiceProvider } from "./elevenlabs-voice.js";
import { FishAudioVoiceProvider } from "./fish-audio-voice.js";
import {
  MACOS_VOICE_CATALOG_ENTRY,
  MACOS_VOICE_PROVIDER_ID,
  MacOsVoiceProvider,
  macOsSayAvailable,
} from "./macos-voice.js";
import { openAiCompatAllowPublicHosts } from "./openai-compatible-url.js";
import {
  OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
  OpenAiCompatibleVoiceProvider,
} from "./openai-compatible-voice.js";
import { OpenAIVoiceProvider } from "./openai-voice.js";
import { SCRIPTED_VOICE_CATALOG_ENTRY, ScriptedVoiceProvider } from "./scripted-voice.js";

export const VOICE_CATALOG = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Highest quality and cloning. Flash v2.5 for conversational calls.",
    transcribe: true,
    speechModel: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Simple TTS plus Whisper-class transcription. Reuse an OpenAI key.",
    transcribe: true,
  },
  {
    id: "cartesia",
    name: "Cartesia",
    description: "Lowest-latency Sonic voices for interruptible calls.",
    transcribe: false,
  },
  {
    id: "fish-audio",
    name: "Fish Audio",
    description: "Voice models, cloning, and expressive speech with optional transcription.",
    transcribe: true,
    speechModel: true,
    languages: true,
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast Whisper transcription.",
    transcribe: true,
    preset: {
      provider: OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
      baseUrl: "https://api.groq.com/openai/v1",
      sttModel: "whisper-large-v3-turbo",
    },
  },
  {
    id: OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
    name: "Third-party model",
    description: "Any OpenAI-compatible speech server, like Kokoro or Whisper.",
    transcribe: true,
  },
] as const;

export { SCRIPTED_VOICE_CATALOG_ENTRY };

export type HostedVoiceProviderId = (typeof VOICE_CATALOG)[number]["id"];
export type VoiceProviderId = HostedVoiceProviderId | "macos" | "scripted";

export function scriptedVoiceEnabled() {
  return process.env.AGENT_RUNTIME === "scripted";
}

export function listVoiceCatalog(
  options: { allowPrivateEndpoint?: boolean } = {},
): VoiceCatalogEntry[] {
  // A preset is a hosted service on the compatible provider: it shows only
  // where public hosts are allowed, while the compatible row itself also
  // shows for a private endpoint the operator allows.
  const catalog = VOICE_CATALOG.filter((entry) => {
    if (entry.preset?.provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID) {
      return openAiCompatAllowPublicHosts();
    }
    return (
      entry.id !== OPENAI_COMPATIBLE_VOICE_PROVIDER_ID ||
      options.allowPrivateEndpoint === true ||
      openAiCompatAllowPublicHosts()
    );
  });
  return [
    ...(macOsSayAvailable() ? [MACOS_VOICE_CATALOG_ENTRY] : []),
    ...catalog,
    ...(scriptedVoiceEnabled() ? [SCRIPTED_VOICE_CATALOG_ENTRY] : []),
  ];
}

export function voiceCatalogEntry(id: string): VoiceCatalogEntry | undefined {
  if (id === SCRIPTED_VOICE_CATALOG_ENTRY.id) return SCRIPTED_VOICE_CATALOG_ENTRY;
  if (id === MACOS_VOICE_PROVIDER_ID) return MACOS_VOICE_CATALOG_ENTRY;
  return VOICE_CATALOG.find((entry) => entry.id === id);
}

export function isVoiceProviderId(value: string): value is VoiceProviderId {
  if (value === "scripted") return scriptedVoiceEnabled();
  if (value === MACOS_VOICE_PROVIDER_ID) return macOsSayAvailable();
  return VOICE_CATALOG.some((entry) => entry.id === value);
}

export function createVoiceProvider(
  kind: string,
  options: { allowPrivateEndpoint?: boolean } = {},
): VoiceProvider {
  // A preset entry is only a shortcut: the connection runs on its provider.
  const resolved = VOICE_CATALOG.find((entry) => entry.id === kind)?.preset?.provider ?? kind;
  switch (resolved) {
    case "elevenlabs":
      return new ElevenLabsVoiceProvider();
    case "openai":
      return new OpenAIVoiceProvider();
    case "cartesia":
      return new CartesiaVoiceProvider();
    case "fish-audio":
      return new FishAudioVoiceProvider();
    case OPENAI_COMPATIBLE_VOICE_PROVIDER_ID:
      return new OpenAiCompatibleVoiceProvider({
        allowPrivateEndpoint: options.allowPrivateEndpoint,
      });
    case MACOS_VOICE_PROVIDER_ID:
      if (!macOsSayAvailable()) break;
      return new MacOsVoiceProvider();
    case "scripted":
      if (!scriptedVoiceEnabled()) break;
      return new ScriptedVoiceProvider();
    default:
      break;
  }
  throw new Error(
    `Unknown voice provider "${kind}". Use elevenlabs | openai | cartesia | fish-audio | openai-compatible.`,
  );
}

export class NoVoiceConfigured extends Error {
  readonly reason: "key" | "voice";

  constructor(reason: "key" | "voice") {
    super(
      reason === "key"
        ? "Add a voice provider key in Voice settings to turn on speaking."
        : "Pick a voice in Voice settings.",
    );
    this.reason = reason;
    this.name = "NoVoiceConfigured";
  }
}

export { isSpeechModelId, MAX_SPEAK_CHARS } from "./voice-http.js";
export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;
