// Y-Summit Season 4 2026 — "Download PDF" buttons for fixtures and players lists.
//   admin/sports.html        -> toolbar under the page header (fixtures + players, by category)
//   participant/sports.html  -> a "Fixtures PDF" button next to the fixture filters
import { apiDownload, showError } from "./utils.js";

const CATEGORIES = ["Football", "Volleyball", "Dance", "Folk Song"];

const style = document.createElement("style");
style.textContent = `
.pdf-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 18px;padding:12px 14px;background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:14px}
.pdf-bar strong{font-size:.95rem}
.pdf-bar select{padding:9px 10px;border:1px solid var(--border-dark,#d1d5db);border-radius:10px;background:#fff;font:inherit}
.pdf-bar button,.pdf-btn{border:0;border-radius:10px;padding:10px 16px;min-height:42px;font:700 .9rem var(--font-body,sans-serif);cursor:pointer;background:var(--primary-gradient,#f96d04);color:#fff}
.pdf-bar button.alt{background:#eef1f4;color:#1b1b1b}
.pdf-bar button[disabled],.pdf-btn[disabled]{opacity:.55;cursor:wait}
@media(max-width:600px){.pdf-bar>*{flex:1 1 100%}}
`;
document.head.appendChild(style);

async function download(kind, category, btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const q = category ? `?category=${encodeURIComponent(category)}` : "";
    const slug = category ? category.toLowerCase().replace(/\s+/g, "-") : "all";
    await apiDownload(`/exports/${kind}.pdf${q}`, `${kind}-${slug}.pdf`);
  } catch (err) {
    showError(err.message || "Could not create the PDF.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

const header = document.querySelector(".admin-header");
const tools = document.querySelector(".fixture-tools");

if (header) {
  const bar = document.createElement("div");
  bar.className = "pdf-bar";
  bar.innerHTML = `
    <strong><i class="fa-solid fa-file-pdf"></i> Download PDF</strong>
    <select id="pdfCategory" aria-label="Category">
      <option value="">All categories</option>
      ${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}
    </select>
    <button type="button" data-kind="fixtures"><i class="fa-solid fa-calendar-days"></i> Fixtures</button>
    <button type="button" data-kind="players" class="alt"><i class="fa-solid fa-users"></i> Players list</button>`;
  header.insertAdjacentElement("afterend", bar);
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-kind]");
    if (btn) download(btn.dataset.kind, bar.querySelector("#pdfCategory").value, btn);
  });
} else if (tools) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pdf-btn";
  btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Fixtures PDF';
  btn.addEventListener("click", () => download("fixtures", "", btn));
  tools.appendChild(btn);
}
