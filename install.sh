#!/bin/bash
# Vitrin Studio — tek satırlık kurulum / güncelleme (macOS, Linux):
#
#   curl -fsSL https://raw.githubusercontent.com/cosmnet/Vitrin/main/install.sh | bash
#
# Yönetici şifresi istemez. Node.js yoksa ~/Vitrin içine taşınabilir bir Node
# indirir. Yeniden çalıştırmak güncelleme yapar; projelerin ve .env korunur.
#
# Ayarlar (isteğe bağlı ortam değişkenleri):
#   VITRIN_HOME   kurulum klasörü           (varsayılan ~/Vitrin)
#   VITRIN_REPO   GitHub deposu             (varsayılan cosmnet/Vitrin)
#   VITRIN_REF    dal ya da etiket          (varsayılan main)
#   VITRIN_SOURCE yerel kaynak klasörü — indirmek yerine buradan kopyala (test için)
set -euo pipefail

REPO="${VITRIN_REPO:-cosmnet/Vitrin}"
REF="${VITRIN_REF:-main}"
DEST="${VITRIN_HOME:-$HOME/Vitrin}"
STUDIO="$DEST/vitrin-studio"
MCP="$DEST/vitrin-mcp"
NODE_LINE="latest-v24.x"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
# Mesaj dili: sistem dili Türkçe ise Türkçe, değilse İngilizce.
[[ "${LC_ALL:-${LANG:-}}" == tr* ]] && TR=1 || TR=0
t() { if [[ "$TR" == 1 ]]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | awk '{print $1}'; }
# curl | bash ile çalışırken stdin betiğin kendisidir: soruları terminalden oku.
has_tty() { [[ -t 1 ]] && { : < /dev/tty; } 2>/dev/null; }
ask() { local __v=""; if has_tty; then printf '%s' "$2"; read -r __v < /dev/tty || true; fi; printf -v "$1" '%s' "$__v"; }

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64) PLAT=darwin-arm64 ;;
  Darwin-x86_64) PLAT=darwin-x64 ;;
  Linux-x86_64) PLAT=linux-x64 ;;
  Linux-aarch64|Linux-arm64) PLAT=linux-arm64 ;;
  *) die "$(t "Desteklenmeyen sistem: $OS $ARCH (macOS ya da Linux gerekir)" "Unsupported system: $OS $ARCH (needs macOS or Linux)")" ;;
esac
for c in curl tar rsync; do command -v "$c" >/dev/null 2>&1 || die "$(t "'$c' bulunamadı; önce onu kur." "'$c' not found; install it first.")"; done

bold "$(t "Vitrin Studio kurulumu → $DEST" "Installing Vitrin Studio → $DEST")"

# --- 1. Node.js ----------------------------------------------------------
step "Node.js"
NODE_BIN=""
if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]]; then
  NODE_BIN="$(command -v node)"
  echo "$(t "Sistemdeki Node kullanılacak: $(node -v)" "Using system Node: $(node -v)")"
elif [[ -x "$DEST/.runtime/node/bin/node" ]]; then
  NODE_BIN="$DEST/.runtime/node/bin/node"
  echo "$(t "Taşınabilir Node hazır: $("$NODE_BIN" -v)" "Portable Node ready: $("$NODE_BIN" -v)")"
else
  echo "$(t "Node 20+ yok; taşınabilir Node indiriliyor (yalnız $DEST içine)…" "No Node 20+; downloading a portable Node (into $DEST only)…")"
  curl -fsSL "https://nodejs.org/dist/$NODE_LINE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  NODE_TGZ="$(awk -v p="-$PLAT.tar.gz" '$2 ~ /^node-v/ && substr($2, length($2)-length(p)+1) == p {print $2; exit}' "$TMP/SHASUMS256.txt")"
  [[ -n "$NODE_TGZ" ]] || die "$(t "Node paketi bulunamadı ($PLAT)." "Node package not found ($PLAT).")"
  curl -fL# "https://nodejs.org/dist/$NODE_LINE/$NODE_TGZ" -o "$TMP/$NODE_TGZ"
  [[ "$(sha256 "$TMP/$NODE_TGZ")" == "$(awk -v f="$NODE_TGZ" '$2 == f {print $1}' "$TMP/SHASUMS256.txt")" ]] || die "$(t "Node indirmesi doğrulanamadı." "Node download failed verification.")"
  mkdir -p "$DEST/.runtime"
  rm -rf "$DEST/.runtime/node"
  tar -xzf "$TMP/$NODE_TGZ" -C "$DEST/.runtime"
  mv "$DEST/.runtime/${NODE_TGZ%.tar.gz}" "$DEST/.runtime/node"
  NODE_BIN="$DEST/.runtime/node/bin/node"
  echo "$(t "Kuruldu: $("$NODE_BIN" -v)" "Installed: $("$NODE_BIN" -v)")"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

# --- 2. Kaynak kod -------------------------------------------------------
step "$(t "Kaynak kod ($REPO@$REF)" "Source code ($REPO@$REF)")"
if [[ -n "${VITRIN_SOURCE:-}" ]]; then
  SRC="$VITRIN_SOURCE"
