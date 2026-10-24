"use strict";

const APP_VERSION = "20261024235501"; // trocado pelo deploy.sh a cada publicação

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

let dataVersion = 0; // muda a cada gravação, para refazer cálculos guardados
const persist = () => { dataVersion++; LS.set("da_records", records); };

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
    if (res.status === 401) {
      // Senha trocada no servidor: pede de novo, sem apagar o que está no aparelho.
      password = ""; LS.del("da_pw"); setSync("");
      render(); toast("A senha mudou. Digite a nova senha.");
      return;
    }
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
    if (changed && !isTyping() && Date.now() - wheelBusy > 1500 && document.getElementById("sheet").hidden) render();
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
const INTENSITIES = [["leve", "Leve"], ["moderado", "Moderado"], ["forte", "Forte"]];
const FOOD_GROUPS = ["Fritura", "Gordura", "Fibra", "FODMAP", "Lactose", "Glúten", "Açúcar", "Cafeína", "Álcool", "Picante", "Leguminosa", "Ultraprocessado"];

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

// Quantidade pode faltar em alimento por peso (peso é opcional).
const qtyText = (it, f) => (it.qty ? `${fmtNum(it.qty)} ${unitLabel(f)}` : "");

function mealTotals(meal) {
  let grams = 0, est = 0, units = 0;
  for (const it of meal.items || []) {
    const f = get(it.foodId);
    if (!f || !it.qty) continue;
    if (f.mode === "weight") grams += it.qty;
    else if (f.unitWeight) est += it.qty * f.unitWeight;
    else units += it.qty;
  }
  return { grams, est, units };
}

function totalText(meal) {
  if (meal.totalWeight) return `${fmtNum(meal.totalWeight)} g`; // total digitado à mão
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

/* ---------- Pontuação ---------- */

// Nota de saúde de cada alimento, pela regra de ouro do Guia Alimentar (tabela + IA no servidor).
const HEALTH = {
  saudavel: { emoji: "🥦", label: "Saudável", pts: 100 },
  moderado: { emoji: "🍞", label: "Moderação", pts: 60 },
  evitar: { emoji: "🍟", label: "Evitar", pts: 15 },
};
const HEALTH_SOURCE = { tabela: "pela tabela do Guia Alimentar", ia: "pela IA", manual: "por você" };

// Nota da barriga (intestino irritado): semáforo da Monash University e das diretrizes ACG e NICE.
const GUT = {
  ok: { emoji: "🟢", label: "Tranquilo", pts: 100 },
  atencao: { emoji: "🟡", label: "Atenção", pts: 60 },
  gatilho: { emoji: "🔴", label: "Gatilho comum", pts: 15 },
};
const WHY = {
  frutanos: ["🧅", "Frutanos"], gos: ["🫘", "GOS (feijões)"], lactose: ["🥛", "Lactose"], frutose: ["🍎", "Frutose"],
  poliois: ["🍬", "Polióis"], gordura: ["🧈", "Gordura"], cafeina: ["☕", "Cafeína"], alcool: ["🍺", "Álcool"],
  gas: ["🫧", "Gás"], picante: ["🌶️", "Picante"], insoluvel: ["🌾", "Fibra insolúvel"], soluvel: ["💚", "Fibra que ajuda"],
};
const GUT_SOURCE = { tabela: "pela tabela da Monash e das diretrizes", ia: "pela IA", manual: "por você" };
const whyText = (f) => (f?.gutWhy || []).filter((w) => WHY[w]).map((w) => `${WHY[w][0]} ${WHY[w][1]}`).join(", ");
const GUT_LEVELS = [
  [80, "😌", "top", ["Barriga em paz 😌", "Dia leve pra barriga 🍃", "Barriga agradece! 🙏"]],
  [60, "🙂", "good", ["Barriga tranquila 🙂", "Quase tudo leve hoje 👍", "Bom pra barriga 🌱"]],
  [40, "😕", "meh", ["Uns gatilhos no caminho 🤏", "Barriga de olho 👀", "Meio pesado hoje 🫤"]],
  [0, "😣", "low", ["Barriga em alerta 🚨", "Muitos gatilhos hoje 🔴", "Dia pesado pra barriga 😣"]],
];
function gutLevel(score, key = "") {
  const [, emoji, tone, msgs] = GUT_LEVELS.find(([min]) => score >= min);
  return { emoji, tone, msg: msgs[hashStr(key) % msgs.length] };
}

// Gatilhos pessoais: alimentos que, nos últimos 60 dias, vêm antes de sintoma 1,5× mais que a média.
let triggersCache = null;
function personalTriggers() {
  const key = cursor + ":" + dataVersion + ":" + today();
  if (triggersCache?.key === key) return triggersCache.set;
  const r = analyze(addDays(today(), -59), today());
  const set = new Set(r.ranking.filter((x) => x.lift != null && x.lift >= 1.5 && x.eaten >= 3 && x.before >= 2).map((x) => x.key));
  triggersCache = { key, set };
  return set;
}
const isTrigger = (f) => !!f && personalTriggers().has(f.id) && !f.gutOkForMe;
// Seu gatilho vale mais que a regra geral; "vai bem comigo" também.
const gutOf = (f) => (isTrigger(f) ? "gatilho" : f?.gutOkForMe ? "ok" : f?.gut);

// Nota da barriga no dia: média dos alimentos (sem bônus).
function gutDayScore(date) {
  const counts = { ok: 0, atencao: 0, gatilho: 0 }, mine = new Set();
  let pts = 0, n = 0;
  for (const m of mealsOn(date)) for (const it of m.items || []) {
    const f = get(it.foodId), g = gutOf(f);
    if (!GUT[g]) continue;
    if (isTrigger(f)) mine.add(f.name);
    counts[g]++; pts += GUT[g].pts; n++;
  }
  return n ? { score: Math.round(pts / n), counts, mine: [...mine] } : null;
}

// Aviso discreto ao pôr na refeição um alimento que costuma ser gatilho.
function gutWarning(foodId) {
  const f = get(foodId);
  if (isTrigger(f)) return `⚠️ ${f.name} é um gatilho seu, pelos seus registros`;
  if (f?.gut === "gatilho" && !f.gutOkForMe) return `🔴 Gatilho comum${whyText(f) ? `: ${whyText(f)}` : ""}`;
  return null;
}

// Constância: registrar várias refeições no dia rende bônus.
const mealBonus = (n) => (n >= 3 ? 10 : n === 2 ? 5 : 0);

const LEVELS = [
  [85, "🤩", "top", ["Nota 10! Tampinha arrasou 🥦", "Prato de campeã! 🏆", "Isso sim é comer bem! ✨"]],
  [70, "😄", "good", ["Mandou bem! 💪", "Tá voando! 🚀", "Muito bom, continua assim! 🌱"]],
  [55, "🙂", "ok", ["No caminho certo 👣", "Bom equilíbrio! ⚖️", "Dá pra subir mais um pouquinho 📈"]],
  [40, "😐", "meh", ["Dá pra caprichar mais 🥕", "Que tal uma fruta no próximo lanche? 🍎", "Meio a meio hoje 🤷"]],
  [0, "😬", "low", ["Ih... bora de salada no próximo? 🥗", "Dia de besteirinha, né? 🍟", "Amanhã é outro dia! 🌅"]],
];
const hashStr = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function level(score, key = "") {
  const [, emoji, tone, msgs] = LEVELS.find(([min]) => score >= min);
  return { emoji, tone, msg: msgs[hashStr(key) % msgs.length] }; // a frase não muda a cada abertura
}

// Nota do dia (0 a 100): média das notas dos alimentos + bônus de constância.
function dayScore(date) {
  const meals = mealsOn(date);
  if (!meals.length) return null;
  const counts = { saudavel: 0, moderado: 0, evitar: 0 }, unrated = new Set();
  let pts = 0, n = 0;
  for (const m of meals) for (const it of m.items || []) {
    const f = get(it.foodId);
    if (!f) continue;
    if (!HEALTH[f.health]) { unrated.add(f.id); continue; }
    counts[f.health]++; pts += HEALTH[f.health].pts; n++;
  }
  const score = n ? Math.min(100, Math.round(pts / n + mealBonus(meals.length))) : null;
  return { date, score, meals: meals.length, counts, unrated };
}

// Nota de um período: média dos dias com nota; dias registrados contam até hoje.
function periodScore(start, end) {
  const t = today(), days = [];
  for (let s = start; s <= end && s <= t; s = addDays(s, 1)) days.push(dayScore(s));
  const scored = days.filter((d) => d?.score != null);
  const counts = { saudavel: 0, moderado: 0, evitar: 0 };
  for (const d of scored) for (const k in counts) counts[k] += d.counts[k];
  return {
    score: scored.length ? Math.round(avg(scored.map((d) => d.score))) : null,
    elapsed: days.length, logged: days.filter(Boolean).length, scored, counts,
  };
}

// Dias seguidos com pelo menos uma refeição (hoje ainda vazio não quebra a sequência).
function streak() {
  let s = today(), n = 0;
  if (!mealsOn(s).length) s = addDays(s, -1);
  while (mealsOn(s).length) { n++; s = addDays(s, -1); }
  return n;
}

function weekBadges(w) {
  const out = [];
  if (w.scored.filter((d) => d.score >= 70).length >= 5) out.push(["🥗", "Semana verde", "5 dias ou mais com nota acima de 70"]);
  if (w.elapsed === 7 && w.logged === 7) out.push(["📒", "Diário em dia", "registrou todos os dias da semana"]);
  if (w.scored.length >= 3 && !w.counts.evitar) out.push(["🚫🍟", "Sem besteira", "nenhum alimento para evitar na semana"]);
  if (w.counts.saudavel >= 15) out.push(["🥦", "Fã de verdura", "15 ou mais alimentos saudáveis na semana"]);
  return out;
}
function monthBadges(m) {
  const out = [];
  if (m.scored.length >= 15 && m.score >= 75) out.push(["🏆", "Mês campeão", "média acima de 75 em 15 dias ou mais"]);
  if (m.logged >= 20) out.push(["🗓️", "Maratonista", "20 dias ou mais registrados no mês"]);
  return out;
}

// Pede ao servidor a nota dos alimentos sem nota (o agendamento semanal faz o mesmo para o que sobrar).
let rating = false;
const unratedFoods = () => all("food").filter((f) => !HEALTH[f.health] || !GUT[f.gut]);
async function rateFoods(foods = unratedFoods()) {
  if (!foods.length || rating || !password || !navigator.onLine) return 0;
  rating = true;
  try {
    const g = await rateGut(foods.filter((f) => !GUT[f.gut]));
    foods = foods.filter((f) => !HEALTH[f.health]);
    if (!foods.length) return g;
    const examples = all("food").filter((f) => f.healthManual && HEALTH[f.health]).slice(-40)
      .map((f) => ({ name: f.name, prep: f.prep || "", health: f.health }));
    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + password },
      body: JSON.stringify({ foods: foods.map((f) => ({ name: f.name, prep: f.prep || "" })), examples }),
    });
    if (!res.ok) return 0;
    const { health = {}, source = {} } = await res.json();
    let n = 0;
    for (const f0 of foods) {
      const f = get(f0.id);
      if (!f || HEALTH[f.health] || !HEALTH[health[f.name]]) continue;
      const { id, ...data } = f;
      put("food", id, { ...data, health: health[f.name], healthSource: source[f.name] || "ia" });
      n++;
    }
    return Math.max(n, g);
  } catch { return 0; } finally { rating = false; }
}

async function rateGut(foods) {
  if (!foods.length) return 0;
  try {
    const examples = all("food").filter((f) => f.gutManual && GUT[f.gut]).slice(-40)
      .map((f) => ({ name: f.name, prep: f.prep || "", gut: f.gut, why: f.gutWhy || [] }));
    const res = await fetch("/api/gut", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + password },
      body: JSON.stringify({ foods: foods.map((f) => ({ name: f.name, prep: f.prep || "" })), examples }),
    });
    if (!res.ok) return 0;
    const { gut = {}, source = {} } = await res.json();
    let n = 0;
    for (const f0 of foods) {
      const f = get(f0.id), r = f && gut[f.name];
      if (!f || GUT[f.gut] || !GUT[r?.gut]) continue;
      const { id, ...data } = f;
      put("food", id, { ...data, gut: r.gut, gutWhy: r.why || [], gutSource: source[f.name] || "ia" });
      n++;
    }
    return n;
  } catch { return 0; }
}

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

