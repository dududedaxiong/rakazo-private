import QRCode from "qrcode";

/** A QR code for a share link, as an SVG string; the same code the web dialog draws. */
export async function shareLinkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
