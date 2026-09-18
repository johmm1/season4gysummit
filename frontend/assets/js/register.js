// GY Summit 2026 — registration page
// Step navigation (next1..next3/back1..back3) and the medical-info toggle
// are already wired by the inline <script> in register.html. This module
// handles: dynamic parish->church loading, bank-reference verification,
// profile photo upload, and final account creation.
import { apiFetch, showError, showSuccess, $ } from "./utils.js";
import { setToken } from "./auth.js";

let bankReferenceVerified = false;
let selectedPresbyteryId = null;
let selectedParishId = null;

// ---- Dynamic presbytery -> parish -> church loading ----
async function loadPresbyteries() {
  const presbyterySelect = $("presbytery");
  if (!presbyterySelect) return;
  try {
    const { items } = await apiFetch("/structure/presbyteries");
    presbyterySelect.innerHTML =
      `<option value="">Select Presbytery</option>` +
      items.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

    // Only one presbytery today — select it automatically and load its parishes.
    if (items.length === 1) {
      presbyterySelect.value = String(items[0].id);
      presbyterySelect.dispatchEvent(new Event("change"));
    }
  } catch (err) {
    presbyterySelect.innerHTML = `<option value="">Could not load presbyteries</option>`;
    showError(err.message || "Could not load the presbytery list.");
  }
}
await loadPresbyteries();

$("presbytery")?.addEventListener("change", async (e) => {
  selectedPresbyteryId = e.target.value || null;
  const parishSelect = $("parish");
  const churchSelect = $("church");
  if (!parishSelect) return;

  churchSelect && (churchSelect.innerHTML = `<option value="">Select Parish First</option>`);
  selectedParishId = null;

  if (!selectedPresbyteryId) {
    parishSelect.innerHTML = `<option value="">Select Presbytery First</option>`;
    return;
  }

  parishSelect.innerHTML = `<option value="">Loading parishes...</option>`;
  try {
    const { items } = await apiFetch(`/structure/parishes?presbyteryId=${selectedPresbyteryId}`);
    parishSelect.innerHTML =
      `<option value="">Select Parish</option>` +
      items.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  } catch (err) {
    parishSelect.innerHTML = `<option value="">Could not load parishes</option>`;
    showError(err.message || "Could not load parishes for that presbytery.");
  }
});

$("parish")?.addEventListener("change", async (e) => {
  selectedParishId = e.target.value || null;
  const churchSelect = $("church");
  if (!churchSelect) return;

  if (!selectedParishId) {
    churchSelect.innerHTML = `<option value="">Select Parish First</option>`;
    return;
  }

  churchSelect.innerHTML = `<option value="">Loading churches...</option>`;
  try {
    const { items } = await apiFetch(`/structure/churches?parishId=${selectedParishId}`);
    churchSelect.innerHTML =
      `<option value="">Select Church</option>` +
      items.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  } catch (err) {
    churchSelect.innerHTML = `<option value="">Could not load churches</option>`;
    showError(err.message || "Could not load churches for that parish.");
  }
});

/** Reads a <select>'s value as a real number, or undefined if unset/invalid — never NaN. */
function selectValueAsInt(id) {
  const raw = $(id)?.value;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

// ---- Bank reference verification ----
$("verifyBank")?.addEventListener("click", async () => {
  const code = $("bankReference").value.trim();
  if (!code) {
    showError("Enter a bank reference number first.");
    return;
  }
  const statusInput = $("referenceStatus");
  statusInput.value = "Checking...";

  try {
    const result = await apiFetch(`/registration/verify-bank-reference/${encodeURIComponent(code)}`);
    $("availableSlots").value = result.availableSlots ?? 0;
    $("usedSlots").value = result.usedSlots ?? 0;

    if (result.valid) {
      statusInput.value = `Verified — ${result.parish}`;
      bankReferenceVerified = true;
      showSuccess("Bank reference verified. A slot will be reserved for you.");
    } else {
      statusInput.value = "Not Verified";
      bankReferenceVerified = false;
      showError("That code is invalid, inactive, or fully used. You can still register and pay by M-Pesa after signing in.");
    }
  } catch (err) {
    statusInput.value = "Not Verified";
    bankReferenceVerified = false;
    showError(err.message || "Could not verify bank reference right now.");
  }
});

// ---- Final submission ----
const form = $("registerForm");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = $("password").value;
  const confirmPassword = $("confirmPassword").value;
  if (password !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }
  if (password.length < 8) {
    showError("Password must be at least 8 characters.");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = "Creating your account...";
  }

  try {
    const bankReference = $("bankReference")?.value.trim();
    const presbyteryId = selectValueAsInt("presbytery");
    const parishId = selectValueAsInt("parish");
    const churchId = selectValueAsInt("church");

    const result = await apiFetch("/auth/register", {
      method: "POST",
      body: {
        fullName: $("fullname").value.trim(),
        email: $("email").value.trim(),
        password,
        phone: $("phone").value.trim(),
        presbyteryId,
        parishId,
        churchId,
        dateOfBirth: $("dob")?.value || undefined,
        gender: $("gender")?.value || undefined,
        emergencyContactName: $("emergencyName")?.value.trim() || undefined,
        emergencyContactPhone: $("emergencyPhone")?.value.trim() || undefined,
        idNumber: $("idNumber")?.value.trim() || undefined,
        hasMedicalCondition: $("hasMedical")?.value === "Yes",
        medicalCondition: $("medicalCondition")?.value.trim() || undefined,
        medication: $("medication")?.value.trim() || undefined,
        allergies: $("allergies")?.value.trim() || undefined,
        medicalNotes: $("medicalNotes")?.value.trim() || undefined,
        disability: $("disability")?.value.trim() || undefined,
        bankReferenceCode: bankReferenceVerified && bankReference ? bankReference : undefined,
        otpChannel: $("otpChannel")?.value || "email",
      },
    });

    if (result.stkPush?.sent) {
      showSuccess("Registration received! Check your phone for the M-Pesa PIN prompt to pay.");
    }

    // Uploading needs an authenticated session, which doesn't exist yet —
    // no token is issued until OTP verification succeeds. Rather than try
    // to smuggle the File object across a page navigation (it can't
    // survive one), just let them know to add it afterwards from their
    // profile page.
    if ($("profilePhoto")?.files?.[0]) {
      sessionStorage.setItem("gySummitAddPhotoReminder", "1");
    }

    // TEMPORARY (matches SKIP_OTP_VERIFICATION on the backend, see
    // auth.routes.js): while that's on, registration returns a real
    // session token instead of requiresVerification, so log straight in
    // rather than sending them to a code-entry screen for a code that
    // was never generated. Once the backend toggle is removed, this
    // branch just never fires again — nothing else to revert here.
    if (result.skippedVerification) {
      setToken(result.token);
      window.location.href = "participant/dashboard.html";
      return;
    }

    window.location.href = `verify-otp.html?email=${encodeURIComponent(result.email)}&channel=${encodeURIComponent(result.otpChannel)}`;
  } catch (err) {
    showError(err.message || "Registration failed. Please try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.originalText;
    }
  }
});
