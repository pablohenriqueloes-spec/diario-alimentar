"use strict";

/* ---------- Armazenamento local ---------- */

const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast("Não foi possível salvar no aparelho"); }
  },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

// id -> { id, kind, data, updated_at, deleted, dirty }
let records = LS.get("da_records", {});
let cursor = LS.get("da_cursor", 0);
let password = LS.get("da_pw", "");

const persist = () => LS.set("da_records", records);

function put(kind, id, data) {
  records[id] = { id, kind, data, updated_at: Date.now(), deleted: false, dirty: true };
  persist();
  scheduleSync();
}

function remove(id) {
  const r = records[id];
  if (!r) return;
  Object.assign(r, { deleted: true, updated_at: Date.now(), dirty: true });
  persist();
  scheduleSync();
}

const get = (id) => {
  const r = records[id];
  return r && !r.deleted ? { ...r.data, id } : null;
};
const all = (kind) =>
  Object.values(records).filter((r) => r.kind === kind && !r.deleted).map((r) => ({ ...r.data, id: r.id }));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Sincronização com a nuvem ---------- */

let syncing = false, syncAgain = false, syncTimer = null;

function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}

function setSync(text, isError = false) {
  const el = document.getElementById("sync");
  el.textContent = text;
  el.classList.toggle("err", isError);
}

async function sync() {
  if (!password) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSync("Sincronizando…");
  try {
    const dirty = Object.values(records).filter((r) => r.dirty);
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + password },
      body: JSON.stringify({
        since: cursor,
        changes: dirty.map(({ dirty, ...r }) => r),
      }),
    });
    if (res.status === 401) { setSync("Senha recusada", true); return; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.json();

    for (const sent of dirty) {
      const cur = records[sent.id];
      if (cur && cur.updated_at === sent.updated_at) cur.dirty = false;
    }
    let changed = false;
    for (const r of out.records) {
      const cur = records[r.id];
      if (!cur || r.updated_at > cur.updated_at || (!cur.dirty && r.updated_at !== cur.updated_at)) {
        records[r.id] = { ...r, dirty: false };
        changed = true;
      }
    }
    cursor = out.cursor;
    persist();
    LS.set("da_cursor", cursor);
    const hh = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    setSync("Salvo na nuvem " + hh);
    if (changed && !isTyping()) render();
  } catch {
    setSync("Sem conexão · salvo no aparelho", true);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}

/* ---------- Datas e números ---------- */

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const at = (date, time) => { const d = parseYmd(date); const [h, m] = time.split(":").map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };

const fmtLong = (s) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(parseYmd(s));
const fmtShort = (s) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(parseYmd(s)).replace(".", "");
const fmtMonth = (y, m) => cap(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(y, m, 1)));
const fmtTitle = (s) => cap(new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "long" }).format(parseYmd(s)));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtNum = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const parseNum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
function fmtDur(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/* ---------- Regras do diário ---------- */

const MEAL_NAMES = ["Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia"];
const SYMPTOM_TYPES = ["Dor abdominal", "Inchaço", "Gases", "Azia", "Náusea", "Diarreia", "Prisão de ventre", "Outro"];

function guessMealName(time) {
  const h = Number((time || "12:00").slice(0, 2));
  if (h < 10) return "Café da manhã";
  if (h < 12) return "Lanche da manhã";
  if (h < 15) return "Almoço";
  if (h < 19) return "Lanche da tarde";
  if (h < 22) return "Jantar";
  return "Ceia";
}

const settings = () => ({ winMin: 30, winMax: 8, ...(get("settings") || {}) }); // minutos, horas
const foodName = (id) => get(id)?.name || "(alimento excluído)";
const unitLabel = (food) => (food?.mode === "unit" ? "un." : "g");

function getDay(date) {
  return {
    date, mood: null, moodNote: "", exercise: null, exerciseNote: "", sleep: null, sleepNote: "",
    gi: null, giNote: "", symptoms: [],
    ...(get("day:" + date) || {}),
  };
}
function saveDay(day) {
  const { id, ...data } = day;
  put("day", "day:" + day.date, data);
}

const mealsOn = (date) =>
  all("meal").filter((m) => m.date === date).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));

function saveMeal(meal) {
  const { id, ...data } = meal;
  put("meal", id, data);
}

function mealTotals(meal) {
  let grams = 0, est = 0, units = 0;
  for (const it of meal.items || []) {
    const f = get(it.foodId);
    if (!f) continue;
    if (f.mode === "weight") grams += it.qty;
    else if (f.unitWeight) est += it.qty * f.unitWeight;
    else units += it.qty;
  }
  return { grams, est, units };
}

function totalText(meal) {
  const { grams, est, units } = mealTotals(meal);
  const parts = [];
  if (grams || est) parts.push(`${est ? "≈ " : ""}${fmtNum(grams + est)} g`);
  if (units) parts.push(`${fmtNum(units)} un.`);
  return parts.join(" + ") || "vazio";
}

function foodUsage() {
  const count = {};
  for (const m of all("meal")) for (const it of m.items || []) count[it.foodId] = (count[it.foodId] || 0) + 1;
  return count;
}

