# Vitrin MCP

Vitrin Studio'yu Claude'dan süren stdio MCP sunucusu.
**"Lumo için 10 screenshot yap"** → tara, içe aktar, kurgula, önizle, çevir,
export al — hepsi konuşarak.

> Bu repo MCP köprüsüdür; Vitrin Studio uygulaması ayrı bir yerel klasör olarak
> gerekir. Başka bir bilgisayarda kurulum için [kurulum rehberine](docs/INSTALL.md)
> bakın.

```
vitrin-mcp/
├── src/                        TypeScript kaynak
│   ├── index.ts                serveStdio girişi, araç kaydı
│   ├── config.ts               VITRIN_DIR / VITRIN_PORT / timeout'lar
│   ├── log.ts                  stderr log + VitrinError (Türkçe neden + öneri)
│   ├── studio.ts               ensureServer() + REST istemcisi
│   ├── browser.ts              tek Chromium, WebGL yoklaması, 5 dk boşta kapanma
│   ├── headless.ts             /headless-export sürücüsü (önizleme/kontak/export)
│   ├── project.ts              proje CRUD + ÖZETLEME (ham JSON asla dönmez)
│   ├── catalog.ts              tema/şablon/yerleşim kataloğu (stüdyodan)
│   ├── result.ts               content block'ları, ilerleme, hata sarmalayıcı
│   └── tools/{core,content,design,render}.ts
├── dist/                       tsc çıktısı — çalıştırılan bu
├── skills/vitrin-workflow/     Türkçe iş akışı becerisi
└── .claude-plugin/             plugin.json + marketplace.json
```

## Kurulum

> En kolayı: depo kökündeki tek satırlık `install.sh` stüdyoyu ve bu MCP'yi
> birlikte kurar, Claude'a da kendisi bağlar (bkz. ana README).

```bash
git clone https://github.com/cosmnet/Vitrin.git
cd Vitrin/vitrin-mcp
npm ci
npm run build      # → dist/index.js
npm run check:secrets
```

Codex, Cursor ve Claude Code için tam kurulum: [`docs/INSTALL.md`](docs/INSTALL.md).

Tarayıcı indirilmez: sistemdeki **Google Chrome** `channel: "chrome"` ile
kullanılır. Chrome yoksa `VITRIN_CHROME_CHANNEL=msedge` (ya da `chrome-beta`)
verilebilir.

## Claude'a tanıtma — iki yol

### 1) Doğrudan MCP kaydı (sadece araçlar)

```bash
claude mcp add --scope user --transport stdio vitrin \
  -e VITRIN_DIR="$HOME/Vitrin/vitrin-studio" \
  -e VITRIN_PORT=4780 \
  -- node "$HOME/Vitrin/vitrin-mcp/dist/index.js"

claude mcp list      # doğrulama: "vitrin: … - ✓ Connected"
```

### 2) Eklenti (MCP + Türkçe iş akışı becerisi birlikte) — ÖNERİLEN

```
/plugin marketplace add /absolute/path/to/Vitrin/vitrin-mcp
/plugin install vitrin@cosm-labs
```

Eklenti yolu, MCP sunucusuna ek olarak `skills/vitrin-workflow` becerisini de
yükler: Claude Türkçe konuşmayı, netleştirme sorularını ve araç sırasını oradan
öğrenir.

### Zaman aşımı — ÖNEMLİ

`vitrin_art_direct` ve `vitrin_translate` Claude API'ye çıkar
(`maxDuration = 300`), `vitrin_export` 15 dilde dakikalarca sürebilir. Claude
eklenti yapılandırmasında timeout 600 saniye olarak hazırdır. Codex kullanıyorsan
`examples/codex.config.toml` içindeki `tool_timeout_sec = 600` ayarını kullan:

```bash
export VITRIN_RENDER_TIMEOUT=600000 # 10 dk (ms)
```

Eklenti yolunda bu `plugin.json` içindeki `"timeout": 600000` ile hazır gelir.
`claude mcp add` yolunda istemcinin kendi timeout ayarını kullan.

