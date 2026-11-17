// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaResult } from "./media-result";

const artifactMocks = vi.hoisted(() => ({
  fetchArtifactBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  downloadArtifact: vi.fn(async () => undefined),
}));
vi.mock("../../lib/artifact-open", () => artifactMocks);

vi.mock("./message-cards", () => ({
  // The preview slots render here so the title bar and regenerate action are
  // testable without the real image lightbox.
  ArtifactImage: ({
    previewOpen,
    previewTitleBar,
    previewHeaderActions,
  }: {
    previewOpen?: boolean;
    previewTitleBar?: ReactNode;
    previewHeaderActions?: ReactNode;
  }) =>
    previewOpen ? (
      <div data-testid="artifact-image-preview">
        {previewHeaderActions}
        {previewTitleBar}
      </div>
    ) : null,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@rakazo_mickvvw/ui-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo_mickvvw/ui-web")>();
  return { ...actual, toast: toastMock };
});

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.activate("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "share");
});

function buttonByText(text: string) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text);
}

function renderResult(
  overrides: {
    mark?: { modelId: string; presetName?: string } | null;
    modelSwitches?: {
      attempts: {
        model: string;
        provider?: string;
        outcome: "failed" | "skipped" | "succeeded";
        errorCode?: string;
        errorMessage?: string;
        at: string;
      }[];
      finalModel: string;
    } | null;
    models?: { provider: string; model: string }[];
    presets?: { name: string; prompt: string }[];
    activePreset?: string | null;
    rpc?: unknown;
  } = {},
) {
  const media = {
    getSupplementaryPrompt: vi.fn(async () => ({ supplementaryPrompt: "" })),
    setSupplementaryPrompt: vi.fn(async () => ({ ok: true as const })),
    regenerate: vi.fn(async () => ({ ok: true as const, status: "completed" as const })),
  };
  const rpc = (overrides.rpc ?? { media }) as never;
  act(() =>
    root.render(
      <MediaResult
        kind="image"
        target={{ botId: "bot-1" }}
        artifactId="art-1"
        name="sunset.png"
        mimeType="image/png"
        mark={overrides.mark ?? { modelId: "model-a", presetName: "水彩" }}
        botId="bot-1"
        rpc={rpc}
        modelSwitches={overrides.modelSwitches ?? null}
        models={
          overrides.models ?? [
            { provider: "p1", model: "model-a" },
            { provider: "p2", model: "model-b" },
          ]
        }
        presets={
          overrides.presets ?? [
            { name: "水彩", prompt: "watercolor" },
            { name: "油画", prompt: "oil painting" },
          ]
        }
        activePreset={overrides.activePreset ?? "水彩"}
        favorite={{ favorited: false, busy: false, toggle: vi.fn(async () => true) }}
      />,
    ),
  );
  return { media };
}

