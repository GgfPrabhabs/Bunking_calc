/* Attendance Tracker (Vanilla JS)
   Modern UI + ultra-simple daily usage.

   Button rules (per subject/section):
   - +1 Attend: attended += 1, total += 1
   - Bunk 1: total += 1
   - -1 Undo: reverses the *last* action (attend or bunk)

   Practical subjects have two independent sections: PP and PR.
*/

"use strict";

// -------------------------
// Constants + helpers
// -------------------------

const STORAGE_KEY = "attendance_tracker_cards_v1";
const REQUIRED_PERCENT = 75;

const $ = (sel, root = document) => root.querySelector(sel);

function toInt(v) {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function uid() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(attended, total) {
  if (total <= 0) return 0;
  return (attended / total) * 100;
}

function pctText(p) {
  // Show attendance with decimals for better accuracy (e.g., 68.42%).
  const n = Number.isFinite(p) ? p : 0;
  const fixed = n.toFixed(2);
  // Trim trailing zeros: "75.00" -> "75", "68.50" -> "68.5"
  const trimmed = fixed.replace(/\.?0+$/, "");
  return `${trimmed}%`;
}

function tier(p) {
  if (p >= REQUIRED_PERCENT) return "ok";
  if (p >= 60) return "warn";
  return "bad";
}

function barClass(p) {
  const t = tier(p);
  return t === "ok" ? "barFill--ok" : t === "warn" ? "barFill--warn" : "";
}

function normalizePair(attended, total) {
  const t = Math.max(0, toInt(total));
  const a = clamp(Math.max(0, toInt(attended)), 0, t);
  return { a, t };
}

// -------------------------
// Planner (bunk / attend)
// -------------------------

function bunkLimit(attended, total) {
  // Largest x such that (attended / (total + x))*100 >= 75
  attended = Math.max(0, toInt(attended));
  total = Math.max(0, toInt(total));

  let x = 0;
  while (percent(attended, total + x) >= REQUIRED_PERCENT) x += 1;
  return Math.max(0, x - 1);
}

function mustAttend(attended, total) {
  // Smallest x such that ((attended + x) / (total + x))*100 >= 75
  attended = Math.max(0, toInt(attended));
  total = Math.max(0, toInt(total));

  let x = 0;
  while (percent(attended + x, total + x) < REQUIRED_PERCENT) x += 1;
  return x;
}

function plannerText(attended, total) {
  const p = percent(attended, total);
  if (p >= REQUIRED_PERCENT) {
    const x = bunkLimit(attended, total);
    return `You can bunk ${x} more class${x === 1 ? "" : "es"} and still maintain 75%.`;
  }
  const x = mustAttend(attended, total);
  return `You must attend ${x} class${x === 1 ? "" : "es"} to reach 75%.`;
}

// -------------------------
// State (localStorage)
// -------------------------

/*
Theory subject:
{
  id, name, type: "theory",
  a, t,
  history: ["attend"|"bunk", ...],
  createdAt
}

Practical subject:
{
  id, name, type: "practical",
  pp: { a, t, history: [...] },
  pr: { a, t, history: [...] },
  createdAt
}
*/

function loadState() {
  // Try to migrate the previous simple-table version if it exists.
  const legacy = localStorage.getItem("attendance_calculator_simple_v1");
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw && legacy) {
    try {
      const old = JSON.parse(legacy);
      const subjects = Array.isArray(old?.subjects) ? old.subjects : [];
      const migrated = subjects.map((s) => {
        const name = String(s?.name ?? "Untitled").trim();
        const createdAt = Number.isFinite(s?.createdAt) ? s.createdAt : Date.now();
        const type = s?.type === "practical" ? "practical" : "theory";
        if (type === "theory") {
          const x = normalizePair(s?.attended, s?.total);
          return { id: String(s?.id ?? uid()), name, type, a: x.a, t: x.t, history: [], createdAt };
        }
        const pp = normalizePair(s?.ppAttended, s?.ppTotal);
        const pr = normalizePair(s?.prAttended, s?.prTotal);
        return {
          id: String(s?.id ?? uid()),
          name,
          type,
          pp: { a: pp.a, t: pp.t, history: [] },
          pr: { a: pr.a, t: pr.t, history: [] },
          createdAt,
        };
      });
      const next = { version: 1, subjects: migrated };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      // ignore migration errors
    }
  }

  try {
    if (!raw) return { version: 1, subjects: [] };
    const parsed = JSON.parse(raw);
    const subjects = Array.isArray(parsed?.subjects) ? parsed.subjects : [];
    return { version: 1, subjects };
  } catch {
    return { version: 1, subjects: [] };
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// -------------------------
// DOM
// -------------------------

const cardsEl = $("#cards");
const emptyStateEl = $("#emptyState");

const overallTextEl = $("#overallText");
const overallPercentEl = $("#overallPercent");
const overallBarEl = $("#overallBar");

const btnAdd = $("#btnAdd");
const btnReset = $("#btnReset");

const subjectDialog = $("#subjectDialog");
const subjectForm = $("#subjectForm");
const dialogTitle = $("#dialogTitle");
const editingId = $("#editingId");

const subjectName = $("#subjectName");
const subjectType = $("#subjectType");
const theoryFields = $("#theoryFields");
const practicalFields = $("#practicalFields");

const theoryAttended = $("#theoryAttended");
const theoryTotal = $("#theoryTotal");
const ppAttended = $("#ppAttended");
const ppTotal = $("#ppTotal");
const prAttended = $("#prAttended");
const prTotal = $("#prTotal");

const btnCancel = $("#btnCancel");
const formNote = $("#formNote");

// -------------------------
// Calculations (for UI)
// -------------------------

function metricsTheory(s) {
  const x = normalizePair(s.a, s.t);
  const p = percent(x.a, x.t);
  return { attended: x.a, total: x.t, pct: p };
}

function metricsPractical(s) {
  const pp = normalizePair(s?.pp?.a, s?.pp?.t);
  const pr = normalizePair(s?.pr?.a, s?.pr?.t);
  const ppPct = percent(pp.a, pp.t);
  const prPct = percent(pr.a, pr.t);
  const finalPct = (ppPct + prPct) / 2;
  return {
    pp: { ...pp, pct: ppPct },
    pr: { ...pr, pct: prPct },
    finalPct,
    attended: pp.a + pr.a,
    total: pp.t + pr.t,
  };
}

function overallMetrics() {
  let a = 0;
  let t = 0;
  for (const s of state.subjects) {
    if (s.type === "theory") {
      const m = metricsTheory(s);
      a += m.attended;
      t += m.total;
    } else {
      const m = metricsPractical(s);
      a += m.attended;
      t += m.total;
    }
  }
  const pct = percent(a, t);
  return { attended: a, total: t, pct };
}

// -------------------------
// Rendering
// -------------------------

function render() {
  const items = state.subjects.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  cardsEl.innerHTML = "";
  emptyStateEl.classList.toggle("hidden", items.length !== 0);

  for (const s of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = s.id;

    if (s.type === "theory") {
      const m = metricsTheory(s);
      const p = clamp(m.pct, 0, 100);
      card.innerHTML = `
        <div class="card__head">
          <div class="card__title">
            <div class="name">${escapeHtml(s.name)}</div>
            <div class="meta">Theory • <strong>${m.attended}</strong> / <strong>${m.total}</strong></div>
          </div>
          <div class="card__tools">
            <button class="iconBtn" type="button" data-act="edit" title="Edit">✎</button>
            <button class="iconBtn iconBtn--danger" type="button" data-act="delete" title="Delete">🗑</button>
          </div>
        </div>
        <div class="card__body">
          <div class="stat">
            <div class="statTop">
              <div class="statLabel">Attendance</div>
              <div class="statValue">${pctText(p)}</div>
            </div>
            <div class="barTrack"><div class="barFill ${barClass(p)}" style="width:${p}%"></div></div>
            <div class="planner">${escapeHtml(plannerText(m.attended, m.total))}</div>
          </div>
          <div class="btnRow">
            <button class="btn btnMini btnMini--ok" type="button" data-act="attend">+1 Attend</button>
            <button class="btn btnMini btnMini--warn" type="button" data-act="bunk">Bunk 1</button>
            <button class="btn btnMini btnMini--muted" type="button" data-act="undo" ${
              (s.history?.length ?? 0) === 0 ? "disabled" : ""
            }>-1 Undo</button>
          </div>
        </div>
      `;
    } else {
      const m = metricsPractical(s);
      const finalP = clamp(m.finalPct, 0, 100);
      const ppP = clamp(m.pp.pct, 0, 100);
      const prP = clamp(m.pr.pct, 0, 100);

      card.innerHTML = `
        <div class="card__head">
          <div class="card__title">
            <div class="name">${escapeHtml(s.name)}</div>
            <div class="meta">Practical • Final <span class="finalPill">${pctText(finalP)}</span></div>
          </div>
          <div class="card__tools">
            <button class="iconBtn" type="button" data-act="edit" title="Edit">✎</button>
            <button class="iconBtn iconBtn--danger" type="button" data-act="delete" title="Delete">🗑</button>
          </div>
        </div>
        <div class="card__body">
          <div class="split">
            <div class="stat" data-section="pp">
              <div class="statTop">
                <div class="statLabel">PP (Theory)</div>
                <div class="statValue">${m.pp.a} / ${m.pp.t} • ${pctText(ppP)}</div>
              </div>
              <div class="barTrack"><div class="barFill ${barClass(ppP)}" style="width:${ppP}%"></div></div>
              <div class="planner">${escapeHtml(plannerText(m.pp.a, m.pp.t))}</div>
              <div class="btnRow">
                <button class="btn btnMini btnMini--ok" type="button" data-act="attend-pp">+1 Attend</button>
                <button class="btn btnMini btnMini--warn" type="button" data-act="bunk-pp">Bunk 1</button>
                <button class="btn btnMini btnMini--muted" type="button" data-act="undo-pp" ${
                  (s.pp?.history?.length ?? 0) === 0 ? "disabled" : ""
                }>-1 Undo</button>
              </div>
            </div>

            <div class="stat" data-section="pr">
              <div class="statTop">
                <div class="statLabel">PR (Lab)</div>
                <div class="statValue">${m.pr.a} / ${m.pr.t} • ${pctText(prP)}</div>
              </div>
              <div class="barTrack"><div class="barFill ${barClass(prP)}" style="width:${prP}%"></div></div>
              <div class="planner">${escapeHtml(plannerText(m.pr.a, m.pr.t))}</div>
              <div class="btnRow">
                <button class="btn btnMini btnMini--ok" type="button" data-act="attend-pr">+1 Attend</button>
                <button class="btn btnMini btnMini--warn" type="button" data-act="bunk-pr">Bunk 1</button>
                <button class="btn btnMini btnMini--muted" type="button" data-act="undo-pr" ${
                  (s.pr?.history?.length ?? 0) === 0 ? "disabled" : ""
                }>-1 Undo</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    cardsEl.appendChild(card);
  }

  const o = overallMetrics();
  const p = clamp(o.pct, 0, 100);
  overallTextEl.textContent = `${o.attended}/${o.total}`;
  overallPercentEl.textContent = pctText(p);
  overallBarEl.style.width = `${p}%`;
  overallBarEl.classList.remove("barFill--ok", "barFill--warn");
  const cls = barClass(p);
  if (cls) overallBarEl.classList.add(cls);
}

// -------------------------
// Actions (+1 / bunk / undo)
// -------------------------

function getSubjectIndex(id) {
  return state.subjects.findIndex((s) => s.id === id);
}

function applyActionTheory(s, action) {
  // action: "attend" | "bunk"
  const x = normalizePair(s.a, s.t);
  if (action === "attend") {
    s.a = x.a + 1;
    s.t = x.t + 1;
  } else {
    s.a = x.a;
    s.t = x.t + 1;
  }
  s.history = Array.isArray(s.history) ? s.history : [];
  s.history.push(action);
}

function undoActionTheory(s) {
  s.history = Array.isArray(s.history) ? s.history : [];
  const last = s.history.pop();
  if (!last) return;
  const x = normalizePair(s.a, s.t);
  if (last === "attend") {
    s.a = Math.max(0, x.a - 1);
    s.t = Math.max(0, x.t - 1);
  } else if (last === "bunk") {
    s.a = x.a;
    s.t = Math.max(0, x.t - 1);
  }
}

function applyActionSection(sec, action) {
  const x = normalizePair(sec.a, sec.t);
  if (action === "attend") {
    sec.a = x.a + 1;
    sec.t = x.t + 1;
  } else {
    sec.a = x.a;
    sec.t = x.t + 1;
  }
  sec.history = Array.isArray(sec.history) ? sec.history : [];
  sec.history.push(action);
}

function undoActionSection(sec) {
  sec.history = Array.isArray(sec.history) ? sec.history : [];
  const last = sec.history.pop();
  if (!last) return;
  const x = normalizePair(sec.a, sec.t);
  if (last === "attend") {
    sec.a = Math.max(0, x.a - 1);
    sec.t = Math.max(0, x.t - 1);
  } else if (last === "bunk") {
    sec.a = x.a;
    sec.t = Math.max(0, x.t - 1);
  }
}

function updateAndRender() {
  saveState();
  render();
}

// -------------------------
// CRUD (Add/Edit/Delete)
// -------------------------

function setTypeUI(type) {
  const isTheory = type === "theory";
  theoryFields.classList.toggle("hidden", !isTheory);
  practicalFields.classList.toggle("hidden", isTheory);
  practicalFields.setAttribute("aria-hidden", String(isTheory));
}

function setNote(msg) {
  formNote.textContent = msg || "";
}

function openDialogForNew() {
  editingId.value = "";
  dialogTitle.textContent = "Add Subject";
  subjectForm.reset();
  subjectType.value = "theory";
  theoryAttended.value = "0";
  theoryTotal.value = "0";
  ppAttended.value = "0";
  ppTotal.value = "0";
  prAttended.value = "0";
  prTotal.value = "0";
  setTypeUI("theory");
  setNote("");
  subjectDialog.showModal();
  subjectName.focus();
}

function openDialogForEdit(id) {
  const s = state.subjects.find((x) => x.id === id);
  if (!s) return;

  editingId.value = s.id;
  dialogTitle.textContent = "Edit Subject";
  subjectName.value = s.name;
  subjectType.value = s.type;
  setTypeUI(s.type);

  if (s.type === "theory") {
    const x = normalizePair(s.a, s.t);
    theoryAttended.value = String(x.a);
    theoryTotal.value = String(x.t);
  } else {
    const pp = normalizePair(s.pp?.a, s.pp?.t);
    const pr = normalizePair(s.pr?.a, s.pr?.t);
    ppAttended.value = String(pp.a);
    ppTotal.value = String(pp.t);
    prAttended.value = String(pr.a);
    prTotal.value = String(pr.t);
  }

  setNote("");
  subjectDialog.showModal();
  subjectName.focus();
}

function upsertFromForm() {
  const name = String(subjectName.value ?? "").trim();
  const type = subjectType.value === "practical" ? "practical" : "theory";
  if (!name) {
    setNote("Please enter a subject name.");
    return false;
  }

  const isEdit = Boolean(editingId.value);
  const id = isEdit ? editingId.value : uid();
  const createdAt = isEdit
    ? state.subjects.find((x) => x.id === id)?.createdAt ?? Date.now()
    : Date.now();

  let next;
  if (type === "theory") {
    const x = normalizePair(theoryAttended.value, theoryTotal.value);
    next = {
      id,
      name,
      type,
      a: x.a,
      t: x.t,
      history: isEdit ? state.subjects.find((x0) => x0.id === id)?.history ?? [] : [],
      createdAt,
    };
  } else {
    const pp = normalizePair(ppAttended.value, ppTotal.value);
    const pr = normalizePair(prAttended.value, prTotal.value);
    const old = isEdit ? state.subjects.find((x0) => x0.id === id) : null;
    next = {
      id,
      name,
      type,
      pp: {
        a: pp.a,
        t: pp.t,
        history: old?.type === "practical" ? old.pp?.history ?? [] : [],
      },
      pr: {
        a: pr.a,
        t: pr.t,
        history: old?.type === "practical" ? old.pr?.history ?? [] : [],
      },
      createdAt,
    };
  }

  if (isEdit) {
    const idx = getSubjectIndex(id);
    if (idx !== -1) state.subjects[idx] = next;
  } else {
    state.subjects.push(next);
  }

  updateAndRender();
  return true;
}

function deleteSubject(id) {
  const s = state.subjects.find((x) => x.id === id);
  if (!s) return;
  if (!window.confirm(`Delete "${s.name}"?`)) return;
  state.subjects = state.subjects.filter((x) => x.id !== id);
  updateAndRender();
}

// -------------------------
// Event wiring
// -------------------------

btnAdd.addEventListener("click", openDialogForNew);

btnReset.addEventListener("click", () => {
  if (!window.confirm("Reset all subjects?")) return;
  state = { version: 1, subjects: [] };
  updateAndRender();
});

btnCancel.addEventListener("click", () => {
  subjectDialog.close();
});

subjectType.addEventListener("change", () => {
  setTypeUI(subjectType.value);
});

subjectForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const ok = upsertFromForm();
  if (ok) subjectDialog.close();
});

cardsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  if (!id) return;

  const idx = getSubjectIndex(id);
  if (idx === -1) return;
  const s = state.subjects[idx];

  const act = btn.dataset.act;
  if (act === "edit") {
    openDialogForEdit(id);
    return;
  }
  if (act === "delete") {
    deleteSubject(id);
    return;
  }

  if (s.type === "theory") {
    if (act === "attend") applyActionTheory(s, "attend");
    else if (act === "bunk") applyActionTheory(s, "bunk");
    else if (act === "undo") undoActionTheory(s);
    updateAndRender();
    return;
  }

  // Practical actions are section-specific.
  if (act === "attend-pp") applyActionSection(s.pp, "attend");
  else if (act === "bunk-pp") applyActionSection(s.pp, "bunk");
  else if (act === "undo-pp") undoActionSection(s.pp);
  else if (act === "attend-pr") applyActionSection(s.pr, "attend");
  else if (act === "bunk-pr") applyActionSection(s.pr, "bunk");
  else if (act === "undo-pr") undoActionSection(s.pr);

  updateAndRender();
});

// Close dialog if user clicks outside it (desktop UX).
subjectDialog.addEventListener("click", (e) => {
  const rect = subjectDialog.getBoundingClientRect();
  const inside =
    rect.top <= e.clientY &&
    e.clientY <= rect.top + rect.height &&
    rect.left <= e.clientX &&
    e.clientX <= rect.left + rect.width;
  if (!inside) subjectDialog.close();
});

// -------------------------
// Boot
// -------------------------

setTypeUI(subjectType.value);
render();
