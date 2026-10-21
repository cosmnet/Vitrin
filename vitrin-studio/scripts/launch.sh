#!/bin/bash
# Vitrin Studio'yu başlatır (gerekirse derler) ve tarayıcıda açar.
# Başlat.command, macOS uygulaması ve Linux kısayolu bunu çağırır.
set -euo pipefail

STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://localhost:4780/studio"
if [[ "$(uname -s)" == "Darwin" ]]; then LOG="$HOME/Library/Logs/vitrin-studio.log"; else LOG="${XDG_STATE_HOME:-$HOME/.local/state}/vitrin-studio.log"; fi
mkdir -p "$(dirname "$LOG")"

# Finder'dan açılan uygulamalar kısa bir PATH ile gelir: kurulumun taşınabilir
# Node'unu ve Homebrew yollarını öne ekle.
export PATH="$STUDIO/../.runtime/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

[[ "${LC_ALL:-${LANG:-}}" == tr* ]] && TR=1 || TR=0
t() { if [[ "$TR" == 1 ]]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
open_url() { if command -v open >/dev/null 2>&1; then open "$1"; else xdg-open "$1" >/dev/null 2>&1 || true; fi; }
up() { curl -fsS -o /dev/null "$URL" 2>/dev/null; }

if up; then open_url "$URL"; exit 0; fi

cd "$STUDIO"
if [[ ! -f .next-production/BUILD_ID ]] || [[ -n "$(find app components engine store lib private private-stub public/assets/template-previews -type f -newer .next-production/BUILD_ID -print -quit 2>/dev/null)" ]]; then
  echo "$(t "Vitrin Studio derleniyor (ilk açılışta birkaç dakika sürer)…" "Building Vitrin Studio (first launch takes a few minutes)…")"
  npm run build >>"$LOG" 2>&1 || { echo "$(t "Derleme başarısız; günlük: $LOG" "Build failed; log: $LOG")" >&2; exit 1; }
fi

nohup npm run start >>"$LOG" 2>&1 &
for _ in $(seq 1 120); do
  if up; then open_url "$URL"; exit 0; fi
  sleep 0.5
done
echo "$(t "Vitrin Studio açılamadı; günlük: $LOG" "Vitrin Studio did not start; log: $LOG")" >&2
exit 1
