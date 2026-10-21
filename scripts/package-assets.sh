#!/bin/bash
# Bakımcı için: vitrin-studio/public/assets'i GitHub Release'e yüklenecek
# arşive paketler. Kurulum betiği bu arşivi ASSETS_VERSION etiketinden indirir.
#
#   scripts/package-assets.sh   → dist/vitrin-assets.tar.gz (+ .sha256)
#
# Varlıkları değiştirdiğinde vitrin-studio/ASSETS_VERSION'ı artır (assets-v2 …),
# arşivi yeniden üret ve o etiketle yeni bir Release'e yükle.
# Yayımlanmayacak varlıklar: vitrin-studio/private/assets-exclude.txt (her
# satır bir tar kalıbı, ör. `*markam*`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STUDIO="$ROOT/vitrin-studio"
ASSETS="$STUDIO/public/assets"
TAG="$(tr -d '[:space:]' < "$STUDIO/ASSETS_VERSION")"
OUT="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PATTERNS=()
if [[ -f "$STUDIO/private/assets-exclude.txt" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" && "$line" != \#* ]] && PATTERNS+=("$line")
  done < "$STUDIO/private/assets-exclude.txt"
fi
EXCLUDES=(--exclude .DS_Store --exclude ./media-manifest.json)
for p in ${PATTERNS[@]+"${PATTERNS[@]}"}; do EXCLUDES+=(--exclude "$p"); done

# Manifest de dışlanan yolları anmasın.
node -e '
  const fs = require("fs");
  const [src, dst, ...globs] = process.argv.slice(1);
  const res = globs.map(g => new RegExp("^" + g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i"));
  const hit = s => res.some(r => r.test(s));
  const m = JSON.parse(fs.readFileSync(src, "utf8"));
  const out = Object.fromEntries(Object.entries(m).filter(([k, v]) => !hit(k) && !hit(v.src ?? "") && !hit(v.preview ?? "")));
  fs.writeFileSync(dst, JSON.stringify(out));
  console.log(`manifest: ${Object.keys(m).length} → ${Object.keys(out).length} kayıt`);
' "$ASSETS/media-manifest.json" "$STAGE/media-manifest.json" ${PATTERNS[@]+"${PATTERNS[@]}"}
printf '%s\n' "$TAG" > "$STAGE/.version"

mkdir -p "$OUT"
echo "Paketleniyor: $TAG"
COPYFILE_DISABLE=1 tar -cf "$STAGE/assets.tar" -C "$ASSETS" "${EXCLUDES[@]}" .
COPYFILE_DISABLE=1 tar -rf "$STAGE/assets.tar" -C "$STAGE" media-manifest.json .version
gzip -c "$STAGE/assets.tar" > "$OUT/vitrin-assets.tar.gz"
(cd "$OUT" && shasum -a 256 vitrin-assets.tar.gz > vitrin-assets.tar.gz.sha256)

du -h "$OUT/vitrin-assets.tar.gz"
cat <<EOF

Hazır. GitHub'da yeni bir Release aç:
  Etiket: $TAG
  Dosyalar: dist/vitrin-assets.tar.gz ve dist/vitrin-assets.tar.gz.sha256
(gh varsa: gh release create $TAG dist/vitrin-assets.tar.gz dist/vitrin-assets.tar.gz.sha256 --title "Vitrin varlıkları $TAG" --notes "Kurulum betiği bunu indirir.")
EOF
