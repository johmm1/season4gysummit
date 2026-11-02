// Y-Summit Season 4 2026 — one shared admin sidebar menu.
//
// Every admin page used to carry its own hand-written copy of the menu, and
// the copies had drifted apart (Admissions only showed on some pages, Reports
// nowhere). This renders the same menu on every admin page so a new link is
// added once, here. Included as a plain (non-module) script near the end of
// each admin page so it runs before app-shell.js wires the menu up.
(function () {
  var ITEMS = [
    ["dashboard.html", "fa-chart-line", "Dashboard"],
    ["admissions.html", "fa-door-open", "Admissions"],
    ["participants.html", "fa-users", "Participants"],
    ["finance.html", "fa-money-bill-transfer", "Finance"],
    ["sports.html", "fa-futbol", "Sports"],
    ["judges.html", "fa-gavel", "Judges"],
    ["reports.html", "fa-file-pdf", "Reports"],
    ["gallery.html", "fa-images", "Gallery"],
    ["announcements.html", "fa-bullhorn", "Announcements"],
    ["structure.html", "fa-church", "Structure"],
    ["settings.html", "fa-gear", "Settings"]
  ];

  var nav = document.querySelector(".sidebar nav");
  if (!nav) return;

  var current = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();

  nav.innerHTML = ITEMS.map(function (item) {
    var active = item[0] === current ? ' class="active" aria-current="page"' : "";
    return '<a href="' + item[0] + '"' + active + '><i class="fa-solid ' + item[1] + '"></i> ' + item[2] + "</a>";
  }).join("");
})();
