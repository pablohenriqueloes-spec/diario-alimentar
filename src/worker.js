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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!authorized(request, env)) return json({ error: "Senha incorreta" }, 401);

    if (url.pathname === "/api/ping" && request.method === "GET") return json({ ok: true });
    if (url.pathname === "/api/sync" && request.method === "POST") return sync(request, env);
    return json({ error: "Não encontrado" }, 404);
  },
};
