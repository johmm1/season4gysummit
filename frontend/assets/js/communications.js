import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml } from "./utils.js";

const admin = await requireAdminSession();
if (!admin) throw new Error("Not signed in");
wireLogoutButton();
const $ = (id) => document.getElementById(id);
$("adminName").textContent = admin.fullName || admin.email || "Administrator";
$("adminRole").textContent = String(admin.role || "").replaceAll("_", " ");

let participants = [];
let settings = {};

async function loadSettings() {
  const result = await apiFetch("/admin/settings");
  settings = result.settings || {};
  $("channelUrl").value = settings.whatsappChannelUrl || "";
  updateChannelLink();
}
function updateChannelLink() {
  const value = $("channelUrl").value.trim();
  const link = $("openChannel");
  const valid = /^https:\/\/(chat\.whatsapp\.com|whatsapp\.com\/channel)\//i.test(value);
  link.hidden = !valid;
  if (valid) link.href = value;
  $("channelStatus").textContent = valid ? "Channel invitation link is saved or ready to save." : "Channel link not added yet.";
}
$("channelUrl").addEventListener("input", updateChannelLink);
$("saveChannel").addEventListener("click", async () => {
  const url = $("channelUrl").value.trim();
  if (url && !/^https:\/\/(chat\.whatsapp\.com|whatsapp\.com\/channel)\//i.test(url)) {
    showError("Enter a valid WhatsApp group or channel invitation URL.");
    return;
  }
  try {
    await apiFetch("/admin/settings", { method: "PUT", body: { whatsappChannelUrl: url } });
    settings.whatsappChannelUrl = url;
    updateChannelLink();
    showSuccess("WhatsApp Channel link saved.");
  } catch (error) { showError(error.message); }
});

async function loadParticipants() {
  $("participantsBody").innerHTML = '<tr><td colspan="5">Loading participants…</td></tr>';
  try {
    const first = await apiFetch("/admin/participants?page=1&pageSize=100");
    participants = first.items || [];
    const pages = Math.min(Number(first.totalPages || 1), 100);
    for (let page = 2; page <= pages; page++) {
      const next = await apiFetch(`/admin/participants?page=${page}&pageSize=100`);
      participants.push(...(next.items || []));
    }
    render();
  } catch (error) {
    $("participantsBody").innerHTML = '<tr><td colspan="5">Could not load participants.</td></tr>';
    showError(error.message);
  }
}
function render() {
  const has = participants.filter(p => p.whatsappStatus === "HAS_WHATSAPP").length;
  const none = participants.filter(p => p.whatsappStatus === "NO_WHATSAPP").length;
  const joined = participants.filter(p => p.whatsappChannelJoined).length;
  $("countAll").textContent = participants.length.toLocaleString();
  $("countHas").textContent = has.toLocaleString();
  $("countNone").textContent = none.toLocaleString();
  $("countJoined").textContent = joined.toLocaleString();
  const query = $("participantSearch").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const joinedFilter = $("joinedFilter").value;
  const filtered = participants.filter(p => {
    const matches = [p.fullName, p.phone, p.email].some(v => String(v || "").toLowerCase().includes(query));
    return matches && (!status || (p.whatsappStatus || "UNKNOWN") === status)
      && (!joinedFilter || (joinedFilter === "yes" ? !!p.whatsappChannelJoined : !p.whatsappChannelJoined));
  });
  $("participantsBody").innerHTML = filtered.map(p => `
    <tr data-id="${escapeHtml(p.id)}">
      <td><strong>${escapeHtml(p.fullName || "Unnamed")}</strong><br><span class="comm-muted">${escapeHtml(p.Parish?.name || "Parish not set")}</span></td>
      <td>${escapeHtml(p.phone || "—")}</td>
      <td>${escapeHtml(p.email || "—")}</td>
      <td><select class="wa-status" aria-label="WhatsApp status for ${escapeHtml(p.fullName)}">
        <option value="UNKNOWN" ${(p.whatsappStatus || "UNKNOWN") === "UNKNOWN" ? "selected" : ""}>Not confirmed</option>
        <option value="HAS_WHATSAPP" ${p.whatsappStatus === "HAS_WHATSAPP" ? "selected" : ""}>Has WhatsApp</option>
        <option value="NO_WHATSAPP" ${p.whatsappStatus === "NO_WHATSAPP" ? "selected" : ""}>No WhatsApp</option>
      </select></td>
      <td><label><input class="wa-joined" type="checkbox" ${p.whatsappChannelJoined ? "checked" : ""}> Joined</label></td>
    </tr>`).join("") || '<tr><td colspan="5">No participants match these filters.</td></tr>';
  $("listStatus").textContent = `Showing ${filtered.length} of ${participants.length} participants. Changes save when you update a status.`;
}
$("participantsBody").addEventListener("change", async event => {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const participant = participants.find(p => p.id === row.dataset.id);
  if (!participant) return;
  const body = event.target.classList.contains("wa-status")
    ? { whatsappStatus: event.target.value }
    : { whatsappChannelJoined: event.target.checked };
  try {
    const result = await apiFetch(`/admin/participants/${encodeURIComponent(participant.id)}`, { method: "PATCH", body });
    Object.assign(participant, result.user || body);
    render();
    showSuccess("Participant communication status updated.");
  } catch (error) {
    showError(error.message);
    render();
  }
});
["participantSearch", "statusFilter", "joinedFilter"].forEach(id => $(id).addEventListener(id === "participantSearch" ? "input" : "change", render));
$("refreshParticipants").addEventListener("click", loadParticipants);
await Promise.all([loadSettings().catch(error => showError(error.message)), loadParticipants()]);
