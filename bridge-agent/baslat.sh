#!/bin/sh
# macOS / Linux: ajanı başlatır (ilk seferde bağımlılıkları kurar).
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
exec node agent.mjs