/* ---------- Seletor de horário (carrossel de hora e minutos) ---------- */

const WHEEL_ROW = 36; // altura de cada linha, igual ao CSS
let wheelBusy = 0;    // último giro, para a sincronização não redesenhar a tela no meio

const wheelCol = (part, count, value, label) => `
  <div class="tw-part"><span class="tw-label">${label}</span>
    <div class="tw-box"><div class="tw-col" data-part="${part}" data-value="${value}">
      <div class="tw-pad"></div>${Array.from({ length: count }, (_, i) => `<div class="tw-row" data-i="${i}">${pad(i)}</div>`).join("")}<div class="tw-pad"></div>
    </div></div></div>`;

function timeWheel(key, time) {
  const [h, m] = (time || "12:00").split(":").map(Number);
  return `<div class="tw" data-tw="${esc(key)}">${wheelCol("h", 24, h, "Hora")}<span class="tw-sep">:</span>${wheelCol("m", 60, m, "Minutos")}</div>`;
}

// Liga os carrosséis dentro de `root`; onChange(key, "HH:MM") quando um giro termina.
function initWheels(root, onChange) {
  for (const tw of root.querySelectorAll(".tw")) {
    const cols = [...tw.querySelectorAll(".tw-col")];
    const mark = (col, i) => col.querySelectorAll(".tw-row").forEach((r) => r.classList.toggle("on", Number(r.dataset.i) === i));
    const value = () => cols.map((c) => pad(c.dataset.value)).join(":");
    for (const col of cols) {
      const max = col.querySelectorAll(".tw-row").length - 1;
      col.scrollTop = Number(col.dataset.value) * WHEEL_ROW;
      mark(col, Number(col.dataset.value));
      let t = null;
      col.addEventListener("scroll", () => {
        wheelBusy = Date.now();
        const i = Math.max(0, Math.min(max, Math.round(col.scrollTop / WHEEL_ROW)));
        mark(col, i);
        clearTimeout(t);
        t = setTimeout(() => {
          if (Number(col.dataset.value) === i) return;
          col.dataset.value = i;
          onChange(tw.dataset.tw, value());
        }, 150);
      }, { passive: true });
      col.addEventListener("click", (e) => {
        const row = e.target.closest(".tw-row");
        if (row) col.scrollTo({ top: Number(row.dataset.i) * WHEEL_ROW, behavior: "smooth" });
      });
    }
  }
}

/* ---------- Telas ---------- */

let calMonth = null; // [ano, mês]
let calWeek = null;  // domingo da semana mostrada no modo Semana (aaaa-mm-dd)
let calMode = LS.get("da_cal_mode", "mes"); // "semana" ou "mes"
const weekStart = (s) => addDays(s, -parseYmd(s).getDay());

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
    setTimeout(maybeAskNotifications, 1500);
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

  const dotsFor = (s) => Array.from({ length: Math.min(mealCount[s] || 0, 5) }, () => '<i class="dot"></i>').join("") + (alert[s] ? '<i class="dot alert"></i>' : "");

  let calHtml;
  if (calMode === "semana") {
    if (!calWeek) calWeek = weekStart(t);
    const days = Array.from({ length: 7 }, (_, i) => addDays(calWeek, i));
    const end = days[6], sp = parseYmd(calWeek), ep = parseYmd(end);
    const title = sp.getMonth() === ep.getMonth()
      ? `${sp.getDate()} a ${ep.getDate()} de ${new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(ep)}`
      : `${fmtShort(calWeek)} a ${fmtShort(end)}`;
    calHtml = `
      <div class="cal-head">
        <button class="btn small" data-action="week" data-delta="-7" aria-label="Semana anterior">‹</button>
        <h2>${esc(title)}</h2>
        <button class="btn small" data-action="week" data-delta="7" aria-label="Próxima semana">›</button>
      </div>
      <div class="wk-grid">${days.map((s) => {
        const n = mealCount[s] || 0;
        return `<button class="wk-day ${s === t ? "today" : ""}" data-action="open-day" data-date="${s}" aria-label="${esc(fmtLong(s))}">
          <span class="wk-dow">${["D", "S", "T", "Q", "Q", "S", "S"][parseYmd(s).getDay()]}</span>
          <span class="wk-n">${parseYmd(s).getDate()}</span>
          <span class="dots">${dotsFor(s)}</span>
          <span class="wk-meals">${n ? `${n} ref.` : ""}</span>
          <span class="wk-score">${(() => { const d = dayScore(s); return d?.score != null ? level(d.score).emoji : ""; })()}</span></button>`;
      }).join("")}</div>`;
  } else {
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const s = ymd(d);
      if (i >= 35 && d.getMonth() !== m) break;
      cells += `<button class="cal-day ${d.getMonth() !== m ? "out" : ""} ${s === t ? "today" : ""}" data-action="open-day" data-date="${s}" aria-label="${esc(fmtLong(s))}">
        <span class="d">${d.getDate()}</span><span class="dots">${dotsFor(s)}</span></button>`;
    }
    calHtml = `
      <div class="cal-head">
        <button class="btn small" data-action="month" data-delta="-1" aria-label="Mês anterior">‹</button>
        <h2>${esc(fmtMonth(y, m))}</h2>
        <button class="btn small" data-action="month" data-delta="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="cal-grid">
        ${["D", "S", "T", "Q", "Q", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells}
      </div>`;
  }

  const todayMeals = mealsOn(t);
  const ws = calMode === "semana" ? calWeek : weekStart(t);
  const mStart = ymd(new Date(y, m, 1)), mEnd = ymd(new Date(y, m + 1, 0));
  $view.innerHTML = `
    <div class="seg" role="group" aria-label="Modo do calendário">
      <button class="${calMode === "semana" ? "on" : ""}" data-action="cal-mode" data-mode="semana" aria-pressed="${calMode === "semana"}">SEMANA</button>
      <button class="${calMode === "mes" ? "on" : ""}" data-action="cal-mode" data-mode="mes" aria-pressed="${calMode === "mes"}">MÊS</button>
    </div>
    <div class="card">
      ${calHtml}
      <div class="legend"><span><i class="dot"></i>refeição</span><span><i class="dot alert"></i>sintoma</span></div>
    </div>
    ${scoreCard(t, ws, mStart, mEnd)}
    <a class="card" href="#/dia/${t}" style="text-decoration:none;color:inherit">
      <div class="spread"><h2>Hoje</h2><span class="muted small">${esc(fmtLong(t))}</span></div>
      <span class="muted small">${todayMeals.length ? plural(todayMeals.length, "refeição registrada", "refeições registradas") : "Nenhuma refeição registrada ainda"} · toque para abrir</span>
    </a>`;
  $view.onclick = (e) => {
    if (e.target.closest("[data-action=score-help]")) return scoreHelp(ws);
    const rate = e.target.closest("[data-action=rate-foods]");
    if (rate) {
      rate.disabled = true; rate.textContent = "Classificando…";
      rateFoods().then((n) => { toast(n ? `${plural(n, "alimento ganhou nota", "alimentos ganharam nota")}` : "Não foi possível classificar agora"); render(); });
    }
  };
}

const monthShort = (s) => cap(new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(parseYmd(s)));

function scoreTile(label, score, key) {
  if (score == null) return `<div class="sc-tile"><span class="sc-emoji">🫥</span><span class="sc-num muted">--</span><span class="sc-label">${esc(label)}</span><span class="sc-bar"><i style="width:0"></i></span></div>`;
  const lv = level(score, key);
  return `<div class="sc-tile ${lv.tone}"><span class="sc-emoji">${lv.emoji}</span><span class="sc-num">${score}</span><span class="sc-label">${esc(label)}</span><span class="sc-bar"><i style="width:${score}%"></i></span></div>`;
}

function gutTile(score, key) {
  if (score == null) return `<div class="sc-tile"><span class="sc-emoji">🫥</span><span class="sc-num muted">--</span><span class="sc-label">Barriga</span><span class="sc-bar"><i style="width:0"></i></span></div>`;
  const lv = gutLevel(score, key);
  return `<div class="sc-tile ${lv.tone}"><span class="sc-emoji">${lv.emoji}</span><span class="sc-num">${score}</span><span class="sc-label">Barriga</span><span class="sc-bar"><i style="width:${score}%"></i></span></div>`;
}

function scoreCard(t, ws, mStart, mEnd) {
  const d = dayScore(t), w = periodScore(ws, addDays(ws, 6)), mo = periodScore(mStart, mEnd), g = gutDayScore(t);
  if (!all("meal").length) return "";
  const thisWeek = ws === weekStart(t);
  // A frase vem do dia; se hoje ainda não tem nota, da semana.
  const head = d?.score != null ? { s: d.score, key: t, who: "Hoje" } : w.score != null ? { s: w.score, key: ws, who: thisWeek ? "Nesta semana" : "Na semana" } : null;
  const mix = (c) => `🥦 ${c.saudavel} · 🍞 ${c.moderado} · 🍟 ${c.evitar}`;
  const st = streak();
  const badges = [...weekBadges(w), ...monthBadges(mo)];
  const unrated = unratedFoods().length;
  return `
    <div class="card score">
      <div class="spread"><h2>Pontuação</h2><button class="btn small" data-action="score-help">Como funciona?</button></div>
      <div class="sc-tiles">
        ${scoreTile("Hoje", d?.score, t)}
        ${scoreTile(thisWeek ? "Semana" : `Sem. ${fmtShort(ws)}`, w.score, ws)}
        ${scoreTile(monthShort(mStart), mo.score, mStart)}
        ${gutTile(g?.score, t)}
      </div>
      ${head ? `<p class="sc-msg">${esc(head.who)}: ${esc(level(head.s, head.key).msg)}</p>` : `<p class="sc-msg muted">Registre as refeições de hoje para ganhar sua primeira nota 🍽️</p>`}
      ${d?.score != null ? `<span class="small">Hoje: ${mix(d.counts)}${mealBonus(d.meals) ? ` · +${mealBonus(d.meals)} de constância` : ""}</span>` : ""}
      ${g ? `<span class="small">Barriga hoje: ${gutLevel(g.score, "g" + t).msg} · 🟢 ${g.counts.ok} · 🟡 ${g.counts.atencao} · 🔴 ${g.counts.gatilho}${g.mine.length ? `<br>⚠️ Seus gatilhos hoje: ${esc(g.mine.join(", "))}` : ""}</span>` : ""}
      ${st >= 2 ? `<span class="small sc-streak">🔥 ${st} dias seguidos registrando</span>` : ""}
      ${badges.length ? `<div class="sc-badges">${badges.map(([e, name, why]) => `<span class="sc-badge" title="${esc(why)}">${e} ${esc(name)}</span>`).join("")}</div>` : ""}
      ${unrated ? `<div class="spread"><span class="muted small">${plural(unrated, "alimento ainda sem nota", "alimentos ainda sem nota")} (classificados toda segunda)</span><button class="btn small" data-action="rate-foods">Classificar agora</button></div>` : ""}
    </div>`;
}

function scoreHelp(ws) {
  const w = periodScore(ws, addDays(ws, 6));
  const eaten = {};
  for (const d of w.scored) for (const m of mealsOn(d.date)) for (const it of m.items || []) {
    const f = get(it.foodId);
    if (f?.health === "evitar") eaten[f.name] = (eaten[f.name] || 0) + 1;
  }
  const top = Object.entries(eaten).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const s = openSheet(`
    <div class="sheet-head"><span></span><h2>Como funciona</h2><button class="btn small primary" data-close>OK</button></div>
    <p class="small" style="margin:0">Cada alimento tem uma nota, seguindo a regra de ouro do <b>Guia Alimentar para a População Brasileira</b>: comida de verdade como base, processados com moderação e ultraprocessados evitados.</p>
    <div class="sc-rules">
      ${Object.values(HEALTH).map((h) => `<span>${h.emoji} <b>${h.label}</b></span><span class="num">${h.pts} pts</span>`).join("")}
      <span>🍽️ <b>Constância</b>: 2 refeições no dia</span><span class="num">+5</span>
      <span>🍽️ <b>Constância</b>: 3 ou mais</span><span class="num">+10</span>
    </div>
    <p class="small" style="margin:0">A nota do dia é a média dos alimentos mais o bônus, até 100. A da semana e a do mês são a média dos dias com nota.</p>
    <p class="small" style="margin:0">${LEVELS.map(([min, e]) => `${e} ${min}+`).join(" · ")}</p>
    <span class="q-label">Barriga (intestino irritado)</span>
    <p class="small" style="margin:0">Cada alimento também tem um semáforo, pela Monash University (criadora da dieta low FODMAP) e pelas diretrizes médicas: 🟢 tranquilo (100), 🟡 atenção (60) e 🔴 gatilho comum (15). O quadro Barriga é a média do dia, sem bônus. Os motivos aparecem na aba Alimentos: ${Object.values(WHY).map(([e, l]) => `${e} ${l.toLowerCase()}`).join(", ")}.</p>
    <p class="small" style="margin:0">⚠️ <b>Seu gatilho</b>: quando, pelos seus registros, um alimento vem antes de sintoma 1,5× mais que a média (3 vezes ou mais), ele conta como 🔴, mesmo que a regra geral diga 🟢. Na aba Alimentos dá para marcar "vai bem comigo".</p>
    ${top.length ? `<span class="q-label">🍟 mais comidos nesta semana</span><span class="small">${top.map(([n, c]) => `${esc(n)} (${c}×)`).join(", ")}</span>` : ""}
    <p class="muted small" style="margin:0">A nota de cada alimento pode ser trocada na aba Alimentos.</p>`);
  s.onclick = (e) => { if (e.target.closest("[data-close]")) closeSheet(); };
}

