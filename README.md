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

Notificações: `src/push.js` (Web Push com WebCrypto) e o cron de 1 minuto em `wrangler.toml`.
Os horários ficam no registro `reminders` (sincronizado); as inscrições, na tabela `push_subs`.

Pontuação: cada alimento tem uma nota de saúde (`health`: saudavel, moderado ou evitar), pela tabela de
`src/foods.js` (regra de ouro do Guia Alimentar) e IA para o resto, na rota `/api/health`. O cron semanal
(segunda, 9h UTC) dá nota aos alimentos que ainda não têm.
A chave VAPID fica no segredo `VAPID_JWK` do Worker (já gravado; trocar a chave obriga a reativar no iPhone).

Barriga (intestino irritado): cada alimento tem também `gut` (ok, atencao ou gatilho) e `gutWhy` (frutanos, gos,
lactose, frutose, poliois, gordura, cafeina, alcool, gas, picante, insoluvel, soluvel), pela tabela de `src/foods.js`
(Monash University e diretrizes ACG/NICE) e IA para o resto, na rota `/api/gut`. O mesmo cron semanal preenche.
Gatilhos pessoais são calculados no aparelho a partir da análise dos últimos 60 dias.

Personagem do dia (Friends): ao responder as 4 perguntas de "Como foi o dia", uma nota parcial (70% respostas,
30% comida do dia) escolhe o personagem, mostrado num modal por 15 s. As fotos ficam em `public/friends/`, fora
do Git por serem imagens dos atores; uma cópia fica nos arquivos do projeto (diario-alimentar/public/friends).
Sem elas, o deploy publica o app sem as fotos.
