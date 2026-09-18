// GY Summit 2026 — participant Media Centre
// Reads the same /gallery endpoint the admin Media Centre writes to, so any
// photo or video an admin approves shows up here automatically. Participants
// can also share their own photos/videos, which land here as "pending" until
// an admin approves them (see backend/routes/gallery.routes.js).
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, debounce, $ } from "../../assets/js/utils.js";
import { uploadFile } from "../../assets/js/fileUpload.js";

let items = [];
let activeAlbum = null;
let activeType = "all";

const user = await requireSession();
if (user) {
  wireLogoutButton();
  renderProfile(user);
  await load();
  wireTabs();
  wireSearch();
  wireModals();
  wireUpload();
}

function renderProfile(u) {
  const nameEl = $("participantName");
  if (nameEl) nameEl.textContent = u.fullName || "Participant";
  const parishEl = $("participantParish");
  if (parishEl) parishEl.textContent = u.Parish?.name || u.Church?.name || "—";
  const avatar = $("participantAvatar");
  if (avatar && u.avatarUrl) avatar.src = u.avatarUrl;
}

/* ==========================================================
   LOAD + RENDER
   ========================================================== */

async function load() {
  try {
    const { items: fetched } = await apiFetch("/gallery");
    items = fetched;
    setStats();
    buildAlbumTabs();
    render();
  } catch (err) {
    const grid = $("galleryGrid");
    if (grid) grid.innerHTML = `<div class="gallery-empty"><i class="fas fa-triangle-exclamation"></i><h3>Couldn't load the gallery</h3><p>${escapeHtml(err.message || "Please try again shortly.")}</p></div>`;
    showError(err.message || "Could not load the gallery.");
  }
}

function setStats() {
  const photos = items.filter((i) => i.mediaType === "photo").length;
  const videos = items.filter((i) => i.mediaType === "video").length;
  const documents = items.filter((i) => i.mediaType === "document").length;
  setText("statPhotos", photos);
  setText("statVideos", videos);
  setText("statDocuments", documents);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function buildAlbumTabs() {
  const container = $("mediaTabs");
  if (!container) return;
  // Remove any previously generated album chips, keep the 3 built-in tabs.
  container.querySelectorAll("[data-album]").forEach((el) => el.remove());

  const albums = [...new Set(items.map((i) => i.albumName).filter(Boolean))];
  for (const album of albums) {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.album = album;
    btn.innerHTML = `<i class="fas fa-folder"></i> ${escapeHtml(album)}`;
    btn.addEventListener("click", () => {
      activeAlbum = album;
      activeType = "all";
      setActiveTabButton(btn);
      render();
    });
    container.appendChild(btn);
  }
}

function wireTabs() {
  document.querySelectorAll("#mediaTabs .tab[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeType = btn.dataset.tab;
      activeAlbum = null;
      setActiveTabButton(btn);
      render();
    });
  });
}

function setActiveTabButton(activeBtn) {
  document.querySelectorAll("#mediaTabs .tab").forEach((b) => b.classList.remove("active"));
  activeBtn.classList.add("active");
}

function wireSearch() {
  const input = $("gallerySearch");
  input?.addEventListener("input", debounce(render, 200));
}

function getFiltered() {
  const search = ($("gallerySearch")?.value || "").trim().toLowerCase();
  return items.filter((item) => {
    if (item.mediaType === "document") return false; // documents render in their own list below
    if (activeAlbum && item.albumName !== activeAlbum) return false;
    if (!activeAlbum && activeType !== "all" && item.mediaType !== activeType) return false;
    if (search) {
      const haystack = `${item.caption || ""} ${item.albumName || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function render() {
  const grid = $("galleryGrid");
  if (!grid) return;
  const filtered = getFiltered();

  setText("galleryResultCount", `${filtered.length} item${filtered.length === 1 ? "" : "s"}`);

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <i class="fas fa-image"></i>
        <h3>No media here yet</h3>
        <p>${items.length ? "Try a different search or album." : "Check back once the summit team uploads and approves photos."}</p>
      </div>`;
  } else {
    grid.innerHTML = filtered.map(cardHtml).join("");
    grid.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => {
        const item = items.find((i) => i.id === el.dataset.open);
        if (item) openMedia(item);
      });
    });
  }

  renderDocuments();
}

