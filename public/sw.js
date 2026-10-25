// Guarda as telas do app para abrir sem internet. Os dados ficam no aparelho (localStorage).
const CACHE = "diario-20261025135556";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Rede primeiro (para pegar atualizações), cache quando estiver sem internet.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }) // sempre confere com o servidor, sem cache do navegador
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

/* Notificações (lembretes). O servidor manda título e mensagem; sem dados, sorteia aqui. */
const MESSAGES = [
  "Como foi seu dia hoje?",
  "Eai... comeu o que hoje?",
  "O tampinha, como você está hoje?",
  "Não esqueça de nos contar o que comeu hoje.",
  "Já preencheu sua rotina hoje?",
];

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || "Diário alimentar", {
    body: data.body || MESSAGES[Math.floor(Math.random() * MESSAGES.length)],
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
  }));
});

// Tocar na notificação abre o app no dia de hoje.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = new Date();
  const url = `/#/dia/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate?.(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
