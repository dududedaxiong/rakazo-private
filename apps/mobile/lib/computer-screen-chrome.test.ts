// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { computerScreenChromeScript } from "./computer-screen-chrome";

/**
 * The screen page the script runs against. The old embed.html in this repo has
 * no #mobile-view-controls; the newer one the live image serves adds it (with
 * the +/- zoom and ^/v scroll buttons), so the fake page carries both shapes.
 */
const FAKE_PAGE = `
  <div id="mobile-view-controls">
    <button type="button">+</button>
    <button type="button">-</button>
    <button type="button">^</button>
    <button type="button">v</button>
  </div>
  <div id="mobile-key-bar">
    <button type="button" data-key="Escape">Esc</button>
    <button type="button" data-key="Tab">Tab</button>
    <button type="button" data-key="Control">Ctrl</button>
    <button type="button" data-key="ArrowLeft">←</button>
    <button type="button" data-key="ArrowDown">↓</button>
    <button type="button" data-key="ArrowUp">↑</button>
    <button type="button" data-key="ArrowRight">→</button>
  </div>
  <div id="mobile-controls">
    <button type="button">Paste</button>
    <button type="button">Keyboard</button>
    <button type="button">Trackpad</button>
  </div>
  <div id="noVNC_control_bar_anchor"></div>
`;

function displayOf(selector: string): string {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  return getComputedStyle(element as Element).display;
}

/**
 * Run the injected script the way a WebView runs it: as a <script> in the
 * page, not through eval.
 */
function runScript(script: string): void {
  const element = document.createElement("script");
  element.textContent = script;
  document.head.appendChild(element);
  element.remove();
}

describe("computerScreenChromeScript", () => {
  beforeEach(() => {
    document.body.innerHTML = FAKE_PAGE;
    // The script keys its <style> by id and skips a second injection, so a
    // style left in <head> by an earlier test would hide the next mode's CSS.
    document.getElementById("rakazo-screen-chrome")?.remove();
  });

  it("float mode hides every in-page control panel", () => {
    runScript(computerScreenChromeScript("float"));
    expect(displayOf("#mobile-view-controls")).toBe("none");
    expect(displayOf("#mobile-key-bar")).toBe("none");
    expect(displayOf("#mobile-controls")).toBe("none");
    expect(displayOf("#noVNC_control_bar_anchor")).toBe("none");
  });

  it("takeover mode hides the zoom cluster and the arrow keys, keeps the rest", () => {
    runScript(computerScreenChromeScript("takeover"));
    expect(displayOf("#mobile-view-controls")).toBe("none");
    for (const key of ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]) {
      expect(displayOf(`#mobile-key-bar [data-key="${key}"]`)).toBe("none");
    }
    for (const key of ["Escape", "Tab", "Control"]) {
      expect(displayOf(`#mobile-key-bar [data-key="${key}"]`)).not.toBe("none");
    }
    expect(displayOf("#mobile-controls")).not.toBe("none");
  });

  it("is safe to inject more than once (one style element)", () => {
    runScript(computerScreenChromeScript("float"));
    runScript(computerScreenChromeScript("float"));
    expect(document.querySelectorAll("#rakazo-screen-chrome")).toHaveLength(1);
    expect(displayOf("#mobile-key-bar")).toBe("none");
  });

  it("ends in true, as WebView injectedJavaScript expects", () => {
    expect(computerScreenChromeScript("float").trimEnd().endsWith("true;})();")).toBe(true);
  });
});