const hasSymptoms = (day) => day.gi === "sim" || (day.symptoms || []).length > 0;

/* ---------- Interface: utilidades ---------- */

const $view = document.getElementById("view");
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function setChrome({ title, back = null, tab = null, tabs = true }) {
  document.getElementById("title").textContent = title;
  const b = document.getElementById("back");
  b.hidden = !back;
  b.onclick = back ? () => (location.hash = back) : null;
  document.getElementById("tabs").hidden = !tabs;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  document.title = title === "Diário alimentar" ? title : `${title} · Diário`;
}

const chips = (field, options, value, cls = "") =>
  `<div class="chips">${options
    .map(([v, label]) => `<button type="button" class="chip ${cls} ${value === v ? "on" : ""}" data-action="chip" data-field="${field}" data-value="${esc(v)}">${esc(label)}</button>`)
    .join("")}</div>`;

/* ---------- Telas ---------- */

let calMonth = null; // [ano, mês]

function viewLogin() {
  setChrome({ title: "Diário alimentar", tabs: false });
  $view.innerHTML = `
    <div class="card login">
      <h2>Entrar</h2>
      <p class="muted small">Digite a senha do app. Ela fica salva neste aparelho e só é pedida uma vez.</p>
      <form id="login-form" class="row" style="flex-direction:column;align-items:stretch">
        <input type="password" id="login-pw" autocomplete="current-password" placeholder="Senha" required>
        <button class="btn primary block" type="submit">Entrar</button>
      </form>
      <p class="notice" id="login-err" hidden></p>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("login-pw").value.trim();
    const err = document.getElementById("login-err");
    try {
      const res = await fetch("/api/ping", { headers: { authorization: "Bearer " + pw } });
      if (res.status === 401) { err.textContent = "Senha incorreta. Confira e tente de novo."; err.hidden = false; return; }
    } catch { /* sem internet: aceita e sincroniza depois */ }
    password = pw;
    LS.set("da_pw", pw);
    location.hash = "#/";
    render();
    sync();
  });
}

function viewCalendar() {
  setChrome({ title: "Diário alimentar", tab: "cal" });
  const t = today();
  if (!calMonth) { const d = parseYmd(t); calMonth = [d.getFullYear(), d.getMonth()]; }
  const [y, m] = calMonth;
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());

  const mealCount = {}, alert = {};
  for (const meal of all("meal")) mealCount[meal.date] = (mealCount[meal.date] || 0) + 1;
  for (const d of all("day")) if (hasSymptoms(d)) alert[d.date] = true;

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = ymd(d);
    if (i >= 35 && d.getMonth() !== m) break;
    const n = Math.min(mealCount[s] || 0, 5);
    const dots = Array.from({ length: n }, () => '<i class="dot"></i>').join("") + (alert[s] ? '<i class="dot alert"></i>' : "");
    cells += `<button class="cal-day ${d.getMonth() !== m ? "out" : ""} ${s === t ? "today" : ""}" data-action="open-day" data-date="${s}" aria-label="${esc(fmtLong(s))}">
      <span class="d">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }

  const todayMeals = mealsOn(t);
  $view.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn small" data-action="month" data-delta="-1" aria-label="Mês anterior">‹</button>
        <h2>${esc(fmtMonth(y, m))}</h2>
        <button class="btn small" data-action="month" data-delta="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="cal-grid">
        ${["D", "S", "T", "Q", "Q", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells}
      </div>
      <div class="legend"><span><i class="dot"></i>refeição</span><span><i class="dot alert"></i>sintoma</span></div>
    </div>
    <a class="card" href="#/dia/${t}" style="text-decoration:none;color:inherit">
      <div class="spread"><h2>Hoje</h2><span class="muted small">${esc(fmtLong(t))}</span></div>
      <span class="muted small">${todayMeals.length ? plural(todayMeals.length, "refeição registrada", "refeições registradas") : "Nenhuma refeição registrada ainda"} · toque para abrir</span>
    </a>`;
}

function viewDay(date) {
  setChrome({ title: fmtTitle(date), back: "#/", tab: "cal" });
  const d = parseYmd(date); calMonth = [d.getFullYear(), d.getMonth()];
  const meals = mealsOn(date);
  const day = getDay(date);

  const mealHtml = meals.length
    ? meals.map((meal) => {
        const names = (meal.items || []).map((it) => {
          const f = get(it.foodId);
          return `${esc(foodName(it.foodId))} ${fmtNum(it.qty)} ${unitLabel(f)}`;
        }).join(" · ");
        return `<a class="meal" href="#/refeicao/${meal.id}">
          <span class="meal-time">${esc(meal.time || "--:--")}</span>
          <span class="meal-body"><span class="meal-name">${esc(meal.name || "Refeição")}</span><br>
            <span class="meal-items">${names || "Nenhum alimento ainda"}</span></span>
          <span class="meal-total">${esc(totalText(meal))}</span></a>`;
      }).join('<hr style="border:0;border-top:1px solid var(--line);margin:0">')
    : `<p class="empty">Nenhuma refeição neste dia.</p>`;

  const yn = [["sim", "Sim"], ["nao", "Não"]];
  const symptoms = (day.symptoms || []).map((s) => `
    <div class="symptom">
      <input type="time" value="${esc(s.time)}" data-symptom="${s.id}" data-sfield="time" aria-label="Horário do sintoma">
      <select data-symptom="${s.id}" data-sfield="type" aria-label="Tipo de sintoma">
        ${SYMPTOM_TYPES.map((t) => `<option ${t === s.type ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select>
      <button class="icon-btn" data-action="del-symptom" data-id="${s.id}" aria-label="Remover sintoma">×</button>
    </div>`).join("");

  $view.innerHTML = `
    <div class="spread">
      <a class="btn small" href="#/dia/${addDays(date, -1)}">‹ ${esc(fmtShort(addDays(date, -1)))}</a>
      <a class="btn small" href="#/dia/${addDays(date, 1)}">${esc(fmtShort(addDays(date, 1)))} ›</a>
    </div>
    <div class="card">
      <h2>Refeições</h2>
      ${mealHtml}
      <button class="btn primary block" data-action="add-meal" data-date="${date}">+ Adicionar refeição</button>
    </div>
    <div class="card">
      <h2>Como foi o dia</h2>
      <div class="q">
        <span class="q-label">Como estava emocionalmente?</span>
        ${chips("mood", [["bem", "Bem"], ["regular", "Mais ou menos"], ["mal", "Mal"]], day.mood)}
        <textarea rows="1" data-note="moodNote" placeholder="Escreva se quiser">${esc(day.moodNote)}</textarea>
      </div>
      <div class="q">
        <span class="q-label">Praticou atividade física?</span>
        ${chips("exercise", yn, day.exercise)}
        <textarea rows="1" data-note="exerciseNote" placeholder="Qual e por quanto tempo?">${esc(day.exerciseNote)}</textarea>
      </div>
      <div class="q">
        <span class="q-label">Dormiu bem?</span>
        ${chips("sleep", yn, day.sleep)}
        <textarea rows="1" data-note="sleepNote" placeholder="Escreva se quiser">${esc(day.sleepNote)}</textarea>
      </div>
      <div class="q">
        <span class="q-label">Sintomas gastrointestinais?</span>
        ${chips("gi", yn, day.gi, "alert")}
        <textarea rows="1" data-note="giNote" placeholder="Como foi? Ex.: inchaço depois do almoço">${esc(day.giNote)}</textarea>
        ${day.gi === "sim" ? `
          <span class="muted small">Horário de cada sintoma (é ele que a análise usa)</span>
          ${symptoms}
          <button class="btn small" data-action="add-symptom">+ Horário do sintoma</button>
          ${(day.symptoms || []).length ? "" : `<p class="notice">Adicione o horário do sintoma para ele entrar na análise.</p>`}` : ""}
      </div>
    </div>`;

  $view.oninput = (e) => {
    const note = e.target.dataset.note;
    if (note) {
      clearTimeout(viewDay.t);
      viewDay.t = setTimeout(() => { const dd = getDay(date); dd[note] = e.target.value; saveDay(dd); }, 500);
    }
  };
  $view.onchange = (e) => {
    const sid = e.target.dataset.symptom;
    if (sid) {
      const dd = getDay(date);
      const s = dd.symptoms.find((x) => x.id === sid);
      if (s) { s[e.target.dataset.sfield] = e.target.value; saveDay(dd); }
    }
  };
  $view.onclick = (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const dd = getDay(date);
    if (el.dataset.action === "chip") {
      const f = el.dataset.field;
      dd[f] = dd[f] === el.dataset.value ? null : el.dataset.value;
      if (f === "gi" && dd.gi === "sim" && !dd.symptoms.length) dd.symptoms.push({ id: uid(), time: date === today() ? nowHHMM() : "", type: SYMPTOM_TYPES[1] });
      saveDay(dd); render();
    } else if (el.dataset.action === "add-symptom") {
      dd.symptoms.push({ id: uid(), time: date === today() ? nowHHMM() : "", type: SYMPTOM_TYPES[1] });
      saveDay(dd); render();
    } else if (el.dataset.action === "del-symptom") {
      dd.symptoms = dd.symptoms.filter((x) => x.id !== el.dataset.id);
      saveDay(dd); render();
    } else if (el.dataset.action === "add-meal") {
      const time = date === today() ? nowHHMM() : "";
      const id = "meal:" + uid();
      saveMeal({ id, date, time, name: guessMealName(time || "12:00"), autoName: true, items: [] });
      location.hash = "#/refeicao/" + id;
    }
  };
}

function viewMeal(id) {
  const meal = get(id);
  if (!meal) { location.hash = "#/"; return; }
  setChrome({ title: meal.name || "Refeição", back: "#/dia/" + meal.date, tab: "cal" });

  const items = (meal.items || []).map((it, i) => {
    const f = get(it.foodId);
    return `<div class="item">
      <span class="item-name">${esc(foodName(it.foodId))}${f?.mode === "unit" && f.unitWeight ? `<br><span class="muted small">${fmtNum(f.unitWeight)} g por unidade</span>` : ""}</span>
      <span class="qty"><input type="text" inputmode="decimal" value="${fmtNum(it.qty)}" data-qty="${i}" aria-label="Quantidade"> <span class="muted">${unitLabel(f)}</span></span>
      <button class="icon-btn" data-action="del-item" data-i="${i}" aria-label="Remover">×</button>
    </div>`;
  }).join("");

  $view.innerHTML = `
    <div class="card">
      <label class="field">Refeição<input type="text" id="meal-name" value="${esc(meal.name)}"></label>
      <div class="chips">${MEAL_NAMES.map((n) => `<button class="chip ${n === meal.name ? "on" : ""}" data-action="name" data-value="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <label class="field">Horário em que aconteceu<input type="time" id="meal-time" value="${esc(meal.time)}"></label>
      ${meal.time ? "" : `<p class="notice">Informe o horário para a refeição entrar na análise.</p>`}
    </div>
    <div class="card">
      <h2>Alimentos</h2>
      ${items || `<p class="empty">Nenhum alimento ainda.</p>`}
      <div class="total-bar"><span>Total da refeição</span><span class="num" id="meal-total">${esc(totalText(meal))}</span></div>
      <button class="btn primary block" data-action="add-food">+ Adicionar alimento</button>
    </div>
    <button class="btn danger" data-action="del-meal">Excluir refeição</button>`;

  const reload = () => get(id);
  $view.oninput = (e) => {
    if (e.target.dataset.qty != null) {
      const m = reload();
      m.items[e.target.dataset.qty].qty = parseNum(e.target.value);
      document.getElementById("meal-total").textContent = totalText(m);
    }
  };
  $view.onchange = (e) => {
    const m = reload();
    if (e.target.id === "meal-name") { m.name = e.target.value.trim(); m.autoName = false; saveMeal(m); setChrome({ title: m.name || "Refeição", back: "#/dia/" + m.date, tab: "cal" }); }
    else if (e.target.id === "meal-time") {
      m.time = e.target.value;
      if (m.autoName && m.time) m.name = guessMealName(m.time); // nome sugerido acompanha o horário até ser escolhido
      saveMeal(m); render();
    }
    else if (e.target.dataset.qty != null) {
      const q = parseNum(e.target.value);
      if (!q) { toast("Quantidade inválida"); render(); return; }
      m.items[e.target.dataset.qty].qty = q; saveMeal(m);
      document.getElementById("meal-total").textContent = totalText(m);
    }
  };
  let confirmDel = false;
  $view.onclick = (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const m = reload();
    switch (el.dataset.action) {
      case "name": m.name = el.dataset.value; m.autoName = false; saveMeal(m); render(); break;
      case "del-item": m.items.splice(Number(el.dataset.i), 1); saveMeal(m); render(); break;
      case "add-food": openFoodPicker((foodId, qty) => {
        const mm = reload(); mm.items.push({ foodId, qty }); saveMeal(mm); render(); toast("Alimento adicionado");
      }); break;
      case "del-meal":
        if (!confirmDel) { confirmDel = true; el.textContent = "Toque de novo para confirmar"; return; }
        remove(id); location.hash = "#/dia/" + m.date; toast("Refeição excluída"); break;
    }
  };
}

/* ---------- Folha de escolha de alimento ---------- */

function openSheet(html) {
  const s = document.getElementById("sheet");
  s.innerHTML = html;
  s.hidden = false;
  document.getElementById("sheet-backdrop").hidden = false;
  return s;
}
function closeSheet() {
  document.getElementById("sheet").hidden = true;
  document.getElementById("sheet-backdrop").hidden = true;
}
document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);

function openFoodPicker(onPick) {
  const usage = foodUsage();
  const foods = all("food").sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name, "pt-BR"));

  const s = openSheet(`
    <div class="spread"><h2 style="margin:0;font-size:18px">Adicionar alimento</h2><button class="btn small" data-close>Fechar</button></div>
    <input type="search" id="food-q" placeholder="Buscar ou cadastrar alimento" autocomplete="off">
    <div class="food-list" id="food-list"></div>`);
  const q = s.querySelector("#food-q");
  const list = s.querySelector("#food-list");

  const draw = () => {
    const term = norm(q.value);
    const hits = foods.filter((f) => norm(f.name).includes(term)).slice(0, 40);
    const exact = foods.some((f) => norm(f.name) === term);
    list.innerHTML =
      (term && !exact ? `<button class="food-opt new" data-new>+ Cadastrar “${esc(q.value.trim())}”</button>` : "") +
      hits.map((f) => `<button class="food-opt" data-id="${f.id}"><span>${esc(f.name)}</span><span class="muted small">${f.mode === "unit" ? "por unidade" : "por peso"}</span></button>`).join("") +
      (!term && !foods.length ? `<p class="empty">Nenhum alimento cadastrado. Digite o nome para cadastrar o primeiro.</p>` : "");
  };
  draw();
  q.addEventListener("input", draw);
  setTimeout(() => q.focus(), 50);

  s.onclick = (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const opt = e.target.closest(".food-opt");
    if (!opt) return;
    if (opt.dataset.new != null) qtyStep(null, q.value.trim(), onPick);
    else qtyStep(get(opt.dataset.id), null, onPick);
  };
}

// Quantidade do alimento escolhido; com `food` nulo, cadastra um novo antes.
function qtyStep(food, newName, onPick) {
  let mode = food?.mode || null;
  const s = openSheet(`
    <div class="spread"><h2 style="margin:0;font-size:18px">${food ? esc(food.name) : "Novo alimento"}</h2><button class="btn small" data-close>Fechar</button></div>
    ${food ? "" : `
      <label class="field">Nome<input type="text" id="nf-name" value="${esc(newName)}"></label>
      <span class="muted small">Como você mede este alimento?</span>
      <div class="chips"><button class="chip" data-mode="unit">Por unidade</button><button class="chip" data-mode="weight">Por peso (g)</button></div>
      <label class="field" id="nf-uw-wrap" hidden>Peso médio de 1 unidade em gramas (opcional, para somar no total)
        <input type="text" inputmode="decimal" id="nf-uw" placeholder="Ex.: 50"></label>`}
    <label class="field" id="qty-wrap" ${mode ? "" : "hidden"}><span id="qty-label">${mode === "unit" ? "Quantas unidades?" : "Quantos gramas?"}</span>
      <input type="text" inputmode="decimal" id="qty" placeholder="${mode === "unit" ? "Ex.: 2" : "Ex.: 120"}"></label>
    <p class="notice" id="qty-err" hidden></p>
    <button class="btn primary block" id="qty-ok">${food ? "Adicionar" : "Cadastrar e adicionar"}</button>`);

  const setMode = (m) => {
    mode = m;
    s.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    s.querySelector("#nf-uw-wrap").hidden = m !== "unit";
    s.querySelector("#qty-wrap").hidden = false;
    s.querySelector("#qty-label").textContent = m === "unit" ? "Quantas unidades?" : "Quantos gramas?";
    s.querySelector("#qty").placeholder = m === "unit" ? "Ex.: 2" : "Ex.: 120";
  };
  if (food) setTimeout(() => s.querySelector("#qty").focus(), 50);

  s.onclick = (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const mb = e.target.closest("[data-mode]");
    if (mb) { setMode(mb.dataset.mode); s.querySelector("#qty").focus(); return; }
    if (e.target.id !== "qty-ok") return;
    const err = s.querySelector("#qty-err");
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    let f = food;
    if (!f) {
      const name = s.querySelector("#nf-name").value.trim();
      if (!name) return fail("Digite o nome do alimento.");
      if (!mode) return fail("Escolha se é por unidade ou por peso.");
      const dup = all("food").find((x) => norm(x.name) === norm(name));
      if (dup) f = dup;
      else {
        const id = "food:" + uid();
        const data = { name, mode };
        const uw = parseNum(s.querySelector("#nf-uw").value);
        if (mode === "unit" && uw) data.unitWeight = uw;
        put("food", id, data);
        f = { ...data, id };
      }
    }
    const qty = parseNum(s.querySelector("#qty").value);
    if (!qty) return fail(f.mode === "unit" ? "Informe quantas unidades." : "Informe o peso em gramas.");
    closeSheet();
    onPick(f.id, qty);
  };
}

/* ---------- Alimentos ---------- */

function viewFoods() {
  setChrome({ title: "Alimentos", tab: "alimentos" });
  const usage = foodUsage();
  const foods = all("food").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  $view.innerHTML = `
    <input type="search" id="foods-q" placeholder="Buscar alimento" autocomplete="off">
    <div class="card" id="foods-list"></div>
    <button class="btn" data-action="new-food">+ Novo alimento</button>`;
  const draw = () => {
    const term = norm(document.getElementById("foods-q").value);
    const rows = foods.filter((f) => norm(f.name).includes(term));
    document.getElementById("foods-list").innerHTML = rows.length
      ? rows.map((f) => `<button class="food-opt" data-id="${f.id}"><span>${esc(f.name)}<br><span class="muted small">${f.mode === "unit" ? "por unidade" + (f.unitWeight ? ` · ${fmtNum(f.unitWeight)} g cada` : "") : "por peso"}</span></span><span class="muted small">${usage[f.id] || 0}×</span></button>`).join("")
      : `<p class="empty">${foods.length ? "Nada encontrado." : "Nenhum alimento cadastrado ainda. Eles também são cadastrados na hora, dentro de uma refeição."}</p>`;
  };
  draw();
  $view.oninput = (e) => { if (e.target.id === "foods-q") draw(); };
  $view.onchange = null;
  $view.onclick = (e) => {
    const opt = e.target.closest(".food-opt");
    if (opt) return editFood(get(opt.dataset.id), usage[opt.dataset.id] || 0);
    if (e.target.closest("[data-action=new-food]")) editFood(null, 0);
  };
}

function editFood(food, uses) {
  let mode = food?.mode || "weight";
  const s = openSheet(`
    <div class="spread"><h2 style="margin:0;font-size:18px">${food ? "Editar alimento" : "Novo alimento"}</h2><button class="btn small" data-close>Fechar</button></div>
    <label class="field">Nome<input type="text" id="ef-name" value="${esc(food?.name)}"></label>
    <div class="chips"><button class="chip ${mode === "unit" ? "on" : ""}" data-mode="unit">Por unidade</button><button class="chip ${mode === "weight" ? "on" : ""}" data-mode="weight">Por peso (g)</button></div>
    <label class="field" id="ef-uw-wrap" ${mode === "unit" ? "" : "hidden"}>Peso médio de 1 unidade em gramas (opcional)
      <input type="text" inputmode="decimal" id="ef-uw" value="${food?.unitWeight ? fmtNum(food.unitWeight) : ""}"></label>
    ${food && uses ? `<p class="muted small">Usado em ${plural(uses, "refeição", "refeições")}. Mudar a medida muda como as quantidades já registradas são lidas.</p>` : ""}
    <p class="notice" id="ef-err" hidden></p>
    <button class="btn primary block" id="ef-save">Salvar</button>
    ${food ? `<button class="btn danger block" id="ef-del">Excluir alimento</button>` : ""}`);
  let confirmDel = false;
  s.onclick = (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const err = s.querySelector("#ef-err");
    const mb = e.target.closest("[data-mode]");
    if (mb) {
      mode = mb.dataset.mode;
      s.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === mb));
      s.querySelector("#ef-uw-wrap").hidden = mode !== "unit";
      return;
    }
    if (e.target.id === "ef-save") {
      const name = s.querySelector("#ef-name").value.trim();
      if (!name) { err.textContent = "Digite o nome."; err.hidden = false; return; }
      const data = { name, mode };
      const uw = parseNum(s.querySelector("#ef-uw").value);
      if (mode === "unit" && uw) data.unitWeight = uw;
      put("food", food?.id || "food:" + uid(), data);
      closeSheet(); render(); toast("Alimento salvo");
    }
    if (e.target.id === "ef-del") {
      if (uses) { err.textContent = `Este alimento está em ${plural(uses, "refeição", "refeições")}. Remova-o antes de excluir.`; err.hidden = false; return; }
      if (!confirmDel) { confirmDel = true; e.target.textContent = "Toque de novo para confirmar"; return; }
      remove(food.id); closeSheet(); render(); toast("Alimento excluído");
    }
  };
}

/* ---------- Análise ---------- */

const PERIODS = [["1", "Dia"], ["3", "3 dias"], ["7", "Semana"], ["30", "Mês"]];
let analysis = { days: LS.get("da_period", "7"), end: null };

function analyze(startDate, endDate) {
  const { winMin, winMax } = settings();
  const lo = winMin * 60000, hi = winMax * 3600000;

  const inRange = (d) => d >= startDate && d <= endDate;
  const meals = all("meal").filter((m) => inRange(m.date));
  const timedMeals = meals.filter((m) => m.time);
  const days = all("day").filter((d) => inRange(d.date));

  const symptoms = [];
  let giNoTime = 0;
  for (const d of days) {
    const timed = (d.symptoms || []).filter((s) => s.time);
    if (d.gi === "sim" && !timed.length) giNoTime++;
    for (const s of timed) symptoms.push({ ...s, date: d.date, t: at(d.date, s.time) });
  }
  symptoms.sort((a, b) => a.t - b.t);

  // Cada alimento conta uma vez por refeição.
  const consumptions = [];
  for (const m of timedMeals) {
    const t = at(m.date, m.time);
    for (const foodId of new Set((m.items || []).map((i) => i.foodId))) consumptions.push({ foodId, t, meal: m });
  }

  const stats = {};
  for (const c of consumptions) {
    const s = (stats[c.foodId] ||= { foodId: c.foodId, eaten: 0, before: 0, gaps: [] });
    s.eaten++;
    const gaps = symptoms.map((x) => x.t - c.t).filter((g) => g >= lo && g <= hi);
    if (gaps.length) { s.before++; s.gaps.push(Math.min(...gaps)); }
  }
  const ranking = Object.values(stats)
    .map((s) => ({ ...s, pct: s.before / s.eaten, gap: s.gaps.length ? s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length : null }))
    .sort((a, b) => b.before - a.before || b.pct - a.pct || b.eaten - a.eaten);

  // Para cada sintoma, o que foi comido na janela antes dele.
  const perSymptom = symptoms.map((s) => ({
    ...s,
    foods: consumptions
      .filter((c) => s.t - c.t >= lo && s.t - c.t <= hi)
      .sort((a, b) => b.t - a.t)
      .map((c) => ({ foodId: c.foodId, gap: s.t - c.t, meal: c.meal })),
  }));

  return {
    ranking, perSymptom, symptoms,
    mealCount: meals.length, untimedMeals: meals.length - timedMeals.length,
    symptomDays: new Set(symptoms.map((s) => s.date)).size + giNoTime, giNoTime,
    winText: `${fmtDur(lo)} a ${fmtDur(hi)} antes`,
  };
}

function viewAnalysis() {
  setChrome({ title: "Análise", tab: "analise" });
  const end = analysis.end || today();
  const n = Number(analysis.days);
  const start = addDays(end, -(n - 1));
  const r = analyze(start, end);
  const rangeText = n === 1 ? fmtLong(end) : `${fmtShort(start)} a ${fmtShort(end)}`;

  const warn = [];
  if (r.untimedMeals) warn.push(`${plural(r.untimedMeals, "refeição sem horário ficou", "refeições sem horário ficaram")} de fora.`);
  if (r.giNoTime) warn.push(`${plural(r.giNoTime, "dia com sintoma sem horário ficou", "dias com sintoma sem horário ficaram")} de fora.`);

  const table = r.ranking.length && r.symptoms.length ? `
    <div class="rank">${r.ranking.map((x) => `
      <div class="rank-row">
        <div class="spread"><span class="rank-name">${esc(foodName(x.foodId))}</span>
          <span class="num ${x.pct >= 0.5 && x.eaten >= 3 ? "pill alert" : "muted"}">${Math.round(x.pct * 100)}%</span></div>
        <div class="bar"><span style="width:${Math.round(x.pct * 100)}%"></span></div>
        <span class="small muted">Comido ${x.eaten}×, ${x.before}× antes de sintoma${x.gap != null ? ` · intervalo médio ${fmtDur(x.gap)}` : ""}${x.eaten < 3 ? ' · <span class="pill">poucos dados</span>' : ""}</span>
      </div>`).join("")}</div>` : `<p class="empty">${r.symptoms.length ? "Nenhuma refeição com horário neste período." : "Nenhum sintoma com horário neste período."}</p>`;

  const perSymptom = r.perSymptom.length ? r.perSymptom.map((s) => `
    <div class="tl alert">
      <span class="tl-time">${esc(s.time)}</span>
      <span><span class="tl-what">${esc(s.type)}</span>${n > 1 ? ` <span class="muted small">${esc(fmtShort(s.date))}</span>` : ""}<br>
      <span class="small muted">${s.foods.length ? s.foods.map((f) => `${esc(foodName(f.foodId))} (${fmtDur(f.gap)} antes)`).join(", ") : "Nada registrado na janela antes deste sintoma."}</span></span>
    </div>`).join("") : "";

  let dayTimeline = "";
  if (n === 1) {
    const events = [
      ...mealsOn(end).filter((m) => m.time).map((m) => ({ time: m.time, html: `<span class="tl-what">${esc(m.name)}</span><br><span class="small muted">${(m.items || []).map((i) => esc(foodName(i.foodId))).join(", ") || "sem alimentos"}</span>` })),
      ...r.symptoms.map((s) => ({ time: s.time, alert: true, html: `<span class="tl-what">${esc(s.type)}</span>` })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    dayTimeline = `<div class="card"><h2>Linha do tempo do dia</h2>
      ${events.length ? `<div class="timeline">${events.map((e) => `<div class="tl ${e.alert ? "alert" : ""}"><span class="tl-time">${esc(e.time)}</span><span>${e.html}</span></div>`).join("")}</div>` : `<p class="empty">Nada registrado neste dia.</p>`}</div>`;
  }

  $view.innerHTML = `
    <div class="card">
      ${chips("period", PERIODS, analysis.days)}
      <label class="field">Até o dia<input type="date" id="an-end" value="${end}" max="${today()}"></label>
      <span class="muted small">${esc(rangeText)} · janela de ${esc(r.winText)} do sintoma</span>
    </div>
    <div class="stats">
      <div class="stat"><b>${r.mealCount}</b><span>${r.mealCount === 1 ? "refeição" : "refeições"}</span></div>
      <div class="stat"><b>${r.symptoms.length}</b><span>${r.symptoms.length === 1 ? "sintoma" : "sintomas"} com horário</span></div>
      <div class="stat"><b>${r.symptomDays}</b><span>${r.symptomDays === 1 ? "dia" : "dias"} com sintoma</span></div>
    </div>
    ${warn.length ? `<p class="notice">${warn.join(" ")}</p>` : ""}
    ${dayTimeline}
    <div class="card">
      <h2>Alimentos suspeitos</h2>
      <span class="muted small">Quantas vezes cada alimento foi comido e quantas dessas vezes veio um sintoma em seguida.</span>
      ${table}
    </div>
    ${perSymptom ? `<div class="card"><h2>Cada sintoma e o que veio antes</h2><div class="timeline">${perSymptom}</div></div>` : ""}
    <div class="card">
      <button class="btn" data-action="copy">Copiar resumo para a nutricionista</button>
      <span class="muted small">A análise mostra coincidências no tempo, não um diagnóstico.</span>
    </div>`;

  $view.oninput = null;
  $view.onchange = (e) => { if (e.target.id === "an-end") { analysis.end = e.target.value || null; render(); } };
  $view.onclick = async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "chip") { analysis.days = el.dataset.value; LS.set("da_period", analysis.days); render(); }
    if (el.dataset.action === "copy") {
      const lines = [`Diário alimentar · ${rangeText}`, `Janela: ${r.winText} do sintoma`, `${r.mealCount} refeições, ${r.symptoms.length} sintomas com horário`, ""];
      for (const x of r.ranking.filter((x) => x.before)) lines.push(`- ${foodName(x.foodId)}: comido ${x.eaten}x, ${x.before}x antes de sintoma (${Math.round(x.pct * 100)}%)${x.gap != null ? `, intervalo médio ${fmtDur(x.gap)}` : ""}`);
      lines.push("", "Sintomas:");
      for (const s of r.perSymptom) lines.push(`- ${fmtShort(s.date)} ${s.time} ${s.type}: ${s.foods.map((f) => foodName(f.foodId)).join(", ") || "nada antes"}`);
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Resumo copiado"); }
      catch { toast("Não foi possível copiar"); }
    }
  };
}

/* ---------- Ajustes ---------- */

function viewSettings() {
  setChrome({ title: "Ajustes", tab: "ajustes" });
  const st = settings();
  const pending = Object.values(records).filter((r) => r.dirty).length;
  $view.innerHTML = `
    <div class="card">
      <h2>Janela da análise</h2>
      <span class="muted small">Um alimento conta como suspeito quando foi comido dentro deste intervalo antes do sintoma.</span>
      <div class="row">
        <label class="field" style="flex:1">De (minutos antes)<input type="text" inputmode="numeric" id="st-min" value="${st.winMin}"></label>
        <label class="field" style="flex:1">Até (horas antes)<input type="text" inputmode="decimal" id="st-max" value="${fmtNum(st.winMax)}"></label>
      </div>
    </div>
    <div class="card">
      <h2>Nuvem</h2>
      <span class="muted small">${pending ? `${plural(pending, "alteração aguardando", "alterações aguardando")} envio.` : "Tudo enviado para a nuvem."}</span>
      <button class="btn" data-action="sync">Sincronizar agora</button>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <span class="muted small">Gera um arquivo com todos os registros.</span>
      <button class="btn" data-action="export">Exportar dados</button>
    </div>
    <div class="card">
      <h2>Instalar no iPhone</h2>
      <span class="small">No Safari, toque em Compartilhar e depois em <b>Adicionar à Tela de Início</b>. O app passa a abrir em tela cheia, com ícone próprio.</span>
    </div>
    <button class="btn danger" data-action="logout">Sair deste aparelho</button>`;

  $view.oninput = null;
  $view.onchange = (e) => {
    if (e.target.id === "st-min" || e.target.id === "st-max") {
      const winMin = Math.round(parseNum(document.getElementById("st-min").value));
      const winMax = parseNum(document.getElementById("st-max").value);
      if (!winMax || winMin / 60 >= winMax) { toast("O fim da janela precisa ser maior que o começo"); render(); return; }
      put("settings", "settings", { winMin, winMax });
      toast("Janela salva");
    }
  };
  let confirmOut = false;
  $view.onclick = async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "sync") { await sync(); render(); }
    if (el.dataset.action === "export") exportData();
    if (el.dataset.action === "logout") {
      if (!confirmOut) { confirmOut = true; el.textContent = "Toque de novo para sair (os dados não enviados serão perdidos)"; return; }
      LS.del("da_pw"); LS.del("da_records"); LS.del("da_cursor");
      records = {}; cursor = 0; password = "";
      render();
    }
  };
}

async function exportData() {
  const data = {
    exportado_em: new Date().toISOString(),
    alimentos: all("food"),
    refeicoes: all("meal").map((m) => ({ ...m, itens: (m.items || []).map((i) => ({ alimento: foodName(i.foodId), quantidade: i.qty })) })),
    dias: all("day"),
  };
  const name = `diario-alimentar-${today()}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (err) { if (err && err.name === "AbortError") return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Roteador ---------- */

function render() {
  closeSheet();
  if (!password) return viewLogin();
  const [, route, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  window.scrollTo(0, 0);
  switch (route) {
    case "dia": return /^\d{4}-\d{2}-\d{2}$/.test(arg) ? viewDay(arg) : viewCalendar();
    case "refeicao": return viewMeal(decodeURIComponent(arg || ""));
    case "analise": return viewAnalysis();
    case "alimentos": return viewFoods();
    case "ajustes": return viewSettings();
    default: return viewCalendar();
  }
}

// Calendário: navegação de mês e abrir dia (os demais cliques são de cada tela).
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action=month],[data-action=open-day]");
  if (!el || !$view.contains(el)) return;
  if (el.dataset.action === "open-day") { location.hash = "#/dia/" + el.dataset.date; return; }
  const [y, m] = calMonth;
  const d = new Date(y, m + Number(el.dataset.delta), 1);
  calMonth = [d.getFullYear(), d.getMonth()];
  render();
});

window.addEventListener("hashchange", render);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
window.addEventListener("online", () => sync());

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

if (password) setSync("Salvo no aparelho");
render();
sync();