function viewDay(date) {
  setChrome({ title: fmtTitle(date), back: "#/", tab: "cal" });
  const d = parseYmd(date); calMonth = [d.getFullYear(), d.getMonth()]; calWeek = weekStart(date);
  const meals = mealsOn(date);
  const day = getDay(date);

  const mealHtml = meals.length
    ? meals.map((meal) => {
        const names = (meal.items || []).map((it) => {
          const f = get(it.foodId);
          return `${esc(foodName(it.foodId))} ${qtyText(it, f)}`.trim();
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
      ${s.time ? timeWheel("s:" + s.id, s.time) : `<button class="btn small" data-action="set-stime" data-id="${s.id}">Informar horário</button>`}
      <select data-symptom="${s.id}" data-sfield="type" aria-label="Tipo de sintoma">
        ${SYMPTOM_TYPES.map((t) => `<option ${t === s.type ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select>
      <button class="icon-btn" data-action="del-symptom" data-id="${s.id}" aria-label="Remover sintoma">×</button>
      <div class="chips symptom-int"><span class="muted small">Intensidade</span>${INTENSITIES.map(([v, label]) =>
        `<button type="button" class="chip alert ${s.intensity === v ? "on" : ""}" data-action="sint" data-id="${s.id}" data-value="${v}">${label}</button>`).join("")}</div>
    </div>`).join("");

  const ds = dayScore(date);
  $view.innerHTML = `
    <div class="spread">
      <a class="btn small" href="#/dia/${addDays(date, -1)}">‹ ${esc(fmtShort(addDays(date, -1)))}</a>
      <a class="btn small" href="#/dia/${addDays(date, 1)}">${esc(fmtShort(addDays(date, 1)))} ›</a>
    </div>
    ${(() => { const g = gutDayScore(date); return g ? `<div class="card sc-day ${gutLevel(g.score).tone}"><span class="sc-emoji">${gutLevel(g.score).emoji}</span>
      <span><b class="num">Barriga: ${g.score}</b><br><span class="small">${esc(gutLevel(g.score, "g" + date).msg)}<br>🟢 ${g.counts.ok} · 🟡 ${g.counts.atencao} · 🔴 ${g.counts.gatilho}${g.mine.length ? ` · ⚠️ ${esc(g.mine.join(", "))}` : ""}</span></span></div>` : ""; })()}
    ${ds?.score != null ? `<div class="card sc-day ${level(ds.score).tone}"><span class="sc-emoji">${level(ds.score).emoji}</span>
      <span><b class="num">Nota do dia: ${ds.score}</b><br><span class="small">${esc(level(ds.score, date).msg)}<br>🥦 ${ds.counts.saudavel} · 🍞 ${ds.counts.moderado} · 🍟 ${ds.counts.evitar}</span></span></div>` : ""}
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

  initWheels($view, (key, time) => {
    const dd = getDay(date);
    const s = dd.symptoms.find((x) => "s:" + x.id === key);
    if (s) { s.time = time; saveDay(dd); }
  });
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
    } else if (el.dataset.action === "sint") {
      const s = dd.symptoms.find((x) => x.id === el.dataset.id);
      if (s) { s.intensity = s.intensity === el.dataset.value ? null : el.dataset.value; saveDay(dd); }
      el.parentElement.querySelectorAll("[data-action=sint]").forEach((b) => b.classList.toggle("on", b === el && !!s?.intensity));
    } else if (el.dataset.action === "set-stime") {
      const s = dd.symptoms.find((x) => x.id === el.dataset.id);
      if (s) { s.time = "12:00"; saveDay(dd); render(); }
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
      <span class="qty"><input type="text" inputmode="decimal" value="${it.qty ? fmtNum(it.qty) : ""}" placeholder="${f?.mode === "unit" ? "" : "opcional"}" data-qty="${i}" aria-label="Quantidade"> <span class="muted">${unitLabel(f)}</span></span>
      <button class="icon-btn" data-action="del-item" data-i="${i}" aria-label="Remover">×</button>
    </div>`;
  }).join("");

  $view.innerHTML = `
    <div class="card">
      <label class="field">Refeição<input type="text" id="meal-name" value="${esc(meal.name)}"></label>
      <div class="chips" id="meal-chips">${MEAL_NAMES.map((n) => `<button class="chip ${n === meal.name ? "on" : ""}" data-action="name" data-value="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <span class="muted small">Horário em que aconteceu</span>
      ${meal.time ? timeWheel("meal", meal.time) : `<button class="btn" data-action="set-time">Informar horário</button>
        <p class="notice">Informe o horário para a refeição entrar na análise.</p>`}
    </div>
    <div class="card">
      <h2>Alimentos</h2>
      ${items || `<p class="empty">Nenhum alimento ainda.</p>`}
      <div class="total-bar"><span>Total da refeição</span>
        <span class="qty"><input type="text" inputmode="decimal" id="meal-total" aria-label="Peso total da refeição"> <span class="muted">g</span></span></div>
      <span class="muted small" id="total-note"></span>
      <button class="btn block" data-action="add-food">+ Adicionar alimento</button>
    </div>
    <button class="btn primary block" data-action="save-meal">Salvar refeição</button>
    <button class="btn danger" data-action="del-meal">Excluir refeição</button>`;

  const reload = () => get(id);

  // Total: soma dos alimentos, a menos que tenha sido digitado à mão (totalWeight).
  const drawTotal = (m, keepInput = false) => {
    const { grams, est, units } = mealTotals(m);
    const sum = grams + est;
    const input = document.getElementById("meal-total");
    if (!keepInput) input.value = m.totalWeight ? fmtNum(m.totalWeight) : sum ? fmtNum(sum) : "";
    input.placeholder = "0";
    const extra = units ? ` + ${fmtNum(units)} un. sem peso` : "";
    document.getElementById("total-note").textContent = m.totalWeight
      ? `Editado à mão. Soma dos alimentos: ${fmtNum(sum)} g${extra}. Apague o campo para voltar à soma.`
      : `${est ? "Estimado pela" : "Calculado pela"} soma dos alimentos${extra}. Pode editar.`;
  };
  drawTotal(meal);

  initWheels($view, (key, time) => {
    const m = reload();
    m.time = time;
    if (m.autoName) { // nome sugerido acompanha o horário até ser escolhido
      m.name = guessMealName(time);
      document.getElementById("meal-name").value = m.name;
      document.querySelectorAll("#meal-chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.value === m.name));
      setChrome({ title: m.name, back: "#/dia/" + m.date, tab: "cal" });
    }
    saveMeal(m);
  });

  $view.oninput = (e) => {
    if (e.target.dataset.qty != null) {
      const m = reload();
      m.items[e.target.dataset.qty].qty = parseNum(e.target.value) || null;
      drawTotal(m);
    }
  };
  $view.onchange = (e) => {
    const m = reload();
    if (e.target.id === "meal-name") { m.name = e.target.value.trim(); m.autoName = false; saveMeal(m); setChrome({ title: m.name || "Refeição", back: "#/dia/" + m.date, tab: "cal" }); }
    else if (e.target.id === "meal-total") {
      const q = parseNum(e.target.value);
      const { grams, est } = mealTotals(m);
      if (!q || Math.abs(q - (grams + est)) < 0.05) delete m.totalWeight; else m.totalWeight = q;
      saveMeal(m); drawTotal(m);
    }
    else if (e.target.dataset.qty != null) {
      const it = m.items[e.target.dataset.qty];
      const q = parseNum(e.target.value);
      const unit = get(it.foodId)?.mode === "unit";
      it.qty = q || (unit ? 1 : null); saveMeal(m); // por unidade, em branco vale 1
      e.target.value = it.qty ? fmtNum(it.qty) : "";
      drawTotal(m);
    }
  };
  let confirmDel = false;
  $view.onclick = (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const m = reload();
    switch (el.dataset.action) {
      case "name": m.name = el.dataset.value; m.autoName = false; saveMeal(m); render(); break;
      case "set-time":
        m.time = m.date === today() ? nowHHMM() : "12:00";
        if (m.autoName) m.name = guessMealName(m.time);
        saveMeal(m); render(); break;
      case "del-item": m.items.splice(Number(el.dataset.i), 1); saveMeal(m); render(); break;
      case "add-food": openFoodSheet((foodId, qty) => {
        const mm = reload(); mm.items.push({ foodId, qty }); saveMeal(mm); render(); toast(gutWarning(foodId) || "Alimento salvo");
      }); break;
      case "save-meal":
        document.activeElement?.blur(); // confirma o campo que estiver sendo digitado
        location.hash = "#/dia/" + m.date; toast("Refeição salva"); break;
      case "del-meal":
        if (!confirmDel) { confirmDel = true; el.textContent = "Toque de novo para confirmar"; return; }
        remove(id); location.hash = "#/dia/" + m.date; toast("Refeição excluída"); break;
    }
  };
}

/* ---------- Folha do alimento (escolher ou cadastrar na hora) ---------- */

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

// Teclado do celular: a janela de baixo sobe junto e fica acima dele, sem cobrir o que se digita.
if (window.visualViewport) {
  const fitSheet = () => {
    const vv = window.visualViewport, sheet = document.getElementById("sheet");
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.bottom = kb > 80 ? kb + "px" : "";
    sheet.style.maxHeight = kb > 80 ? Math.round(vv.height * 0.92) + "px" : "";
  };
  window.visualViewport.addEventListener("resize", fitSheet);
  window.visualViewport.addEventListener("scroll", fitSheet);
}

// "massinha de creme e café com leite" ou "arroz, feijão" viram um alimento por pedaço.
const parts = (text) => text.split(/\s*,\s*|\s+e\s+/i).map((x) => x.trim()).filter(Boolean);

// Digita o nome, escolhe um cadastrado ou segue com um novo; o cadastro acontece ao salvar.
function openFoodSheet(onPick) {
  const usage = foodUsage();
  const foods = all("food").sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name, "pt-BR"));
  let newMode = "weight";

  const s = openSheet(`
    <div class="sheet-head"><button class="btn small" data-close>Cancelar</button><h2>Alimento</h2><button class="btn small primary" data-save>Salvar</button></div>
    <input type="text" id="fs-food" name="food-search-${uid()}" placeholder="Nome do alimento" autocomplete="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" enterkeyhint="next">
    <div class="food-list" id="fs-list"></div>
    <div id="fs-new" hidden>
      <span class="muted small" id="fs-new-label">Alimento novo, será cadastrado ao salvar. Como você mede?</span>
      <div class="chips"><button class="chip" data-mode="unit">Por unidade</button><button class="chip on" data-mode="weight">Por peso (g)</button></div>
      <label class="field" id="fs-uw-wrap" hidden>Peso médio de 1 unidade em gramas (opcional, para somar no total)
        <input type="text" inputmode="decimal" id="fs-uw" placeholder="Ex.: 50"></label>
    </div>
    <label class="field" id="fs-qty-wrap" hidden><span id="fs-qty-label"></span>
      <input type="text" inputmode="decimal" id="fs-qty" enterkeyhint="done"></label>
    <div id="fs-multi" class="fs-multi" hidden></div>
    <p class="notice" id="fs-err" hidden></p>
    <button class="btn primary block" data-save>Salvar alimento</button>`);
  const $ = (sel) => s.querySelector(sel);
  const nameIn = $("#fs-food");

  const find = (name) => { const t = norm(name); return t ? foods.find((f) => norm(f.name) === t) : null; };
  const match = () => find(nameIn.value);
  const draw = () => {
    const list = parts(nameIn.value), multi = list.length > 1;
    // Com vários alimentos, a busca ajuda a completar o último que está sendo digitado.
    const last = /(,|\s+e)\s*$/i.test(nameIn.value) ? "" : list[list.length - 1] || "";
    const term = norm(multi ? last : nameIn.value);
    const found = multi ? find(last) : match();
    const hits = found || (multi && !term) ? [] : foods.filter((f) => norm(f.name).includes(term)).slice(0, term ? 6 : 8);
    $("#fs-list").innerHTML = hits.map((f) => `<button class="food-opt" data-id="${f.id}"><span>${esc(f.name)}</span><span class="muted small">${f.mode === "unit" ? "por unidade" : "por peso"}</span></button>`).join("");
    const newOnes = list.filter((n) => !find(n));
    $("#fs-multi").hidden = !multi;
    $("#fs-new-label").textContent = multi ? "Os alimentos novos serão cadastrados ao salvar. Como você mede?" : "Alimento novo, será cadastrado ao salvar. Como você mede?";
    $("#fs-multi").innerHTML = multi ? `<span class="muted small">Vão entrar ${list.length} alimentos:</span>
      ${list.map((n) => `<span class="fs-part">${esc(n)} <span class="pill">${find(n) ? "cadastrado" : "novo"}</span></span>`).join("")}
      <span class="muted small">Quem é por unidade entra com 1; o peso fica em branco e pode ser editado na refeição.</span>` : "";
    const mode = found && !multi ? found.mode : newMode;
    $("#fs-new").hidden = multi ? !newOnes.length : !term || !!found;
    $("#fs-uw-wrap").hidden = mode !== "unit" || multi;
    $("#fs-qty-wrap").hidden = !term || multi;
    $("#fs-qty-label").textContent = mode === "unit" ? "Quantas unidades? (em branco = 1)" : "Peso em gramas (opcional)";
    $("#fs-qty").placeholder = mode === "unit" ? "Ex.: 2" : "Ex.: 120";
    $("#fs-err").hidden = true;
  };
  draw();
  nameIn.addEventListener("input", draw);
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (nameIn.value.trim()) $("#fs-qty").focus(); } });
  $("#fs-qty").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  setTimeout(() => nameIn.focus(), 50);

  const fail = (msg) => { $("#fs-err").textContent = msg; $("#fs-err").hidden = false; };
  // Um ou mais alimentos novos: cada um passa pela janela de tipo, um de cada vez.
  function addNew(names, data, qtyFor, done) {
    if (!names.length) return done();
    const [name, ...rest] = names;
    groupsSheet(name, (extra) => {
      const id = "food:" + uid();
      put("food", id, { ...data, name, ...extra });
      foods.push(get(id));
      onPick(id, qtyFor(data.mode));
      rateFoods([get(id)]);
      addNew(rest, data, qtyFor, done);
    });
  }

  function save() {
    const name = nameIn.value.trim();
    if (!name) return fail("Digite o nome do alimento.");
    const list = parts(name);
    if (list.length > 1) {
      const qtyFor = (mode) => (mode === "unit" ? 1 : null);
      const fresh = [];
      closeSheet();
      for (const n of list) { const f = find(n); if (f) onPick(f.id, qtyFor(f.mode)); else if (!fresh.some((x) => norm(x) === norm(n))) fresh.push(n); }
      return addNew(fresh, { mode: newMode }, qtyFor, () => { closeSheet(); render(); });
    }
    let f = match();
    const qty = parseNum($("#fs-qty").value) || ((f ? f.mode : newMode) === "unit" ? 1 : 0); // sem quantidade = 1 unidade
    if (f) { closeSheet(); return onPick(f.id, qty || null); }
    const data = { name, mode: newMode };
    const uw = parseNum($("#fs-uw").value);
    if (newMode === "unit" && uw) data.unitWeight = uw;
    groupsSheet(name, (extra) => {
      const id = "food:" + uid();
      put("food", id, { ...data, ...extra });
      closeSheet();
      onPick(id, qty || null);
      rateFoods([get(id)]);
    });
  }

  s.onclick = (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    if (e.target.closest("[data-save]")) return save();
    const mb = e.target.closest("[data-mode]");
    if (mb) {
      newMode = mb.dataset.mode;
      s.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === mb));
      draw(); $("#fs-qty").focus(); return;
    }
    const opt = e.target.closest(".food-opt");
    if (opt) {
      const picked = get(opt.dataset.id).name;
      if (parts(nameIn.value).length > 1) {
        const prefix = nameIn.value.match(/^(.*(?:,|\s+e\s))/i)?.[1] || "";
        nameIn.value = prefix.trimEnd() + " " + picked;
        draw(); nameIn.focus(); return;
      }
      nameIn.value = picked; draw(); $("#fs-qty").focus();
    }
  };
}

/* ---------- Grupos do alimento ---------- */

const groupChips = (selected = []) =>
  `<div class="chips">${FOOD_GROUPS.map((g) => `<button type="button" class="chip ${selected.includes(g) ? "on" : ""}" data-group="${esc(g)}">${esc(g)}</button>`).join("")}</div>`;
const readGroups = (root) => [...root.querySelectorAll("[data-group].on")].map((b) => b.dataset.group);
const groupsText = (f) => (f?.groups || []).join(", ");
const sameGroups = (a, b) => [...a].sort().join() === [...b].sort().join();
const SOURCE_TEXT = { tabela: "pela tabela de referência", ia: "pela IA" };

// Os grupos são "manuais" quando a pessoa escolheu ou corrigiu à mão; esses viram exemplo para a IA.
function manualFlag(groups, suggested, prev) {
  if (suggested) return !sameGroups(groups, suggested);
  if (prev) return sameGroups(groups, prev.groups || []) ? !!prev.groupsManual : true;
  return groups.length > 0;
}

// Sugestão do servidor: tabela de referência primeiro, IA para o resto.
// Vai junto o que a pessoa já classificou à mão, para a IA seguir o mesmo critério.
async function fetchGroups(foods) {
  const asked = new Set(foods.map((f) => norm(f.name)));
  const examples = all("food")
    .filter((f) => f.groupsManual && !asked.has(norm(f.name)))
    .slice(-40)
    .map((f) => ({ name: f.name, prep: f.prep || "", groups: f.groups || [] }));
  const res = await fetch("/api/groups", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + password },
    body: JSON.stringify({ foods: foods.map((f) => ({ name: f.name, prep: f.prep || "" })), examples }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const out = await res.json();
  return { groups: out.groups || {}, source: out.source || {} };
}

// Botão "Automático": marca os chips de `root` e devolve os grupos sugeridos (ou null).
async function autoGroups(btn, root, name, prep) {
  if (!name) { toast("Digite o nome primeiro"); return null; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Pesquisando…";
  let groups = null;
  try {
    const r = await fetchGroups([{ name, prep }]);
    groups = r.groups[name];
    if (!groups) throw new Error("sem resposta");
    root.querySelectorAll("[data-group]").forEach((c) => c.classList.toggle("on", groups.includes(c.dataset.group)));
    const src = root.querySelector("[data-auto-src]");
    if (src) src.textContent = `Classificado ${SOURCE_TEXT[r.source[name]] || ""}${groups.length ? "" : ": nenhum grupo se aplica"}. Confira e ajuste se precisar.`;
  } catch { toast("Não foi possível pesquisar agora"); }
  btn.disabled = false; btn.textContent = label;
  return groups;
}

const prepField = (value = "") => `
  <label class="field">Preparo ou ingredientes (opcional, ajuda o Automático)
    <input type="text" id="prep" value="${esc(value)}" placeholder="Ex.: assado, caseiro, massa de trigo, com queijo"></label>`;

// Janela que aparece ao cadastrar um alimento novo, para marcar os grupos dele (opcional).
// onDone recebe { groups, prep, groupsManual }.
function groupsSheet(name, onDone) {
  const s = openSheet(`
    <div class="sheet-head"><button class="btn small" data-skip>Pular</button><h2>Tipo do alimento</h2><button class="btn small primary" data-save>Salvar</button></div>
    <p class="muted small" style="margin:0">Marque os grupos de <b>${esc(name)}</b>, ou toque em Automático para classificar. Pode marcar mais de um, ou pular.</p>
    ${prepField()}
    <button class="btn" data-auto>✨ Automático</button>
    <span class="muted small" data-auto-src></span>
    ${groupChips()}
    <button class="btn primary block" data-save>Salvar alimento</button>`);
  let suggested = null;
  const prep = () => s.querySelector("#prep").value.trim();
  s.onclick = async (e) => {
    const g = e.target.closest("[data-group]");
    if (g) return g.classList.toggle("on");
    const auto = e.target.closest("[data-auto]");
    if (auto) { suggested = (await autoGroups(auto, s, name, prep())) || suggested; return; }
    if (e.target.closest("[data-skip]")) return onDone({ groups: [], prep: prep(), groupsManual: false });
    if (e.target.closest("[data-save]")) {
      const groups = readGroups(s);
      onDone({ groups, prep: prep(), groupsManual: manualFlag(groups, suggested, null) });
    }
  };
}

/* ---------- Alimentos ---------- */

function viewFoods() {
  setChrome({ title: "Alimentos", tab: "alimentos" });
  const usage = foodUsage();
  const foods = all("food").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  $view.innerHTML = `
    <input type="search" id="foods-q" placeholder="Buscar alimento" autocomplete="off">
    ${foods.length ? `<button class="btn" data-action="suggest-groups">Preencher grupos automaticamente</button>` : ""}
    <div class="card" id="foods-list"></div>
    <button class="btn" data-action="new-food">+ Novo alimento</button>`;
  const draw = () => {
    const term = norm(document.getElementById("foods-q").value);
    const rows = foods.filter((f) => norm(f.name).includes(term));
    document.getElementById("foods-list").innerHTML = rows.length
      ? rows.map((f) => `<button class="food-opt" data-id="${f.id}"><span>${HEALTH[f.health] ? HEALTH[f.health].emoji + " " : ""}${GUT[gutOf(f)] ? GUT[gutOf(f)].emoji + " " : ""}${esc(f.name)}${isTrigger(f) ? ' <span class="pill alert">⚠️ seu gatilho</span>' : ""}<br><span class="muted small">${f.mode === "unit" ? "por unidade" + (f.unitWeight ? ` · ${fmtNum(f.unitWeight)} g cada` : "") : "por peso"}${f.groups?.length ? ` · ${esc(groupsText(f))}` : ""}${f.groupsManual ? " ✓" : ""}</span></span><span class="muted small">${usage[f.id] || 0}×</span></button>`).join("")
      : `<p class="empty">${foods.length ? "Nada encontrado." : "Nenhum alimento cadastrado ainda. Eles também são cadastrados na hora, dentro de uma refeição."}</p>`;
  };
  draw();
  $view.oninput = (e) => { if (e.target.id === "foods-q") draw(); };
  $view.onchange = null;
  $view.onclick = (e) => {
    const opt = e.target.closest(".food-opt");
    if (opt) return editFood(get(opt.dataset.id), usage[opt.dataset.id] || 0);
    if (e.target.closest("[data-action=new-food]")) editFood(null, 0);
    if (e.target.closest("[data-action=suggest-groups]")) suggestGroups();
  };
}

// Sugere grupos para todos os alimentos cadastrados e mostra para revisar.
// Os que a pessoa já corrigiu à mão (✓) ficam de fora.
async function suggestGroups() {
  const all_ = all("food").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const foods = all_.filter((f) => !f.groupsManual);
  const kept = all_.length - foods.length;
  if (!foods.length) return toast("Todos os alimentos já foram conferidos por você");
  const s = openSheet(`
    <div class="sheet-head"><button class="btn small" data-close>Cancelar</button><h2>Grupos</h2><span></span></div>
    <p class="empty">Pesquisando os grupos de ${plural(foods.length, "alimento", "alimentos")}…</p>`);
  s.onclick = (e) => { if (e.target.closest("[data-close]")) closeSheet(); };

  let found, source;
  try {
    ({ groups: found, source } = await fetchGroups(foods));
  } catch {
    if (!s.hidden) { closeSheet(); toast("Não foi possível pesquisar agora. Confira a internet e tente de novo."); }
    return;
  }
  if (s.hidden) return; // cancelado enquanto pesquisava

  const fresh = foods.filter((f) => !(f.groups || []).length && found[f.name]?.length);
  const changed = foods.filter((f) => (f.groups || []).length && found[f.name] && !sameGroups(f.groups, found[f.name]));
  if (!fresh.length && !changed.length) { closeSheet(); return toast("Nenhuma sugestão nova para os seus alimentos"); }

  const srcTag = (f) => `<span class="pill">${source[f.name] === "tabela" ? "tabela" : "IA"}</span>`;
  const sugChips = (f) => found[f.name].map((g) => `<button type="button" class="chip on" data-group="${esc(g)}">${esc(g)}</button>`).join("");
  openSheet(`
    <div class="sheet-head"><button class="btn small" data-close>Cancelar</button><h2>Revisar grupos</h2><button class="btn small primary" data-save>Aplicar</button></div>
    ${fresh.length ? `<span class="q-label">Sem grupo · ${plural(fresh.length, "alimento será preenchido", "alimentos serão preenchidos")}</span>
      <span class="muted small">Toque num grupo para tirar.</span>
      ${fresh.map((f) => `<div class="sg-item" data-id="${f.id}"><span><b>${esc(f.name)}</b> ${srcTag(f)}</span><div class="chips">${sugChips(f)}</div></div>`).join("")}` : ""}
    ${changed.length ? `<span class="q-label">Já têm grupo · quer alterar?</span>
      ${changed.map((f) => `<div class="sg-item" data-id="${f.id}" data-changed>
        <span><b>${esc(f.name)}</b> ${srcTag(f)}</span>
        <span class="small">Atual: ${esc(groupsText(f))}</span>
        <span class="small">Sugerido: ${esc(found[f.name].join(", ") || "nenhum grupo")}</span>
        <div class="chips"><button type="button" class="chip on" data-keep="1">Manter atual</button><button type="button" class="chip" data-keep="0">Usar sugerido</button></div>
      </div>`).join("")}` : ""}
    <span class="muted small">"tabela" vem da tabela de referência do app; "IA" é sugestão automática, confira antes de aplicar.${kept ? ` ${plural(kept, "alimento corrigido por você ficou", "alimentos corrigidos por você ficaram")} de fora.` : ""}</span>
    <button class="btn primary block" data-save>Aplicar</button>`);

  const sheet = document.getElementById("sheet");
  sheet.onclick = (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const g = e.target.closest("[data-group]");
    if (g) return g.classList.toggle("on");
    const k = e.target.closest("[data-keep]");
    if (k) return k.parentElement.querySelectorAll("[data-keep]").forEach((b) => b.classList.toggle("on", b === k));
    if (!e.target.closest("[data-save]")) return;
    let n = 0;
    for (const el of sheet.querySelectorAll(".sg-item")) {
      const f = get(el.dataset.id);
      if (!f) continue;
      let groups;
      if (el.dataset.changed != null) {
        if (el.querySelector("[data-keep].on")?.dataset.keep !== "0") continue;
        groups = found[f.name];
      } else groups = readGroups(el);
      const { id, ...data } = f;
      put("food", id, { ...data, groups, groupsManual: manualFlag(groups, found[f.name], null) });
      n++;
    }
    closeSheet(); render();
    toast(n ? `${plural(n, "alimento atualizado", "alimentos atualizados")}` : "Nada foi alterado");
  };
}

function editFood(food, uses) {
  let mode = food?.mode || "weight";
  const s = openSheet(`
    <div class="sheet-head"><button class="btn small" data-close>Cancelar</button><h2>${food ? "Editar alimento" : "Novo alimento"}</h2><button class="btn small primary" data-save>Salvar</button></div>
    <label class="field">Nome<input type="text" id="ef-food" name="food-name-x" autocomplete="off" value="${esc(food?.name)}"></label>
    <div class="chips"><button class="chip ${mode === "unit" ? "on" : ""}" data-mode="unit">Por unidade</button><button class="chip ${mode === "weight" ? "on" : ""}" data-mode="weight">Por peso (g)</button></div>
    <label class="field" id="ef-uw-wrap" ${mode === "unit" ? "" : "hidden"}>Peso médio de 1 unidade em gramas (opcional)
      <input type="text" inputmode="decimal" id="ef-uw" value="${food?.unitWeight ? fmtNum(food.unitWeight) : ""}"></label>
    ${prepField(food?.prep)}
    <div class="spread"><span class="muted small">Grupos (opcional, pode marcar mais de um)</span><button class="btn small" data-auto>✨ Automático</button></div>
    <span class="muted small" data-auto-src>${food?.groupsManual ? "✓ Grupos conferidos por você: servem de exemplo para o Automático." : ""}</span>
    ${groupChips(food?.groups)}
    <span class="muted small">Nota de saúde (para a pontuação)${HEALTH[food?.health] && food.healthSource ? `: definida ${HEALTH_SOURCE[food.healthSource] || ""}` : ""}</span>
    <div class="chips">${Object.entries(HEALTH).map(([k, h]) => `<button type="button" class="chip ${food?.health === k ? "on" : ""}" data-health="${k}">${h.emoji} ${h.label}</button>`).join("")}</div>
    <span class="muted small">Barriga (intestino irritado)${GUT[food?.gut] && food.gutSource ? `: definida ${GUT_SOURCE[food.gutSource] || ""}` : ""}</span>
    ${isTrigger(food) ? `<p class="notice" style="margin:0">⚠️ Pelos seus registros, ${esc(food.name)} vem antes de sintoma bem mais que a média, então conta como 🔴 seu gatilho.</p>` : ""}
    <div class="chips">${Object.entries(GUT).map(([k, h]) => `<button type="button" class="chip ${food?.gut === k ? "on" : ""}" data-gut="${k}">${h.emoji} ${h.label}</button>`).join("")}</div>
    <span class="muted small">Motivos</span>
    <div class="chips">${Object.entries(WHY).map(([k, [e, l]]) => `<button type="button" class="chip ${(food?.gutWhy || []).includes(k) ? "on" : ""}" data-why="${k}">${e} ${l}</button>`).join("")}</div>
    ${food ? `<div class="chips"><button type="button" class="chip ${food.gutOkForMe ? "on" : ""}" data-okforme>👍 Vai bem comigo</button></div>
    <span class="muted small">Marque se você come sempre sem sintoma: o alimento passa a contar como 🟢 para você.</span>` : ""}
    ${food && uses ? `<p class="muted small">Usado em ${plural(uses, "refeição", "refeições")}. Mudar a medida muda como as quantidades já registradas são lidas.</p>` : ""}
    <p class="notice" id="ef-err" hidden></p>
    <button class="btn primary block" data-save>Salvar</button>
    ${food ? `<button class="btn danger block" id="ef-del">Excluir alimento</button>` : ""}`);
  let confirmDel = false, suggested = null;
  s.onclick = async (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const g = e.target.closest("[data-group]");
    if (g) return g.classList.toggle("on");
    const hb = e.target.closest("[data-health]");
    if (hb) return s.querySelectorAll("[data-health]").forEach((b) => b.classList.toggle("on", b === hb && !b.classList.contains("on")));
    const gb = e.target.closest("[data-gut]");
    if (gb) return s.querySelectorAll("[data-gut]").forEach((b) => b.classList.toggle("on", b === gb && !b.classList.contains("on")));
    const wb = e.target.closest("[data-why],[data-okforme]");
    if (wb) return wb.classList.toggle("on");
    const auto = e.target.closest("[data-auto]");
    if (auto) {
      suggested = (await autoGroups(auto, s, s.querySelector("#ef-food").value.trim(), s.querySelector("#prep").value.trim())) || suggested;
      return;
    }
    const err = s.querySelector("#ef-err");
    const mb = e.target.closest("[data-mode]");
    if (mb) {
      mode = mb.dataset.mode;
      s.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === mb));
      s.querySelector("#ef-uw-wrap").hidden = mode !== "unit";
      return;
    }
    if (e.target.closest("[data-save]")) {
      const name = s.querySelector("#ef-food").value.trim();
      if (!name) { err.textContent = "Digite o nome."; err.hidden = false; return; }
      const groups = readGroups(s);
      const data = { name, mode, groups, prep: s.querySelector("#prep").value.trim(), groupsManual: manualFlag(groups, suggested, food) };
      const uw = parseNum(s.querySelector("#ef-uw").value);
      if (mode === "unit" && uw) data.unitWeight = uw;
      const health = s.querySelector("[data-health].on")?.dataset.health;
      if (health) Object.assign(data, health === food?.health
        ? { health, healthSource: food.healthSource, healthManual: !!food.healthManual }
        : { health, healthSource: "manual", healthManual: true });
      const gut = s.querySelector("[data-gut].on")?.dataset.gut;
      const why = [...s.querySelectorAll("[data-why].on")].map((b) => b.dataset.why);
      if (gut) {
        const same = gut === food?.gut && [...why].sort().join() === [...(food?.gutWhy || [])].sort().join();
        Object.assign(data, { gut, gutWhy: why }, same
          ? { gutSource: food.gutSource, gutManual: !!food.gutManual }
          : { gutSource: "manual", gutManual: true });
      }
      if (s.querySelector("[data-okforme].on")) data.gutOkForMe = true;
      const id = food?.id || "food:" + uid();
      put("food", id, data);
      closeSheet(); render(); toast("Alimento salvo");
      if (!health || !gut) rateFoods([get(id)]);
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

const INT_W = { leve: 1, moderado: 2, forte: 3 };
const intText = (w) => (w < 1.5 ? "leve" : w < 2.5 ? "moderada" : "forte");
const INT_LABEL = Object.fromEntries(INTENSITIES);
const GAP_BUCKETS = [[0, 1, "até 1h"], [1, 2, "1 a 2h"], [2, 4, "2 a 4h"], [4, Infinity, "mais de 4h"]];
const bucketize = (gaps) => GAP_BUCKETS.map(([a, b, label]) => ({ label, n: gaps.filter((g) => g >= a * 3600000 && g < b * 3600000).length }));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctText = (x) => `${Math.round(x * 100)}%`;
const FACTORS = [
  ["sleep", "Dormiu bem?", [["sim", "Sim"], ["nao", "Não"]]],
  ["exercise", "Atividade física", [["sim", "Sim"], ["nao", "Não"]]],
  ["mood", "Emocional", [["bem", "Bem"], ["regular", "Mais ou menos"], ["mal", "Mal"]]],
];

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
  const after = (t) => symptoms.filter((x) => x.t - t >= lo && x.t - t <= hi);

  // Cada refeição com horário: sintomas na janela depois dela e quantidade de cada alimento.
  const mealInfo = timedMeals.map((m) => {
    const t = at(m.date, m.time);
    const qty = {};
    for (const it of m.items || []) if (it.qty) qty[it.foodId] = (qty[it.foodId] || 0) + it.qty;
    return { m, t, hits: after(t), qty, foodIds: [...new Set((m.items || []).map((i) => i.foodId))] };
  });
  // Linha de base: quanto das refeições em geral vem seguida de sintoma.
  const base = mealInfo.length ? mealInfo.filter((x) => x.hits.length).length / mealInfo.length : 0;

  // Estatística de um alimento, grupo ou par (cada um conta uma vez por refeição).
  const newStat = (key) => ({ key, eaten: 0, before: 0, gaps: [], types: {}, ints: [], qtyHit: [], qtyMiss: [] });
  const add = (s, x, qty) => {
    s.eaten++;
    if (x.hits.length) {
      s.before++;
      s.gaps.push(Math.min(...x.hits.map((h) => h.t - x.t)));
      for (const h of x.hits) {
        s.types[h.type] = (s.types[h.type] || 0) + 1;
        if (INT_W[h.intensity]) s.ints.push(INT_W[h.intensity]);
      }
    }
    if (qty) (x.hits.length ? s.qtyHit : s.qtyMiss).push(qty);
  };
  const finish = (s) => ({
    ...s, pct: s.before / s.eaten, lift: base ? s.before / s.eaten / base : null,
    gap: avg(s.gaps), hist: bucketize(s.gaps), intensity: avg(s.ints),
  });
  // Mais suspeitos primeiro; quem tem poucos dados (menos de 3 vezes) vai para o fim.
  const order = (a, b) => (b.eaten >= 3) - (a.eaten >= 3) || b.pct - a.pct || b.before - a.before || b.eaten - a.eaten;

  const foods = {}, groups = {}, pairs = {}, reasons = {};
  for (const x of mealInfo) {
    const gset = new Set(), wset = new Set();
    for (const id of x.foodIds) {
      add((foods[id] ||= newStat(id)), x, x.qty[id]);
      for (const g of get(id)?.groups || []) gset.add(g);
      for (const w of get(id)?.gutWhy || []) if (WHY[w] && w !== "soluvel") wset.add(w);
    }
    for (const g of gset) add((groups[g] ||= newStat(g)), x);
    for (const w of wset) add((reasons[w] ||= newStat(w)), x);
    const ids = [...x.foodIds].sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) add((pairs[ids[i] + "|" + ids[j]] ||= newStat([ids[i], ids[j]])), x);
  }
  const ranking = Object.values(foods).map(finish).sort(order);
  const groupRanking = Object.values(groups).map(finish).sort(order);
  const reasonRanking = Object.values(reasons).map(finish).sort(order);
  // Pares comidos juntos pelo menos 2 vezes e que vêm antes de sintoma mais que a média.
  const pairRanking = Object.values(pairs).map(finish)
    .filter((p) => p.eaten >= 2 && p.before && p.pct > base)
    .sort((a, b) => b.pct - a.pct || b.before - a.before).slice(0, 8);

  // Para cada sintoma, o que foi comido na janela antes dele (mais recente primeiro).
  const perSymptom = symptoms.map((s) => ({
    ...s,
    foods: mealInfo
      .filter((x) => s.t - x.t >= lo && s.t - x.t <= hi)
      .sort((a, b) => b.t - a.t)
      .flatMap((x) => x.foodIds.map((foodId) => ({ foodId, gap: s.t - x.t, meal: x.m }))),
  }));
  const typeCount = {}, intCount = {};
  for (const s of symptoms) {
    typeCount[s.type] = (typeCount[s.type] || 0) + 1;
    intCount[s.intensity || "sem"] = (intCount[s.intensity || "sem"] || 0) + 1;
  }
  const nearestGaps = perSymptom.filter((s) => s.foods.length).map((s) => s.foods[0].gap);

  // Sono, exercício e humor: em quantos dias com cada resposta houve sintoma.
  const dates = [...new Set([...meals.map((m) => m.date), ...days.map((d) => d.date)])];
  const dayObjs = dates.map(getDay);
  const factors = FACTORS.map(([field, label, opts]) => ({
    label,
    rows: opts.map(([v, text]) => {
      const ds = dayObjs.filter((d) => d[field] === v);
      return { text, n: ds.length, sym: ds.filter(hasSymptoms).length };
    }),
  })).filter((f) => f.rows.some((r) => r.n));

  return {
    ranking, groupRanking, reasonRanking, pairRanking, perSymptom, symptoms, base, typeCount, intCount,
    gapHist: bucketize(nearestGaps), factors,
    mealCount: meals.length, timedMealCount: timedMeals.length, untimedMeals: meals.length - timedMeals.length,
    symptomDays: new Set(symptoms.map((s) => s.date)).size + giNoTime, giNoTime,
    winText: `${fmtDur(lo)} a ${fmtDur(hi)} antes`,
  };
}

// Dias com sintoma por semana (8 semanas até `endDate`) e sequências sem sintoma.
function evolution(endDate, weeks = 8) {
  const dayRec = {};
  for (const d of all("day")) dayRec[d.date] = d;
  const logged = new Set([...all("meal").map((m) => m.date), ...Object.keys(dayRec)]);
  const symDay = (s) => !!dayRec[s] && hasSymptoms(dayRec[s]);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const wEnd = addDays(endDate, -7 * w), wStart = addDays(wEnd, -6);
    let sym = 0, n = 0;
    for (let i = 0; i < 7; i++) { const s = addDays(wStart, i); if (logged.has(s)) n++; if (symDay(s)) sym++; }
    out.push({ wStart, wEnd, sym, logged: n });
  }
  let streak = 0;
  let s = logged.has(endDate) ? endDate : addDays(endDate, -1); // o dia de hoje pode ainda não ter registro
  for (; logged.has(s) && !symDay(s); s = addDays(s, -1)) streak++;
  let best = 0, run = 0;
  for (let i = 89; i >= 0; i--) {
    const d = addDays(endDate, -i);
    if (logged.has(d) && !symDay(d)) best = Math.max(best, ++run); else run = 0;
  }
  return { weeks: out, streak, best };
}

/* Gráficos simples em HTML (uma série cada; o valor fica escrito ao lado ou acima). */

function vbars(items) {
  const m = Math.max(1, ...items.map((i) => i.value));
  return `<div class="vbars">${items.map((i) => `
    <button type="button" class="vbar" data-tip="${esc(i.tip)}" aria-label="${esc(i.tip)}">
      <span class="vbar-val">${i.value}</span>
      <span class="vbar-track"><span class="vbar-fill" style="height:${Math.round((i.value / m) * 100)}%"></span></span>
      <span class="vbar-x">${esc(i.label)}</span></button>`).join("")}</div>`;
}

function hbars(items, { max, tone = "" } = {}) {
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar"><span class="hbar-label">${esc(i.label)}</span>
      <span class="bar ${tone}"><span style="width:${Math.round((i.value / m) * 100)}%"></span></span>
      <span class="hbar-val">${esc(i.text ?? String(i.value))}</span></div>`).join("")}</div>`;
}

const liftPill = (x) => (x.lift == null ? "" : x.lift >= 1.5 && x.eaten >= 3
  ? `<span class="pill alert">${fmtNum(x.lift)}× a média</span>`
  : `<span class="pill">${fmtNum(x.lift)}× a média</span>`);
const typesText = (types) => Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(", ");
const portionText = (x, f) => {
  const u = f?.mode === "unit" ? "un." : "g";
  const parts = [];
  if (x.qtyHit.length) parts.push(`com sintoma ${fmtNum(avg(x.qtyHit))} ${u}`);
  if (x.qtyMiss.length) parts.push(`sem sintoma ${fmtNum(avg(x.qtyMiss))} ${u}`);
  return parts.join(" · ");
};
const typicalGap = (x) => { const b = [...x.hist].sort((p, q) => q.n - p.n)[0]; return b && b.n ? b.label : ""; };

function foodRow(x) {
  const f = get(x.foodId ?? x.key);
  const portion = portionText(x, f);
  return `<details class="rank-row">
    <summary>
      <div class="spread"><span class="rank-name">${esc(foodName(x.key))}</span>
        <span class="num ${x.pct >= 0.5 && x.eaten >= 3 ? "pill alert" : "muted"}">${pctText(x.pct)}</span></div>
      <div class="bar"><span style="width:${pctText(x.pct)}"></span></div>
      <span class="small muted">Comido ${x.eaten}×, ${x.before}× antes de sintoma ${liftPill(x)}${x.eaten < 3 ? ' <span class="pill">poucos dados</span>' : ""}</span>
    </summary>
    <div class="rank-more">
      ${f?.groups?.length ? `<div><b>Grupos:</b> ${esc(groupsText(f))}</div>` : ""}
      ${x.lift != null ? `<div><b>Comparado à média:</b> veio antes de sintoma em ${pctText(x.pct)} das vezes; nas suas refeições em geral isso acontece em ${pctText(x.pct / x.lift)}.</div>` : ""}
      ${portion ? `<div><b>Porção média:</b> ${esc(portion)}</div>` : ""}
      ${x.before ? `<div><b>Sintomas que vieram depois:</b> ${esc(typesText(x.types))}${x.intensity ? ` · intensidade média ${intText(x.intensity)}` : ""}</div>
      <div><b>Tempo até o sintoma</b>${x.gap != null ? ` (média ${fmtDur(x.gap)})` : ""}</div>
      ${hbars(x.hist.map((b) => ({ label: b.label, value: b.n, text: b.n ? `${b.n}×` : "" })), { tone: "accent" })}` : ""}
    </div>
  </details>`;
}

function viewAnalysis() {
  setChrome({ title: "Análise", tab: "analise" });
  const end = analysis.end || today();
  const n = Number(analysis.days);
  const start = addDays(end, -(n - 1));
  const r = analyze(start, end);
  const ev = evolution(end);
  const rangeText = n === 1 ? fmtLong(end) : `${fmtShort(start)} a ${fmtShort(end)}`;

  const warn = [];
  if (r.untimedMeals) warn.push(`${plural(r.untimedMeals, "refeição sem horário ficou", "refeições sem horário ficaram")} de fora.`);
  if (r.giNoTime) warn.push(`${plural(r.giNoTime, "dia com sintoma sem horário ficou", "dias com sintoma sem horário ficaram")} de fora.`);

  const hasData = r.ranking.length && r.symptoms.length;
  const table = hasData
    ? `<div class="rank">${r.ranking.map((x) => foodRow({ ...x, foodId: x.key })).join("")}</div>`
    : `<p class="empty">${r.symptoms.length ? "Nenhuma refeição com horário neste período." : "Nenhum sintoma com horário neste período."}</p>`;

  const groupsCard = !hasData ? "" : r.groupRanking.length ? `
    <div class="card"><h2>Grupos de alimentos</h2>
      <span class="muted small">Refeições com algum alimento do grupo e quantas vieram antes de sintoma.</span>
      <div class="rank">${r.groupRanking.map((g) => `
        <div class="rank-row">
          <div class="spread"><span class="rank-name">${esc(g.key)}</span><span class="num ${g.pct >= 0.5 && g.eaten >= 3 ? "pill alert" : "muted"}">${pctText(g.pct)}</span></div>
          <div class="bar"><span style="width:${pctText(g.pct)}"></span></div>
          <span class="small muted">Em ${plural(g.eaten, "refeição", "refeições")}, ${g.before}× antes de sintoma ${liftPill(g)}${g.before ? ` · ${esc(typesText(g.types))}` : ""}</span>
        </div>`).join("")}</div></div>`
    : `<div class="card"><h2>Grupos de alimentos</h2><p class="muted small">Marque os grupos dos alimentos (fritura, FODMAP, lactose…) na aba Alimentos para ver a análise por grupo.</p></div>`;

  const reasonsCard = !hasData || !r.reasonRanking.length ? "" : `
    <div class="card"><h2>Motivos da barriga</h2>
      <span class="muted small">Refeições com algum alimento de cada motivo (intestino irritado) e quantas vieram antes de sintoma.</span>
      <div class="rank">${r.reasonRanking.map((g) => `
        <div class="rank-row">
          <div class="spread"><span class="rank-name">${WHY[g.key][0]} ${esc(WHY[g.key][1])}</span><span class="num ${g.pct >= 0.5 && g.eaten >= 3 ? "pill alert" : "muted"}">${pctText(g.pct)}</span></div>
          <div class="bar"><span style="width:${pctText(g.pct)}"></span></div>
          <span class="small muted">Em ${plural(g.eaten, "refeição", "refeições")}, ${g.before}× antes de sintoma ${liftPill(g)}${g.before ? ` · ${esc(typesText(g.types))}` : ""}</span>
        </div>`).join("")}</div></div>`;

  const pairsCard = r.pairRanking.length ? `
    <div class="card"><h2>Combinações</h2>
      <span class="muted small">Alimentos comidos juntos que vêm antes de sintoma mais do que a média (${pctText(r.base)}).</span>
      ${r.pairRanking.map((p) => `<div class="rank-row"><div class="spread"><span class="rank-name">${esc(foodName(p.key[0]))} + ${esc(foodName(p.key[1]))}</span><span class="num muted">${pctText(p.pct)}</span></div>
        <span class="small muted">Juntos ${p.eaten}×, ${p.before}× antes de sintoma ${liftPill(p)}</span></div>`).join("")}
    </div>` : "";

  const typeItems = Object.entries(r.typeCount).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ label: t, value: c }));
  const intItems = [...INTENSITIES, ["sem", "Não informada"]].filter(([v]) => r.intCount[v]).map(([v, label]) => ({ label, value: r.intCount[v] }));
  const symptomsCard = r.symptoms.length ? `
    <div class="card"><h2>Sintomas do período</h2>
      ${hbars(typeItems)}
      <span class="q-label small">Intensidade</span>
      ${hbars(intItems)}
      ${r.gapHist.some((b) => b.n) ? `<span class="q-label small">Tempo entre a última refeição e o sintoma</span>
      ${hbars(r.gapHist.map((b) => ({ label: b.label, value: b.n })), { tone: "accent" })}` : ""}
    </div>` : "";

  const factorsCard = r.factors.length ? `
    <div class="card"><h2>Outros fatores do dia</h2>
      <span class="muted small">Em quantos dias com cada resposta houve sintoma.</span>
      ${r.factors.map((f) => `<span class="q-label small">${esc(f.label)}</span>
        ${hbars(f.rows.filter((x) => x.n).map((x) => ({ label: x.text, value: x.sym / x.n, text: `${x.sym} de ${plural(x.n, "dia", "dias")}` })), { max: 1 })}`).join("")}
    </div>` : "";

  const evCard = `
    <div class="card"><h2>Evolução</h2>
      <span class="muted small">Dias com sintoma em cada semana (8 semanas até ${esc(fmtShort(end))}). Toque numa barra para ver detalhes.</span>
      ${vbars(ev.weeks.map((w) => ({ label: fmtShort(w.wEnd).replace(/ de /, " "), value: w.sym, tip: `${fmtShort(w.wStart)} a ${fmtShort(w.wEnd)}: ${plural(w.sym, "dia", "dias")} com sintoma, ${plural(w.logged, "dia registrado", "dias registrados")}` })))}
      <div class="stats two">
        <div class="stat"><b>${ev.streak}</b><span>${ev.streak === 1 ? "dia" : "dias"} seguidos sem sintoma agora</span></div>
        <div class="stat"><b>${ev.best}</b><span>maior sequência nos últimos 90 dias</span></div>
      </div>
    </div>`;

  const perSymptom = r.perSymptom.length ? r.perSymptom.map((s) => `
    <div class="tl alert">
      <span class="tl-time">${esc(s.time)}</span>
      <span><span class="tl-what">${esc(s.type)}</span>${s.intensity ? ` <span class="pill alert">${esc(INT_LABEL[s.intensity])}</span>` : ""}${n > 1 ? ` <span class="muted small">${esc(fmtShort(s.date))}</span>` : ""}<br>
      <span class="small muted">${s.foods.length ? s.foods.map((f) => `${esc(foodName(f.foodId))} (${fmtDur(f.gap)} antes)`).join(", ") : "Nada registrado na janela antes deste sintoma."}</span></span>
    </div>`).join("") : "";

  let dayTimeline = "";
  if (n === 1) {
    const events = [
      ...mealsOn(end).filter((m) => m.time).map((m) => ({ time: m.time, html: `<span class="tl-what">${esc(m.name)}</span><br><span class="small muted">${(m.items || []).map((i) => esc(foodName(i.foodId))).join(", ") || "sem alimentos"}</span>` })),
      ...r.symptoms.map((s) => ({ time: s.time, alert: true, html: `<span class="tl-what">${esc(s.type)}</span>${s.intensity ? ` <span class="pill alert">${esc(INT_LABEL[s.intensity])}</span>` : ""}` })),
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
    ${r.timedMealCount && r.symptoms.length ? `<p class="muted small" style="margin:0">Em média, ${pctText(r.base)} das suas refeições vieram antes de um sintoma. Alimentos bem acima disso são os mais suspeitos.</p>` : ""}
    ${warn.length ? `<p class="notice">${warn.join(" ")}</p>` : ""}
    ${dayTimeline}
    <div class="card">
      <h2>Alimentos suspeitos</h2>
      <span class="muted small">Toque num alimento para ver porção, sintomas e tempo até o sintoma.</span>
      ${table}
    </div>
    ${groupsCard}
    ${reasonsCard}
    ${pairsCard}
    ${symptomsCard}
    ${factorsCard}
    ${evCard}
    ${perSymptom ? `<div class="card"><h2>Cada sintoma e o que veio antes</h2><div class="timeline">${perSymptom}</div></div>` : ""}
    <div class="card">
      <a class="btn primary block" href="#/relatorio" style="text-align:center;text-decoration:none">Relatório para a nutricionista</a>
      <button class="btn" data-action="copy">Copiar resumo em texto</button>
      <span class="muted small">A análise mostra coincidências no tempo, não um diagnóstico.</span>
    </div>`;

  $view.oninput = null;
  $view.onchange = (e) => { if (e.target.id === "an-end") { analysis.end = e.target.value || null; render(); } };
  $view.onclick = async (e) => {
    const bar = e.target.closest(".vbar");
    if (bar) return toast(bar.dataset.tip);
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "chip") { analysis.days = el.dataset.value; LS.set("da_period", analysis.days); render(); }
    if (el.dataset.action === "copy") {
      try { await navigator.clipboard.writeText(summaryText(r, rangeText)); toast("Resumo copiado"); }
      catch { toast("Não foi possível copiar"); }
    }
  };
}

