// GY Summit 2026 — shared app-shell behavior for the admin and
// participant portals: the sidebar toggle button and the footer.
//
// One file for both sections (rather than duplicating this in 16
// separate pages) so the two portals share one exact behavior and
// look, and a future page gets both automatically just by including
// this script and the button markup.
//
// Toggle mechanic: clicking the button flips a single class on
// <body>, "sidebar-toggled". What that class means is entirely up to
// the CSS (admin.css / participants/layout.css), which interprets it
// oppositely depending on screen width — hide-to-expand-content on a
// wide screen, show-as-overlay on a narrow one. This script doesn't
// need to know or care which; it only flips the class.

document.addEventListener("DOMContentLoaded", () => {
  initSidebarToggle();
  injectFooter();
  initThemeSwitcher();
});

function initSidebarToggle() {
  const toggleBtn = document.getElementById("mobileMenuToggle");
  const sidebar = document.querySelector(".sidebar");
  if (!toggleBtn || !sidebar) return;

  // Created here rather than in every page's HTML: it's purely a click
  // target for "close the menu on mobile", not real page content.
  const backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";
  document.body.appendChild(backdrop);

  function close() {
    document.body.classList.remove("sidebar-toggled");
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  toggleBtn.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("sidebar-toggled");
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
  });

  backdrop.addEventListener("click", close);

  // On a narrow screen, tapping a nav link should also close the
  // overlay — otherwise the next page loads with it still open for a
  // moment. (On a wide screen "sidebar-toggled" means hidden, so this
  // is a no-op there, which is fine — nothing to close.)
  sidebar.querySelectorAll("nav a, .sidebar-nav a").forEach((link) => {
    link.addEventListener("click", close);
  });
}

function injectFooter() {
  // Whichever one of these exists tells us which portal we're in.
  const container = document.querySelector(".admin-main, .dashboard-content");
  if (!container || container.querySelector(".app-footer")) return;

  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.innerHTML = `Powered by <strong>BABA NEEMA ENTERPRISE</strong>`;
  container.appendChild(footer);
}

// Quick theme switcher — participant portal only. Lets someone flip
// between Vanilla / Dark / Pink / Blue from any page, not just
// Settings → Appearance (which stays the "full" picker with labels).
// Both places read/write the same "gySummitTheme" key and stay in
// sync via the gySummitThemeChange event.
const THEMES = [
  { id: "vanilla", label: "Vanilla" },
  { id: "dark", label: "Dark" },
  { id: "pink", label: "Pink" },
  { id: "blue", label: "Blue" },
];

function initThemeSwitcher() {
  // Admin pages have .admin-main, not .dashboard-content — this
  // widget is participant-only, so bail out on admin pages.
  if (!document.querySelector(".dashboard-content")) return;

  const topbar = document.querySelector(".topbar");
  if (!topbar || topbar.querySelector(".theme-toggle")) return;

  const wrap = document.createElement("div");
  wrap.className = "theme-toggle";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle-btn";
  btn.setAttribute("aria-label", "Change theme");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `<i class="fa-solid fa-palette"></i>`;

  const menu = document.createElement("div");
  menu.className = "theme-toggle-menu";
  menu.hidden = true;

  THEMES.forEach((t) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = `theme-toggle-option theme-dot-${t.id}`;
    opt.dataset.theme = t.id;
    opt.title = t.label;
    opt.setAttribute("aria-label", t.label);
    opt.addEventListener("click", () => {
      setTheme(t.id);
      closeMenu();
    });
    menu.appendChild(opt);
  });

  function markActive() {
    const current = localStorage.getItem("gySummitTheme") || "vanilla";
    menu.querySelectorAll(".theme-toggle-option").forEach((o) => {
      o.classList.toggle("active", o.dataset.theme === current);
    });
  }

  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = menu.hidden;
    menu.hidden = !isHidden;
    btn.setAttribute("aria-expanded", String(isHidden));
    if (isHidden) markActive();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeMenu();
  });

  wrap.appendChild(btn);
  wrap.appendChild(menu);

  // Group the toggle with whatever's already on the right side of the
  // topbar (an existing .topbar-right, or a bare .participant-profile
  // on pages that never got that wrapper) so the topbar keeps its
  // original 3-column [menu][title][right group] layout instead of
  // spreading a 4th item unevenly across justify-content:space-between.
  const existingRight = topbar.querySelector(".topbar-right, .participant-profile");
  if (existingRight && existingRight.classList.contains("topbar-right")) {
    existingRight.insertBefore(wrap, existingRight.firstChild);
  } else if (existingRight) {
    const group = document.createElement("div");
    group.className = "topbar-right";
    existingRight.parentNode.insertBefore(group, existingRight);
    group.appendChild(wrap);
    group.appendChild(existingRight);
  } else {
    topbar.appendChild(wrap);
  }

  window.addEventListener("gySummitThemeChange", markActive);
  markActive();
}

function setTheme(theme) {
  try {
    localStorage.setItem("gySummitTheme", theme);
  } catch (e) {
    // localStorage unavailable — theme still applies for this load.
  }
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("gySummitThemeChange", { detail: { theme } }));
}
