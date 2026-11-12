// Y-Summit Season 4 2026 — participant dashboard
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, apiDownload, showError, formatDate, setText, $, startCountdown } from "../../assets/js/utils.js";
import { CONFIG } from "../../assets/js/config.js";

const user = await requireSession();
if (user) {
  wireLogoutButton();
  renderProfile(user);
  await loadAnnouncementPreview();
  wireDownloadButtons();
  startCountdown(CONFIG.EVENT.startDate, { days: "days", hours: "hours", minutes: "minutes", seconds: "seconds" });
}

function renderProfile(user) {
  setText("welcomeName", user.fullName?.split(" ")[0] || "Participant");
  setText("participantName", user.fullName);
  setText("participantParish", user.Parish?.name || user.Church?.name || "—");
  const avatar = $("participantAvatar");
  if (avatar && user.avatarUrl) avatar.src = user.avatarUrl;

  const reg = user.registration;
  setText("registrationStatus", reg?.status?.replace("_", " ") ?? "—");
  setText("registrationDate", formatDate(reg?.createdAt));
  setText("admissionStatus", "Name-based check-in");
  setText("admissionCode", "Show your full name at the entrance");
}

async function loadAnnouncementPreview() {
  try {
    const { announcements } = await apiFetch("/announcements");
    const latest = announcements[0];
    if (latest) {
      setText("announcementTitle", latest.title);
      setText("announcementMessage", latest.body);
      setText("announcementDate", formatDate(latest.createdAt));
    }
  } catch (err) {
    console.error("Failed to load announcements:", err);
  }
}

function wireDownloadButtons() {
  const certBtn = $("downloadCertificateBtn");
  if (certBtn) {
    apiFetch("/certificates/me").then(({ certificates }) => {
      if (certificates.length) {
        certBtn.addEventListener("click", async () => {
          const cert = certificates[0];
          try {
            await apiDownload(`/certificates/me/${cert.id}/pdf`, `gy-summit-2026-${cert.type.toLowerCase()}.pdf`);
          } catch (err) {
            showError(err.message || "Could not download your certificate.");
          }
        });
      } else {
        certBtn.disabled = true;
        certBtn.title = "Not issued yet — certificates are released after the summit team finalises them.";
      }
    }).catch(() => {
      certBtn.disabled = true;
    });
  }

  const programBtn = $("downloadProgramBtn");
  if (programBtn) {
    apiFetch("/gallery").then(({ items }) => {
      const program = items.find(
        (i) => i.mediaType === "document" && /program/i.test(`${i.caption || ""} ${i.albumName || ""}`)
      );
      if (program) {
        programBtn.addEventListener("click", () => window.open(program.url, "_blank", "noopener"));
      } else {
        programBtn.disabled = true;
        programBtn.title = "The event program hasn't been uploaded yet.";
      }
    }).catch(() => {
      programBtn.disabled = true;
    });
  }
}