function summaryText(r, rangeText) {
  const lines = [`Diário alimentar · ${rangeText}`, `Janela: ${r.winText} do sintoma`, `${r.mealCount} refeições, ${r.symptoms.length} sintomas com horário`, `Média: ${pctText(r.base)} das refeições antes de sintoma`, ""];
  lines.push("Alimentos:");
  for (const x of r.ranking.filter((x) => x.before)) lines.push(`- ${foodName(x.key)}: comido ${x.eaten}x, ${x.before}x antes de sintoma (${pctText(x.pct)}${x.lift != null ? `, ${fmtNum(x.lift)}x a média` : ""})${typicalGap(x) ? `, geralmente ${typicalGap(x)} depois` : ""}`);
  if (r.groupRanking.length) {
    lines.push("", "Grupos:");
    for (const g of r.groupRanking) lines.push(`- ${g.key}: ${g.eaten} refeições, ${g.before}x antes de sintoma (${pctText(g.pct)})`);
  }
  if (r.reasonRanking.length) {
    lines.push("", "Motivos da barriga:");
    for (const g of r.reasonRanking) lines.push(`- ${WHY[g.key][1]}: ${g.eaten} refeições, ${g.before}x antes de sintoma (${pctText(g.pct)})`);
  }
  const mine = all("food").filter(isTrigger);
  if (mine.length) lines.push("", "Gatilhos pessoais: " + mine.map((f) => f.name).join(", "));
  if (r.pairRanking.length) {
    lines.push("", "Combinações:");
    for (const p of r.pairRanking) lines.push(`- ${foodName(p.key[0])} + ${foodName(p.key[1])}: juntos ${p.eaten}x, ${p.before}x antes de sintoma`);
  }
  lines.push("", "Sintomas:");
  for (const s of r.perSymptom) lines.push(`- ${fmtShort(s.date)} ${s.time} ${s.type}${s.intensity ? ` (${INT_LABEL[s.intensity].toLowerCase()})` : ""}: ${[...new Set(s.foods.map((f) => foodName(f.foodId)))].join(", ") || "nada antes"}`);
  return lines.join("\n");
}

