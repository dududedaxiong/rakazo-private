import { MAX_VOICE_AUDIO_BYTES, VOICE_RESPONSE_TIMEOUT_MS } from "@rakazo_mickvvw/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Speaker } from "./tts.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSelectedSpace(id: string) {
  const store = new Map<string, string>([["rakazo:space-id", id]]);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return (next: string) => store.set("rakazo:space-id", next);
}

describe("Speaker", () => {
  it("interrupting before audio arrives leaves the speaker idle", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockImplementation(() => new Promise(() => undefined));
    const pending = speaker.speak("Hello there.", { messageId: "m1" });
    speaker.stop();
    await expect(pending).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
  });

  it("does not report a failure for a request a newer one replaced", async () => {
    const speaker = new Speaker();
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce({ utterances: [], transcribeOnly: false });
    const first = speaker.speak("First.", { messageId: "m1" });
    await speaker.speak("Second.", { messageId: "m2" });
    fail(new Error("Your voice provider is out of credit."));
    await expect(first).resolves.toBeUndefined();
    expect(speaker.state.error).toBeUndefined();
  });

  it("resolves with an error snapshot instead of rejecting", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockRejectedValue(new Error("ElevenLabs rejected that key."));
    await expect(speaker.speak("Hi there.")).resolves.toBe("ElevenLabs rejected that key.");
    expect(speaker.state.error).toBe("ElevenLabs rejected that key.");
  });

  it("keeps reading after a middle utterance fails to render", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["First.", "Second.", "Third."], transcribeOnly: false });
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        requested.push(body.text ?? "");
        if (body.text === "Second.") throw new Error("Offline.");
        return new Response(new Blob(["audio"]), { status: 200 });
      }),
    );
    const played: Array<unknown> = [];
    let plays = 0;
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onplaying: (() => void) | null = null;
        onloadedmetadata: (() => void) | null = null;
        constructor() {
          played.push(this);
        }
        play() {
          plays += 1;
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await expect(speaker.speak("Read this.", { messageId: "m1" })).resolves.toBeUndefined();
    expect(requested).toEqual(["First.", "Second.", "Third."]);
    // One audio element is reused for the whole read; it played twice
    // (the failed middle utterance never reached it).
    expect(played).toHaveLength(1);
    expect(plays).toBe(2);
    expect(speaker.state.status).toBe("idle");
  });

  // Fake timers stall the response-body stream reader, so this one waits
  // out the real start watchdog instead.
  it("skips a segment whose audio never starts instead of stalling", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["First."], transcribeOnly: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["audio"]), { status: 200 })),
    );
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onplaying: (() => void) | null = null;
        onloadedmetadata: (() => void) | null = null;
        // Never starts, never ends, never errors: a phone blocking a later
        // segment's playback instead of rejecting it.
        play() {
          return new Promise(() => undefined);
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await expect(speaker.speak("Read this.", { messageId: "m1" })).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
  }, 20000);

  it("tags each spoken segment with its caption and position", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["First.", "Second.", "Third."], transcribeOnly: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["audio"]), { status: 200 })),
    );
    const played: Array<unknown> = [];
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          played.push(this);
        }
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const snapshots: Array<{ caption?: string; segmentIndex?: number; segmentTotal?: number }> = [];
    speaker.subscribe((state) => {
      if (state.status === "speaking") {
        snapshots.push({
          caption: state.caption,
          segmentIndex: state.segmentIndex,
          segmentTotal: state.segmentTotal,
        });
      }
    });

    await expect(speaker.speak("Read this.", { messageId: "m1" })).resolves.toBeUndefined();
    expect(snapshots).toEqual([
      { caption: "First.", segmentIndex: 0, segmentTotal: 3 },
      { caption: "Second.", segmentIndex: 1, segmentTotal: 3 },
      { caption: "Third.", segmentIndex: 2, segmentTotal: 3 },
    ]);
  });

  it("reports the failure when every utterance fails to render", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["First.", "Second."], transcribeOnly: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Offline.");
      }),
    );

    await expect(speaker.speak("Read this.", { messageId: "m1" })).resolves.toBe("Offline.");
    expect(speaker.state.status).toBe("idle");
  });

  it.each([
    { spaceId: undefined, expectedSpaceId: "space-support" },
    { spaceId: "space-edited", expectedSpaceId: "space-edited" },
  ])("keeps both speech requests in $expectedSpaceId", async ({ spaceId, expectedSpaceId }) => {
    const changeSelectedSpace = stubSelectedSpace("space-support");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      blob: async () => new Blob(["audio"]),
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const speaker = new Speaker();
    const prepare = vi
      .spyOn(
        speaker as unknown as {
          prepare: (
            text: string,
            opts: unknown,
            signal: AbortSignal,
            spaceId: string | null,
          ) => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
        },
        "prepare",
      )
      .mockImplementation(async () => {
        changeSelectedSpace("space-other");
        return { utterances: ["Hello."], transcribeOnly: false };
      });
    await speaker.speak("Hello.", { messageId: "m1", spaceId });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/speak",
      expect.objectContaining({ credentials: "include" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-rakazo-space-id")).toBe(expectedSpaceId);
    expect(headers.get("content-type")).toBe("application/json");
    expect(prepare.mock.calls[0]?.[3]).toBe(expectedSpaceId);
  });

  it("rejects oversized audio without waiting for response cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": String(MAX_VOICE_AUDIO_BYTES + 1) },
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["Hello."], transcribeOnly: false });

    await expect(speaker.speak("Hello.")).resolves.toBe("Voice response is too large.");

    expect(speaker.state.error).toBe("Voice response is too large.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["VOICE_OUT_OF_CREDIT", 402, "Your voice provider is out of credit."],
    ["VOICE_KEY_REJECTED", 403, "Your voice provider key was rejected."],
  ])("shows its own copy for %s", async (code, status, copy) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Insufficient API credit at fish.audio", code }), {
            status,
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["Hello."], transcribeOnly: false });

    await expect(speaker.speak("Hello.")).resolves.toBe(copy);

    expect(speaker.state.error).toBe(copy);
  });

  it("times out while a voice response body is stalled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull: () => new Promise<void>(() => undefined),
            }),
          ),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["Hello."], transcribeOnly: false });

    const pending = speaker.speak("Hello.");
    await vi.advanceTimersByTimeAsync(VOICE_RESPONSE_TIMEOUT_MS);
    await pending;

    expect(speaker.state.error).toBe("Voice request timed out.");
  });

  it("reads aloud with the browser voice when the connection only transcribes", async () => {
    const spoken: string[] = [];
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn((utterance: { text: string; onend: (() => void) | null }) => {
        spoken.push(utterance.text);
        queueMicrotask(() => utterance.onend?.());
      }),
      cancel: vi.fn(),
    });
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["Hello.", "World."], transcribeOnly: true });

    await expect(speaker.speak("Hello. World.")).resolves.toBeUndefined();
    expect(spoken).toEqual(["Hello.", "World."]);
    expect(speaker.state.status).toBe("idle");
  });

  it("reports a missing browser voice when the connection only transcribes", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as {
        prepare: () => Promise<{ utterances: string[]; transcribeOnly: boolean }>;
      },
      "prepare",
    ).mockResolvedValue({ utterances: ["Hello."], transcribeOnly: true });

    await expect(speaker.speak("Hello.")).resolves.toBe(
      "Add a voice provider key and pick a voice in Voice settings.",
    );
  });
});
