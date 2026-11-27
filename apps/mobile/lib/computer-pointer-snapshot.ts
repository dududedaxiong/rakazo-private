import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type WebView from "react-native-webview";
import type { ComputerPointer } from "./computer-pointer";
import {
  computerPointer,
  setComputerPointerSnapshot,
  useComputerPointer,
} from "./computer-pointer";

/**
 * The AI click magnifier: a circular lens over the click point showing the
 * real screen content around it, magnified.
 *
 * The screen is a noVNC page, so the frame already sits in a 2D canvas in
 * the WebView (noVNC's Display renders the framebuffer into one; its
 * backing store is the framebuffer size, so canvas pixels are desktop
 * pixels 1:1). A 2D canvas keeps its backing store — the blank-readback
 * problem only exists for WebGL — so the capture script can crop the region
 * around the click out of the canvas, scale it up, and post the data URL
 * back to the app. No second session, no server round-trip, no extra
 * dependency: the frame is already there.
 *
 * The lens shows the crop at the moment of capture. The click's target is
 * visible whether or not the click's effect has reached the canvas yet; the
 * exact position still comes from the server's pointer, never from the
 * image.
 */

/** Lens diameter, in points. */
export const POINTER_SNAPSHOT_LENS_SIZE = 140;
/** How much the lens magnifies the screen around the click. */
export const POINTER_SNAPSHOT_ZOOM = 2.5;
/** Desktop pixels cropped around the click (lens size / zoom). */
export const POINTER_SNAPSHOT_CROP = 56;
/** The captured lens image is a small JPEG; quality 0.85 keeps it legible. */
const SNAPSHOT_JPEG_QUALITY = 0.85;
/** One retry inside the page when the canvas is not there yet. */
const PAGE_RETRY_MS = 800;
/** One retry from the app when nothing came back (page still loading). */
const APP_RETRY_MS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * JavaScript injected into the computer screen WebView. Crops the region
 * around the click out of the noVNC canvas, scales it up into a lens-sized
 * image, and posts it back with `window.ReactNativeWebView.postMessage`.
 * Ends in `true;` as WebView injectedJavaScript expects.
 *
 * The canvas is `#screen canvas` on the embed page (RFB builds its canvas
 * inside `#screen`), `#noVNC_canvas` on the stock noVNC page, or the first
 * canvas in the document as a last resort. A click near the edge clamps the
 * crop to the canvas and offsets the draw, so the click stays at the centre
 * of the lens instead of sliding off it.
 */
export function computerPointerSnapshotScript(
  pointer: Pick<ComputerPointer, "x" | "y" | "seq">,
): string {
  const seq = JSON.stringify(pointer.seq);
  const cx = JSON.stringify(pointer.x);
  const cy = JSON.stringify(pointer.y);
  const crop = POINTER_SNAPSHOT_CROP;
  const size = POINTER_SNAPSHOT_LENS_SIZE;
  const zoom = POINTER_SNAPSHOT_ZOOM;
  return `(function(){var seq=${seq};var cx=${cx};var cy=${cy};var crop=${crop};var size=${size};var zoom=${zoom};
function post(payload){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify(payload));}}catch(e){}}
function capture(attempt){try{
var canvas=document.querySelector("#screen canvas")||document.querySelector("#noVNC_canvas")||document.querySelector("canvas");
if(!canvas||!canvas.width||!canvas.height){if(attempt<1){setTimeout(function(){capture(attempt+1);},${PAGE_RETRY_MS});}else{post({type:"rakazo-pointer-snapshot",seq:seq,error:"no-canvas"});}return;}
var ctx=canvas.getContext("2d");
if(!ctx){post({type:"rakazo-pointer-snapshot",seq:seq,error:"no-context"});return;}
var out=document.createElement("canvas");out.width=size;out.height=size;
var octx=out.getContext("2d");
if(!octx){post({type:"rakazo-pointer-snapshot",seq:seq,error:"no-context"});return;}
octx.fillStyle="#0e0e10";octx.fillRect(0,0,size,size);
var ix=Math.round(cx-crop/2);var iy=Math.round(cy-crop/2);
var sx=ix;var sy=iy;var sw=crop;var sh=crop;
if(sx<0){sw+=sx;sx=0;} if(sy<0){sh+=sy;sy=0;}
if(sx+sw>canvas.width){sw=canvas.width-sx;} if(sy+sh>canvas.height){sh=canvas.height-sy;}
if(sw>0&&sh>0){octx.drawImage(canvas,sx,sy,sw,sh,(sx-ix)*zoom,(sy-iy)*zoom,sw*zoom,sh*zoom);}
post({type:"rakazo-pointer-snapshot",seq:seq,dataUrl:out.toDataURL("image/jpeg",${SNAPSHOT_JPEG_QUALITY})});
}catch(e){post({type:"rakazo-pointer-snapshot",seq:seq,error:"capture-failed"});}}
capture(0);return true;})();`;
}

export type ComputerPointerSnapshotMessage =
  | { seq: number; dataUrl: string }
  | { seq: number; error: string };

/**
 * Parse an incoming WebView message as a pointer snapshot, or null when it
 * is anything else (screen state, keyboard traffic, ...). Only data URLs
 * that look like images are accepted.
 */
export function parseComputerPointerSnapshotMessage(
  data: string,
): ComputerPointerSnapshotMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.type !== "rakazo-pointer-snapshot") return null;
  if (!isFiniteNumber(parsed.seq)) return null;
  if (typeof parsed.dataUrl === "string" && parsed.dataUrl.startsWith("data:image/")) {
    return { seq: parsed.seq, dataUrl: parsed.dataUrl };
  }
  if (typeof parsed.error === "string") {
    return { seq: parsed.seq, error: parsed.error };
  }
  return null;
}

/**
 * Route an incoming WebView message: when it is a pointer snapshot, store it
 * (a failed capture stores nothing — the marker falls back to the dot, ring
 * and arrow) and return true; otherwise return false so the caller falls
 * through to its own message handling.
 */
export function handleComputerPointerSnapshotMessage(data: string): boolean {
  const message = parseComputerPointerSnapshotMessage(data);
  if (!message) return false;
  if ("dataUrl" in message) setComputerPointerSnapshot(message.seq, message.dataUrl);
  return true;
}

/**
 * Ask a screen WebView to capture the region around a new pointer. Each
 * mounted screen face calls this for the same pointer; the store keeps the
 * first snapshot that comes back, so the extra captures are harmless.
 */
export function useComputerPointerSnapshot(webViewRef: RefObject<WebView | null>): void {
  const pointer = useComputerPointer();
  const lastRequestedSeq = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pointer || pointer.snapshot) return;
    if (lastRequestedSeq.current === pointer.seq) return;
    lastRequestedSeq.current = pointer.seq;
    webViewRef.current?.injectJavaScript(computerPointerSnapshotScript(pointer));
    // The page may not have its canvas yet when the pointer lands (a screen
    // that just opened); try once more shortly after, from the same face.
    retryTimer.current = setTimeout(() => {
      const current = computerPointer();
      if (current && current.seq === pointer.seq && !current.snapshot) {
        webViewRef.current?.injectJavaScript(computerPointerSnapshotScript(pointer));
      }
    }, APP_RETRY_MS);
    return () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
  }, [pointer, webViewRef]);
}
