// What every guide page does in the browser: the dark or light mode, Copy,
// note cards that light their lines, and the wisdom checks. It loads in the
// page's <head>, so the mode is set before anything is drawn. Nothing is
// saved: a reload starts every check fresh.

// ---------- Mode: the system setting, and L to switch ----------
const system = matchMedia("(prefers-color-scheme: dark)");
let chosen = null; // set by L, and then the system setting no longer moves it

// Dungeon or Lintel, by the reader's L or else the system setting.
function applyMode() {
  const mode = chosen ?? (system.matches ? "dark" : "light");
  document.documentElement.dataset.mode = mode;
}
applyMode();
system.addEventListener("change", applyMode);
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea, [contenteditable]")) return;
  if (e.key !== "l" && e.key !== "L") return;
  chosen = document.documentElement.dataset.mode === "dark" ? "light" : "dark";
  applyMode();
});

// ---------- Copy ----------
// Copies `text` and says so on the button for a moment.
function copyText(text, button) {
  const done = () => {
    const was = button.textContent;
    button.textContent = "Copied";
    button.classList.add("ok");
    setTimeout(() => {
      button.textContent = was;
      button.classList.remove("ok");
    }, 1200);
  };
  const fallback = () => {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    done();
  };
  if (navigator.clipboard)
    navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

// ---------- Note cards and their lines ----------
// Pointing at a note lights its lines, and pointing at a line lights its note.
function light(wrap, notes) {
  wrap
    .querySelectorAll(".ln.hl, .on")
    .forEach((x) => x.classList.remove("hl", "on"));
  for (const n of notes) {
    wrap.querySelectorAll(".ln").forEach((x) => {
      if (x.dataset.owners.split(" ").includes(n)) x.classList.add("hl");
    });
    wrap
      .querySelectorAll(`[data-note="${n}"]`)
      .forEach((x) => x.classList.add("on"));
  }
}
document.addEventListener("pointerover", (e) => {
  const wrap = e.target.closest(".linked");
  document.querySelectorAll(".linked").forEach((w) => {
    if (w !== wrap && !w.querySelector(".flash")) light(w, []);
  });
  if (!wrap) return;
  const note = e.target.closest("[data-note]");
  const line = e.target.closest(".ln");
  light(
    wrap,
    note
      ? [note.dataset.note]
      : line
        ? line.dataset.owners.split(" ").filter(Boolean)
        : [],
  );
});

// ---------- Wisdom checks ----------
// The page's checks, from the JSON at its foot. Each pick is marked at once:
// a wrong pick stays marked with its why and a link to the note to reread,
// and a right pick closes the question.
const KIND = { concept: "Concept", predict: "Predict", choice: "Which choice" };
let BANK = {};
const answers = {}; // check id → option indexes picked, in order

// The words on a wrong pick's link: the note or step to go back to.
const rereadText = (q) =>
  q.reread.startsWith("step-")
    ? `Reread step ${q.reread.slice(5)}.`
    : `Reread note (${q.reread}).`;

// One check as HTML, with every pick so far marked, and whether it's done.
function question(id) {
  const q = BANK[id];
  const picks = answers[id] ?? [];
  const done = picks.some((i) => q.opts[i].ok);
  const opts = q.opts
    .map((o, i) => {
      const picked = picks.includes(i);
      const cls = picked ? (o.ok ? "right" : "wrong") : "";
      const link = o.ok
        ? ""
        : ` <a href="#" data-reread="${q.reread}">${rereadText(q)}</a>`;
      const why = picked
        ? `<div class="why"><b>${o.ok ? "Success." : "Not yet."}</b> ${o.why}${link}</div>`
        : "";
      return `<li class="opt ${cls}" data-q="${id}" data-i="${i}"><span class="key">${"ABCD"[i]}</span><span>${o.t}</span>${why}</li>`;
    })
    .join("");
  return {
    done,
    html: `<div class="qk">Wisdom check · ${KIND[q.kind]}</div><div class="qt">${q.q}</div><ul class="opts">${opts}</ul>`,
  };
}

// Draws a check into its box on the page.
function renderCheck(box) {
  const { done, html } = question(box.dataset.check);
  box.innerHTML = html;
  box.classList.toggle("done", done);
}

// The line that ends a page whose checks are all right.
function updatePassed() {
  const passed = document.querySelector(".passed");
  if (!passed) return;
  const ids = Object.keys(BANK);
  passed.hidden = !ids.every((id) =>
    (answers[id] ?? []).some((i) => BANK[id].opts[i].ok),
  );
}

// A wrong answer's link scrolls to the note card, or the step, and flashes
// it, with its code lines lit.
function reread(target) {
  const el = target.startsWith("step-")
    ? document.getElementById(target)
    : document.querySelector(`[data-note="${target}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  // Clear it once the flash ends, so pointing elsewhere unlights the panel.
  el.addEventListener("animationend", () => el.classList.remove("flash"), {
    once: true,
  });
  const wrap = el.closest(".linked");
  if (wrap) {
    light(wrap, [target]);
    setTimeout(() => light(wrap, []), 2500);
  }
}

document.addEventListener("click", (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) return copyText(decodeURIComponent(copy.dataset.copy), copy);
  const link = e.target.closest("[data-reread]");
  if (link) {
    e.preventDefault();
    return reread(link.dataset.reread);
  }
  const opt = e.target.closest(".opt");
  if (!opt) return;
  const box = opt.closest(".q");
  if (box.classList.contains("done")) return;
  const id = opt.dataset.q;
  answers[id] = [...new Set([...(answers[id] ?? []), Number(opt.dataset.i)])];
  renderCheck(box);
  updatePassed();
});

document.addEventListener("DOMContentLoaded", () => {
  const data = document.getElementById("checks");
  BANK = data ? JSON.parse(data.textContent) : {};
  document.querySelectorAll(".q[data-check]").forEach(renderCheck);
});
