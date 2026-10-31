// Shared phone normalization. Kept independent of any payment provider.
function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}
module.exports = { normalizePhone };