## Ortam değişkenleri

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `VITRIN_DIR` | kardeş `../vitrin-studio`, yoksa `~/Vitrin/vitrin-studio` | `npm run dev` bu klasörde koşar |
| `VITRIN_PORT` | `4780` | Stüdyo portu |
| `VITRIN_CHROME_CHANNEL` | `chrome` | Playwright kanalı |
| `VITRIN_RENDER_TIMEOUT` | `600000` | Tek headless işin üst sınırı (ms) |
| `VITRIN_BOOT_TIMEOUT` | `60000` | Dev sunucunun açılması için beklenen süre |
| `VITRIN_BROWSER_IDLE` | `300000` | Tarayıcı bu kadar boşta kalınca kapanır |
| `VITRIN_LLM_TIMEOUT` | `300000` | director/copy istek süresi |

## Araçlar (23)

| Araç | Ne yapar |
|---|---|
| `vitrin_status` | Sunucu ayakta mı; değilse başlatır. Port, klasör, WebGL, proje sayısı. |
| `vitrin_list_projects` | id / uygulama / diller / tarih |
| `vitrin_create_project` | Boş proje (`app`, `brief?`, `locale?`) |
| `vitrin_open_project` | Slayt tablosu ÖZETİ (ham JSON değil) |
| `vitrin_delete_project` | Kalıcı silme — `confirm` = uygulama adı |
| `vitrin_open_studio` | macOS `open` ile stüdyoyu açar |
| `vitrin_scan_folder` | `/api/ingest`: diller, kare sayıları, **dil kovaları** |
| `vitrin_import` | Kareleri slayta çevirir, ekranları `data/shots`'a kopyalar, `designKey=f01…` damgalar |
| `vitrin_art_direct` | Ekranlara bakıp n slaytlık anlatı kurar (Claude API) |
| `vitrin_translate` | `/api/copy` `localize` — tek istekte çok dil |
| `vitrin_edit_slide` | Metin/tasarım yaması; tasarım otomatik dillere yayılır |
| `vitrin_reorder_slides` / `vitrin_add_slide` / `vitrin_remove_slide` | Slayt düzeni |
| `vitrin_list_themes` / `vitrin_list_templates` / `vitrin_list_layouts` | Katalog; `withPreview` ile TEK ızgara görsel |
| `vitrin_apply_theme` / `vitrin_apply_template` | Giysiyi uygular, override'ları temizler |
| `vitrin_sync_design` | Tasarımı dillere yayar (metin yerinde kalır) |
| `vitrin_render_preview` | Tek slayt → görsel |
| `vitrin_render_contact_sheet` | Tüm slaytlar → TEK ızgara görsel |
| `vitrin_export` | 1320×2868 PNG'ler, dil başına klasör, `outDir` seçeneği |

## Nasıl çalışıyor

- **Sunucu:** her araç çağrısından önce `GET /api/assets` (800 ms). Cevap yoksa
  `VITRIN_DIR`'de `npm run dev` **detached** başlatılır ve `unref()` edilir —
  MCP kapansa bile stüdyo ayakta kalır.
- **Render:** motor (`renderSlide` + three.js) yalnız tarayıcıda çalışır. MCP
  headless Chrome'u stüdyodaki `/headless-export` sayfasına sürer; motorun TEK
  kopyası kalır, çıktı stüdyodakiyle bire bir aynıdır.
- **WebGL:** `scene3d` WebGL bulamazsa hata atmaz, **cihazsız** slayt basar.
  Bu yüzden tarayıcı açılırken WebGL yoklanır; GPU yolu vermezse SwiftShader
  argümanlarıyla yeniden başlatılır, o da vermezse render hiç denenmez.
- **Kontak sayfası:** ızgara tarayıcı içinde birleştirilir; 10 slaytın
  dataURL'i Node'a hiç geçmez, tek PNG döner.
- **Tasarım senkronu:** `/api/sync` stüdyoda `engine/designsync.ts`'i sunucu
  tarafında çağırır — `DESIGN_FIELDS` listesi kopyalanmaz, tek kaynak kalır.

## Stüdyo tarafına eklenen dosyalar

Bu paket vitrin-studio'da yalnız `app/api/sync/**` altına yazar:

| Dosya | Ne için |
|---|---|
| `app/api/sync/route.ts` | `POST {projectId, from, to, slides, order}` → tasarım yayılımı |
| `app/api/sync/catalog/route.ts` | `GET` → tema/şablon/yerleşim/boyut kataloğu |
| `app/api/sync/import/route.ts` | `POST` → sunucu tarafı `doImport` (ingest + eşleştirme + shots + slayt kurulumu) |
| `app/api/sync/store.ts` | Ortak proje deposu yardımcıları (route değil) |
