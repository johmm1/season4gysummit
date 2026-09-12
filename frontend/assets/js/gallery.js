// GY Summit 2026 — admin Media & Certificates centre
// Every control on this page is wired to a real backend capability. Anything
// the API can't actually do (bulk certificate generation, template
// management, byte-accurate video/document analytics beyond what storage
// reports) is disabled rather than faked — see admin/gallery.html.
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, apiDownload, showError, showSuccess, escapeHtml, formatBytes, $, on, debounce } from "./utils.js";
import { uploadFile } from "./fileUpload.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const GALLERY_FORMS = [
  "certificateSettingsForm", "certificateTemplatesForm", "digitalSignaturesForm", "certAutoGenerationForm", "certificateTextForm",
  "gallerySettingsForm", "downloadPermissionsForm", "watermarkForm", "galleryVisibilityForm", "storageSettingsForm",
];

const PRESET_ALBUMS = [
  "Arrival Day", "Opening Ceremony", "Worship Sessions", "Bible Study",
  "Football Tournament", "Volleyball Tournament", "Choir Festival",
  "Talent Show", "Prize Giving", "Departure",
];

const PURPOSE_BY_TYPE = { photo: "gallery", video: "gallery", document: "document" };

let items = [];
let activePreviewId = null;
const draftKey = "gySummitGalleryDraft";

const admin = await requireAdminSession();
if (admin) {
  wireLogoutButton();
  $("adminName") && ($("adminName").textContent = admin.fullName || "Admin");
  $("adminRole") && ($("adminRole").textContent = admin.role?.replace(/_/g, " ") || "Admin");
  await load();
  restoreDraft();
  wireQuickActions();
  wireUploadForm();
  wireFilters();
  wireModal();
  await loadPageSettings(GALLERY_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
}

/* ==========================================================
   LOAD + RENDER
   ========================================================== */

async function load() {
  setApiStatus("checking");
  try {
    const { items: fetched } = await apiFetch("/gallery");
    items = fetched;
    setApiStatus("online");
    populateAlbumOptions();
    setCounts();
    render();
  } catch (err) {
    setApiStatus("offline");
    showError(err.message || "Could not load the media library.");
  }
}

function setApiStatus(state) {
  const el = $("statusGalleryApi");
  if (!el) return;
  if (state === "checking") {
    el.textContent = "Checking…";
    el.className = "status";
  } else if (state === "online") {
    el.textContent = "Online";
    el.className = "status success";
  } else {
    el.textContent = "Offline";
    el.className = "status error";
  }
}

function setCounts() {
  const photos = items.filter((i) => i.mediaType === "photo");
  const videos = items.filter((i) => i.mediaType === "video");
  const documents = items.filter((i) => i.mediaType === "document");
  const pending = items.filter((i) => !i.isApproved);

  setText("totalPhotos", photos.length);
  setText("totalVideos", videos.length);
  setText("totalDownloads", documents.length);
  setText("certificatesGenerated", pending.length);
  setText("notificationBadge", pending.length);

  const totalBytes = items.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
  const photoBytes = photos.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
  const videoBytes = videos.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
  const docBytes = documents.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);

  setText("storageUsed", totalBytes ? formatBytes(totalBytes) : `${items.length} items`);
  setText("photoStorage", photoBytes ? formatBytes(photoBytes) : `${photos.length} photos`);
  setText("videoStorage", videoBytes ? formatBytes(videoBytes) : `${videos.length} videos`);
  setText("documentStorage", docBytes ? formatBytes(docBytes) : `${documents.length} files`);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function populateAlbumOptions() {
  const known = new Set(PRESET_ALBUMS);
  const extra = [...new Set(items.map((i) => i.albumName).filter((a) => a && !known.has(a)))];
  if (!extra.length) return;
  for (const selectId of ["galleryAlbum", "albumSelect"]) {
    const select = $(selectId);
    if (!select) continue;
    for (const album of extra) {
      if ([...select.options].some((o) => o.value === album)) continue;
      const opt = document.createElement("option");
      opt.value = album;
      opt.textContent = album;
      select.appendChild(opt);
    }
  }
}

function getFiltered() {
  const search = ($("gallerySearch")?.value || $("mediaSearch")?.value || "").trim().toLowerCase();
  const album = $("galleryAlbum")?.value || "";
  const type = $("galleryType")?.value || "";
  const status = $("galleryVisibility")?.value || "";

  return items.filter((item) => {
    if (album && item.albumName !== album) return false;
    if (type && item.mediaType !== type) return false;
    if (status === "approved" && !item.isApproved) return false;
    if (status === "pending" && item.isApproved) return false;
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

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <i class="fa-solid fa-images"></i>
        <h3>No media found</h3>
        <p>${items.length ? "Try clearing your search or filters." : "Uploaded media will appear here."}</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(cardHtml).join("");

  grid.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () => openPreview(el.dataset.open))
  );
  grid.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); approve(btn.dataset.approve); })
  );
  grid.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); remove(btn.dataset.delete); })
  );
}

