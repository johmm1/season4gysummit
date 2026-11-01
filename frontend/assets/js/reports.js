// Y-Summit Season 4 2026 — department reports (PDF) sent to the super admin
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, apiDownload, showError, showSuccess, escapeHtml, formatBytes } from "./utils.js";
import { CONFIG } from "./config.js";

const admin = await requireAdminSession();
if (!admin) throw new Error("Not signed in");
wireLogoutButton();

const $ = (id) => document.getElementById(id);
const MAX = 10 * 1024 * 1024;
let canReview = false;

// Department filter mirrors the departments in the send form.
[...$("repDept").options].filter((o) => o.value).forEach((o) => $("filterDept").add(new Option(o.text, o.text)));

$("sendReport").addEventListener("click", async () => {
  const department = $("repDept").value;
  const title = $("repTitle").value.trim();
  const summary = $("repSummary").value.trim();
  const file = $("repFile").files[0];

  if (!department) return showError("Choose your department.");
  if (title.length < 3) return showError("Give the report a title.");
  if (!file) return showError("Attach the PDF report.");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return showError("Only PDF files can be sent.");
  if (file.size > MAX) return showError("That PDF is larger than 10 MB.");

  const btn = $("sendReport");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const params = new URLSearchParams({ department, title, fileName: file.name });
    if (summary) params.set("summary", summary);
    const res = await fetch(`${CONFIG.API_BASE_URL}/reports?${params}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        Authorization: `Bearer ${localStorage.getItem("gySummitToken")}`,
      },
      body: file,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || payload.details?.[0]?.message || `Could not send (${res.status})`);
    showSuccess("Report sent to the super admin.");
    $("repTitle").value = "";
    $("repSummary").value = "";
    $("repFile").value = "";
    load();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send report';
  }
});

async function load() {
  const q = new URLSearchParams();
  if ($("filterDept").value) q.set("department", $("filterDept").value);
  if ($("filterStatus").value) q.set("status", $("filterStatus").value);
  const body = $("repBody");
  try {
    const { items, canReview: reviewer } = await apiFetch(`/reports?${q}`);
    canReview = reviewer;
    $("listTitle").textContent = reviewer ? "All reports" : "Your reports";
    body.innerHTML = items.map((r) => `
      <tr>
        <td><b>${escapeHtml(r.title)}</b><br><small class="muted">${escapeHtml(r.department)} · ${formatBytes(r.fileSize)} · ${new Date(r.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</small>
          ${r.summary ? `<br><small>${escapeHtml(r.summary)}</small>` : ""}
          ${r.reviewNote ? `<br><small class="muted"><i class="fa-solid fa-comment"></i> ${escapeHtml(r.reviewNote)}</small>` : ""}</td>
        <td>${escapeHtml(r.submittedBy || "—")}</td>
        <td><span class="desk-badge ${r.status === "REVIEWED" ? "ok" : "warn"}">${r.status === "REVIEWED" ? "Reviewed" : "Waiting"}</span></td>
        <td class="num" style="white-space:nowrap">
          <button class="desk-btn small" data-dl="${r.id}" data-name="${escapeHtml(r.fileName)}" type="button" title="Download"><i class="fa-solid fa-download"></i></button>
          ${reviewer && r.status !== "REVIEWED" ? `<button class="desk-btn small success" data-review="${r.id}" type="button" title="Mark reviewed"><i class="fa-solid fa-check"></i></button>` : ""}
          ${admin.role === "SUPER_ADMIN" || (r.mine && r.status === "SUBMITTED") ? `<button class="desk-btn small ghost" data-del="${r.id}" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ""}
        </td>
      </tr>`).join("") || '<tr><td colspan="4" class="muted">No reports yet.</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

$("repBody").addEventListener("click", async (e) => {
  const dl = e.target.closest("[data-dl]");
  const review = e.target.closest("[data-review]");
  const del = e.target.closest("[data-del]");
  try {
    if (dl) {
      await apiDownload(`/reports/${dl.dataset.dl}/download`, dl.dataset.name || "report.pdf");
    } else if (review) {
      const note = prompt("Add a note for the sender (optional):", "") ;
      if (note === null) return;
      await apiFetch(`/reports/${review.dataset.review}/review`, { method: "PATCH", body: { status: "REVIEWED", reviewNote: note || undefined } });
      showSuccess("Marked as reviewed.");
      load();
    } else if (del) {
      if (!confirm("Delete this report?")) return;
      await apiFetch(`/reports/${del.dataset.del}`, { method: "DELETE" });
      load();
    }
  } catch (err) { showError(err.message); }
});

$("filterDept").addEventListener("change", load);
$("filterStatus").addEventListener("change", load);
load();
