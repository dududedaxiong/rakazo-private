import type { VoiceCatalogEntry, VoiceCredential, VoiceInfo, VoiceStatus } from "@rakazo/contracts";
import {
  DEFAULT_COMPATIBLE_STT_MODEL,
  DEFAULT_COMPATIBLE_TTS_MODEL,
  matchVoicePresetEntry,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@rakazo/contracts";
import { fetchFresh, writeSaved } from "@rakazo/core/query";
import { isCancelledError } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadFailure } from "../../components/load-failure";
import { NativeActionButton } from "../../components/native-action-button";
import { NativeSwitch } from "../../components/native-switch";
import { Checkmark, Chevron } from "../../components/row-accessories";
import { mobileTokens } from "../../lib/appearance";
import {
  loadCallGreetingEnabled,
  loadCallSoundsEnabled,
  loadWaitSoundEnabled,
  playCallCue,
  saveCallGreetingEnabled,
  saveCallSoundsEnabled,
  saveWaitSoundEnabled,
} from "../../lib/call-sounds";
import { loadDeviceVoiceEnabled, saveDeviceVoiceEnabled } from "../../lib/device-voice";
import { recognitionSupported } from "../../lib/dictation";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { readNativeLog } from "../../lib/native-log";
import type {
  OnDeviceSpeechDiagnostics,
  OnDeviceSpeechModelCategory,
  OnDeviceSpeechModelDiagnostics,
  OnDeviceSpeechModelsStatus,
  TtsInitJournal,
} from "../../lib/on-device-speech";
import {
  deleteOnDeviceSpeechModels,
  downloadOnDeviceSpeechModels,
  downloadOnDeviceSpeechModelsFromAddress,
  getOnDeviceSpeechModelDiagnostics,
  getTtsInitJournal,
  importOnDeviceSpeechModel,
  loadOnDeviceSpeechEnabled,
  loadOnDeviceSpeechModelBaseUrl,
  onDeviceSpeechModelSizes,
  onDeviceSpeechModelsStatus,
  saveOnDeviceSpeechEnabled,
  saveOnDeviceSpeechModelBaseUrl,
} from "../../lib/on-device-speech";
import { queryClient, rpcQuery } from "../../lib/query";
import type { SettingsTarget } from "../../lib/settings-target";
import { settingsRpc, settingsTarget } from "../../lib/settings-target";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";
import { speakText } from "../../lib/voice";
import type { VoiceDirection, VoiceSourceId } from "../../lib/voice-direction";
import {
  loadVoiceSource,
  saveVoiceSource,
  serverProviderOf,
  serverVoiceSource,
  VOICE_SOURCE_AUTO,
} from "../../lib/voice-direction";

type VoiceField = "voiceId" | "speechModel" | "baseUrl" | "ttsModel" | "sttModel";

/** A Space's override is read from that Space even when another one is selected. */
const targetSpace = (target: SettingsTarget) =>
  target.scope === "space" ? target.spaceId : undefined;
const voiceReads = (target: SettingsTarget) => {
  const input = { scope: target.scope };
  const spaceId = targetSpace(target);
  return {
    catalog: rpcQuery("voice/catalog", undefined, spaceId),
    credentials: rpcQuery("voice/credentials", input, spaceId),
    status: rpcQuery("voice/status", input, spaceId),
  };
};
const voicesRead = (target: SettingsTarget, provider: string) =>
  rpcQuery("voice/voices", { provider, scope: target.scope }, targetSpace(target));

function pickProvider(
  catalog: VoiceCatalogEntry[],
  credentials: VoiceCredential[],
  status: VoiceStatus,
  preferred?: string,
) {
  const picked =
    [preferred, status.provider].find((id) => catalog.some((entry) => entry.id === id)) ??
    catalog[0]?.id ??
    "";
  // A saved connection shows as its preset entry when the address matches one.
  const cred = credentials.find((entry) => entry.provider === picked);
  return matchVoicePresetEntry(catalog, picked, cred?.endpoint)?.id ?? picked;
}

/** The credential a catalog entry connects with: its own provider, or its preset's. */
function credentialForEntry(
  catalog: VoiceCatalogEntry[],
  credentials: VoiceCredential[],
  entry: VoiceCatalogEntry,
) {
  if (!entry.preset) return credentials.find((cred) => cred.provider === entry.id);
  return credentials.find(
    (cred) => matchVoicePresetEntry(catalog, cred.provider, cred.endpoint)?.id === entry.id,
  );
}

/** What this screen showed last in this space, so a revisit paints it before refreshing. */
function cachedVoiceSettings(target: SettingsTarget) {
  const reads = voiceReads(target);
  const catalog = queryClient.getQueryData(reads.catalog.queryKey);
  const credentials = queryClient.getQueryData(reads.credentials.queryKey);
  const status = queryClient.getQueryData(reads.status.queryKey);
  if (!catalog || !credentials || !status) return null;
  const provider = pickProvider(catalog, credentials, status);
  const entry = catalog.find((item) => item.id === provider);
  const credential = entry ? credentialForEntry(catalog, credentials, entry) : undefined;
  const voices = credential ? queryClient.getQueryData(voicesRead(target, provider).queryKey) : [];
  return { catalog, credentials, status, provider, credential, voices: voices ?? [] };
}

/**
 * The voice that reads replies out loud. Opened with a Space, it edits that Space's override;
 * this device's voice and sounds stay with the device, so only the account's screen shows them.
 */