describe("MediaResult share", () => {
  it("downloads with a toast when the browser has no share sheet", async () => {
    Reflect.deleteProperty(navigator, "share");
    renderResult();
    await act(async () => {
      buttonByText("Share")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(artifactMocks.fetchArtifactBytes).toHaveBeenCalled();
    expect(artifactMocks.downloadArtifact).toHaveBeenCalledWith(
      { botId: "bot-1" },
      "art-1",
      "sunset.png",
      "image/png",
    );
    expect(toastMock).toHaveBeenCalledWith("Downloading sunset.png");
    expect(buttonByText("Share")).not.toBeUndefined();
  });

  it("shows Sharing… and disables the button while the file loads", async () => {
    Reflect.deleteProperty(navigator, "share");
    let resolveFetch!: (bytes: Uint8Array<ArrayBuffer>) => void;
    artifactMocks.fetchArtifactBytes.mockImplementationOnce(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderResult();
    act(() => buttonByText("Share")?.click());
    expect(buttonByText("Sharing…")).not.toBeUndefined();
    expect(buttonByText("Sharing…")?.disabled).toBe(true);
    await act(async () => {
      resolveFetch(new Uint8Array([1]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toastMock).toHaveBeenCalledWith("Downloading sunset.png");
    expect(buttonByText("Share")).not.toBeUndefined();
  });

  it("uses the system share sheet when available and downloads nothing", async () => {
    const share = vi.fn(async (_opts: { files: File[] }) => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderResult();
    await act(async () => {
      buttonByText("Share")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0]?.files?.[0]?.name).toBe("sunset.png");
    expect(artifactMocks.downloadArtifact).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("toasts when the file cannot be fetched", async () => {
    Reflect.deleteProperty(navigator, "share");
    artifactMocks.fetchArtifactBytes.mockRejectedValueOnce(new Error("offline"));
    renderResult();
    await act(async () => {
      buttonByText("Share")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(artifactMocks.downloadArtifact).not.toHaveBeenCalled();
    // errorText surfaces the failure itself; the "Could not share" label only
    // applies when the error carries no usable message.
    expect(toastMock).toHaveBeenCalledWith("offline");
    expect(buttonByText("Share")).not.toBeUndefined();
  });
});

describe("MediaResult switch history", () => {
  const switches = {
    attempts: [
      {
        model: "model-a",
        provider: "p1",
        outcome: "failed" as const,
        errorCode: "rate_limit",
        errorMessage: "slow down",
        at: "2026-11-15T10:00:00.000Z",
      },
      {
        model: "model-b",
        provider: "p2",
        outcome: "succeeded" as const,
        at: "2026-11-15T10:00:01.000Z",
      },
    ],
    finalModel: "model-b",
  };

  it("shows no history button without a switch, and opens the timeline with one", async () => {
    renderResult();
    expect(buttonByText("Switch history")).toBeUndefined();
    renderResult({ modelSwitches: switches });
    expect(buttonByText("Switch history")).not.toBeUndefined();
    await act(async () => {
      buttonByText("Switch history")?.click();
    });
    const dialog = document.querySelector('[data-testid="model-switch-history"]');
    expect(dialog?.textContent).toContain("Switch history");
    expect(dialog?.textContent).toContain("429 rate limit");
  });
});

describe("MediaResult collapse", () => {
  it("folds to its title and model line with Show, and expands without re-fetching", async () => {
    const { media } = renderResult();
    expect(buttonByText("Collapse")).not.toBeUndefined();
    expect(buttonByText("Preview")).not.toBeUndefined();
    await act(async () => {
      buttonByText("Collapse")?.click();
    });
    // The preview and actions hide; the title and model line stay so the
    // folded row still says what was folded.
    expect(buttonByText("Preview")).toBeUndefined();
    expect(buttonByText("Download")).toBeUndefined();
    expect(container.textContent).toContain("sunset.png");
    expect(container.textContent).toContain("model-a");
    expect(container.textContent).toContain("水彩");
    expect(buttonByText("Show")).not.toBeUndefined();
    await act(async () => {
      buttonByText("Show")?.click();
    });
    expect(buttonByText("Show")).toBeUndefined();
    expect(buttonByText("Preview")).not.toBeUndefined();
    expect(buttonByText("Collapse")).not.toBeUndefined();
    expect(media.regenerate).not.toHaveBeenCalled();
    expect(media.getSupplementaryPrompt).not.toHaveBeenCalled();
  });
});

describe("MediaResult preview title bar", () => {
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  async function openPreview() {
    await act(async () => {
      buttonByText("Preview")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function titleBar() {
    return container.querySelector('[data-testid="media-preview-title-bar"]');
  }

  it("shows preset, supplementary prompt, and model in a wrapping row", async () => {
    const { media } = renderResult();
    media.getSupplementaryPrompt.mockResolvedValueOnce({ supplementaryPrompt: "bluer sky" });
    await openPreview();
    await flush();
    expect(media.getSupplementaryPrompt).toHaveBeenCalledWith({ artifactId: "art-1" });
    const bar = titleBar();
    expect(bar?.textContent).toContain("Image generation:");
    expect(bar?.textContent).toContain("水彩");
    expect(bar?.textContent).toContain("Supplementary prompt:");
    expect(bar?.textContent).toContain("bluer sky");
    expect(bar?.textContent).toContain("Model:");
    expect(bar?.textContent).toContain("model-a");
    // jsdom has no layout; the wrap is the flex-wrap class on the row.
    expect(bar?.className).toContain("flex-wrap");
  });

  it("shows + Add when no supplementary prompt is saved, and saves a new one", async () => {
    const { media } = renderResult();
    await openPreview();
    await flush();
    expect(titleBar()?.textContent).toContain("+ Add");
    await act(async () => {
      buttonByText("+ Add")?.click();
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="media-preview-title-bar"] input',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input!,
        "bluer sky",
      );
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonByText("Save")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(media.setSupplementaryPrompt).toHaveBeenCalledExactlyOnceWith({
      artifactId: "art-1",
      supplementaryPrompt: "bluer sky",
    });
    expect(titleBar()?.textContent).toContain("bluer sky");
  });

  it("regenerates from the preview header and toasts the result", async () => {
    const { media } = renderResult();
    await openPreview();
    await flush();
    const regenerate = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Regenerate"]',
    );
    expect(regenerate).not.toBeNull();
    await act(async () => {
      regenerate?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(media.regenerate).toHaveBeenCalledExactlyOnceWith({ artifactId: "art-1" });
    expect(toastMock).toHaveBeenCalledWith("Regenerated");
  });

  it("toasts an unknown regeneration failure with the raw error as its description", async () => {
    const { media } = renderResult();
    media.regenerate.mockRejectedValueOnce(new Error("offline"));
    await openPreview();
    await flush();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Regenerate"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toastMock).toHaveBeenCalledWith("The model provider returned an error.", {
      description: "offline",
    });
  });

  it("toasts a rejected key with a key-test action", async () => {
    const checkKey = vi.fn(async () => ({
      credentialId: "c1",
      status: "invalid_key" as const,
      checkedAt: "2026-11-15T12:00:00.000Z",
    }));
    const media = {
      getSupplementaryPrompt: vi.fn(async () => ({ supplementaryPrompt: "" })),
      setSupplementaryPrompt: vi.fn(async () => ({ ok: true as const })),
      regenerate: vi.fn(async () => ({ ok: true as const, status: "completed" as const })),
    };
    media.regenerate.mockRejectedValueOnce(new Error('401: {"message":"Invalid API key"}'));
    renderResult({
      rpc: {
        media,
        models: {
          credentials: vi.fn(async () => [{ id: "c1", provider: "p1" }]),
          checkKey,
        },
      },
    });
    await openPreview();
    await flush();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Regenerate"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining("rejected the API key"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Test this key" }) }),
    );
    const action = (
      toastMock.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } }
    ).action;
    await act(async () => {
      action.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(checkKey).toHaveBeenCalledWith({ credentialId: "c1" });
    expect(toastMock).toHaveBeenLastCalledWith("Key is invalid");
  });

  it("toasts a rate limit with a retry action", async () => {
    const { media } = renderResult();
    media.regenerate
      .mockRejectedValueOnce(new Error('429: {"message":"Too many requests"}'))
      .mockResolvedValueOnce({ ok: true as const, status: "completed" as const });
    await openPreview();
    await flush();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Regenerate"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining("rate limiting"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) }),
    );
    const action = (
      toastMock.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } }
    ).action;
    await act(async () => {
      action.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(media.regenerate).toHaveBeenCalledTimes(2);
  });
});