else
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/src.tgz" || die "$(t "Depo indirilemedi: $REPO@$REF" "Could not download repo: $REPO@$REF")"
  mkdir -p "$TMP/src"
  tar -xzf "$TMP/src.tgz" -C "$TMP/src" --strip-components 1
  SRC="$TMP/src"
fi
mkdir -p "$DEST"
# Kullanıcıya ait olanlar (projeler, anahtarlar, varlıklar, derlemeler) korunur.
rsync -a --delete \
  --exclude '/.runtime/' --exclude '/.git/' --exclude 'node_modules/' \
  --exclude '/vitrin-studio/data/' --exclude '/vitrin-studio/.env' \
  --exclude '/vitrin-studio/public/assets/' --exclude '/vitrin-studio/.next*/' \
  --exclude '/vitrin-studio/private/' --exclude '.DS_Store' \
  "$SRC/" "$DEST/"
echo "$(t "Güncel." "Up to date.")"

# --- 3. Görsel varlıklar -------------------------------------------------
step "$(t "Görsel varlıklar" "Assets")"
ASSETS_TAG="$(tr -d '[:space:]' < "$STUDIO/ASSETS_VERSION")"
HAVE_TAG=""
[[ -f "$STUDIO/public/assets/.version" ]] && HAVE_TAG="$(tr -d '[:space:]' < "$STUDIO/public/assets/.version")"
if [[ "$HAVE_TAG" == "$ASSETS_TAG" ]]; then
  echo "$(t "Güncel ($ASSETS_TAG)." "Up to date ($ASSETS_TAG).")"
else
  if [[ -n "${VITRIN_ASSETS_FILE:-}" ]]; then
    ARCHIVE="$VITRIN_ASSETS_FILE"
  else
    URL="https://github.com/$REPO/releases/download/$ASSETS_TAG/vitrin-assets.tar.gz"
    echo "$(t "İndiriliyor ($ASSETS_TAG, ~1 GB — bağlantına göre birkaç dakika)…" "Downloading ($ASSETS_TAG, ~1 GB — a few minutes depending on your connection)…")"
    curl -fL# "$URL" -o "$TMP/assets.tgz" || die "$(t "Varlıklar indirilemedi: $URL" "Could not download assets: $URL")"
    curl -fsSL "$URL.sha256" -o "$TMP/assets.sha256" || die "$(t "Sağlama dosyası indirilemedi." "Could not download checksum file.")"
    [[ "$(sha256 "$TMP/assets.tgz")" == "$(awk '{print $1}' "$TMP/assets.sha256")" ]] || die "$(t "Varlık arşivi doğrulanamadı; tekrar dene." "Asset archive failed verification; try again.")"
    ARCHIVE="$TMP/assets.tgz"
  fi
  rm -rf "$STUDIO/public/assets.new"
  mkdir -p "$STUDIO/public/assets.new"
  tar -xzf "$ARCHIVE" -C "$STUDIO/public/assets.new"
  rm -rf "$STUDIO/public/assets"
  mv "$STUDIO/public/assets.new" "$STUDIO/public/assets"
  echo "$(t "Kuruldu ($ASSETS_TAG)." "Installed ($ASSETS_TAG).")"
fi

# --- 4. Bağımlılıklar ve derleme -----------------------------------------
LOG="$DEST/install.log"
: > "$LOG"
run() { "$@" >>"$LOG" 2>&1 || { tail -n 30 "$LOG"; die "$(t "Adım başarısız: $* (tam günlük: $LOG)" "Step failed: $* (full log: $LOG)")"; }; }

step "$(t "Bağımlılıklar (npm)" "Dependencies (npm)")"
(cd "$MCP" && run npm ci --no-audit --no-fund)
(cd "$STUDIO" && run npm ci --no-audit --no-fund)
echo "$(t "Tamam." "Done.")"

step "$(t "Stüdyo derleniyor (2-5 dakika)" "Building the studio (2-5 minutes)")"
# Çalışan eski sürümü durdur ki yeni derleme yüklensin.
pkill -f "next start -H 127.0.0.1 -p 4780" 2>/dev/null || true
(cd "$STUDIO" && run npm run build)
echo "$(t "Tamam." "Done.")"

