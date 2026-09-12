// GY Summit 2026 — shared camera QR scanner (admission check-in)
// Uses html5-qrcode from CDN, matching the project's existing tech stack.
import { apiFetch, showError, showSuccess } from "./utils.js";

let html5QrCode = null;
let scannerLoaded = false;

async function ensureLibraryLoaded() {
  if (scannerLoaded) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  scannerLoaded = true;
}

/**
 * Starts the camera scanner in the element with id=containerId, and calls
 * onResult({ attendance, participant }) for every successfully scanned,
 * valid admission card. type/label are passed straight to /admission/scan.
 */
export async function startAdmissionScanner(containerId, { type = "CHECK_IN", label } = {}, onResult) {
  await ensureLibraryLoaded();
  const container = document.getElementById(containerId);
  if (!container) return;

  // eslint-disable-next-line no-undef
  html5QrCode = new Html5Qrcode(containerId);
  let processing = false;

  await html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    async (decodedText) => {
      if (processing) return;
      processing = true;
      try {
        const result = await apiFetch("/admission/scan", { method: "POST", body: { token: decodedText, type, label } });
        showSuccess(`Checked in: ${result.participant.fullName}`);
        onResult?.(result);
      } catch (err) {
        showError(err.message || "Invalid or already-used admission code.");
      } finally {
        setTimeout(() => (processing = false), 1500);
      }
    },
    () => {} // ignore per-frame scan failures (no QR in view yet)
  );
}

export async function stopAdmissionScanner() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch {
      // scanner already stopped
    }
  }
}