/* ---------- Relatório para a nutricionista (para imprimir ou salvar em PDF) ---------- */

function viewReport() {
  setChrome({ title: "Relatório", back: "#/analise", tab: "analise" });
  const end = analysis.end || today();
  const n = Number(analysis.days);
  const start = addDays(end, -(n - 1));
  const r = analyze(start, end);
  const ev = evolution(end);
  const rangeText = n === 1 ? fmtLong(end) : `${fmtShort(start)} a ${fmtShort(end)}`;
  const suspects = r.ranking.filter((x) => x.before);

  const mealDays = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const ms = mealsOn(d), day = getDay(d);
    if (ms.length || hasSymptoms(day)) mealDays.push({ d, ms, day });
  }

  $view.innerHTML = `
    <div class="no-print row">
      <button class="btn primary" data-action="print">Imprimir ou salvar PDF</button>
      <button class="btn" data-action="copy">Copiar em texto</button>
    </div>
    <p class="muted small no-print" style="margin:0">No iPhone: toque em Imprimir, depois em Compartilhar para salvar como PDF ou enviar.</p>
    <article class="report card">
      <header>
        <h1>Diário alimentar</h1>
        <p class="muted">${esc(cap(rangeText))} · gerado em ${esc(fmtShort(today()))}<br>
          Janela da análise: ${esc(r.winText)} do sintoma</p>
      </header>

      <section><h2>Resumo</h2>
        <ul>
          <li>${plural(r.mealCount, "refeição registrada", "refeições registradas")}, ${plural(r.symptoms.length, "sintoma com horário", "sintomas com horário")}, ${plural(r.symptomDays, "dia com sintoma", "dias com sintoma")}.</li>
          ${r.timedMealCount && r.symptoms.length ? `<li>Em média, ${pctText(r.base)} das refeições vieram antes de um sintoma.</li>` : ""}
          ${Object.keys(r.typeCount).length ? `<li>Sintomas: ${esc(typesText(r.typeCount))}.</li>` : ""}
          <li>Sequência atual sem sintomas: ${plural(ev.streak, "dia", "dias")} (maior nos últimos 90 dias: ${ev.best}).</li>
        </ul>
      </section>

      ${suspects.length ? `<section><h2>Alimentos que vieram antes de sintomas</h2>
        ${suspects.map((x) => `<div class="report-item">
          <p><b>${esc(foodName(x.key))}</b>${get(x.key)?.groups?.length ? ` <span class="muted">(${esc(groupsText(get(x.key)))})</span>` : ""}</p>
          <p>Comido ${x.eaten}×, ${x.before}× antes de sintoma (${pctText(x.pct)})${x.lift != null ? `, ${fmtNum(x.lift)}× a média` : ""}${typicalGap(x) ? ` · geralmente ${esc(typicalGap(x))} depois` : ""}</p>
          <p class="muted">${esc(typesText(x.types))}${x.intensity ? ` · intensidade média ${intText(x.intensity)}` : ""}${portionText(x, get(x.key)) ? ` · porção ${esc(portionText(x, get(x.key)))}` : ""}</p>
        </div>`).join("")}</section>` : ""}

      ${r.groupRanking.length ? `<section><h2>Por grupo de alimento</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Grupo</th><th class="n">Refeições</th><th class="n">Antes de sintoma</th><th class="n">vs. média</th></tr></thead>
          <tbody>${r.groupRanking.map((g) => `<tr><td>${esc(g.key)}</td><td class="n">${g.eaten}</td><td class="n">${g.before}× (${pctText(g.pct)})</td><td class="n">${g.lift != null ? fmtNum(g.lift) + "×" : "–"}</td></tr>`).join("")}</tbody>
        </table></div></section>` : ""}

      ${r.reasonRanking.length ? `<section><h2>Motivos da barriga (intestino irritado)</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Motivo</th><th class="n">Refeições</th><th class="n">Antes de sintoma</th><th class="n">vs. média</th></tr></thead>
          <tbody>${r.reasonRanking.map((g) => `<tr><td>${WHY[g.key][0]} ${esc(WHY[g.key][1])}</td><td class="n">${g.eaten}</td><td class="n">${g.before}× (${pctText(g.pct)})</td><td class="n">${g.lift != null ? fmtNum(g.lift) + "×" : "–"}</td></tr>`).join("")}</tbody>
        </table></div></section>` : ""}
      ${(() => { const mine = all("food").filter(isTrigger); return mine.length ? `<section><h2>Gatilhos pessoais (últimos 60 dias)</h2>
        <p>${mine.map((f) => `${esc(f.name)}${whyText(f) ? ` (${esc(whyText(f))})` : ""}`).join("; ")}</p></section>` : ""; })()}

      ${r.pairRanking.length ? `<section><h2>Combinações</h2><ul>
        ${r.pairRanking.map((p) => `<li>${esc(foodName(p.key[0]))} + ${esc(foodName(p.key[1]))}: juntos ${p.eaten}×, ${p.before}× antes de sintoma (${pctText(p.pct)})</li>`).join("")}</ul></section>` : ""}

      ${r.factors.length ? `<section><h2>Outros fatores</h2><ul>
        ${r.factors.map((f) => `<li>${esc(f.label)} ${f.rows.filter((x) => x.n).map((x) => `${esc(x.text)}: sintoma em ${x.sym} de ${plural(x.n, "dia", "dias")}`).join(" · ")}</li>`).join("")}</ul></section>` : ""}

      ${r.perSymptom.length ? `<section><h2>Sintomas e o que veio antes</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Quando</th><th>Sintoma</th><th>Comido antes</th></tr></thead>
          <tbody>${r.perSymptom.map((s) => `<tr><td class="nowrap">${esc(fmtShort(s.date))} ${esc(s.time)}</td><td>${esc(s.type)}${s.intensity ? `<br><span class="muted small">${esc(INT_LABEL[s.intensity])}</span>` : ""}</td>
            <td>${s.foods.length ? s.foods.map((f) => `${esc(foodName(f.foodId))} (${fmtDur(f.gap)})`).join(", ") : "–"}</td></tr>`).join("")}</tbody>
        </table></div></section>` : ""}

      ${mealDays.length ? `<section><h2>Registro do período</h2>
        ${mealDays.map(({ d, ms, day }) => `<div class="report-day"><h3>${esc(cap(fmtLong(d)))}${hasSymptoms(day) ? ' <span class="pill alert">sintoma</span>' : ""}</h3>
          ${ms.map((m) => `<p><b>${esc(m.time || "--:--")} ${esc(m.name || "Refeição")}</b> · ${(m.items || []).map((it) => esc(`${foodName(it.foodId)} ${qtyText(it, get(it.foodId))}`.trim())).join(", ") || "sem alimentos"}${m.totalWeight || mealTotals(m).grams ? ` <span class="muted">(${esc(totalText(m))})</span>` : ""}</p>`).join("")}
          ${(day.symptoms || []).filter((s) => s.time).map((s) => `<p class="alert-text">${esc(s.time)} ${esc(s.type)}${s.intensity ? ` (${esc(INT_LABEL[s.intensity].toLowerCase())})` : ""}</p>`).join("")}
          ${day.giNote ? `<p class="muted">${esc(day.giNote)}</p>` : ""}
        </div>`).join("")}</section>` : ""}

      <p class="muted small">A análise mostra coincidências no tempo entre o que foi comido e os sintomas, não um diagnóstico.</p>
    </article>`;

  $view.oninput = null;
  $view.onchange = null;
  $view.onclick = async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "print") window.print();
    if (el.dataset.action === "copy") {
      try { await navigator.clipboard.writeText(summaryText(r, rangeText)); toast("Resumo copiado"); }
      catch { toast("Não foi possível copiar"); }
    }
  };
}