# --- 5. Anahtarlar -------------------------------------------------------
step "$(t "API anahtarları (isteğe bağlı)" "API keys (optional)")"
if [[ ! -f "$STUDIO/.env" ]]; then
  cp "$STUDIO/.env.example" "$STUDIO/.env"
  echo "$(t "Wiro AI anahtarı arka plan üretimi ve otomatik plan için gerekir (https://wiro.ai)." "A Wiro AI key enables AI backgrounds and auto plans (https://wiro.ai).")"
  echo "$(t "Şimdi girmek istemezsen Enter'a bas; sonra $STUDIO/.env dosyasına yazabilirsin." "Press Enter to skip; you can add it later in the app's Settings.")"
  ask WK "Wiro API key: "
  if [[ -n "$WK" ]]; then
    ask WS "Wiro API secret: "
    sed -i.bak -e "s|^WIRO_API_KEY=.*|WIRO_API_KEY=$WK|" -e "s|^WIRO_API_SECRET=.*|WIRO_API_SECRET=${WS:-}|" "$STUDIO/.env"
    rm -f "$STUDIO/.env.bak"
  fi
  chmod 600 "$STUDIO/.env"
else
  echo "$(t "Mevcut .env korundu." "Kept existing .env.")"
fi

# --- 6. Kısayol ----------------------------------------------------------
step "$(t "Kısayol" "Shortcut")"
chmod +x "$STUDIO/scripts/launch.sh" "$STUDIO/Başlat.command" 2>/dev/null || true
if [[ "$OS" == "Darwin" ]]; then
  APP="$HOME/Applications/Vitrin Studio.app"
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Vitrin Studio</string>
  <key>CFBundleIdentifier</key><string>com.cosmlabs.vitrin-studio</string>
  <key>CFBundleExecutable</key><string>vitrin</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
</dict></plist>
PLIST
  printf '#!/bin/bash\nexec "%s/scripts/launch.sh"\n' "$STUDIO" > "$APP/Contents/MacOS/vitrin"
  chmod +x "$APP/Contents/MacOS/vitrin"
  ln -sfn "$APP" "$HOME/Desktop/Vitrin Studio.app" 2>/dev/null || true
  echo "$(t "Masaüstü ve Uygulamalar: Vitrin Studio" "Desktop and Applications: Vitrin Studio")"
else
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/vitrin-studio.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Vitrin Studio
Exec="$STUDIO/scripts/launch.sh"
Terminal=false
Categories=Graphics;Development;
DESK
  echo "$(t "Uygulama menüsü: Vitrin Studio" "App menu: Vitrin Studio")"
fi

# --- 7. Claude bağlantısı (MCP) -----------------------------------------
step "$(t "Claude bağlantısı" "Claude connection")"
MCP_ENTRY="$MCP/dist/index.js"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove --scope user vitrin >/dev/null 2>&1 || true
  if claude mcp add --scope user vitrin -e VITRIN_DIR="$STUDIO" -- "$NODE_BIN" "$MCP_ENTRY" >>"$LOG" 2>&1; then
    echo "$(t "Claude Code: 'vitrin' MCP eklendi." "Claude Code: added the 'vitrin' MCP.")"
  else
    warn "$(t "Claude Code'a eklenemedi (ayrıntı: $LOG)." "Could not add to Claude Code (details: $LOG).")"
  fi
  mkdir -p "$HOME/.claude/skills"
  rsync -a "$MCP/skills/" "$HOME/.claude/skills/"
  echo "$(t "Claude Code: vitrin-workflow becerisi eklendi." "Claude Code: added the vitrin-workflow skill.")"
fi
DESKTOP_CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [[ "$OS" == "Darwin" && -d "$(dirname "$DESKTOP_CFG")" ]]; then
  [[ -f "$DESKTOP_CFG" ]] && cp "$DESKTOP_CFG" "$DESKTOP_CFG.vitrin-yedek"
  if "$NODE_BIN" -e '
    const fs = require("fs"); const [file, node, entry, dir] = process.argv.slice(1);
    const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
    cfg.mcpServers = { ...(cfg.mcpServers || {}), vitrin: { command: node, args: [entry], env: { VITRIN_DIR: dir } } };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  ' "$DESKTOP_CFG" "$NODE_BIN" "$MCP_ENTRY" "$STUDIO" 2>>"$LOG"; then
    echo "$(t "Claude masaüstü uygulaması: 'vitrin' eklendi (uygulamayı yeniden başlat)." "Claude Desktop: added 'vitrin' (restart the app).")"
  else
    warn "$(t "Claude masaüstü ayarı güncellenemedi; yedek: $DESKTOP_CFG.vitrin-yedek" "Could not update Claude Desktop config; backup: $DESKTOP_CFG.vitrin-yedek")"
  fi
fi
if [[ "$OS" == "Darwin" && ! -d "/Applications/Google Chrome.app" ]]; then
  warn "$(t "Google Chrome bulunamadı. Claude'dan önizleme/export için Chrome gerekir." "Google Chrome not found. Previews/exports driven from Claude need Chrome.")"
fi

if [[ "$TR" == 1 ]]; then bold "
✓ Vitrin Studio hazır.
  Aç:         Masaüstündeki 'Vitrin Studio' (ya da: $STUDIO/scripts/launch.sh)
  Adres:      http://localhost:4780/studio
  Güncelle:   bu kurulum komutunu yeniden çalıştır
  Dil, anahtarlar: uygulamadaki Ayarlar"
else bold "
✓ Vitrin Studio is ready.
  Open:       'Vitrin Studio' on your Desktop (or: $STUDIO/scripts/launch.sh)
  URL:        http://localhost:4780/studio
  Update:     run this install command again
  Language, keys: Settings inside the app"
fi


if has_tty; then
  ask OPEN "$(t "Şimdi açılsın mı? [E/h] " "Open it now? [Y/n] ")"
  case "$OPEN" in h|H|n|N) ;; *) "$STUDIO/scripts/launch.sh" || true ;; esac
fi
