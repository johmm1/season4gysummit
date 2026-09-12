// GY Summit 2026 — participant account settings
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, showSuccess, setValue, $ } from "../../assets/js/utils.js";

const user = await requireSession();
if (user) {
  wireLogoutButton();
  setValue("fullName", user.fullName);
  setValue("email", user.email);
  setValue("phone", user.phone);
  setValue("church", user.Church?.name);
  setValue("parish", user.Parish?.name);
  setValue("emergencyName", user.emergencyContactName);
  setValue("emergencyPhone", user.emergencyContactPhone);
  setValue("admissionCode", user.admissionCard?.cardNumber ?? "Not yet issued");

  const savedTheme = localStorage.getItem("gySummitTheme");
  if (savedTheme) setValue("theme", savedTheme);
}

$("profileSettingsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await apiFetch("/auth/me", {
      method: "PATCH",
      body: {
        fullName: $("fullName").value.trim(),
        phone: $("phone").value.trim(),
        emergencyContactName: $("emergencyName")?.value.trim(),
        emergencyContactPhone: $("emergencyPhone")?.value.trim(),
      },
    });
    showSuccess("Settings saved.");
  } catch (err) {
    showError(err.message || "Could not save settings.");
  }
});

$("securityForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = $("currentPassword").value;
  const next = $("newPassword").value;
  const confirm = $("confirmPassword").value;

  if (next !== confirm) {
    showError("New passwords do not match.");
    return;
  }
  if (next.length < 8) {
    showError("New password must be at least 8 characters.");
    return;
  }

  try {
    await apiFetch("/auth/change-password", {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    });
    showSuccess("Password updated.");
    e.target.reset();
  } catch (err) {
    showError(err.message || "Could not update password. Check your current password.");
  }
});

$("theme")?.addEventListener("change", (e) => {
  localStorage.setItem("gySummitTheme", e.target.value);
  document.documentElement.dataset.theme = e.target.value;
});
