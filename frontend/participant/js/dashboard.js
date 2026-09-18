// GY Summit 2026 — participant dashboard
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, apiDownload, showError, showSuccess, formatKes, formatDate, setText, $, startCountdown } from "../../assets/js/utils.js";
import { CONFIG } from "../../assets/js/config.js";

const user = await requireSession();
if (user) {
  wireLogoutButton();
  renderProfile(user);
  await loadAnnouncementPreview();
  await loadAttendanceSummary();
  await loadSportsSummary();
  await loadGalleryPreview();
  wireDownloadButtons();
  startCountdown(CONFIG.EVENT.startDate, { days: "days", hours: "hours", minutes: "minutes", seconds: "seconds" });
  tickClock();
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
  setText("paymentStatus", reg?.status === "CONFIRMED" ? "Paid" : "Pending");
  setText("amountPaid", formatKes(
    reg?.payments?.filter((p) => p.status === "SUCCESS").reduce((sum, p) => sum + p.amount, 0) || 0
  ));

  setText("admissionStatus", user.admissionCard ? "Issued" : "Not yet issued");
  setText("admissionCode", user.admissionCard?.cardNumber ?? "—");
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

async function loadAttendanceSummary() {
  try {
    const { attendances } = await apiFetch("/attendance/me");
    setText("certificateCount", attendances.filter((a) => a.type === "SESSION").length);
  } catch (err) {
    console.error("Failed to load attendance:", err);
  }
}

async function loadSportsSummary() {
  try {
    const [{ memberships }, { events }] = await Promise.all([
      apiFetch("/sports/me"),
      apiFetch("/sports"),
    ]);

    const byCategory = {
      Football: { statusId: "footballStatus", fixtureId: "footballFixture" },
      Volleyball: { statusId: "volleyballStatus" },
      Dance: { statusId: "danceStatus", fixtureId: "dancePerformance" },
    };

    for (const [category, ids] of Object.entries(byCategory)) {
      const isRegistered = memberships.some((m) => m.SportsTeam?.category === category);
      setText(ids.statusId, isRegistered ? "Registered" : "Not Registered");

      if (ids.fixtureId) {
        const next = events
          .filter((e) => e.category === category && e.status !== "COMPLETED" && e.status !== "CANCELLED")
          .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
        setText(ids.fixtureId, next ? `Next: ${formatDate(next.startsAt)} — ${next.venue}` : "No fixture scheduled yet");
      }
    }
  } catch (err) {
    console.error("Failed to load sports summary:", err);
  }
}

async function loadGalleryPreview() {
  try {
    const { items } = await apiFetch("/gallery");
    const photos = items.filter((i) => i.mediaType === "photo").slice(0, 4);
    photos.forEach((photo, i) => {
      const img = $(`galleryImage${i + 1}`);
      if (img) img.src = photo.url;
    });
  } catch (err) {
    console.error("Failed to load gallery preview:", err);
  }

  return null;
}

function tickClock() {
  const el = $("currentTime");
  if (!el) return;
  setInterval(() => {
    el.textContent = new Date().toLocaleTimeString("en-KE");
  }, 1000);
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
