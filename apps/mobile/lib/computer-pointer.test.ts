// @vitest-environment jsdom

import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return import("./computer-pointer");
}

describe("extractComputerPointer", () => {
  it("takes the observed pointer from a computer_act completion", async () => {
    const mod = await freshModule();
    expect(
      mod.extractComputerPointer({
        type: "agent.tool.completed",
        botId: "bot-1",
        payload: {
          name: "computer_act",
          outcome: "succeeded",
          width: 1280,
          height: 720,
          cursor: { x: 640, y: 360 },
        },
      }),
    ).toEqual({ botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
  });

  it.each([
    [
      "not a completion",
      { type: "agent.tool.called", botId: "bot-1", payload: { name: "computer_act" } },
    ],
    [
      "another tool",
      {
        type: "agent.tool.completed",
        botId: "bot-1",
        payload: { name: "browser_act", width: 1280, height: 720, cursor: { x: 1, y: 2 } },
      },
    ],
    [
      "no cursor",
      {
        type: "agent.tool.completed",
        botId: "bot-1",
        payload: { name: "computer_act", width: 1280, height: 720 },
      },
    ],
    [
      "no frame size",
      {
        type: "agent.tool.completed",
        botId: "bot-1",
        payload: { name: "computer_act", cursor: { x: 1, y: 2 } },
      },
    ],
    [
      "no bot",
      {
        type: "agent.tool.completed",
        payload: { name: "computer_act", width: 1280, height: 720, cursor: { x: 1, y: 2 } },
      },
    ],
    [
      "malformed cursor",
      {
        type: "agent.tool.completed",
        botId: "bot-1",
        payload: {
          name: "computer_act",
          width: 1280,
          height: 720,
          cursor: { x: "640", y: Number.NaN },
        },
      },
    ],
  ])("returns null: %s", async (_label, event) => {
    const mod = await freshModule();
    expect(mod.extractComputerPointer(event)).toBeNull();
  });
});

describe("pointerDisplayPoint", () => {
  it("maps directly when the frame fills the view", async () => {
    const mod = await freshModule();
    expect(mod.pointerDisplayPoint({ x: 640, y: 360, width: 1280, height: 720 }, 400, 225)).toEqual(
      { x: 200, y: 112.5 },
    );
  });

  it("corrects for a letterboxed wide frame", async () => {
    const mod = await freshModule();
    // 16:9 frame in a square view: fills the width, bars top and bottom.
    expect(mod.pointerDisplayPoint({ x: 640, y: 360, width: 1280, height: 720 }, 400, 400)).toEqual(
      { x: 200, y: 200 },
    );
    expect(mod.pointerDisplayPoint({ x: 0, y: 0, width: 1280, height: 720 }, 400, 400)).toEqual({
      x: 0,
      y: 87.5,
    });
    expect(
      mod.pointerDisplayPoint({ x: 1280, y: 720, width: 1280, height: 720 }, 400, 400),
    ).toEqual({ x: 400, y: 312.5 });
  });

  it("corrects for a letterboxed tall frame", async () => {
    const mod = await freshModule();
    // 9:16 frame in a square view: fills the height, bars left and right.
    expect(mod.pointerDisplayPoint({ x: 360, y: 640, width: 720, height: 1280 }, 400, 400)).toEqual(
      { x: 200, y: 200 },
    );
  });

  it("returns null for unusable sizes", async () => {
    const mod = await freshModule();
    expect(mod.pointerDisplayPoint({ x: 1, y: 1, width: 1280, height: 720 }, 0, 400)).toBeNull();
    expect(mod.pointerDisplayPoint({ x: 1, y: 1, width: 0, height: 720 }, 400, 400)).toBeNull();
  });
});

describe("computer pointer store", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("starts empty and notifies subscribers on a new pointer", async () => {
    const mod = await freshModule();
    expect(mod.computerPointer()).toBeNull();
    function Probe() {
      const pointer = mod.useComputerPointer();
      return createElement(
        "span",
        null,
        pointer ? `${pointer.botId}:${pointer.x},${pointer.y}#${pointer.seq}` : "none",
      );
    }
    await act(async () => {
      root?.render(createElement(Probe));
    });
    expect(container?.textContent).toBe("none");
    await act(async () => {
      mod.setComputerPointer({ botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
    });
    expect(container?.textContent).toBe("bot-1:640,360#1");
    await act(async () => {
      mod.setComputerPointer({ botId: "bot-1", x: 100, y: 50, width: 1280, height: 720 });
    });
    expect(container?.textContent).toBe("bot-1:100,50#2");
  });

  it("attaches a snapshot only to the pointer with the matching sequence", async () => {
    const mod = await freshModule();
    // No pointer yet: a snapshot has nowhere to land.
    mod.setComputerPointerSnapshot(1, "data:image/jpeg,first");
    expect(mod.computerPointer()).toBeNull();
    mod.setComputerPointer({ botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
    const seq = mod.computerPointer()?.seq;
    expect(seq).toBeTypeOf("number");
    // A stale sequence is ignored.
    mod.setComputerPointerSnapshot((seq ?? 0) + 1, "data:image/jpeg,stale");
    expect(mod.computerPointer()?.snapshot).toBeUndefined();
    // The matching sequence lands.
    mod.setComputerPointerSnapshot(seq ?? -1, "data:image/jpeg,first");
    expect(mod.computerPointer()?.snapshot).toBe("data:image/jpeg,first");
    // A second snapshot for the same click does not replace the first.
    mod.setComputerPointerSnapshot(seq ?? -1, "data:image/jpeg,second");
    expect(mod.computerPointer()?.snapshot).toBe("data:image/jpeg,first");
    // A new pointer starts without a snapshot.
    mod.setComputerPointer({ botId: "bot-1", x: 100, y: 50, width: 1280, height: 720 });
    expect(mod.computerPointer()?.snapshot).toBeUndefined();
  });
});
