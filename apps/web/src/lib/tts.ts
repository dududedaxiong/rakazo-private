import { t } from "@lingui/core/macro";
import type { SettingsScope } from "@rakazo_mickvvw/contracts";
import {
  readVoiceAudio,
  readVoiceError,
  requestDeadline,
  VOICE_RESPONSE_TIMEOUT_MS,
  withAbort,
} from "@rakazo_mickvvw/core";
import { rpc, selectedSpaceId, withSpaceHeaders } from "./rpc.js";
import { errorText, voiceAccountErrorText } from "./user-error.js";

export type SpeechStatus = "idle" | "preparing" | "speaking";

export interface SpeechSnapshot {
  status: SpeechStatus;
  botId?: string;
  messageId?: string;
  caption?: string;
  /** Which utterance is playing, so the UI can show read-aloud progress. */
  segmentIndex?: number;
  segmentTotal?: number;
  error?: string;
}

interface SpeakOptions {
  spaceId?: string | null;
  /** Which copy of the voice settings to use; omitted means whichever applies in the space. */
  scope?: SettingsScope;
  voiceId?: string;
  botId?: string;
  messageId?: string;
  /** Read the whole text instead of a spoken summary. */
  full?: boolean;
}

const IDLE: SpeechSnapshot = { status: "idle" };

/** A clip that never starts playing must not stall the whole read. */
const PLAY_START_TIMEOUT_MS = 5000;
/** A clip that starts but never ends is abandoned after its own length plus this. */
const PLAY_END_SLACK_MS = 10000;
/** Fallback cap when a clip's duration is unknown. */
const PLAY_END_FALLBACK_MS = 120000;

export class Speaker {
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<(s: SpeechSnapshot) => void>();
  private token = 0;
  /**
   * One audio element for the whole read. A fresh element per segment needs
   * new user activation to play, and the tap's activation expires seconds
   * after it, so on phones a later segment's play() can hang forever instead
   * of resolving. An element that already played from the tap keeps playing.
   */
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settlePlayback: ((finished: boolean) => void) | null = null;
  private request: AbortController | null = null;

