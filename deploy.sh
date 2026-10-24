#!/usr/bin/env bash
# Publica o Diário alimentar no Cloudflare.
# Uso: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... APP_PASSWORD=... ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?defina CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?defina CLOUDFLARE_ACCOUNT_ID}"
: "${APP_PASSWORD:?defina APP_PASSWORD}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

npm install --no-audit --no-fund

if grep -q PREENCHER_NO_DEPLOY wrangler.toml; then
  find_id() { npx wrangler d1 list --json | node -e 'const s=require("fs").readFileSync(0,"utf8");const l=JSON.parse(s.slice(s.indexOf("[")));const d=l.find(x=>x.name==="diario-alimentar");if(d)console.log(d.uuid)'; }
  id=$(find_id)
  if [ -z "$id" ]; then
    npx wrangler d1 create diario-alimentar
    id=$(find_id)
  fi
  sed -i "s/PREENCHER_NO_DEPLOY/$id/" wrangler.toml
fi

# Versão nova a cada publicação: o app compara com /version.json e recarrega sozinho.
v=$(date -u +%Y%m%d%H%M%S)
printf '{"version":"%s"}\n' "$v" > public/version.json
sed -i "s/^const APP_VERSION = .*/const APP_VERSION = \"$v\"; \/\/ trocado pelo deploy.sh a cada publicação/" public/app.js
sed -i "s/^const CACHE = .*/const CACHE = \"diario-$v\";/" public/sw.js

npx wrangler d1 execute diario-alimentar --remote --file schema.sql
npx wrangler deploy
printf '%s' "$APP_PASSWORD" | npx wrangler secret put APP_PASSWORD