export default function VoiceSettings() {
  const params = useLocalSearchParams<{ spaceId?: string }>();
  const target = useMemo(() => settingsTarget(params.spaceId), [params.spaceId]);
  const rpc = useMemo(() => settingsRpc(target), [target]);
  const scope = target.scope;
  const deviceSettings = scope === "account";
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createVoiceStyles);
  const { t } = useI18n();
  const [cached] = useState(() => cachedVoiceSettings(target));
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>(cached?.catalog ?? []);
  const [credentials, setCredentials] = useState<VoiceCredential[]>(cached?.credentials ?? []);
  const [status, setStatus] = useState<VoiceStatus | null>(cached?.status ?? null);
  const [voices, setVoices] = useState<VoiceInfo[]>(cached?.voices ?? []);
  const [provider, setProvider] = useState(cached?.provider ?? "");
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState(cached?.credential?.voiceId ?? "");
  const [speechModel, setSpeechModel] = useState(cached?.credential?.speechModel ?? "");
  const [baseUrl, setBaseUrl] = useState(cached?.credential?.endpoint ?? "");
  const [ttsModel, setTtsModel] = useState(cached?.credential?.ttsModel ?? "");
  const [sttModel, setSttModel] = useState(cached?.credential?.sttModel ?? "");
  // Fields typed into since the last load; an opening refresh keeps them only while their
  // provider stays selected.
  const edited = useRef(new Set<VoiceField>());
  // The provider chosen last, ahead of the render that shows it, so a field still showing the
  // previous provider cannot type into the next one.
  const selectedProvider = useRef(provider);
  // Every load and action bumps this, so an older refresh never lands over a newer choice.
  const loadRevision = useRef(0);
  const speechModelSave = useRef<string | null>(null);
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [deviceVoiceReady, setDeviceVoiceReady] = useState(!deviceSettings);
  const [onDeviceSpeech, setOnDeviceSpeech] = useState(false);
  const [onDeviceSpeechReady, setOnDeviceSpeechReady] = useState(!deviceSettings);
  const [onDeviceExpanded, setOnDeviceExpanded] = useState(false);
  // Each direction's pinned source, or auto for the existing fallback order.
  const [inputSource, setInputSource] = useState<VoiceSourceId>(VOICE_SOURCE_AUTO);
  const [readAloudSource, setReadAloudSource] = useState<VoiceSourceId>(VOICE_SOURCE_AUTO);
  // Whether this phone ships a speech recognizer at all; unknown until probed.
  const [systemDictation, setSystemDictation] = useState<boolean | null>(null);
  const [modelStatus, setModelStatus] = useState<OnDeviceSpeechModelsStatus | null>(null);
  const [modelDiagnostics, setModelDiagnostics] = useState<OnDeviceSpeechDiagnostics | null>(null);
  const [ttsInitJournal, setTtsInitJournal] = useState<TtsInitJournal | null>(null);
  const [nativeLog, setNativeLog] = useState<string | null>(null);
  const [nativeLogLoading, setNativeLogLoading] = useState(false);
  const [nativeLogError, setNativeLogError] = useState<string | null>(null);
  // A journal left at "started" means the last init died in native code;
  // the log is grabbed once, before the ring buffer rotates it away.
  const nativeLogAutoLoaded = useRef(false);
  const [downloadingModels, setDownloadingModels] = useState(false);
  const [importingModels, setImportingModels] = useState(false);
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [callSounds, setCallSounds] = useState<boolean | null>(null);
  const [waitSound, setWaitSound] = useState<boolean | null>(null);
  const [callGreeting, setCallGreeting] = useState<boolean | null>(null);
  // Prevent stale reads from overwriting a saved preference.
  const soundPrefsRevision = useRef(0);
  const soundPrefSaving = useRef(false);
  // Only the first visit waits; a revisit paints what it saw last and refreshes behind it.
  const [loading, setLoading] = useState(!cached);
  const [pending, setPending] = useState<
    "connect" | "disconnect" | "voice" | "speech" | "test" | "device-voice" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deviceVoiceRevision = useRef(0);
  const deviceVoiceSaveInFlight = useRef(false);

  async function loadNativeLog() {
    setNativeLogLoading(true);
    setNativeLogError(null);
    try {
      const log = await readNativeLog();
      if (log) {
        setNativeLog(log);
      } else {
        setNativeLog(null);
        setNativeLogError(t("Could not read the native log."));
      }
    } catch (err) {
      setNativeLog(null);
      setNativeLogError(errorText(err, t("Could not read the native log.")));
    } finally {
      setNativeLogLoading(false);
    }
  }

  async function shareNativeLog() {
    if (!nativeLog) return;
    try {
      const [{ File, Paths }, Sharing] = await Promise.all([
        import("expo-file-system"),
        import("expo-sharing"),
      ]);
      const file = new File(Paths.cache, `rakazo-native-log-${Date.now()}.txt`);
      file.create({ overwrite: true });
      file.write(nativeLog);
      await Sharing.shareAsync(file.uri, { mimeType: "text/plain" });
    } catch (err) {
      setError(errorText(err, t("Could not share file")));
    }
  }

  /**
   * Opening keeps fields typed into meanwhile and may share a read already in flight; after a
   * change, every field takes the server's value from a read sent afterwards.
   */
  const load = useCallback(
    async (nextProvider?: string, opening = false) => {
      const revision = ++loadRevision.current;
      if (!opening) edited.current.clear();
      const reads = voiceReads(target);
      const reuse = { reuse: opening };
      const [nextCatalog, nextCredentials, nextStatus] = await Promise.all([
        fetchFresh(queryClient, reads.catalog, reuse),
        fetchFresh(queryClient, reads.credentials, reuse),
        fetchFresh(queryClient, reads.status, reuse),
      ]);
      if (revision !== loadRevision.current) return;
      setLoadError(null);
      const selected = pickProvider(nextCatalog, nextCredentials, nextStatus, nextProvider);
      if (selected !== selectedProvider.current) edited.current.clear();
      setCatalog(nextCatalog);
      setCredentials(nextCredentials);
      setStatus(nextStatus);
      selectedProvider.current = selected;
      setProvider(selected);
      const entry = nextCatalog.find((item) => item.id === selected);
      const cred = entry ? credentialForEntry(nextCatalog, nextCredentials, entry) : undefined;
      const fields: [VoiceField, (value: string) => void, string | undefined][] = [
        ["voiceId", setVoiceId, cred?.voiceId],
        ["speechModel", setSpeechModel, cred?.speechModel],
        ["baseUrl", setBaseUrl, cred?.endpoint ?? entry?.preset?.baseUrl],
        ["ttsModel", setTtsModel, cred?.ttsModel],
        ["sttModel", setSttModel, cred?.sttModel ?? entry?.preset?.sttModel],
      ];
      for (const [field, set, value] of fields) if (!edited.current.has(field)) set(value ?? "");
      if (cred) {
        const nextVoices = await fetchFresh(
          queryClient,
          voicesRead(target, entry?.preset?.provider ?? selected),
          reuse,
        );
        if (revision === loadRevision.current) setVoices(nextVoices);
      } else {
        setVoices([]);
      }
    },
    [target],
  );

  const edit = (field: VoiceField, set: (value: string) => void) => (value: string) => {
    if (provider !== selectedProvider.current) return;
    edited.current.add(field);
    set(value);
  };

  const open = useCallback(() => {
    void load(undefined, true)
      .catch((err: unknown) => {
        // A newer read replaced this one and reports for both.
        if (!isCancelledError(err))
          setLoadError(errorText(err, t("Could not load voice settings")));
      })
      .finally(() => setLoading(false));
  }, [load, t]);

  useFocusEffect(
    useCallback(() => {
      open();
      if (!deviceSettings) return;
      const revision = ++deviceVoiceRevision.current;
      void loadDeviceVoiceEnabled()
        .then((value) => {
          if (deviceVoiceSaveInFlight.current) return;
          if (deviceVoiceRevision.current !== revision) return;
          setDeviceVoice(value);
          setDeviceVoiceReady(true);
        })
        .catch((err: unknown) => {
          if (deviceVoiceSaveInFlight.current) return;
          if (deviceVoiceRevision.current !== revision) return;
          setDeviceVoiceReady(true);
          setError(errorText(err, t("Could not load voice settings")));
        });
      // On-device speech is per account and device-local; its models are
      // downloaded on demand, so the switch and the model state load together.
      void Promise.all([
        loadOnDeviceSpeechEnabled(),
        onDeviceSpeechModelsStatus(),
        loadOnDeviceSpeechModelBaseUrl(),
        getOnDeviceSpeechModelDiagnostics().catch(() => null),
        getTtsInitJournal().catch(() => null),
      ])
        .then(([enabled, status, baseUrl, diagnostics, journal]) => {
          if (deviceVoiceRevision.current !== revision) return;
          setOnDeviceSpeech(enabled);
          setModelStatus(status);
          setModelBaseUrl(baseUrl);
          setModelDiagnostics(diagnostics);
          setTtsInitJournal(journal);
          setOnDeviceSpeechReady(true);
          if (journal?.phase === "started" && !nativeLogAutoLoaded.current) {
            nativeLogAutoLoaded.current = true;
            void loadNativeLog();
          }
        })
        .catch(() => {
          if (deviceVoiceRevision.current !== revision) return;
          setOnDeviceSpeechReady(true);
        });
      // Input and read-aloud each keep their own source on this device, so
      // a phone can transcribe through one connection and speak through another.
      void Promise.all([
        loadVoiceSource("input"),
        loadVoiceSource("readAloud"),
        recognitionSupported(),
      ])
        .then(([input, readAloud, system]) => {
          if (deviceVoiceRevision.current !== revision) return;
          setInputSource(input);
          setReadAloudSource(readAloud);
          setSystemDictation(system);
        })
        .catch(() => undefined);
      const soundRevision = soundPrefsRevision.current;
      void Promise.allSettled([
        loadCallSoundsEnabled(),
        loadWaitSoundEnabled(),
        loadCallGreetingEnabled(),
      ]).then(([calls, waiting, greeting]) => {
        if (soundPrefSaving.current || soundPrefsRevision.current !== soundRevision) return;
        setCallSounds(calls.status === "fulfilled" ? calls.value : null);
        setWaitSound(waiting.status === "fulfilled" ? waiting.value : null);
        setCallGreeting(greeting.status === "fulfilled" ? greeting.value : null);
        const failed = [calls, waiting, greeting].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") {
          setError(errorText(failed.reason, t("Could not load voice settings")));
        }
      });
    }, [deviceSettings, open, t]),
  );

  /** One sound-switch save at a time; a failed save rolls back only that switch. */
  async function saveSoundPref(
    next: boolean,
    show: (value: boolean) => void,
    save: (value: boolean) => Promise<void>,
  ): Promise<boolean> {
    if (soundPrefSaving.current) return false;
    soundPrefSaving.current = true;
    soundPrefsRevision.current += 1;
    show(next);
    try {
      await save(next);
      return true;
    } catch {
      show(!next);
      setError(t("Could not save that preference"));
      return false;
    } finally {
      soundPrefSaving.current = false;
      soundPrefsRevision.current += 1;
    }
  }

  async function toggleWaitSound(next: boolean) {
    if (waitSound === null) return;
    await saveSoundPref(next, setWaitSound, saveWaitSoundEnabled);
  }

  async function toggleCallGreeting(next: boolean) {
    if (callGreeting === null) return;
    await saveSoundPref(next, setCallGreeting, saveCallGreetingEnabled);
  }

  async function toggleCallSounds(next: boolean) {
    if (callSounds === null) return;
    const saved = await saveSoundPref(next, setCallSounds, saveCallSoundsEnabled);
    // The preview is a courtesy: if it cannot play, the saved choice still stands.
    if (saved && next) await playCallCue("start").catch(() => undefined);
  }

  async function saveDeviceVoice(next: boolean): Promise<boolean> {
    deviceVoiceSaveInFlight.current = true;
    deviceVoiceRevision.current++;
    setDeviceVoice(next);
    try {
      await saveDeviceVoiceEnabled(next);
      return true;
    } catch (err) {
      setDeviceVoice(!next);
      setError(errorText(err, t("Could not save that preference")));
      return false;
    } finally {
      deviceVoiceSaveInFlight.current = false;
      deviceVoiceRevision.current++;
    }
  }

  async function toggleDeviceVoice() {
    if (pending !== null || !deviceVoiceReady) return;
    setPending("device-voice");
    setError(null);
    if (status) setLoadError(null);
    try {
      await saveDeviceVoice(!deviceVoice);
    } finally {
      setPending(null);
    }
  }

  async function toggleOnDeviceSpeech() {
    if (pending !== null || !onDeviceSpeechReady) return;
    const next = !onDeviceSpeech;
    setPending("device-voice");
    setError(null);
    try {
      await saveOnDeviceSpeechEnabled(next);
      setOnDeviceSpeech(next);
    } catch (err) {
      setError(errorText(err, t("Could not save that preference")));
    } finally {
      setPending(null);
    }
  }

  async function refreshModelDiagnostics() {
    setModelDiagnostics(await getOnDeviceSpeechModelDiagnostics().catch(() => null));
  }

  async function downloadModels() {
    if (downloadingModels || importingModels || pending !== null) return;
    setDownloadingModels(true);
    setError(null);
    try {
      const baseUrl = modelBaseUrl.trim();
      if (baseUrl) {
        await downloadOnDeviceSpeechModelsFromAddress(baseUrl, (status) => setModelStatus(status));
      } else {
        await downloadOnDeviceSpeechModels((status) => setModelStatus(status));
      }
      setModelStatus(await onDeviceSpeechModelsStatus());
    } catch (err) {
      setError(errorText(err, t("Could not download the voice models.")));
      setModelStatus(await onDeviceSpeechModelsStatus().catch(() => null));
    } finally {
      setDownloadingModels(false);
      void refreshModelDiagnostics();
    }
  }

  async function saveModelBaseUrl() {
    try {
      await saveOnDeviceSpeechModelBaseUrl(modelBaseUrl);
    } catch {
      // A failed save keeps the typed address for this visit; the
      // download uses the field, so nothing is lost.
    }
  }

  async function importModels() {
    if (importingModels || downloadingModels || pending !== null || !modelStatus) return;
    setImportingModels(true);
    setError(null);
    try {
      // Deferred: most users never import, so the picker loads only here.
      const DocumentPicker = await import("expo-document-picker");
      const missing: OnDeviceSpeechModelCategory[] = [];
      if (modelStatus.stt !== "ready") missing.push("stt");
      if (modelStatus.tts !== "ready") missing.push("tts");
      for (const category of missing) {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ["application/x-bzip2", "application/x-tar", "application/octet-stream"],
          copyToCacheDirectory: false,
        });
        if (picked.canceled || !picked.assets[0]) return;
        const asset = picked.assets[0];
        await importOnDeviceSpeechModel(category, asset.uri, asset.name);
        setModelStatus(await onDeviceSpeechModelsStatus());
      }
    } catch (err) {
      setError(errorText(err, t("Could not import the voice models.")));
      setModelStatus(await onDeviceSpeechModelsStatus().catch(() => null));
    } finally {
      setImportingModels(false);
      void refreshModelDiagnostics();
    }
  }

  async function deleteModels() {
    if (downloadingModels || importingModels || pending !== null) return;
    setPending("device-voice");
    setError(null);
    try {
      await deleteOnDeviceSpeechModels();
      setModelStatus(await onDeviceSpeechModelsStatus());
    } catch (err) {
      setError(errorText(err, t("Could not delete the voice models.")));
    } finally {
      setPending(null);
      void refreshModelDiagnostics();
    }
  }

  /** One row per expected model file: on-disk size against the release size. */
  function diagnosticRows(diagnostics: OnDeviceSpeechModelDiagnostics) {
    const label = diagnostics.category === "stt" ? "STT" : "TTS";
    const markFor = (actual: number | null, expected: number) =>
      actual === null ? "✕" : actual < expected ? "!" : "✓";
    const rows = [
      <View key={`${label}-label`} style={[styles.groupRow, styles.groupDivider]}>
        <View style={styles.rowCopy}>
          <Text style={styles.cardTitle}>{label}</Text>
        </View>
        {!diagnostics.dirExists ? (
          <Text style={[styles.cardTitle, styles.destructive]}>{t("Not imported")}</Text>
        ) : null}
      </View>,
    ];
    if (!diagnostics.dirExists) return rows;
    const renderRow = (key: string, name: string, actual: number | null, expected: number) => {
      const mark = markFor(actual, expected);
      return (
        <View key={key} style={[styles.groupRow, styles.groupDivider]}>
          <Text style={styles.diagnosticName}>{name}</Text>
          <Text style={styles.diagnosticSize}>
            {actual === null ? "—" : formatDiagnosticSize(actual)}
            {" / "}
            {formatDiagnosticSize(expected)}
          </Text>
          <Text style={[styles.diagnosticMark, mark !== "✓" && styles.destructive]}>{mark}</Text>
        </View>
      );
    };
    for (const file of diagnostics.files) {
      rows.push(renderRow(`${label}-${file.name}`, file.name, file.actualSize, file.expectedSize));
    }
    if (diagnostics.dataDirEntries) {
      const { expected, actual } = diagnostics.dataDirEntries;
      rows.push(renderRow(`${label}-espeak-ng-data`, "espeak-ng-data", actual, expected));
    }
    return rows;
  }

  /** Pins one direction to one source; the other direction is untouched. */
  async function chooseVoiceSource(direction: VoiceDirection, source: VoiceSourceId) {
    if (pending !== null) return;
    const show = direction === "input" ? setInputSource : setReadAloudSource;
    const previous = direction === "input" ? inputSource : readAloudSource;
    show(source);
    try {
      await saveVoiceSource(direction, source);
    } catch {
      show(previous);
      setError(t("Could not save that preference"));
    }
  }

  async function chooseProvider(nextProvider: string) {
    if (pending !== null || !deviceVoiceReady) return;
    const wasDeviceVoice = deviceVoice;
    const previousProvider = provider;
    loadRevision.current++;
    setPending("voice");
    setError(null);
    if (status) setLoadError(null);
    try {
      if (deviceSettings && !(await saveDeviceVoice(false))) return;
      selectedProvider.current = nextProvider;
      setProvider(nextProvider);
      const nextEntry = catalog.find((entry) => entry.id === nextProvider);
      const nextRpcProvider = nextEntry?.preset?.provider ?? nextProvider;
      const cred = nextEntry ? credentialForEntry(catalog, credentials, nextEntry) : undefined;
      if (cred?.voiceId && status?.provider !== nextRpcProvider) {
        try {
          const saved = await rpc("voice/setVoice", {
            voiceId: cred.voiceId,
            provider: nextRpcProvider,
            scope,
          });
          setStatus(saved);
          await writeSaved(queryClient, voiceReads(target).status.queryKey, () => saved);
        } catch (err) {
          selectedProvider.current = previousProvider;
          setProvider(previousProvider);
          if (wasDeviceVoice && !(await saveDeviceVoice(true))) return;
          setError(errorText(err, t("Could not save that voice")));
          return;
        }
      }
      setApiKey("");
      setVoiceId(cred?.voiceId ?? "");
      setSpeechModel(cred?.speechModel ?? "");
      setVoices([]);
      try {
        await load(nextProvider);
      } catch (err) {
        // A refresh failure must not leave another provider's voices available.
        setVoices([]);
        setError(errorText(err, t("Could not load voice settings")));
      }
    } finally {
      setPending(null);
    }
  }

  const selected = catalog.find((entry) => entry.id === provider);
  const credential = selected ? credentialForEntry(catalog, credentials, selected) : undefined;
  const hiddenSelfHosted =
    !catalog.some((entry) => entry.id === OPENAI_COMPATIBLE_PROVIDER_ID) &&
    credentials.some((entry) => entry.provider === OPENAI_COMPATIBLE_PROVIDER_ID);

  const selfHosted = selected?.id === OPENAI_COMPATIBLE_PROVIDER_ID;
  /** A preset entry prefills its hosted service; the connection lives on the preset's provider. */
  const isPreset = Boolean(selected?.preset);
  const rpcProvider = selected?.preset?.provider ?? selected?.id;
  const keyless = Boolean(selected?.keyless);
  const canConnect =
    keyless ||
    (isPreset
      ? Boolean(baseUrl.trim()) && apiKey.trim().length >= 8
      : selfHosted
        ? Boolean(baseUrl.trim())
        : apiKey.trim().length >= 8);

  // One direction's source list: auto first, then the sources this phone can
  // actually use. A source that vanished (models deleted, connection removed)
  // is not listed, and the choice falls back to auto until it returns.
  function voiceSourceOptions(direction: VoiceDirection) {
    const serverOptions = credentials.filter((cred) =>
      direction === "input" ? cred.transcribe : true,
    );
    const onDeviceReady =
      onDeviceSpeech &&
      (direction === "input" ? modelStatus?.stt === "ready" : modelStatus?.tts === "ready");
    const systemReady = direction === "input" ? systemDictation === true : true;
    const options: { id: VoiceSourceId; label: string }[] = [
      { id: VOICE_SOURCE_AUTO, label: t("Auto") },
    ];
    if (onDeviceReady) options.push({ id: "on-device", label: t("On-device voice") });
    if (systemReady) options.push({ id: "system", label: t("Device voice") });
    for (const cred of serverOptions) {
      options.push({
        id: serverVoiceSource(cred.provider),
        // A connection on a preset address shows as that preset, so Groq reads as Groq.
        label:
          matchVoicePresetEntry(catalog, cred.provider, cred.endpoint)?.name ??
          catalog.find((entry) => entry.id === cred.provider)?.name ??
          cred.provider,
      });
    }
    return options;
  }

  const inputOptions = voiceSourceOptions("input");
  const readAloudOptions = voiceSourceOptions("readAloud");
  const effectiveInputSource = inputOptions.some((option) => option.id === inputSource)
    ? inputSource
    : VOICE_SOURCE_AUTO;
  const effectiveReadAloudSource = readAloudOptions.some((option) => option.id === readAloudSource)
    ? readAloudSource
    : VOICE_SOURCE_AUTO;
  // The read-aloud source behind a preset without a speech model only
  // transcribes; reading aloud falls back to the on-device voice.
  const readAloudCredential = serverProviderOf(effectiveReadAloudSource)
    ? credentials.find((cred) => serverVoiceSource(cred.provider) === effectiveReadAloudSource)
    : undefined;
  const readAloudPreset = readAloudCredential
    ? matchVoicePresetEntry(catalog, readAloudCredential.provider, readAloudCredential.endpoint)
    : undefined;
  const readAloudTranscribeOnly = Boolean(
    readAloudPreset?.preset && readAloudPreset.preset.ttsModel === undefined,
  );

  function voiceSourceRows(
    direction: VoiceDirection,
    options: { id: VoiceSourceId; label: string }[],
    effective: VoiceSourceId,
  ) {
    return options.map((option, index) => {
      const chosen = effective === option.id;
      return (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityState={{ selected: chosen }}
          disabled={pending !== null}
          onPress={() => void chooseVoiceSource(direction, option.id)}
          style={({ pressed }) => [
            styles.groupRow,
            index > 0 && styles.groupDivider,
            pending !== null && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.rowCopy}>
            <Text style={styles.cardTitle}>{option.label}</Text>
          </View>
          {chosen ? <Checkmark /> : null}
        </Pressable>
      );
    });
  }

  async function connect() {
    if (!selected || !canConnect) return;
    setPending("connect");
    setError(null);
    if (status) setLoadError(null);
    try {
      await rpc("voice/connect", {
        provider: rpcProvider ?? selected.id,
        scope,
        apiKey: apiKey.trim(),
        // The server drops this voice when the address or speech model really changed.
        voiceId: voiceId || undefined,
        ...(selected.speechModel ? { speechModel: speechModel.trim() } : {}),
        // A preset carries only its transcription model; the speech model stays the default.
        ...(selfHosted
          ? {
              baseUrl: baseUrl.trim(),
              ttsModel: ttsModel.trim() || undefined,
              sttModel: sttModel.trim() || undefined,
            }
          : isPreset
            ? { baseUrl: baseUrl.trim(), sttModel: sttModel.trim() || undefined }
            : {}),
      });
      setApiKey("");
      await load(selected.id);
    } catch (err) {
      setError(errorText(err, t("Could not connect")));
    } finally {
      setPending(null);
    }
  }

  async function disconnect(providerId = credential?.provider) {
    if (!providerId) return;
    setPending("disconnect");
    setError(null);
    if (status) setLoadError(null);
    try {
      await rpc("voice/disconnect", { provider: providerId });
      setApiKey("");
      await load(providerId);
    } catch (err) {
      setError(errorText(err, t("Could not disconnect")));
    } finally {
      setPending(null);
    }
  }

  async function saveSpeechModel() {
    if (!credential || !selected?.speechModel || pending !== null) return;
    const next = speechModel.trim();
    if (next === (credential.speechModel ?? "")) return;
    if (speechModelSave.current === next) return;
    speechModelSave.current = next;
    setPending("speech");
    setError(null);
    if (status) setLoadError(null);
    try {
      const saved = await rpc("voice/setSpeechModel", {
        provider: rpcProvider ?? selected.id,
        scope,
        speechModel: next,
      });
      const merge = (current: VoiceCredential[] = []) =>
        current.map((entry) => (entry.id === saved.id ? { ...entry, ...saved } : entry));
      // A read still out started before this save, so it must not land; read again after it.
      loadRevision.current++;
      edited.current.delete("speechModel");
      setSpeechModel(saved.speechModel ?? "");
      setCredentials(merge);
      await writeSaved(queryClient, voiceReads(target).credentials.queryKey, merge);
      void load(selected.id, true).catch(() => undefined);
    } catch (err) {
      setError(errorText(err, t("Could not save that speech model")));
    } finally {
      speechModelSave.current = null;
      setPending(null);
    }
  }

  async function chooseVoice(nextVoiceId: string) {
    loadRevision.current++;
    setVoiceId(nextVoiceId);
    setPending("voice");
    try {
      await rpc("voice/setVoice", { voiceId: nextVoiceId, provider: rpcProvider, scope });
      await load(selected?.id);
    } catch (err) {
      setError(errorText(err, t("Could not save that voice")));
    } finally {
      setPending(null);
    }
  }

  async function testVoice() {
    setPending("test");
    setError(null);
    if (status) setLoadError(null);
    try {
      const ready = await speakText(t("Hi, this is how I'll sound when I read replies out loud."), {
        scope,
      });
      if (!ready) {
        throw new Error(t("Connect a voice provider first."));
      }
    } catch (err) {
      setError(errorText(err, t("Could not play a sample")));
    } finally {
      setPending(null);
    }
  }

  const failure = error ?? loadError;
  const shownError = error ?? (status ? loadError : null);

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {loading || !deviceVoiceReady || !onDeviceSpeechReady ? (
          <ActivityIndicator color={native.secondaryLabel} />
        ) : null}
        {failure && !status ? (
          <LoadFailure
            message={failure}
            onRetry={() => {
              setLoadError(null);
              setLoading(true);
              open();
            }}
          />
        ) : shownError ? (
          <Text style={styles.error}>{shownError}</Text>
        ) : null}
        {deviceSettings ? (
          <View style={styles.group}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: deviceVoice }}
              disabled={pending !== null || !deviceVoiceReady}
              onPress={() => void toggleDeviceVoice()}
              style={({ pressed }) => [
                styles.groupRow,
                (pending !== null || !deviceVoiceReady) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.cardTitle}>{t("This device")}</Text>
              </View>
              {deviceVoice ? <Checkmark /> : null}
            </Pressable>
          </View>
        ) : null}
        {deviceSettings && onDeviceSpeechReady ? (
          <View style={styles.group}>
            <View style={styles.groupRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  onDeviceExpanded
                    ? t("Collapse {name}", { name: t("On-device voice") })
                    : t("Expand {name}", { name: t("On-device voice") })
                }
                accessibilityState={{ expanded: onDeviceExpanded }}
                onPress={() => setOnDeviceExpanded((open) => !open)}
                style={({ pressed }) => [
                  styles.rowCopy,
                  styles.sectionTitleRow,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.cardTitle}>{t("On-device voice")}</Text>
                <Chevron expanded={onDeviceExpanded} />
              </Pressable>
              <NativeSwitch
                accessibilityLabel={t("On-device voice")}
                value={onDeviceSpeech}
                disabled={pending !== null}
                onValueChange={() => void toggleOnDeviceSpeech()}
              />
            </View>
            {onDeviceExpanded && onDeviceSpeech && modelStatus ? (
              modelStatus.stt === "ready" && modelStatus.tts === "ready" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={pending !== null || downloadingModels || importingModels}
                  onPress={() => void deleteModels()}
                  style={({ pressed }) => [
                    styles.groupRow,
                    styles.groupDivider,
                    (pending !== null || downloadingModels || importingModels) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowCopy}>
                    <Text style={[styles.cardTitle, styles.destructive]}>
                      {t("Delete voice models")}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending !== null || downloadingModels || importingModels}
                    onPress={() => void downloadModels()}
                    style={({ pressed }) => [
                      styles.groupRow,
                      styles.groupDivider,
                      (pending !== null || downloadingModels || importingModels) && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.cardTitle}>
                        {downloadingModels && modelStatus.progress !== null
                          ? t("Downloading voice models… {percent}%", {
                              percent: String(Math.round(modelStatus.progress * 100)),
                            })
                          : t("Download voice models ({size} MB)", {
                              size: String(onDeviceSpeechModelSizes().totalMb),
                            })}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending !== null || downloadingModels || importingModels}
                    onPress={() => void importModels()}
                    style={({ pressed }) => [
                      styles.groupRow,
                      styles.groupDivider,
                      (pending !== null || downloadingModels || importingModels) && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.cardTitle}>
                        {importingModels
                          ? t("Importing voice models…")
                          : t("Import from local files")}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={[styles.groupRow, styles.groupDivider]}>
                    <TextInput
                      accessibilityLabel={t("Model download address")}
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect={false}
                      inputMode="url"
                      keyboardType="url"
                      value={modelBaseUrl}
                      onChangeText={setModelBaseUrl}
                      onEndEditing={() => void saveModelBaseUrl()}
                      placeholder={t("Model download address")}
                      placeholderTextColor={native.tertiaryLabel}
                      style={[styles.cardTitle, styles.addressInput]}
                      textContentType="URL"
                    />
                  </View>
                </>
              )
            ) : null}
            {onDeviceExpanded && onDeviceSpeech && modelDiagnostics ? (
              <>
                <View style={[styles.groupRow, styles.groupDivider]}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.cardTitle}>{t("Model files")}</Text>
                  </View>
                </View>
                {diagnosticRows(modelDiagnostics.stt)}
                {diagnosticRows(modelDiagnostics.tts)}
                {/* The native loader dies with no JS error, so the journal
                    and the log are the only record of why an init crashed. */}
                <View style={[styles.groupRow, styles.groupDivider]}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.cardTitle}>{t("Native log")}</Text>
                  </View>
                </View>
                {ttsInitJournal?.phase === "started" ? (
                  <View style={[styles.groupRow, styles.groupDivider]}>
                    <Text style={[styles.diagnosticName, styles.destructive]}>
                      {t("Crashed while loading the voice engine")}
                    </Text>
                  </View>
                ) : null}
                {ttsInitJournal?.phase === "started" && ttsInitJournal.memAvailableKB !== null ? (
                  <View style={[styles.groupRow, styles.groupDivider]}>
                    <Text style={styles.diagnosticName}>
                      {t("Free memory: {mb} MB", {
                        mb: String(Math.round(ttsInitJournal.memAvailableKB / 1024)),
                      })}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={nativeLogLoading}
                  onPress={() => void loadNativeLog()}
                  style={({ pressed }) => [
                    styles.groupRow,
                    styles.groupDivider,
                    nativeLogLoading && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowCopy}>
                    <Text style={styles.cardTitle}>{t("View")}</Text>
                  </View>
                </Pressable>
                {nativeLog ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void shareNativeLog()}
                      style={({ pressed }) => [
                        styles.groupRow,
                        styles.groupDivider,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={styles.cardTitle}>{t("Share")}</Text>
                      </View>
                    </Pressable>
                    <View style={[styles.groupRow, styles.groupDivider]}>
                      <ScrollView nestedScrollEnabled style={styles.logScroll}>
                        <Text selectable style={styles.logText}>
                          {nativeLog}
                        </Text>
                      </ScrollView>
                    </View>
                  </>
                ) : null}
                {nativeLogError ? (
                  <View style={[styles.groupRow, styles.groupDivider]}>
                    <Text style={[styles.diagnosticName, styles.destructive]}>
                      {nativeLogError}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
        {catalog.length ? (
          <View style={styles.group}>
            {catalog.map((entry, index) => {
              const chosen = deviceVoiceReady && !deviceVoice && provider === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  disabled={pending !== null || !deviceVoiceReady}
                  onPress={() => void chooseProvider(entry.id)}
                  style={({ pressed }) => [
                    styles.groupRow,
                    index > 0 && styles.groupDivider,
                    (pending !== null || !deviceVoiceReady) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowCopy}>
                    <Text style={styles.cardTitle}>{entry.name}</Text>
                  </View>
                  {chosen ? <Checkmark /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {/* Input and read-aloud each pick their own source on this device, so
            one connection can transcribe while another one speaks. */}
        {deviceSettings ? (
          <>
            <Text style={styles.fieldLabel}>{t("Voice input")}</Text>
            <View style={styles.group}>
              {voiceSourceRows("input", inputOptions, effectiveInputSource)}
            </View>
            <Text style={styles.fieldLabel}>{t("Speak")}</Text>
            <View style={styles.group}>
              {voiceSourceRows("readAloud", readAloudOptions, effectiveReadAloudSource)}
            </View>
            {readAloudTranscribeOnly ? (
              <Text style={styles.note}>
                {t("Not supported in Chinese yet. Reading aloud still uses the on-device voice.")}
              </Text>
            ) : null}
          </>
        ) : null}
        {/* Connections belong to the account, so a space never removes them. */}
        {hiddenSelfHosted && scope === "account" ? (
          <NativeActionButton
            label={t("Disconnect Self-hosted")}
            prominence="quiet"
            disabled={pending !== null}
            onPress={() => void disconnect(OPENAI_COMPATIBLE_PROVIDER_ID)}
          />
        ) : null}
        {selected && deviceVoiceReady && !deviceVoice ? (
          <>
            {selfHosted || isPreset ? (
              <TextInput
                accessibilityLabel={t("Server URL")}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                inputMode="url"
                keyboardType="url"
                value={baseUrl}
                onChangeText={edit("baseUrl", setBaseUrl)}
                placeholder="http://192.168.1.10:8880/v1"
                placeholderTextColor={native.tertiaryLabel}
                style={styles.input}
                textContentType="URL"
              />
            ) : null}
            {keyless ? null : (
              <TextInput
                accessibilityLabel={t("API key")}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={
                  selfHosted
                    ? t("Optional")
                    : credential
                      ? t("Paste a replacement key")
                      : t("Paste your API key")
                }
                placeholderTextColor={native.tertiaryLabel}
                secureTextEntry
                style={styles.input}
                textContentType="none"
              />
            )}
            {selfHosted ? (
              <>
                <Text style={styles.fieldLabel}>{t("Speech model")}</Text>
                <TextInput
                  accessibilityLabel={t("Speech model")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={ttsModel}
                  onChangeText={edit("ttsModel", setTtsModel)}
                  placeholder={DEFAULT_COMPATIBLE_TTS_MODEL}
                  placeholderTextColor={native.tertiaryLabel}
                  style={styles.input}
                />
              </>
            ) : null}
            {selfHosted || isPreset ? (
              <>
                <Text style={styles.fieldLabel}>{t("Transcription model")}</Text>
                <TextInput
                  accessibilityLabel={t("Transcription model")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={sttModel}
                  onChangeText={edit("sttModel", setSttModel)}
                  placeholder={DEFAULT_COMPATIBLE_STT_MODEL}
                  placeholderTextColor={native.tertiaryLabel}
                  style={styles.input}
                />
              </>
            ) : null}
            {keyless && credential ? null : (
              <NativeActionButton
                disabled={pending !== null || !canConnect}
                label={
                  credential && (selfHosted || isPreset)
                    ? t("Reconnect")
                    : credential
                      ? t("Replace key")
                      : t("Connect")
                }
                onPress={() => void connect()}
              />
            )}
            {isPreset ? (
              <Text style={styles.note}>
                {t("Groq only transcribes speech. Reading aloud still uses the on-device voice.")}
              </Text>
            ) : null}
            {credential && scope === "account" ? (
              <NativeActionButton
                disabled={pending !== null}
                label={pending === "disconnect" ? t("Disconnecting…") : t("Disconnect")}
                onPress={() => void disconnect()}
                prominence="destructive"
              />
            ) : null}
            {credential && selected.speechModel ? (
              <>
                <Text style={styles.fieldLabel}>{t("Speech model")}</Text>
                <TextInput
                  accessibilityLabel={t("Speech model")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={pending === null}
                  value={speechModel}
                  onChangeText={edit("speechModel", setSpeechModel)}
                  onBlur={() => void saveSpeechModel()}
                  onSubmitEditing={() => void saveSpeechModel()}
                  placeholder={t("Optional")}
                  placeholderTextColor={native.tertiaryLabel}
                  style={styles.input}
                />
              </>
            ) : null}
            {voices.length && !isPreset ? (
              <View style={[styles.group, styles.voices]}>
                {voices.map((voice, index) => (
                  <Pressable
                    key={voice.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: voiceId === voice.id }}
                    disabled={pending !== null}
                    onPress={() => void chooseVoice(voice.id)}
                    style={({ pressed }) => [
                      styles.groupRow,
                      index > 0 && styles.groupDivider,
                      pending !== null && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.voiceLabel}>{voice.label}</Text>
                    {voiceId === voice.id ? <Checkmark /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {deviceSettings && (deviceVoice || status?.ready) && !isPreset ? (
          <NativeActionButton
            disabled={pending !== null}
            label={t("Hear a sample")}
            onPress={() => void testVoice()}
          />
        ) : null}
        {deviceSettings ? (
          <View style={styles.group}>
            <View style={styles.groupRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.cardTitle}>{t("Call sounds")}</Text>
              </View>
              <NativeSwitch
                accessibilityLabel={t("Call sounds")}
                value={callSounds === true}
                disabled={callSounds === null}
                onValueChange={(next) => void toggleCallSounds(next)}
              />
            </View>
            <View style={[styles.groupRow, styles.groupDivider]}>
              <View style={styles.rowCopy}>
                <Text style={styles.cardTitle}>{t("Waiting sound")}</Text>
              </View>
              <NativeSwitch
                accessibilityLabel={t("Waiting sound")}
                value={waitSound === true}
                disabled={waitSound === null}
                onValueChange={(next) => void toggleWaitSound(next)}
              />
            </View>
            <View style={[styles.groupRow, styles.groupDivider]}>
              <View style={styles.rowCopy}>
                <Text style={styles.cardTitle}>{t("Call greeting")}</Text>
              </View>
              <NativeSwitch
                accessibilityLabel={t("Call greeting")}
                value={callGreeting === true}
                disabled={callGreeting === null}
                onValueChange={(next) => void toggleCallGreeting(next)}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Grouped digits, so an on-disk size reads next to the release size. */
function formatDiagnosticSize(size: number): string {
  return size.toLocaleString("en-US");
}

function createVoiceStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 10 },
    error: { color: tokens.destructive, marginBottom: 8 },
    destructive: { color: tokens.destructive },
    group: { borderRadius: 14, backgroundColor: native.fill, overflow: "hidden" },
    groupRow: {
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    groupDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: native.separator,
    },
    rowCopy: { flex: 1 },
    sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    addressInput: { flex: 1 },
    cardTitle: { color: native.label, fontSize: 16 },
    diagnosticName: { color: native.label, fontSize: 14, flex: 1 },
    diagnosticSize: { color: native.secondaryLabel, fontSize: 13 },
    diagnosticMark: { color: native.label, fontSize: 16, width: 20, textAlign: "center" },
    logScroll: { flex: 1, maxHeight: 260 },
    logText: { color: native.secondaryLabel, fontSize: 12, fontFamily: "monospace" },
    fieldLabel: { color: native.label, marginTop: 16 },
    note: { color: native.secondaryLabel, fontSize: 13, marginTop: 8 },
    input: {
      marginTop: 8,
      borderRadius: 12,
      backgroundColor: native.fill,
      color: native.label,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
    voices: { marginTop: 12 },
    voiceLabel: { flex: 1, color: native.label, fontSize: 16 },
  });
}
