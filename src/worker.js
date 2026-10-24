import { lookup, healthLookup, norm } from "./foods.js";
import { randomMessage, sendPush, publicKeyOf } from "./push.js";

// API do Diário alimentar. Os arquivos do app são servidos pelos assets;
// este Worker só responde em /api/*.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  const given = header.replace(/^Bearer\s+/i, "");
  const expected = env.APP_PASSWORD || "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const KINDS = new Set(["food", "meal", "day", "settings"]);

// Recebe as mudanças do celular e devolve tudo que mudou no servidor desde `since`.
// Conflitos: vence a versão com updated_at maior (só existe uma usuária).
async function sync(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.changes)) return json({ error: "Corpo inválido" }, 400);
  const since = Number(body.since) || 0;
  const last = await env.DB.prepare("SELECT MAX(rev) AS m FROM records").first();
  let rev = Math.max(Date.now(), (last?.m || 0) + 1);

  const stmts = [];
  for (const c of body.changes.slice(0, 2000)) {
    if (typeof c.id !== "string" || !KINDS.has(c.kind) || typeof c.updated_at !== "number") continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO records (id, kind, data, updated_at, deleted, rev) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET kind = ?2, data = ?3, updated_at = ?4, deleted = ?5, rev = ?6
         WHERE excluded.updated_at > records.updated_at`
      ).bind(c.id, c.kind, JSON.stringify(c.data ?? {}), c.updated_at, c.deleted ? 1 : 0, rev++)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);

  const { results } = await env.DB.prepare(
    "SELECT id, kind, data, updated_at, deleted, rev FROM records WHERE rev > ?1 ORDER BY rev"
  ).bind(since).all();

  const records = results.map((r) => ({
    id: r.id,
    kind: r.kind,
    data: JSON.parse(r.data),
    updated_at: r.updated_at,
    deleted: !!r.deleted,
  }));
  const cursor = results.reduce((m, r) => Math.max(m, r.rev), since);
  return json({ cursor, records });
}

// Sugestão de grupos para alimentos já cadastrados, usando o modelo de IA da Cloudflare.
const GROUPS = {
  "Fritura": "preparado frito em óleo (batata frita, pastel, coxinha, empanados)",
  "Gordura": "rico em gordura (bacon, manteiga, queijos amarelos, carnes gordas, creme de leite, castanhas, abacate)",
  "Fibra": "rico em fibras (verduras, legumes, frutas, cereais integrais, aveia, feijões)",
  "FODMAP": "alto em FODMAP (cebola, alho, trigo, centeio, feijões, lentilha, maçã, pera, manga, mel, leite, cogumelos, couve-flor, adoçantes como sorbitol)",
  "Lactose": "contém leite ou derivados com lactose (leite, iogurte, requeijão, queijos frescos, sorvete)",
  "Glúten": "contém trigo, cevada ou centeio (pão, macarrão, bolo, biscoito, cerveja). Tapioca, crepioca, mandioca, arroz, milho e polvilho NÃO têm glúten",
  "Açúcar": "rico em açúcar adicionado ou muito doce (doces, refrigerante, sucos adoçados)",
  "Cafeína": "contém cafeína (café, chá preto ou verde, mate, refrigerante de cola, chocolate, energético)",
  "Álcool": "bebida alcoólica",
  "Picante": "apimentado (pimenta, molhos picantes)",
  "Leguminosa": "leguminosa (feijão, lentilha, grão-de-bico, ervilha, soja)",
  "Ultraprocessado": "produto industrializado ultraprocessado (embutidos, salsicha, refrigerante, biscoito recheado, salgadinho, macarrão instantâneo). Comida caseira ou de restaurante não é ultraprocessada, mesmo que leve um ingrediente industrializado",
};

const MODEL = "@cf/openai/gpt-oss-120b";

// Texto da resposta do modelo, qualquer que seja o formato de saída dele.
async function askModel(env, prompt, effort = "low") {
  const model = MODEL;
  const res = model.includes("gpt-oss")
    ? await env.AI.run(model, { input: prompt, reasoning: { effort } })
    : await env.AI.run(model, { messages: [{ role: "user", content: prompt }], max_tokens: 2048, temperature: 0 });
  if (typeof res?.response === "string") return res.response;
  if (res?.response && typeof res.response === "object") return JSON.stringify(res.response);
  const msg = (res?.output || []).find((o) => o.type === "message");
  return msg?.content?.map((c) => c.text || "").join("") || JSON.stringify(res);
}

// Item da lista: nome e, opcionalmente, preparo/ingredientes.
const item = (f) => (typeof f === "string" ? { name: f, prep: "" } : { name: String(f?.name || ""), prep: String(f?.prep || "") });
const describe = (f) => (f.prep ? `${f.name} (preparo/ingredientes: ${f.prep})` : f.name);

async function suggestGroups(request, env) {
  const body = await request.json().catch(() => null);
  const foods = (Array.isArray(body?.foods) ? body.foods : []).map(item).filter((f) => f.name.trim()).slice(0, 200);
  // Classificações que a pessoa corrigiu ou confirmou à mão: viram exemplos para a IA.
  const examples = (Array.isArray(body?.examples) ? body.examples : []).slice(0, 40)
    .map((e) => ({ ...item(e), groups: Array.isArray(e?.groups) ? e.groups.filter((g) => g in GROUPS) : [] }));
  const out = {}, source = {};

  // 1) Tabela de referência (só quando não há preparo informado, que pode mudar a classificação).
  const ask = [];
  for (const f of foods) {
    const ref = f.prep ? null : lookup(f.name);
    if (ref) { out[f.name] = ref; source[f.name] = "tabela"; } else ask.push(f);
  }

  // 2) IA para o resto.
  for (let i = 0; i < ask.length; i += 40) {
    const chunk = ask.slice(i, i + 40);
    const prompt =
      "Você é nutricionista. Classifique cada alimento brasileiro abaixo nos grupos que se aplicam, como ele costuma ser consumido no Brasil. " +
      "Use somente estes grupos (pode ser mais de um, ou nenhum):\n" +
      Object.entries(GROUPS).map(([g, d]) => `- ${g}: ${d}`).join("\n") +
      (examples.length
        ? "\n\nClassificações já confirmadas por quem usa o app. Siga o mesmo critério para alimentos parecidos:\n" +
          examples.map((e) => `- ${describe(e)}: ${e.groups.join(", ") || "nenhum grupo"}`).join("\n")
        : "") +
      "\n\nResponda somente com um objeto JSON, sem texto antes ou depois, no formato {\"nome do alimento\": [\"Grupo\", ...]}, " +
      "usando como chave exatamente o nome do alimento (sem o preparo).\n\nAlimentos:\n" + chunk.map((f) => `- ${describe(f)}`).join("\n");
    const text = await askModel(env, prompt);
    let parsed = {};
    try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
    for (const f of chunk) {
      const got = parsed[f.name] ?? Object.entries(parsed).find(([k]) => norm(k) === norm(f.name))?.[1];
      if (Array.isArray(got)) { out[f.name] = [...new Set(got.filter((g) => g in GROUPS))]; source[f.name] = "ia"; }
    }
  }
  return json({ groups: out, source });
}

/* Nota de saúde dos alimentos (para a pontuação). */

const HEALTH_LEVELS = {
  saudavel: "in natura ou minimamente processado, ou preparação caseira simples com eles (arroz, feijão, frutas, verduras, legumes, ovos, carnes e peixes grelhados, assados ou cozidos, leite, iogurte natural, castanhas, café, água)",
  moderado: "processado ou preparação com mais gordura, sal ou farinha refinada, para consumir com moderação (pão francês, macarrão, queijos amarelos, carnes gordas, manteiga, farofa, pizza caseira)",
  evitar: "ultraprocessado, frito, muito doce ou alcoólico (refrigerante, salgadinho, biscoito, embutidos, frituras, doces, sorvete, salgados de padaria, bebidas alcoólicas)",
};

// Aceita "Saudável", "moderação", ["evitar"] etc. e devolve a chave da nota.
function toLevel(v) {
  const t = norm(Array.isArray(v) ? v[0] : typeof v === "object" && v ? Object.values(v)[0] : v);
  if (t.startsWith("saud")) return "saudavel";
  if (t.startsWith("moder")) return "moderado";
  if (t.startsWith("evit")) return "evitar";
  return null;
}
const parseJson = (text) => { try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return {}; } };

// Mesma ideia dos grupos: tabela de referência primeiro, IA para o resto.
async function classifyHealth(env, foods, examples = []) {
  const out = {}, source = {}, ask = [];
  for (const f of foods) {
    const ref = f.prep ? null : healthLookup(f.name);
    if (ref) { out[f.name] = ref; source[f.name] = "tabela"; } else ask.push(f);
  }
  for (let i = 0; i < ask.length; i += 40) {
    const chunk = ask.slice(i, i + 40);
    const prompt =
      "Você é nutricionista e segue o Guia Alimentar para a População Brasileira. Dê uma nota de saúde para cada alimento abaixo, " +
      "como ele costuma ser consumido no Brasil. Use somente uma destas notas:\n" +
      Object.entries(HEALTH_LEVELS).map(([k, d]) => `- ${k}: ${d}`).join("\n") +
      (examples.length
        ? "\n\nNotas já confirmadas por quem usa o app. Siga o mesmo critério:\n" + examples.map((e) => `- ${describe(e)}: ${e.health}`).join("\n")
        : "") +
      "\n\nResponda somente com um objeto JSON, sem texto antes ou depois, no formato {\"nome do alimento\": \"nota\"}, " +
      "usando como chave exatamente o nome do alimento (sem o preparo).\n\nAlimentos:\n" + chunk.map((f) => `- ${describe(f)}`).join("\n");
    // Uma segunda tentativa, com mais raciocínio, para o que a primeira não respondeu direito.
    for (const effort of ["low", "medium"]) {
      const todo = chunk.filter((f) => !out[f.name]);
      if (!todo.length) break;
      const parsed = parseJson(await askModel(env, prompt, effort));
      const entries = Object.entries(parsed);
      for (const f of todo) {
        let got = parsed[f.name] ?? entries.find(([k]) => norm(k) === norm(f.name))?.[1]
          ?? entries.find(([k]) => norm(k).includes(norm(f.name)) || norm(f.name).includes(norm(k)))?.[1];
        if (got == null && todo.length === 1 && entries.length === 1) got = entries[0][1];
        const level = toLevel(got);
        if (level) { out[f.name] = level; source[f.name] = "ia"; }
      }
    }
  }
  return { health: out, source };
}

async function suggestHealth(request, env) {
  const body = await request.json().catch(() => null);
  const foods = (Array.isArray(body?.foods) ? body.foods : []).map(item).filter((f) => f.name.trim()).slice(0, 200);
  const examples = (Array.isArray(body?.examples) ? body.examples : []).slice(0, 40)
    .map((e) => ({ ...item(e), health: e?.health })).filter((e) => e.health in HEALTH_LEVELS);
  return json(await classifyHealth(env, foods, examples));
}

// Agendamento semanal: dá nota aos alimentos cadastrados que ainda não têm.
// Grava como uma mudança comum, então o celular recebe na próxima sincronização.
async function classifyPending(env) {
  const { results } = await env.DB.prepare("SELECT id, data, updated_at FROM records WHERE kind = 'food' AND deleted = 0").all();
  const foods = results.map((r) => ({ id: r.id, updated_at: r.updated_at, data: JSON.parse(r.data) }));
  const pending = foods.filter((f) => !f.data.health && f.data.name);
  if (!pending.length) return 0;
  const examples = foods.filter((f) => f.data.health && f.data.healthManual).slice(-40)
    .map((f) => ({ name: f.data.name, prep: f.data.prep || "", health: f.data.health }));
  const { health, source } = await classifyHealth(env, pending.map((f) => item(f.data)), examples);
  const last = await env.DB.prepare("SELECT MAX(rev) AS m FROM records").first();
  let rev = Math.max(Date.now(), (last?.m || 0) + 1);
  const stmts = [];
  for (const f of pending) {
    const h = health[f.data.name];
    if (!h) continue;
    const data = { ...f.data, health: h, healthSource: source[f.data.name] };
    // Só grava se ninguém mexeu no alimento enquanto a IA respondia.
    stmts.push(env.DB.prepare("UPDATE records SET data = ?1, updated_at = ?2, rev = ?3 WHERE id = ?4 AND updated_at = ?5")
      .bind(JSON.stringify(data), Math.max(Date.now(), f.updated_at + 1), rev++, f.id, f.updated_at));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

/* Notificações: inscrições do aparelho, envio e lembretes agendados. */

const WEEKLY_CRON = "0 9 * * 1"; // segunda, 6h em Brasília (igual ao wrangler.toml)
const SUBJECT = "https://diario-alimentar.pablohenrique-loes.workers.dev";
const vapidKey = (env) => JSON.parse(env.VAPID_JWK);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Envia para todas as inscrições e remove as que o serviço de push diz que expiraram.
async function pushAll(env, payload) {
  const { results } = await env.DB.prepare("SELECT endpoint, sub FROM push_subs").all();
  const statuses = [];
  for (const r of results) {
    let status = 0;
    try { status = await sendPush(JSON.parse(r.sub), payload, vapidKey(env), SUBJECT); } catch { status = -1; }
    if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(r.endpoint).run();
    statuses.push(status);
  }
  return statuses;
}

async function push(request, env, path) {
  if (path === "/api/push/key") return json({ key: publicKeyOf(vapidKey(env)) });
  const body = await request.json().catch(() => ({}));
  if (path === "/api/push/subscribe") {
    if (typeof body?.endpoint !== "string" || !body.keys?.p256dh || !body.keys?.auth) return json({ error: "Inscrição inválida" }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO push_subs (endpoint, sub, created_at) VALUES (?1, ?2, ?3)")
      .bind(body.endpoint, JSON.stringify({ endpoint: body.endpoint, keys: body.keys }), Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/push/unsubscribe") {
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(String(body?.endpoint || "")).run();
    return json({ ok: true });
  }
  if (path === "/api/push/test") return json({ statuses: await pushAll(env, { title: "Diário alimentar", body: randomMessage(), url: "/" }) });
  return json({ error: "Não encontrado" }, 404);
}

// Roda a cada minuto (cron): manda a notificação dos lembretes que batem com a hora local.
async function remind(env, when) {
  const row = await env.DB.prepare("SELECT data FROM records WHERE id = 'reminders' AND deleted = 0").first();
  if (!row) return;
  const { tz = "America/Sao_Paulo", list = [] } = JSON.parse(row.data);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(new Date(when)).map((p) => [p.type, p.value]));
  const hhmm = `${parts.hour}:${parts.minute}`, day = WEEKDAYS.indexOf(parts.weekday);
  const due = list.filter((r) => r.on !== false && r.time === hhmm && (r.days || [0, 1, 2, 3, 4, 5, 6]).includes(day));
  if (due.length) await pushAll(env, { title: "Diário alimentar", body: randomMessage(), url: "/" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!authorized(request, env)) return json({ error: "Senha incorreta" }, 401);

    if (url.pathname === "/api/ping" && request.method === "GET") return json({ ok: true });
    if (url.pathname === "/api/sync" && request.method === "POST") return sync(request, env);
    if (url.pathname.startsWith("/api/push/")) return push(request, env, url.pathname);
    if (url.pathname === "/api/health" && request.method === "POST") {
      try { return await suggestHealth(request, env); }
      catch { return json({ error: "Serviço de sugestão indisponível" }, 502); }
    }
    if (url.pathname === "/api/groups" && request.method === "POST") {
      try { return await suggestGroups(request, env); }
      catch { return json({ error: "Serviço de sugestão indisponível" }, 502); }
    }
    return json({ error: "Não encontrado" }, 404);
  },
  async scheduled(event, env, ctx) {
    if (event.cron === WEEKLY_CRON) ctx.waitUntil(classifyPending(env));
    else ctx.waitUntil(remind(env, event.scheduledTime));
  },
};
