/**
 * In-page controls of the computer screen page, hidden from inside the WebView.
 *
 * The overlay buttons the user sees on the computer screen (+/- zoom and
 * scroll, Esc/Tab/Ctrl, the four arrow keys, paste/keyboard/trackpad) are
 * rendered by the screen page itself — the noVNC page served from the computer
 * sandbox image — not by this app. The app hides them by injecting a <style>
 * into the page, so the removal works no matter which page version the live
 * image serves (the image may run a newer embed.html than the one in
 * infra/sandboxes/computer). The style targets the control ids by name and
 * uses !important so the page's own rules cannot bring them back.
 *
 * This deliberately does NOT touch the page's remote cursor. noVNC renders the
 * cursor only from local input (its canvas follows the user's own mouse), so
 * enlarging it would show a stale cursor at the wrong place — not where the AI
 * clicked. The AI's click position never reaches the app (the thread tool
 * events carry only the tool name, and ComputerStatus has no pointer field),
 * so a true AI click indicator needs the server to send the coordinates; that
 * is a separate follow-up, not something this injection can fake.
 */
export type ComputerScreenChromeMode = "float" | "takeover";

function chromeCss(mode: ComputerScreenChromeMode): string {
  // The small window is for watching: hide every in-page control.
  if (mode === "float") {
    return `${[
      "#mobile-view-controls", // upstream's +/- zoom and ^/v scroll cluster
      "#mobile-key-bar", // Esc, Tab, Ctrl and the four arrow keys
      "#mobile-controls", // paste, keyboard and trackpad buttons
      "#noVNC_control_bar_anchor", // stock noVNC control bar
    ].join(",")}{display:none!important}`;
  }
  // Takeover: the user is driving. Keep Esc/Tab/Ctrl and the
  // paste/keyboard/trackpad row, but hide the +/- zoom and ^/v scroll cluster
  // and the four arrow keys.
  return [
    "#mobile-view-controls{display:none!important}",
    '#mobile-key-bar [data-key="ArrowLeft"],' +
      '#mobile-key-bar [data-key="ArrowDown"],' +
      '#mobile-key-bar [data-key="ArrowUp"],' +
      '#mobile-key-bar [data-key="ArrowRight"]{display:none!important}',
  ].join("\n");
}

/**
 * JavaScript injected into the computer screen WebView. Installs a <style>
 * that hides the in-page controls for the given mode; safe to run more than
 * once (the style element is keyed by id). Ends in `true;` as WebView
 * injectedJavaScript expects.
 */
export function computerScreenChromeScript(mode: ComputerScreenChromeMode): string {
  const css = chromeCss(mode);
  return `(function(){try{var id="rakazo-screen-chrome";if(!document.getElementById(id)){var style=document.createElement("style");style.id=id;style.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(style);}}catch(e){}return true;})();`;
}
