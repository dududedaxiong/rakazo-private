// @vitest-environment jsdom

import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreBox = vi.hoisted(() => ({
  items: new Map<string, string>(),
  sets: [] as Array<[string, string]>,
}));

vi.mock("expo-secure-store", () => ({
  default: {
    getItemAsync: async (key: string) => secureStoreBox.items.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      secureStoreBox.items.set(key, value);
      secureStoreBox.sets.push([key, value]);
    },
  },
}));

type LocalTrafficModule = typeof import("./computer-local-traffic");

async function freshModule(): Promise<LocalTrafficModule> {
  vi.resetModules();
  return import("./computer-local-traffic");
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("computer-local-traffic store", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    secureStoreBox.items.clear();
    secureStoreBox.sets.length = 0;
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

  it("defaults to off, top-right", async () => {
    const mod = await freshModule();
    expect(mod.localTrafficSettings()).toEqual({ enabled: false, x: 0.86, y: 0.12 });
  });

  it("toggling persists the preference", async () => {
    const mod = await freshModule();
    mod.setLocalTrafficEnabled(true);
    await flush();
    expect(mod.localTrafficEnabled()).toBe(true);
    expect(secureStoreBox.sets).toHaveLength(1);
    const [key, value] = secureStoreBox.sets[0] as [string, string];
    expect(key).toBe("rakazo.computer-local-traffic");
    expect(JSON.parse(value)).toMatchObject({ enabled: true });
  });

  it("clamps the dragged position to the screen", async () => {
    const mod = await freshModule();
    mod.setLocalTrafficPosition(2, -1);
    expect(mod.localTrafficSettings()).toMatchObject({ x: 1, y: 0 });
  });

  it("loads a stored preference and notifies subscribers", async () => {
    secureStoreBox.items.set(
      "rakazo.computer-local-traffic",
      JSON.stringify({ enabled: true, x: 0.2, y: 0.3 }),
    );
    const mod = await freshModule();
    function Probe() {
      const settings = mod.useLocalTraffic();
      return createElement("span", null, `${settings.enabled}:${settings.x}:${settings.y}`);
    }
    await act(async () => {
      root?.render(createElement(Probe));
      await flush();
    });
    expect(container?.textContent).toBe("true:0.2:0.3");
    // Toggling re-renders subscribers with the new value.
    await act(async () => {
      mod.setLocalTrafficEnabled(false);
    });
    expect(container?.textContent).toBe("false:0.2:0.3");
  });
});