/* ---------- Notificações ---------- */

const DAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// Os horários ficam num registro sincronizado; o servidor lê de lá para saber quando avisar.
const reminders = () => get("reminders")?.list || [];
const saveReminders = (list) =>
  put("settings", "reminders", { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo", list });

const DENIED_HELP = "As notificações estão bloqueadas neste iPhone. Para liberar: abra os <b>Ajustes</b> do iPhone → <b>Notificações</b> → <b>Diário</b> → ative <b>Permitir Notificações</b>. Depois volte aqui.";
const UNSUPPORTED_HELP = "Para receber notificações, abra o app pelo ícone da Tela de Início (no Safari: Compartilhar → Adicionar à Tela de Início).";

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + password },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function currentSubscription() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
}

// Inscreve este aparelho no servidor (a permissão já precisa estar concedida).
async function subscribeDevice() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api("/api/push/key");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  }
  await api("/api/push/subscribe", sub.toJSON());
}

// Pede a permissão do iPhone (tem que vir direto de um toque) e inscreve o aparelho.
async function enableNotifications() {
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm;
  await subscribeDevice();
  if (!reminders().length) saveReminders([{ id: uid(), time: "21:00", days: ALL_DAYS }]);
  return "granted";
}

function notifCard() {
  const list = reminders().slice().sort((a, b) => a.time.localeCompare(b.time));
  return `<div class="card">
    <h2>Notificações</h2>
    <div id="notif-status"><span class="muted small">Verificando…</span></div>
    <span class="q-label small">Horários dos lembretes</span>
    ${list.length ? list.map((r) => `
      <div class="reminder">
        ${timeWheel("r:" + r.id, r.time)}
        <div class="chips rem-days">${DAY_LETTERS.map((l, i) => `<button type="button" class="chip ${(r.days || ALL_DAYS).includes(i) ? "on" : ""}" data-action="rem-day" data-id="${r.id}" data-day="${i}" aria-label="${DAY_NAMES[i]}">${l}</button>`).join("")}</div>
        <button class="icon-btn" data-action="rem-del" data-id="${r.id}" aria-label="Apagar horário">×</button>
      </div>`).join("") : `<p class="muted small" style="margin:0">Nenhum horário ainda.</p>`}
    <button class="btn small" data-action="rem-add">+ Adicionar horário</button>
    <span class="muted small">Os dias marcados em verde são os dias em que o lembrete toca. A mensagem é sorteada entre 5 frases a cada lembrete.</span>
  </div>`;
}

