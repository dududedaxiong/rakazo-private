package com.rakazo.systemfloat

/**
 * Pure screen-chrome rules for the system floating window's WebView.
 *
 * The computer screen page renders its own control panels (the +/- zoom
 * cluster, the Esc/Tab/Ctrl and arrow-key bar, the paste/keyboard/trackpad
 * row, and the stock noVNC control bar). The float injects a <style> that
 * shows or hides them per mode — the same rules the in-app computer screen
 * injects (apps/mobile/lib/computer-screen-chrome.ts), mirrored here so
 * the native window and the in-app screen agree. This file has no Android
 * dependencies so the rules can be checked without a device.
 *
 * Modes:
 * - FLOAT (watching): hide every in-page control, so the small window
 *   stays a clean view of the remote screen.
 * - TAKEOVER (the user is driving): keep the Esc/Tab/Ctrl bar
 *   (#mobile-key-bar) and the paste/keyboard/trackpad row
 *   (#mobile-controls) visible — the bottom bar the user drives with,
 *   including the page's own keyboard button, which is how the keyboard
 *   comes up. Only the +/- zoom cluster and the four arrow keys stay
 *   hidden.
 *
 * The takeover never forces the soft keyboard up: there is no editable
 * element focused when the user takes over, so a forced showSoftInput
 * pops an IME with no input connection that dies on the first canvas
 * tap, and a blind show raced against the window becoming focusable can
 * be silently dropped. The keyboard appears naturally when the user taps
 * a text field in the computer or the page's own keyboard button, which
 * focuses the page's hidden textarea.
 */
enum class SystemFloatScreenChromeMode {
  FLOAT,
  TAKEOVER,
}

/**
 * The CSS text injected for [mode]. Takeover mode deliberately has no
 * rule hiding `#mobile-key-bar` or `#mobile-controls`: those stay visible.
 */
fun screenChromeCss(mode: SystemFloatScreenChromeMode): String {
  return when (mode) {
    SystemFloatScreenChromeMode.FLOAT -> {
      "#mobile-view-controls,#mobile-key-bar,#mobile-controls," +
        "#noVNC_control_bar_anchor{display:none!important}"
    }
    SystemFloatScreenChromeMode.TAKEOVER -> {
      // Keep #mobile-key-bar (Esc/Tab/Ctrl) and #mobile-controls
      // (paste/keyboard/trackpad) visible; hide only the +/- zoom and
      // scroll cluster and the four arrow keys.
      "#mobile-view-controls{display:none!important}\n" +
        "#mobile-key-bar [data-key=\"ArrowLeft\"]," +
        "#mobile-key-bar [data-key=\"ArrowDown\"]," +
        "#mobile-key-bar [data-key=\"ArrowUp\"]," +
        "#mobile-key-bar [data-key=\"ArrowRight\"]{display:none!important}"
    }
  }
}

/**
 * JavaScript that installs the mode's rules in a <style> keyed by id and
 * records the mode that produced it, so running it again with a different
 * mode rewrites the rules instead of adding a second element. The float
 * and takeover rules live in the same element, so switching modes can
 * never leave the first mode's rules in place underneath the second.
 * Safe to run more than once; the service runs it on every page load
 * (with the current mode) and on every takeover/release.
 */
fun screenChromeScript(mode: SystemFloatScreenChromeMode): String {
  // The CSS contains double quotes but no single quotes, so a
  // single-quoted JS string literal needs no escaping.
  val css = screenChromeCss(mode)
  val modeName = if (mode == SystemFloatScreenChromeMode.TAKEOVER) "takeover" else "float"
  return "(function(){try{var id=\"rakazo-screen-chrome\";var mode='$modeName';" +
    "var css='$css';var style=document.getElementById(id);" +
    "if(!style){style=document.createElement(\"style\");style.id=id;" +
    "(document.head||document.documentElement).appendChild(style);}" +
    "if(style.getAttribute(\"data-mode\")!==mode){" +
    "style.textContent=css;style.setAttribute(\"data-mode\",mode);}" +
    "}catch(e){}})();"
}
