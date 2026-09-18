// GY Summit 2026 — participant announcements
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, formatDate, escapeHtml, setText, $ } from "../../assets/js/utils.js";

const user = await requireSession();
let allAnnouncements = [];
let pinnedAnnouncement = null;

if (user) {
  wireLogoutButton();
  setText("participantName", user.fullName);
  setText("participantParish", user.Parish?.name || user.Church?.name || "—");
  const photo = $("participantPhoto");
  if (photo && user.avatarUrl) photo.src = user.avatarUrl;
  await load();
  wireControls();
}

async function load() {
  try {
    const { announcements } = await apiFetch("/announcements");
    allAnnouncements = announcements;
    render(announcements);

    pinnedAnnouncement = announcements.find((a) => a.isPinned) || null;
    const pinnedSection = document.querySelector(".pinned-announcement");
    if (pinnedAnnouncement) {
      if (pinnedSection) pinnedSection.style.display = "";
      setText("pinnedTitle", pinnedAnnouncement.title);
      setText("pinnedPreview", pinnedAnnouncement.body.slice(0, 160));
      setText("pinnedDate", formatDate(pinnedAnnouncement.createdAt));
    } else if (pinnedSection) {
      pinnedSection.style.display = "none";
    }
    setText("unreadCount", String(announcements.length));

    // No pagination endpoint exists — everything is already loaded, so there's
    // nothing for "Load More" to fetch.
    const loadMoreSection = $("loadMoreBtn")?.closest(".load-more-section");
    if (loadMoreSection) loadMoreSection.style.display = "none";
  } catch (err) {
    showError(err.message || "Could not load announcements.");
  }
}

function wireControls() {
  $("categoryFilter")?.addEventListener("change", (e) => {
    const filtered = e.target.value === "pinned" ? allAnnouncements.filter((a) => a.isPinned) : allAnnouncements;
    render(filtered);
  });

  $("readPinnedBtn")?.addEventListener("click", () => {
    if (pinnedAnnouncement) openModal(pinnedAnnouncement.id);
  });

  $("markAsReadBtn")?.addEventListener("click", () => {
    const modal = $("announcementModal");
    if (modal) modal.style.display = "none";
  });
}

function render(items) {
  const container = $("announcementContainer");
  if (!container) return;
  const empty = $("emptyAnnouncements");

  if (items.length === 0) {
    container.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  container.innerHTML = items
    .map(
      (a) => `
      <article class="announcement-card" data-id="${a.id}" style="cursor:pointer;">
        <h3>${escapeHtml(a.title)} ${a.isPinned ? "📌" : ""}</h3>
        <p>${escapeHtml(a.body.slice(0, 140))}${a.body.length > 140 ? "…" : ""}</p>
        <span class="date">${formatDate(a.createdAt)} — ${escapeHtml(a.author?.fullName || "Organising Team")}</span>
      </article>`
    )
    .join("");

  container.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", () => openModal(el.dataset.id));
  });
}

function openModal(id) {
  const a = allAnnouncements.find((x) => x.id === id);
  if (!a) return;
  setText("modalTitle", a.title);
  setText("modalContent", a.body);
  setText("modalDate", formatDate(a.createdAt));
  setText("modalCategory", a.isPinned ? "Pinned" : "General");
  const attachments = $("attachmentSection");
  if (attachments) attachments.style.display = "none";
  const modal = $("announcementModal");
  if (modal) modal.style.display = "flex";
}

$("closeAnnouncement")?.addEventListener("click", () => {
  const modal = $("announcementModal");
  if (modal) modal.style.display = "none";
});

$("announcementSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  render(allAnnouncements.filter((a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)));
});
