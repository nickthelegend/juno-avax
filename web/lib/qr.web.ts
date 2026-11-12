import QRCode from "qrcode";

/** A QR code for `text` as a data: URL, drawn in Juno ink on white. Web only (the landing page). */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: "#12150E", light: "#ffffff" } });
}
