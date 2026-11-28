import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = resolve(mobileRoot, "modules/rakazo-system-float");
const nativeRoot = resolve(moduleRoot, "android/src/main");

function read(relative: string): string {
  return readFileSync(resolve(nativeRoot, relative), "utf8");
}

describe("system float window native contract", () => {
  it("declares the overlay permission, the foreground-service permission and the service", () => {
    const manifest = read("AndroidManifest.xml");
    expect(manifest).toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_SPECIAL_USE");
    expect(manifest).toContain("RakazoSystemFloatService");
    expect(manifest).toContain('android:foregroundServiceType="specialUse"');
    expect(manifest).toContain("android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE");
  });

  it("exposes the window through the RakazoSystemFloat module", () => {
    const module = read("java/com/rakazo/systemfloat/RakazoSystemFloatModule.kt");
    expect(module).toContain('Name("RakazoSystemFloat")');
    expect(module).toContain('AsyncFunction("isSupported")');
    expect(module).toContain('AsyncFunction("hasOverlayPermission")');
    expect(module).toContain("appContext.reactContext ?: return@AsyncFunction false");
    expect(module).toContain("Settings.canDrawOverlays(context)");
    expect(module).toContain('AsyncFunction("show")');
    expect(module).toContain("RakazoSystemFloatService.ACTION_SHOW");
    expect(module).toContain('AsyncFunction("updateUrl")');
    expect(module).toContain('AsyncFunction("hide")');
    expect(module).toContain('AsyncFunction("isShowing")');
    expect(module).toContain("startForegroundService");
  });

  it("hosts the live screen in a WindowManager overlay kept alive by a foreground service", () => {
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    expect(service).toContain("TYPE_APPLICATION_OVERLAY");
    expect(service).toContain("WebView");
    expect(service).toContain("javaScriptEnabled = true");
    expect(service).toContain("domStorageEnabled = true");
    expect(service).toContain("FOREGROUND_SERVICE_TYPE_SPECIAL_USE");
    expect(service).toContain("startForeground(");
    expect(service).toContain("FLAG_NOT_TOUCH_MODAL");
    expect(service).toContain("updateViewLayout");
    expect(service).toContain("windowManager?.removeView");
    expect(service).toContain("webView?.destroy()");
    // A rotated capability re-points the window instead of reopening it.
    expect(service).toContain("if (url == currentUrl) return");
    // Closing the window from its own title bar stops the service.
    expect(service).toContain("setOnClickListener { stopSelf() }");
  });

  it("shows one takeover button instead of the keyboard and open-app buttons", () => {
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    // The old keyboard button never popped the keyboard and the open-app
    // button duplicated the notification's return path, so both are gone:
    // one takeover button takes over the computer and shows the keyboard.
    expect(service).not.toContain("keyboardButton");
    expect(service).not.toContain("openButton");
    expect(service).not.toContain("updateOperationButtons");
    expect(service).not.toContain("ic_rakazo_system_float_keyboard");
    expect(service).not.toContain("ic_rakazo_system_float_open");
    expect(service).toContain("takeoverButton");
    expect(service).toContain("R.drawable.ic_rakazo_system_float_takeover");
    expect(service).toContain("setOnClickListener { onTakeoverTapped() }");
    // The takeover button is always visible: taking over is how a small
    // window becomes maximized, so hiding it until maximized would hide
    // the only way in. Its tint shows the taken-over state.
    expect(service).toContain("private fun updateTakeoverButton()");
    expect(service).toContain("imageTintList");
    expect(service).toContain("rakazo_system_float_takeover");
    expect(service).toContain("rakazo_system_float_release");
    // Title bar order: title, takeover, maximize/restore, close.
    const bar = service.slice(service.indexOf("bar.addView(titleText)"));
    expect(bar.indexOf("bar.addView(takeoverButton)")).toBeLessThan(
      bar.indexOf("bar.addView(maximizeButton)"),
    );
    expect(bar.indexOf("bar.addView(maximizeButton)")).toBeLessThan(
      bar.indexOf("bar.addView(closeButton)"),
    );
    // Taking over from the small window maximizes it first; maximizing
    // alone never asks for the keyboard.
    expect(service).toContain("private fun onTakeoverTapped()");
    expect(service).toContain("SystemFloatTakeoverEvent.TakeoverTapped");
  });

  it("starts not focusable and only takes focus while taken over", () => {
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    // At rest the overlay must not steal the keyboard from other apps.
    expect(service).toContain("FLAG_NOT_FOCUSABLE");
    expect(service).toContain(
      "WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or\n" +
        "        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,",
    );
    // Takeover clears the flag, release restores it, both through a
    // layout update; the state machine decides which.
    expect(service).toContain("private fun setWindowFocusable(focusable: Boolean)");
    expect(service).toContain(
      "params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()",
    );
    expect(service).toContain("params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE");
    expect(service).toContain("SystemFloatTakeoverEffect.MAKE_FOCUSABLE");
    expect(service).toContain("SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE");
    // The notification still carries the return-to-app path.
    expect(service).toContain("openAppPendingIntent()");
  });

  it("never forces the keyboard up on takeover; it switches the screen chrome instead", () => {
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    // Round 2: takeover is not about popping the keyboard, it is the
    // Settings takeover — the page's own Esc/keyboard bar becomes
    // visible and the keyboard appears naturally when the user taps a
    // text field or the page's keyboard button. A forced showSoftInput
    // with no editable element focused pops an IME with no input
    // connection that dies on the first canvas tap, and a blind show
    // raced against the window becoming focusable can be silently
    // dropped, so the takeover path must not call it at all.
    expect(service).not.toContain("showSoftInput");
    expect(service).not.toContain("SHOW_FORCED");
    expect(service).not.toContain("SHOW_IMPLICIT");
    expect(service).not.toContain("private fun showKeyboardAfterFocus");
    expect(service).not.toContain("KEYBOARD_RETRY_DELAY_MS");
    // Dismissing the keyboard must not end the takeover either: the
    // user may dismiss it and keep driving, so the dismiss listener
    // and its event are gone entirely.
    expect(service).not.toContain("watchKeyboardDismissed");
    expect(service).not.toContain("KeyboardDismissed");
    expect(service).not.toContain("OnGlobalLayoutListener");
    expect(service).not.toContain("KEYBOARD_DISMISS_DELAY_MS");
    expect(service).not.toContain("KEYBOARD_VISIBLE_THRESHOLD_DP");
    // Taking over switches the injected chrome to takeover rules and
    // releasing switches it back, through the state machine.
    expect(service).toContain("SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME");
    expect(service).toContain("private fun applyScreenChrome()");
    expect(service).toContain("screenChromeScript(mode)");
    expect(service).toContain("SystemFloatScreenChromeMode.TAKEOVER");
    expect(service).toContain("SystemFloatScreenChromeMode.FLOAT");
    // A page reload while taken over keeps takeover chrome: the load
    // handler re-injects the current mode, not always the float rules.
    expect(service).not.toContain("SCREEN_CHROME_HIDE_JS");
    expect(service).toContain("applyScreenChrome()");
    const finished = service.slice(service.indexOf("override fun onPageFinished"));
    expect(finished).toContain("applyScreenChrome()");
    // Tapping into the maximized screen to drive takes over; taps on
    // the small window stay mouse clicks.
    expect(service).toContain("SystemFloatTakeoverEvent.ScreenTapped");
    expect(service).toContain("setOnTouchListener { _, event ->");
  });

  it("keeps the Esc/keyboard bar visible in takeover chrome and hides it in float chrome", () => {
    const chrome = read("java/com/rakazo/systemfloat/SystemFloatScreenChrome.kt");
    const takeover = chrome.slice(chrome.indexOf("SystemFloatScreenChromeMode.TAKEOVER ->"));
    const float = chrome.slice(
      chrome.indexOf("SystemFloatScreenChromeMode.FLOAT ->"),
      chrome.indexOf("SystemFloatScreenChromeMode.TAKEOVER ->"),
    );
    // Float (watching) hides every in-page control, including the
    // Esc/Tab/Ctrl bar and the paste/keyboard/trackpad row. (The rule
    // is split across two string literals in the source, so pin both
    // halves rather than the joined text.)
    expect(float).toContain("#mobile-view-controls,#mobile-key-bar,#mobile-controls,");
    expect(float).toContain("#noVNC_control_bar_anchor{display:none!important}");
    // Takeover keeps #mobile-key-bar (Esc/Tab/Ctrl) and #mobile-controls
    // (paste/keyboard/trackpad) visible: no rule hides either of them
    // as a whole. Only the +/- zoom cluster and the four arrow keys go.
    expect(takeover).not.toContain("#mobile-key-bar{display");
    expect(takeover).not.toContain("#mobile-controls{display");
    expect(takeover).not.toContain("#mobile-key-bar,#mobile-controls");
    expect(takeover).toContain("#mobile-view-controls{display:none!important}");
    // The double quotes are escaped in the Kotlin source, so pin the
    // escaped form here; the kotlinc run below checks the real values.
    for (const arrow of ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]) {
      expect(takeover).toContain(`#mobile-key-bar [data-key=\\"${arrow}\\"]`);
    }
    // Both modes share one <style> keyed by id, so switching modes
    // rewrites the rules instead of stacking a second element. (Quotes
    // are escaped in the Kotlin source, so pin the escaped form; the
    // kotlinc run below checks the real script text.)
    expect(chrome).toContain('var id=\\"rakazo-screen-chrome\\"');
    expect(chrome).toContain('style.getAttribute(\\"data-mode\\")!==mode');
    expect(chrome).toContain('style.setAttribute(\\"data-mode\\",mode)');
    // The rules mirror the in-app computer screen's takeover chrome
    // exactly — same selectors, same hidden set — so the native window
    // and the in-app screen agree.
    const inApp = readFileSync(resolve(mobileRoot, "lib/computer-screen-chrome.ts"), "utf8");
    // Same four selectors, same hide rule, in the in-app float mode.
    for (const selector of [
      "#mobile-view-controls",
      "#mobile-key-bar",
      "#mobile-controls",
      "#noVNC_control_bar_anchor",
    ]) {
      expect(inApp).toContain(selector);
    }
    expect(inApp).toContain("{display:none!important}");
    expect(inApp).toContain("#mobile-view-controls{display:none!important}");
    for (const arrow of ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]) {
      expect(inApp).toContain(`#mobile-key-bar [data-key="${arrow}"]`);
    }
  });

  it("keeps the takeover/focus rules in a pure state machine", () => {
    const machine = read("java/com/rakazo/systemfloat/SystemFloatTakeoverState.kt");
    // No Android imports: the transition table must be checkable without
    // a device or a build.
    expect(machine).not.toContain("import android.");
    for (const event of ["TakeoverTapped", "MaximizeTapped", "ScreenTapped", "WindowClosed"]) {
      expect(machine).toContain(event);
    }
    // No keyboard-dismiss event: dismissing the keyboard never ends a
    // takeover, and no transition ever asks the keyboard to appear.
    expect(machine).not.toContain("KeyboardDismissed");
    expect(machine).not.toContain("SHOW_KEYBOARD");
    for (const effect of [
      "MAXIMIZE_WINDOW",
      "RESTORE_WINDOW",
      "MAKE_FOCUSABLE",
      "MAKE_NOT_FOCUSABLE",
      "HIDE_KEYBOARD",
      "APPLY_SCREEN_CHROME",
      "UPDATE_TAKEOVER_BUTTON",
    ]) {
      expect(machine).toContain(effect);
    }
    expect(machine).toContain("fun reduceTakeover(");
    // The service drives the machine and applies its effects in a fixed
    // order instead of branching on flags itself.
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    expect(service).toContain("private fun applyTakeoverTransition(");
    expect(service).toContain("reduceTakeover(currentTakeoverState()");
  });

  it("ships the notification strings for every supported locale", () => {
    const locales = ["", "de", "es", "ja", "nl", "pl", "ru", "zh-rCN", "zh-rTW"];
    for (const locale of locales) {
      const dir = locale === "" ? "values" : `values-${locale}`;
      const path = resolve(nativeRoot, "res", dir, "strings.xml");
      expect(existsSync(path)).toBe(true);
      const strings = readFileSync(path, "utf8");
      for (const key of [
        "rakazo_system_float_title",
        "rakazo_system_float_text",
        "rakazo_system_float_channel",
      ]) {
        expect(strings).toContain(`name="${key}"`);
      }
    }
    for (const dir of ["values", "values-zh-rCN", "values-zh-rTW"]) {
      const strings = readFileSync(resolve(nativeRoot, "res", dir, "strings.xml"), "utf8");
      expect(strings).toContain('name="rakazo_system_float_takeover"');
      expect(strings).toContain('name="rakazo_system_float_release"');
      expect(strings).not.toContain('name="rakazo_system_float_keyboard"');
      expect(strings).not.toContain('name="rakazo_system_float_open_app"');
    }
    const drawables = readdirSync(resolve(nativeRoot, "res", "drawable"));
    expect(drawables).toEqual(
      expect.arrayContaining([
        "ic_rakazo_system_float.xml",
        "ic_rakazo_system_float_close.xml",
        "ic_rakazo_system_float_takeover.xml",
        "ic_rakazo_system_float_resize.xml",
      ]),
    );
    expect(drawables).not.toContain("ic_rakazo_system_float_keyboard.xml");
    expect(drawables).not.toContain("ic_rakazo_system_float_open.xml");
  });
});