function cardHtml(item) {
  const thumb = item.mediaType === "video"
    ? `<video src="${escapeHtml(item.url)}" muted></video>`
    : item.mediaType === "document"
      ? `<div class="doc-thumb"><i class="fa-solid fa-file-lines"></i></div>`
      : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || "")}" loading="lazy" />`;

  return `
    <div class="gallery-card" data-open="${item.id}" style="cursor:pointer;">
      ${thumb}
      <div class="gallery-content">
        <h3>${escapeHtml(item.caption || "Untitled")}</h3>
        <div class="gallery-meta">
          <span class="album-badge"><i class="fa-solid fa-folder"></i> ${escapeHtml(item.albumName || "General")}</span>
          <span class="status ${item.isApproved ? "success" : "pending"}">${item.isApproved ? "Approved" : "Pending"}</span>
        </div>
        <div class="gallery-actions">
          ${item.isApproved ? "" : `<button data-approve="${item.id}"><i class="fa-solid fa-check"></i> Approve</button>`}
          <button data-delete="${item.id}"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>
      </div>
    </div>`;
}

/* ==========================================================
   FILTERS
   ========================================================== */

function wireFilters() {
  const rerender = debounce(render, 200);
  on("gallerySearch", "input", rerender);
  on("mediaSearch", "input", () => { if ($("gallerySearch")) $("gallerySearch").value = $("mediaSearch").value; rerender(); });
  on("galleryAlbum", "change", render);
  on("galleryType", "change", render);
  on("galleryVisibility", "change", render);
  on("refreshGallery", "click", async () => { await load(); showSuccess("Media library refreshed."); });
  on("viewStorageUsage", "click", () => scrollToSection("Media Breakdown"));
}

/* ==========================================================
   QUICK ACTIONS
   ========================================================== */

function wireQuickActions() {
  on("uploadPhotos", "click", () => focusUpload("photo"));
  on("uploadVideos", "click", () => focusUpload("video"));
  on("uploadDocuments", "click", () => focusUpload("document"));
  on("generateCertificates", "click", () => scrollToSection("Certificate Centre"));
  on("manageAlbums", "click", () => {
    scrollToSection("Media Library");
    $("galleryAlbum")?.focus();
  });
  on("storageAnalytics", "click", () => scrollToSection("Media Breakdown"));

  on("generateParticipationCerts", "click", () => runCertificateGeneration("PARTICIPATION", "generateParticipationCerts"));
  on("generateSportsCerts", "click", () => runCertificateGeneration("SPORTS_WINNER", "generateSportsCerts"));

  on("downloadAllType", "change", (e) => {
    $("downloadAllCategory").style.display = e.target.value === "SPORTS_WINNER" ? "inline-block" : "none";
  });
  on("downloadAllCertsBtn", "click", downloadAllCertificates);
}

