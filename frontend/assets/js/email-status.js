// Admin > Announcements: "Email delivery check" panel.
import { apiFetch, showError, showSuccess, escapeHtml, $ } from "./utils.js";

function render(status) {
  const lines = [];
  lines.push(`<p><strong>Provider:</strong> ${status.provider ? escapeHtml(status.provider) : "<span style='color:var(--danger)'>none configured</span>"}</p>`);
  lines.push(`<p><strong>Sending from:</strong> ${status.senderEmail ? escapeHtml(status.senderEmail) : "<span style='color:var(--danger)'>not set</span>"}</p>`);
  lines.push(`<p><strong>Ready to send:</strong> ${status.ready ? "<span style='color:var(--success)'>Yes</span>" : "<span style='color:var(--danger)'>No</span>"}</p>`);
  if (status.problems?.length) lines.push(`<ul>${status.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`);
  if (status.last) {
    const when = new Date(status.last.at).toLocaleString("en-GB");
    lines.push(`<p><strong>Last attempt:</strong> ${status.last.ok ? "sent" : "FAILED"} to ${escapeHtml(status.last.to)} at ${escapeHtml(when)}${status.last.error ? ` — ${escapeHtml(status.last.error)}` : ""}</p>`);
  } else {
    lines.push("<p><strong>Last attempt:</strong> none since the server last started.</p>");
  }
  $("emailStatusBody").innerHTML = lines.join("");
}

async function check() {
  try {
    render(await apiFetch("/admin/email/status"));
  } catch (err) {
    $("emailStatusBody").textContent = err.message || "Could not check email status.";
  }
}

if ($("emailStatusPanel")) {
  $("emailStatusRefresh").addEventListener("click", check);
  $("emailTestBtn").addEventListener("click", async () => {
    const to = $("emailTestTo").value.trim();
    if (!to) { showError("Enter an email address to send the test to."); return; }
    $("emailTestBtn").disabled = true;
    try {
      const res = await apiFetch("/admin/email/test", { method: "POST", body: { to } });
      showSuccess(`Test email sent to ${to}. Check the inbox (and spam).`);
      render(res.status);
    } catch (err) {
      showError(err.message || "The test email failed — see the details above.");
      await check();
    } finally {
      $("emailTestBtn").disabled = false;
    }
  });
  check();
}
