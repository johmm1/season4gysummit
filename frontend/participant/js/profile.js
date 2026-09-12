// GY Summit 2026 — participant profile page
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, showSuccess, formatDate, setText, setValue, $ } from "../../assets/js/utils.js";
import { uploadFile } from "../../assets/js/fileUpload.js";

const user = await requireSession();
let currentUser = user;
if (user) {
  wireLogoutButton();
  fillForm(user);
  await loadSportsTeams();
  $("resetProfileBtn")?.addEventListener("click", () => {
    fillForm(currentUser);
    showSuccess("Reverted to your saved profile.");
  });
}

function fillForm(user) {
  setText("participantName", user.fullName);
  setText("topParticipantName", user.fullName);
  setText("participantParish", user.Parish?.name || user.Church?.name || "—");
  setText("topParticipantParish", user.Parish?.name || user.Church?.name || "—");
  setText("registrationNumber", user.admissionCard?.cardNumber ?? "Pending");
  setText("admissionNumber", user.admissionCard?.cardNumber ?? "Pending");
  setText("registrationDate", formatDate(user.registration?.createdAt));
  setText("lastUpdated", formatDate(user.updatedAt));

  setValue("fullName", user.fullName);
  setValue("email", user.email);
  setValue("phone", user.phone);
  setValue("alternativePhone", user.emergencyContactPhone);
  setValue("dob", user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "");
  setValue("gender", user.gender);
  setValue("nationalId", user.idNumber);
  setValue("church", user.Church?.name);
  setValue("presbytery", user.Presbytery?.name);
  setValue("parish", user.Parish?.name);
  setValue("emergencyName", user.emergencyContactName);
  setValue("emergencyPhone", user.emergencyContactPhone);
  setValue("medicalConditions", user.medicalCondition);
  setValue("allergies", user.allergies);
  setValue("dietaryRequirements", user.dietaryRequirements);
  setValue("physicalChallenge", user.disability);
  setValue("occupation", user.occupation);
  setValue("institution", user.institution);
  const chairpersonEl = $("chairperson");
  if (chairpersonEl) chairpersonEl.value = "Not assigned";

  const photoEl = $("profilePhoto") || $("topProfilePhoto");
  if (photoEl && user.avatarUrl && photoEl.tagName === "IMG") photoEl.src = user.avatarUrl;

  const paymentBadge = $("paymentBadge");
  setText("paymentStatus", user.registration?.status === "CONFIRMED" ? "Paid" : "Pending");
  if (paymentBadge) paymentBadge.className = user.registration?.status === "CONFIRMED" ? "badge badge-success" : "badge badge-warning";
}

async function loadSportsTeams() {
  try {
    const { memberships } = await apiFetch("/sports/me");
    const byCategory = { Football: "footballTeam", Volleyball: "volleyballTeam", Dance: "danceTeam" };
    for (const [category, fieldId] of Object.entries(byCategory)) {
      const membership = memberships.find((m) => m.SportsTeam?.category === category);
      const field = $(fieldId);
      if (field) field.value = membership ? membership.SportsTeam.name : "Not registered";
    }
  } catch (err) {
    console.error("Failed to load sports team memberships:", err);
  }
}

$("profileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("saveProfileBtn");
  if (btn) { btn.disabled = true; btn.dataset.original = btn.textContent; btn.textContent = "Saving..."; }

  try {
    let avatarUrl;
    const fileInput = $("photoUpload");
    if (fileInput?.files?.[0]) {
      ({ url: avatarUrl } = await uploadFile(fileInput.files[0], "avatar"));
    }

    const { user: updated } = await apiFetch("/auth/me", {
      method: "PATCH",
      body: {
        fullName: $("fullName").value.trim(),
        phone: $("phone").value.trim(),
        emergencyContactName: $("emergencyName")?.value.trim(),
        emergencyContactPhone: $("emergencyPhone")?.value.trim(),
        medicalCondition: $("medicalConditions")?.value.trim(),
        allergies: $("allergies")?.value.trim(),
        dietaryRequirements: $("dietaryRequirements")?.value.trim(),
        disability: $("physicalChallenge")?.value.trim(),
        occupation: $("occupation")?.value.trim(),
        institution: $("institution")?.value.trim(),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
    });

    showSuccess("Profile updated.");
    currentUser = updated;
    fillForm(updated);
  } catch (err) {
    showError(err.message || "Could not update your profile.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.original; }
  }
});