function cardHtml(item) {
  const isVideo = item.mediaType === "video";
  return `
    <div class="gallery-card" data-open="${item.id}">
      <span class="media-type-pill"><i class="fas fa-${isVideo ? "play" : "image"}"></i> ${isVideo ? "Video" : "Photo"}</span>
      ${isVideo
        ? `<video class="gallery-thumb" src="${escapeHtml(item.url)}" muted></video>`
        : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || "Summit photo")}" loading="lazy">`}
      <div class="gallery-overlay">
        <h4>${escapeHtml(item.caption || "Summit memory")}</h4>
        <p>${escapeHtml(item.albumName || "General")}</p>
        <i class="fas fa-expand"></i>
      </div>
    </div>`;
}

function renderDocuments() {
  const docs = items.filter((i) => i.mediaType === "document" && (!activeAlbum || i.albumName === activeAlbum));
  const title = $("documentsTitle");
  const list = $("documentsList");
  if (!title || !list) return;
  if (!docs.length) {
    title.style.display = "none";
    list.style.display = "none";
    return;
  }
  title.style.display = "";
  list.style.display = "";
  list.innerHTML = docs.map((d) => `
    <div class="doc-row">
      <div class="doc-info">
        <i class="fa-solid fa-file-lines"></i>
        <div>
          <strong>${escapeHtml(d.caption || "Document")}</strong>
          <div style="font-size:.8rem;color:#888;">${escapeHtml(d.albumName || "General")}</div>
        </div>
      </div>
      ${d.downloadable !== false
        ? `<a class="btn-download" href="${escapeHtml(d.url)}" target="_blank" rel="noopener"><i class="fas fa-download"></i> Download</a>`
        : `<span style="color:#aaa;font-size:.85rem;">View only</span>`}
    </div>`).join("");
}

/* ==========================================================
   MODALS
   ========================================================== */

function wireModals() {
  $("closeImageModal")?.addEventListener("click", closeImageModal);
  $("closeVideoModal")?.addEventListener("click", closeVideoModal);
  $("imageModal")?.addEventListener("click", (e) => { if (e.target.id === "imageModal") closeImageModal(); });
  $("videoModal")?.addEventListener("click", (e) => { if (e.target.id === "videoModal") closeVideoModal(); });
}

function openMedia(item) {
  if (item.mediaType === "video") {
    const modal = $("videoModal");
    const video = $("modalVideo");
    if (video) { video.src = item.url; video.play().catch(() => {}); }
    modal?.classList.add("active");
  } else {
    const modal = $("imageModal");
    const img = $("modalImage");
    const caption = $("modalCaption");
    if (img) img.src = item.url;
    if (caption) caption.textContent = item.caption || "";
    modal?.classList.add("active");
  }
}

function closeImageModal() {
  $("imageModal")?.classList.remove("active");
}

function closeVideoModal() {
  const video = $("modalVideo");
  if (video) { video.pause(); video.src = ""; }
  $("videoModal")?.classList.remove("active");
}

/* ==========================================================
   PARTICIPANT UPLOAD (goes in as "pending" until an admin approves)
   ========================================================== */

function wireUpload() {
  const input = $("participantUpload");
  input?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const label = document.querySelector('label[for="participantUpload"]');
    const originalHtml = label?.innerHTML;
    if (label) label.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
    try {
      const { url, bytes, mediaType } = await uploadFile(file, "gallery");
      await apiFetch("/gallery", {
        method: "POST",
        body: {
          url,
          bytes,
          caption: file.name,
          albumName: "Participant Uploads",
          mediaType,
          visibility: "public",
          downloadable: true,
        },
      });
      showSuccess("Thanks! Your upload will appear here once an admin approves it.");
    } catch (err) {
      showError(err.message || "Upload failed — please try again.");
    } finally {
      if (label && originalHtml) label.innerHTML = originalHtml;
      input.value = "";
    }
  });
}