  subscribe(fn: (s: SpeechSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): SpeechSnapshot {
    return this.snapshot;
  }

  private set(next: SpeechSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  isSpeaking(messageId?: string): boolean {
    if (this.snapshot.status === "idle") return false;
    return messageId ? this.snapshot.messageId === messageId : true;
  }

  stop() {
    this.token += 1;
    this.request?.abort();
    this.request = null;
    if (this.settlePlayback) this.settlePlayback(false);
    else this.teardownAudio();
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  private teardownAudio() {
    if (this.audio) {
      this.audio.pause();
      // Clear the source but keep the element: its playback permission from
      // the tap must survive into the next segment.
      this.audio.src = "";
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** Resolves with this request's failure text; stopping or superseding it resolves with none. */
  async speak(text: string, opts: SpeakOptions = {}): Promise<string | undefined> {
    this.stop();
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    const spaceId = opts.spaceId ?? selectedSpaceId();

    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    let prepared: { utterances: string[]; transcribeOnly: boolean };
    try {
      prepared = await withAbort(
        this.prepare(text, opts, controller.signal, spaceId),
        controller.signal,
      );
    } catch (error) {
      const failure = live() ? errorText(error) : undefined;
      if (failure) this.set({ ...IDLE, error: failure });
      if (this.request === controller) this.request = null;
      return failure;
    }
    if (!live()) return;
    // A connection that only transcribes cannot read aloud; the browser's own voice reads.
    if (prepared.transcribeOnly) {
      const failure = await this.speakLocally(prepared.utterances, opts, live);
      if (this.request === controller) this.request = null;
      return failure;
    }
    const utterances = prepared.utterances;
    if (!utterances.length) {
      this.set(IDLE);
      if (this.request === controller) this.request = null;
      return;
    }

    type Rendered = { blob: Blob; error?: never } | { blob?: never; error: unknown };
    const render = (utterance: string): Promise<Rendered> =>
      this.render(utterance, opts, controller.signal, spaceId).then(
        (blob) => ({ blob }),
        (error: unknown) => ({ error }),
      );
    let next: Promise<Rendered> | null = render(utterances[0] ?? "");
    let playedAny = false;
    let lastFailure: string | undefined;
    for (let i = 0; i < utterances.length; i += 1) {
      const current = next;
      next = i + 1 < utterances.length ? render(utterances[i + 1] ?? "") : null;
      if (!current) break;
      const rendered = await current;
      // One bad clip must not end the whole read-aloud; skip it and keep going.
      if ("error" in rendered) {
        if (live()) lastFailure = errorText(rendered.error);
        continue;
      }
      if (!live()) return;
      this.set({
        status: "speaking",
        botId: opts.botId,
        messageId: opts.messageId,
        caption: utterances[i],
        segmentIndex: i,
        segmentTotal: utterances.length,
      });
      const finished = await this.play(rendered.blob, live);
      if (!finished) {
        if (!live()) return;
        // A clip that will not play must not end the read-aloud either.
        continue;
      }
      playedAny = true;
    }
    if (!playedAny && live() && lastFailure) {
      this.set({ ...IDLE, error: lastFailure });
    } else if (live()) {
      this.set(IDLE);
    }
    if (this.request === controller) this.request = null;
    // Nothing played and nothing stopped it: report the failure so the caller can
    // show it, instead of silently swallowing it.
    if (!playedAny && live()) return lastFailure;
  }

  private async prepare(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<{ utterances: string[]; transcribeOnly: boolean }> {
    const body = await rpc.voice.prepare(
      { text, voiceId: opts.voiceId, botId: opts.botId, scope: opts.scope, full: opts.full },
      { signal, context: { spaceId } },
    );
    if (!body.ready && !body.transcribeOnly) {
      throw new Error(t`Add a voice provider key and pick a voice in Voice settings.`);
    }
    return { utterances: body.utterances ?? [], transcribeOnly: body.transcribeOnly === true };
  }

  /** The browser's own voice, for connections that only transcribe. */
  private async speakLocally(
    utterances: string[],
    opts: SpeakOptions,
    live: () => boolean,
  ): Promise<string | undefined> {
    const synthesis =
      typeof globalThis.speechSynthesis === "undefined" ? null : globalThis.speechSynthesis;
    if (!synthesis) {
      const failure = t`Add a voice provider key and pick a voice in Voice settings.`;
      this.set({ ...IDLE, error: failure });
      return failure;
    }
    let playedAny = false;
    let lastFailure: string | undefined;
    for (let i = 0; i < utterances.length; i += 1) {
      if (!live()) return;
      const text = utterances[i] ?? "";
      this.set({
        status: "speaking",
        botId: opts.botId,
        messageId: opts.messageId,
        caption: text,
        segmentIndex: i,
        segmentTotal: utterances.length,
      });
      const spoken = await new Promise<boolean>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          if (this.settlePlayback === cancel) this.settlePlayback = null;
          resolve(ok);
        };
        const cancel = () => {
          synthesis.cancel();
          finish(false);
        };
        this.settlePlayback = cancel;
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        try {
          synthesis.speak(utterance);
        } catch {
          finish(false);
        }
      });
      if (!live()) return;
      if (spoken) playedAny = true;
      else lastFailure = t`The browser could not read this aloud.`;
    }
    if (!playedAny && live() && lastFailure) {
      this.set({ ...IDLE, error: lastFailure });
    } else if (live()) {
      this.set(IDLE);
    }
    if (!playedAny && live()) return lastFailure;
    return;
  }

  private async render(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<Blob> {
    const deadline = requestDeadline(
      VOICE_RESPONSE_TIMEOUT_MS,
      t`Voice request timed out.`,
      signal,
    );
    try {
      const res = await withAbort(
        fetch("/api/voice/speak", {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({
            text,
            voiceId: opts.voiceId,
            botId: opts.botId,
            scope: opts.scope,
          }),
          signal: deadline.signal,
        }),
        deadline.signal,
      );
      if (!res.ok) {
        const body = await readVoiceError(res, deadline.signal);
        throw new Error(voiceAccountErrorText(body) ?? body.error ?? "");
      }
      const bytes = await readVoiceAudio(res, deadline.signal);
      return new Blob([new Uint8Array(bytes)], {
        type: res.headers.get("content-type") ?? "audio/mpeg",
      });
    } finally {
      deadline.dispose();
    }
  }

  private play(blob: Blob, live: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = this.audio ?? new Audio();
      this.audio = audio;
      this.objectUrl = url;
      let settled = false;
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      let endTimer: ReturnType<typeof setTimeout> | undefined;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (startTimer !== undefined) clearTimeout(startTimer);
        if (endTimer !== undefined) clearTimeout(endTimer);
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        audio.onloadedmetadata = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        resolve(ok);
      };
      audio.src = url;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      // A clip that never starts (a phone blocking a later segment's
      // playback, for instance) is skipped after a short wait instead of
      // holding the read hostage.
      startTimer = setTimeout(() => done(false), PLAY_START_TIMEOUT_MS);
      audio.onplaying = () => {
        if (startTimer !== undefined) {
          clearTimeout(startTimer);
          startTimer = undefined;
        }
        const duration = audio.duration;
        const cap =
          Number.isFinite(duration) && duration > 0
            ? Math.min(Math.max(duration * 1000 + PLAY_END_SLACK_MS, 20000), 180000)
            : PLAY_END_FALLBACK_MS;
        endTimer = setTimeout(() => done(false), cap);
      };
      this.settlePlayback = done;
      audio.play().catch(() => done(false));
    });
  }
}

export const speaker = new Speaker();
