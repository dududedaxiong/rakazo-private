// @vitest-environment jsdom
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
  ArtifactImage: () => null,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@rakazo/ui-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/ui-web")>();
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

function renderResult() {
  act(() =>
    root.render(
      <MediaResult
        kind="image"
        target={{ botId: "bot-1" }}
        artifactId="art-1"
        name="sunset.png"
        mimeType="image/png"
        mark={null}
        botId="bot-1"
        rpc={{} as never}
        models={[]}
        presets={[]}
        activePreset={null}
        favorite={{ favorited: false, busy: false, toggle: vi.fn(async () => true) }}
      />,
    ),
  );
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