async function drawNotifStatus() {
  const el = document.getElementById("notif-status");
  if (!el) return;
  let html;
  if (!pushSupported()) html = `<span class="small">${UNSUPPORTED_HELP}</span>`;
  else if (Notification.permission === "denied") html = `<p class="notice" style="margin:0">${DENIED_HELP}</p>`;
  else {
    const sub = await currentSubscription().catch(() => null);
    html = sub && Notification.permission === "granted"
      ? `<div class="spread"><span class="small">✅ Ativadas neste aparelho</span>
          <span class="row"><button class="btn small" data-action="notif-test">Enviar teste</button><button class="btn small" data-action="notif-off">Desativar</button></span></div>`
      : `<button class="btn primary block" data-action="notif-on">🔔 Ativar notificações</button>`;
  }
  if (el.isConnected) el.innerHTML = html;
}

// Cliques do card de notificações (chamado pela tela de Ajustes). Devolve true se tratou.
async function notifClick(el) {
  const a = el.dataset.action;
  if (a === "notif-on") {
    el.disabled = true;
    const r = await enableNotifications().catch(() => "error");
    if (r === "granted") { toast("Notificações ativadas"); render(); }
    else if (r === "denied") drawNotifStatus();
    else { el.disabled = false; toast("Não foi possível ativar agora"); }
  } else if (a === "notif-test") {
    try { await api("/api/push/test", {}); toast("Teste enviado, deve chegar em instantes"); } catch { toast("Não foi possível enviar o teste"); }
  } else if (a === "notif-off") {
    const sub = await currentSubscription().catch(() => null);
    if (sub) { await api("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    toast("Notificações desativadas neste aparelho"); drawNotifStatus();
  } else if (a === "rem-add") {
    saveReminders([...reminders(), { id: uid(), time: "12:00", days: ALL_DAYS }]); render();
  } else if (a === "rem-del") {
    saveReminders(reminders().filter((r) => r.id !== el.dataset.id)); render();
  } else if (a === "rem-day") {
    const day = Number(el.dataset.day);
    saveReminders(reminders().map((r) => {
      if (r.id !== el.dataset.id) return r;
      const days = new Set(r.days || ALL_DAYS);
      days.has(day) ? days.delete(day) : days.add(day);
      return { ...r, days: [...days].sort() };
    }));
    el.classList.toggle("on");
  } else return false;
  return true;
}

// Popup ao abrir o app: convida a ativar (ou explica como liberar, se foi bloqueado).
// O iPhone não deixa um app web abrir os Ajustes direto, então o popup mostra o caminho.
function maybeAskNotifications() {
  if (!password || !pushSupported() || !document.getElementById("sheet").hidden) return;
  const perm = Notification.permission;
  if (perm === "granted") { subscribeDevice().catch(() => {}); return; } // mantém a inscrição em dia no servidor
  const key = perm === "default" ? "da_notif_ask" : "da_notif_denied";
  if (Date.now() - LS.get(key, 0) < (perm === "default" ? 3 : 7) * 86400000) return;
  LS.set(key, Date.now());
  const denied = `<h2 style="margin:0;font-size:18px">Notificações bloqueadas</h2>
    <p class="small" style="margin:0">${DENIED_HELP}</p>
    <button class="btn primary block" data-close>Entendi</button>`;
  const s = openSheet(perm === "default" ? `
    <h2 style="margin:0;font-size:18px">🔔 Ativar lembretes?</h2>
    <p class="small" style="margin:0">O app avisa nos horários que você escolher para registrar as refeições e como foi o dia. Os horários ficam em Ajustes.</p>
    <button class="btn primary block" data-yes>Ativar</button>
    <button class="btn block" data-close>Agora não</button>` : denied);
  s.onclick = async (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    if (!e.target.closest("[data-yes]")) return;
    const r = await enableNotifications().catch(() => "error");
    if (r === "granted") { closeSheet(); toast("Notificações ativadas. Ajuste os horários em Ajustes."); }
    else if (r === "denied") s.innerHTML = denied;
    else { closeSheet(); toast("Não foi possível ativar agora"); }
  };
}

/* ---------- Ajustes ---------- */

function viewSettings() {
  setChrome({ title: "Ajustes", tab: "ajustes" });
  const st = settings();
  const pending = Object.values(records).filter((r) => r.dirty).length;
  $view.innerHTML = `
    ${notifCard()}
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
    <div class="card">
      <h2>Versão do app</h2>
      <span class="muted small">Versão ${esc(APP_VERSION)}. O app se atualiza sozinho quando é aberto; se algo novo não aparecer, toque abaixo. Seus registros não são apagados.</span>
      <button class="btn" data-action="update">Atualizar app</button>
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
  drawNotifStatus();
  initWheels($view, (key, time) => {
    if (key.startsWith("r:")) saveReminders(reminders().map((r) => ("r:" + r.id === key ? { ...r, time } : r)));
  });
  let confirmOut = false;
  $view.onclick = async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (await notifClick(el)) return;
    if (el.dataset.action === "sync") { await sync(); render(); }
    if (el.dataset.action === "export") exportData();
    if (el.dataset.action === "update") { el.textContent = "Atualizando…"; forceUpdate(); }
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

// Só volta ao topo ao trocar de tela; redesenhar a mesma tela (marcar uma opção, salvar) mantém a rolagem.
let lastHash = null;
function render() {
  closeSheet();
  if (!password) return viewLogin();
  const [, route, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  const sameScreen = location.hash === lastHash, y = window.scrollY;
  lastHash = location.hash;
  switch (route) {
    case "dia": /^\d{4}-\d{2}-\d{2}$/.test(arg) ? viewDay(arg) : viewCalendar(); break;
    case "refeicao": viewMeal(decodeURIComponent(arg || "")); break;
    case "analise": viewAnalysis(); break;
    case "relatorio": viewReport(); break;
    case "alimentos": viewFoods(); break;
    case "ajustes": viewSettings(); break;
    default: viewCalendar();
  }
  window.scrollTo(0, sameScreen ? y : 0);
}

// Calendário: navegação de mês e abrir dia (os demais cliques são de cada tela).
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action=month],[data-action=open-day],[data-action=week],[data-action=cal-mode]");
  if (!el || !$view.contains(el)) return;
  if (el.dataset.action === "open-day") { location.hash = "#/dia/" + el.dataset.date; return; }
  if (el.dataset.action === "cal-mode") { calMode = el.dataset.mode; LS.set("da_cal_mode", calMode); render(); return; }
  if (el.dataset.action === "week") { calWeek = addDays(calWeek || weekStart(today()), Number(el.dataset.delta)); render(); return; }
  const [y, m] = calMonth;
  const d = new Date(y, m + Number(el.dataset.delta), 1);
  calMonth = [d.getFullYear(), d.getMonth()];
  render();
});

window.addEventListener("hashchange", render);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { sync(); checkUpdate(); } });
window.addEventListener("online", () => sync());

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------- Atualização ---------- */

// No iPhone o app instalado volta do segundo plano sem recarregar, então ele mesmo confere
// se há versão nova publicada e recarrega (os dados ficam no aparelho e na nuvem).
async function checkUpdate() {
  if (APP_VERSION === "dev") return;
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    const { version } = await res.json();
    if (!version || version === APP_VERSION || isTyping() || !document.getElementById("sheet").hidden) return;
    // Uma tentativa por versão; se a recarga não trouxer o código novo, limpa as telas guardadas.
    let tried = null;
    try { tried = sessionStorage.getItem("da_update"); sessionStorage.setItem("da_update", version); } catch {}
    if (tried === version) return forceUpdateOnce(version);
    location.reload();
  } catch { /* sem internet: tenta na próxima vez */ }
}

function forceUpdateOnce(version) {
  let done = null;
  try { done = sessionStorage.getItem("da_update_forced"); sessionStorage.setItem("da_update_forced", version); } catch {}
  if (done !== version) forceUpdate();
}

// Botão em Ajustes: limpa as telas guardadas e baixa tudo de novo. Não apaga os registros.
async function forceUpdate() {
  try {
    // Atualiza o service worker sem removê-lo: removê-lo cancelaria as notificações.
    for (const reg of (await navigator.serviceWorker?.getRegistrations()) || []) await reg.update();
    for (const key of (await caches?.keys()) || []) await caches.delete(key);
  } catch {}
  location.reload();
}

if (password) setSync("Salvo no aparelho");
render();
sync();
checkUpdate();
setTimeout(maybeAskNotifications, 2500);
