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

  it("shows the keyboard only on takeover, forced for the explicit tap", () => {
    const service = read("java/com/rakazo/systemfloat/RakazoSystemFloatService.kt");
    // Focus first, then the keyboard: the old showKeyboard asked with
    // SHOW_IMPLICIT before the window was focusable and got nothing.
    expect(service).not.toContain("private fun showKeyboard()");
    expect(service).toContain("private fun showKeyboardAfterFocus(forced: Boolean)");
    expect(service).toContain("InputMethodManager.SHOW_FORCED");
    expect(service).toContain("InputMethodManager.SHOW_IMPLICIT");
    expect(service).toContain("view.requestFocus()");
    expect(service).toContain("view.post {");
    // One retry after the layout update settles, cancelled on release.
    expect(service).toContain("KEYBOARD_RETRY_DELAY_MS");
    expect(service).toContain("cancelKeyboardRetry()");
    // Dismissing the keyboard releases the takeover focus but leaves the
    // window maximized.
    expect(service).toContain("watchKeyboardDismissed");
    expect(service).toContain("SystemFloatTakeoverEvent.KeyboardDismissed");
    // Tapping into the maximized screen to type takes over implicitly;
    // taps on the small window stay mouse clicks.
    expect(service).toContain("SystemFloatTakeoverEvent.ScreenTapped");
    expect(service).toContain("setOnTouchListener { _, event ->");
  });

  it("keeps the takeover/focus rules in a pure state machine", () => {
    const machine = read("java/com/rakazo/systemfloat/SystemFloatTakeoverState.kt");
    // No Android imports: the transition table must be checkable without
    // a device or a build.
    expect(machine).not.toContain("import android.");
    for (const event of [
      "TakeoverTapped",
      "MaximizeTapped",
      "ScreenTapped",
      "KeyboardDismissed",
      "WindowClosed",
    ]) {
      expect(machine).toContain(event);
    }
    for (const effect of [
      "MAXIMIZE_WINDOW",
      "RESTORE_WINDOW",
      "MAKE_FOCUSABLE",
      "MAKE_NOT_FOCUSABLE",
      "SHOW_KEYBOARD_FORCED",
      "SHOW_KEYBOARD_IMPLICIT",
      "HIDE_KEYBOARD",
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