async function downloadAllCertificates() {
  const type = $("downloadAllType")?.value || "";
  const category = $("downloadAllCategory")?.value || "";
  const btn = $("downloadAllCertsBtn");
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing PDF…'; }
  try {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (category) params.set("category", category);
    const label = [type, category].filter(Boolean).join("-").toLowerCase() || "all";
    await apiDownload(`/certificates/download-all?${params}`, `gy-summit-2026-certificates-${label}.pdf`);
    showSuccess("Downloaded — one certificate per page, ready to print.");
  } catch (err) {
    showError(err.message || "Couldn't download certificates.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

async function runCertificateGeneration(type, buttonId) {
  const btn = $(buttonId);
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…'; }
  try {
    const result = await apiFetch("/certificates/generate", { method: "POST", body: { type } });
    if (type === "PARTICIPATION") {
      showSuccess(`${result.issued} new participation certificate(s) issued (${result.eligible} confirmed participants total).`);
    } else {
      showSuccess(
        result.teamsAwarded
          ? `${result.issued} new sports certificate(s) issued across ${result.teamsAwarded} winning team(s).`
          : "No completed fixtures yet — nothing to award."
      );
    }
  } catch (err) {
    showError(err.message || "Could not generate certificates.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function focusUpload(type) {
  const typeSelect = $("mediaType");
  if (typeSelect) typeSelect.value = type;
  document.getElementById("mediaUploadForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("mediaFiles")?.focus();
}

function scrollToSection(headingText) {
  const heading = [...document.querySelectorAll(".panel-header h2, .dashboard-panel h2")]
    .find((h) => h.textContent.trim().startsWith(headingText));
  (heading?.closest("section") || heading)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ==========================================================
   UPLOAD FORM
   ========================================================== */

function wireUploadForm() {
  const form = $("mediaUploadForm");
  const dropZone = $("mediaDropZone");
  const fileInput = $("mediaFiles");

  dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone?.addEventListener("drop", () => dropZone.classList.remove("dragover"));

  fileInput?.addEventListener("change", () => renderFilePreview(fileInput.files));

  on("saveMediaDraft", "click", () => {
    const draft = {
      mediaType: $("mediaType")?.value || "",
      albumSelect: $("albumSelect")?.value || "",
      mediaTitle: $("mediaTitle")?.value || "",
      mediaDescription: $("mediaDescription")?.value || "",
      visibility: $("visibility")?.value || "public",
      downloadable: $("downloadable")?.value || "true",
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
    showSuccess("Draft saved on this device.");
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const files = Array.from(fileInput?.files || []);
    const mediaType = $("mediaType")?.value;
    if (!mediaType) { showError("Choose a media type first."); return; }
    if (!files.length) { showError("Choose at least one file to upload."); return; }

    const uploadBtn = $("uploadMedia");
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.dataset.original = uploadBtn.innerHTML; uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…'; }

    const album = $("albumSelect")?.value || "General";
    const titleBase = $("mediaTitle")?.value?.trim();
    const description = $("mediaDescription")?.value?.trim();
    const visibility = $("visibility")?.value || "public";
    const downloadable = ($("downloadable")?.value ?? "true") === "true";

    let successCount = 0;
    for (const file of files) {
      const queueRow = addQueueRow(file.name);
      try {
        const { url, bytes, mediaType: detectedType } = await uploadFile(
          file,
          PURPOSE_BY_TYPE[mediaType] || "gallery",
          (pct) => updateQueueRow(queueRow, pct)
        );
        const caption = files.length > 1
          ? [titleBase, file.name].filter(Boolean).join(" — ")
          : (titleBase || description || file.name);

        await apiFetch("/gallery", {
          method: "POST",
          body: {
            url,
            bytes,
            caption,
            albumName: album,
            mediaType: mediaType === "document" ? "document" : detectedType,
            visibility,
            downloadable,
          },
        });
        finishQueueRow(queueRow, true, "Uploaded");
        successCount++;
      } catch (err) {
        finishQueueRow(queueRow, false, err.message || "Upload failed");
      }
    }

    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.innerHTML = uploadBtn.dataset.original; }

    if (successCount) {
      showSuccess(`${successCount} of ${files.length} file(s) uploaded.`);
      localStorage.removeItem(draftKey);
      form.reset();
      $("mediaPreview") && ($("mediaPreview").innerHTML = "");
      await load();
    } else {
      showError("None of the files uploaded successfully.");
    }
  });
}

function restoreDraft() {
  const raw = localStorage.getItem(draftKey);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (draft.mediaType) $("mediaType") && ($("mediaType").value = draft.mediaType);
    if (draft.albumSelect) $("albumSelect") && ($("albumSelect").value = draft.albumSelect);
    if (draft.mediaTitle) $("mediaTitle") && ($("mediaTitle").value = draft.mediaTitle);
    if (draft.mediaDescription) $("mediaDescription") && ($("mediaDescription").value = draft.mediaDescription);
    if (draft.visibility) $("visibility") && ($("visibility").value = draft.visibility);
    if (draft.downloadable) $("downloadable") && ($("downloadable").value = draft.downloadable);
    showSuccess("Restored your saved draft.");
  } catch {
    localStorage.removeItem(draftKey);
  }
}

function renderFilePreview(fileList) {
  const preview = $("mediaPreview");
  if (!preview) return;
  const files = Array.from(fileList || []);
  preview.innerHTML = files.map((file) => {
    const isImage = file.type.startsWith("image/");
    const src = isImage ? URL.createObjectURL(file) : null;
    return `
      <div class="media-preview-card">
        ${src ? `<img src="${src}" alt="${escapeHtml(file.name)}" />` : `<div class="doc-thumb"><i class="fa-solid fa-file"></i></div>`}
        <p style="margin-top:8px;font-size:.85rem;color:#555;word-break:break-word;">${escapeHtml(file.name)}</p>
        <p style="font-size:.78rem;color:#999;">${formatBytes(file.size)}</p>
      </div>`;
  }).join("");
}

function addQueueRow(name) {
  const queue = $("uploadQueue");
  if (!queue) return null;
  if (queue.querySelector(".empty-state")) queue.innerHTML = "";
  const row = document.createElement("div");
  row.className = "queue-item";
  row.innerHTML = `
    <i class="fa-solid fa-cloud-arrow-up"></i>
    <div class="queue-item-body">
      <div class="queue-item-name">${escapeHtml(name)}</div>
      <div class="queue-progress-track"><div class="queue-progress-fill" style="width:0%"></div></div>
      <div class="queue-item-status">Uploading…</div>
    </div>`;
  queue.appendChild(row);
  return row;
}

function updateQueueRow(row, percent) {
  if (!row) return;
  const fill = row.querySelector(".queue-progress-fill");
  if (fill) fill.style.width = `${percent}%`;
}

function finishQueueRow(row, success, message) {
  if (!row) return;
  row.classList.add(success ? "done" : "failed");
  row.querySelector(".queue-progress-fill")?.style.setProperty("width", "100%");
  row.querySelector(".queue-item-status").textContent = message;
  row.querySelector("i").className = success ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation";
}

/* ==========================================================
   PREVIEW / EDIT / DELETE MODAL
   ========================================================== */

function wireModal() {
  on("closeMediaModal", "click", closeModal);
  $("mediaModal")?.addEventListener("click", (e) => { if (e.target.id === "mediaModal") closeModal(); });
  on("downloadMedia", "click", () => {
    const item = items.find((i) => i.id === activePreviewId);
    if (item) window.open(item.url, "_blank", "noopener");
  });
  on("editMedia", "click", () => openEditForm());
  on("deleteMedia", "click", async () => {
    if (!activePreviewId) return;
    await remove(activePreviewId);
    closeModal();
  });
}

function openPreview(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  activePreviewId = id;
  const content = $("mediaPreviewContent");
  if (content) {
    content.innerHTML = item.mediaType === "video"
      ? `<div class="modal-body"><video src="${escapeHtml(item.url)}" controls style="width:100%;border-radius:18px;"></video></div>`
      : item.mediaType === "document"
        ? `<div class="modal-body"><p>${escapeHtml(item.caption || item.url)}</p></div>`
        : `<div class="modal-body"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || "")}" /></div>`;
  }
  $("mediaModal")?.classList.add("active");
}

function closeModal() {
  $("mediaModal")?.classList.remove("active");
  activePreviewId = null;
}

function openEditForm() {
  const item = items.find((i) => i.id === activePreviewId);
  if (!item) return;
  const content = $("mediaPreviewContent");
  if (!content) return;

  const albumOptions = [...new Set([...PRESET_ALBUMS, item.albumName])].filter(Boolean);
  content.innerHTML = `
    <form class="media-edit-form" id="mediaEditForm">
      <div>
        <label for="editCaption">Caption</label>
        <input id="editCaption" type="text" value="${escapeHtml(item.caption || "")}" maxlength="200" />
      </div>
      <div>
        <label for="editAlbum">Album</label>
        <select id="editAlbum">
          ${albumOptions.map((a) => `<option value="${escapeHtml(a)}" ${a === item.albumName ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
        </select>
      </div>
      <div class="media-edit-actions">
        <button type="button" class="btn btn-outline" id="cancelMediaEdit">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;

  $("cancelMediaEdit")?.addEventListener("click", () => openPreview(item.id));
  $("mediaEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/gallery/${item.id}`, {
        method: "PATCH",
        body: { caption: $("editCaption").value, albumName: $("editAlbum").value },
      });
      showSuccess("Media details updated.");
      await load();
      openPreview(item.id);
    } catch (err) {
      showError(err.message || "Could not save changes.");
    }
  });
}

async function approve(id) {
  try {
    await apiFetch(`/gallery/${id}/approve`, { method: "PATCH" });
    showSuccess("Approved — this item is now visible to participants.");
    await load();
  } catch (err) {
    showError(err.message || "Could not approve this item.");
  }
}

async function remove(id) {
  if (!confirm("Delete this media item? This can't be undone.")) return;
  try {
    await apiFetch(`/gallery/${id}`, { method: "DELETE" });
    showSuccess("Deleted.");
    await load();
  } catch (err) {
    showError(err.message || "Could not delete this item.");
  }
}
