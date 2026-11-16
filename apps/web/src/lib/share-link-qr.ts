import QRCode from "qrcode";

/** A QR code for a share link, drawn client-side; the code carries the exact link, token included. */
export async function shareLinkQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 192 });
}
