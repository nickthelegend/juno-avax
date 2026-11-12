/** Native builds never render the landing page, so they carry no QR encoder. */
export function qrDataUrl(_text: string): Promise<string> {
  return Promise.reject(new Error("QR codes are drawn on the web landing only"));
}
