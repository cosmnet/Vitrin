# Vitrin Studio

**English** · [Türkçe](#türkçe)

A free, local App Store screenshot studio. Drop in your raw app screens, build
the set with themes and real 3D devices, translate it into 15+ languages and
export every size in one click. Or let Claude drive the whole flow over MCP.

## Install — one line

On macOS or Linux, open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/cosmnet/Vitrin/main/install.sh | bash
```

No admin password needed. The script fetches a portable Node.js if you don't
have one, downloads the app and its assets (~1 GB), builds it, puts a
**Vitrin Studio** shortcut on your Desktop and connects the `vitrin` MCP to
Claude Code / Claude Desktop if they're installed. Needs ~3 GB of disk; Google
Chrome for previews/exports driven from Claude.

- **Open:** double-click **Vitrin Studio** → http://localhost:4780/studio.
  Everything runs on your machine.
- **Language & API keys:** the **Settings** button at the bottom of the left
  rail. Keys are optional ([Wiro](https://wiro.ai) for AI backgrounds and auto
  plans, Anthropic for the vision Art Director) and stay in a local `.env`.
- **Exports** land in `~/Desktop/Vitrin/<App>/<locale>/`.
- **Update:** run the install line again; projects and keys are kept.
- **Uninstall:** delete `~/Vitrin` and `~/Applications/Vitrin Studio.app`.

---

## Türkçe

App Store ekran görüntüsü stüdyosu: uygulamanın ham ekranlarını at, tema ve
3D cihazlarla seti kur, 15+ dile çevir, tek tıkla export al. İstersen tüm
akışı Claude'dan (MCP) yönet. Arayüz dili Ayarlar'dan değişir.

## Kurulum — tek satır

macOS ya da Linux'ta Terminal'i aç ve yapıştır:

```bash
curl -fsSL https://raw.githubusercontent.com/cosmnet/Vitrin/main/install.sh | bash
```

Betik şunları yapar (yönetici şifresi istemez):

1. Node.js 20+ yoksa yalnız `~/Vitrin` içine taşınabilir bir Node indirir.
2. Kaynak kodu ve görsel varlıkları (~1 GB, GitHub Releases) indirir.
3. Bağımlılıkları kurar ve stüdyoyu derler (2-5 dakika).
4. İstersen Wiro anahtarını sorar.
5. Masaüstüne **Vitrin Studio** kısayolu koyar.
6. Claude Code ya da Claude masaüstü uygulaması kuruluysa `vitrin` MCP'sini ekler.

Gereken: ~3 GB boş alan. Claude'dan önizleme/export için Google Chrome.

**Güncelleme:** aynı komutu yeniden çalıştır. Projelerin (`data/`) ve
anahtarların (`.env`) korunur.

**Kaldırma:** `~/Vitrin` klasörünü ve `~/Applications/Vitrin Studio.app`'i sil;
Claude Code'dan `claude mcp remove --scope user vitrin`.

## Kullanım

- Masaüstündeki **Vitrin Studio**'ya çift tıkla → tarayıcıda
  http://localhost:4780/studio açılır. Her şey kendi bilgisayarında çalışır.
- Export'lar `~/Desktop/Vitrin/<Uygulama>/<dil>/` altına yazılır.
- Claude'a "Uygulamam için App Store ekran görüntüleri hazırla" de; MCP
  stüdyoyu kendisi açar.

### Anahtarlar

Ayarlar penceresinden girilir (`~/Vitrin/vitrin-studio/.env`). Hepsi isteğe bağlı:

| Değişken | Ne için |
|---|---|
| `WIRO_API_KEY`, `WIRO_API_SECRET` | Arka plan/sticker üretimi, otomatik plan ([wiro.ai](https://wiro.ai)) |
| `ANTHROPIC_API_KEY` | Görsel destekli Art Director |

Anahtarlar yalnız senin bilgisayarında kalır; depoya girmez.

## Depo yapısı

```
install.sh              tek satırlık kurulum / güncelleme
vitrin-studio/          Next.js stüdyo (port 4780)
vitrin-mcp/             Claude/Cursor/Codex için MCP sunucusu (dist/ derli gelir)
scripts/package-assets.sh   bakımcı: varlık arşivini üretir
```

## Geliştirme

```bash
git clone https://github.com/cosmnet/Vitrin.git && cd Vitrin
VITRIN_HOME="$PWD" VITRIN_SOURCE="$PWD" ./install.sh   # varlıkları indirir, kurar, derler
npm --prefix vitrin-studio run dev                       # http://localhost:4780
```

Uygulamaya özel, yayımlanmayan içerik (kendi marka temaların vb.)
`vitrin-studio/private/index.ts` içine girer; arayüzü
[`vitrin-studio/private-stub/index.ts`](vitrin-studio/private-stub/index.ts)
anlatır. `private/` gitignore'dadır; yoksa boş saplama kullanılır.

### Varlık sürümü yayımlamak

`vitrin-studio/public/assets` değişince:

1. `vitrin-studio/ASSETS_VERSION`'ı artır (ör. `assets-v2`).
2. `scripts/package-assets.sh` → `dist/vitrin-assets.tar.gz` (+ `.sha256`).
3. GitHub'da o etiketle yeni bir Release aç ve iki dosyayı yükle.

Kurulum betiği sürüm değişince yeni arşivi kendisi indirir.

MCP'yi Cursor/Codex'e elle bağlamak için: [vitrin-mcp/docs/INSTALL.md](vitrin-mcp/docs/INSTALL.md).
