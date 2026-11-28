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
      // scroll cluster and the four arrow keys. The page starts both
      // rows with the `hidden` attribute and only removes it when its
      // own attach runs on an interactive page, so force them visible
      // here too — the bar must show even if that un-hide did not run.
      // On its own this cannot drive anything: a view-only page never
      // attaches the button handlers or sends input, so the takeover
      // must also load the interactive URL.
      "#mobile-view-controls{display:none!important}\n" +
        "#mobile-key-bar[hidden]{display:flex!important}\n" +
        "#mobile-controls[hidden]{display:flex!important}\n" +
        "#mobile-paste[hidden],#mobile-keyboard[hidden]," +
        "#mobile-trackpad[hidden]{display:block!important}\n" +
        "#mobile-key-bar [data-key=\"ArrowLeft\"]," +
        "#mobile-key-bar [data-key=\"ArrowDown\"]," +
        "#mobile-key-bar [data-key=\"ArrowUp\"]," +
        "#mobile-key-bar [data-key=\"ArrowRight\"]{display:none!important}"
    }
  }
}

/**
 * Returns [value] as a double-quoted, JSON-style escaped JavaScript
 * string literal, the same escaping the in-app computer screen gets
 * from `JSON.stringify(css)`. A JS string literal cannot contain a
 * raw line break, and the takeover CSS does contain them, so the CSS
 * must go through this helper before it is interpolated into the
 * generated script — interpolating it raw makes the whole script fail
 * to parse (the `try{...}catch(e){}` inside never runs, so nothing
 * is installed and the failure is silent).
 */
fun jsStringLiteral(value: String): String {
  val out = StringBuilder(value.length + 2)
  out.append('"')
  for (ch in value) {
    when (ch) {
      '"' -> out.append("\\\"")
      '\\' -> out.append("\\\\")
      '\n' -> out.append("\\n")
      '\r' -> out.append("\\r")
      '\t' -> out.append("\\t")
      else -> {
        if (ch < ' ') {
          out.append("\\u")
          out.append(ch.code.toString(16).padStart(4, '0'))
        } else {
          out.append(ch)
        }
      }
    }
  }
  out.append('"')
  return out.toString()
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
  // The CSS contains double quotes and real newlines. A single-quoted
  // JS string literal cannot hold a literal line break, so the CSS is
  // embedded through jsStringLiteral (JSON-style escaping, same as the
  // in-app screen's JSON.stringify(css)); interpolating it raw made
  // the whole script fail to parse.
  val css = screenChromeCss(mode)
  val modeName = if (mode == SystemFloatScreenChromeMode.TAKEOVER) "takeover" else "float"
  return "(function(){try{var id=\"rakazo-screen-chrome\";var mode='$modeName';" +
    "var css=${jsStringLiteral(css)};var style=document.getElementById(id);" +
    "if(!style){style=document.createElement(\"style\");style.id=id;" +
    "(document.head||document.documentElement).appendChild(style);}" +
    "if(style.getAttribute(\"data-mode\")!==mode){" +
    "style.textContent=css;style.setAttribute(\"data-mode\",mode);}" +
    "}catch(e){}})();"
}
