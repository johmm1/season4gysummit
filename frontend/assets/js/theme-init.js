// GY Summit 2026 — participant portal theme loader.
// Deliberately tiny and synchronous: included as the very first
// thing in <head>, before any stylesheet, so the data-theme
// attribute is on <html> before the browser paints anything.
// Without this, the page would flash the vanilla theme for a
// moment before switching to whatever the participant picked.
(function () {
  try {
    var saved = localStorage.getItem("gySummitTheme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {
    // localStorage unavailable (private mode, etc.) — falls back
    // to the vanilla theme via the CSS default selector.
  }
})();
