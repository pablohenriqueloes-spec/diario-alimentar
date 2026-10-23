# Diário alimentar

App web (PWA) para iPhone: calendário, refeições com alimentos por unidade ou peso,
questionário do dia e análise de alimentos suspeitos de causar sintomas gastrointestinais.

- `public/` telas do app (HTML, CSS, JS, service worker, ícones)
- `src/worker.js` API de sincronização (Cloudflare Worker)
- `schema.sql` tabela do banco D1
- `deploy.sh` publica tudo no Cloudflare

Os dados ficam no aparelho (localStorage) e sincronizam com o D1 pela rota `/api/sync`,
protegida pela senha `APP_PASSWORD` (segredo do Worker).

Teste local: `printf 'APP_PASSWORD=teste123\n' > .dev.vars`,
`npx wrangler d1 execute diario-alimentar --local --file schema.sql` e `npx wrangler dev`.

Notificações ficaram para depois.
