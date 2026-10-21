# Vitrin MCP kurulumu

Bu proje yerel bir stdio MCP sunucusudur. MCP, Vitrin Studio'yu sürer; bu
nedenle kullanılacağı bilgisayarda Vitrin Studio kaynak klasörü de bulunmalıdır.
MCP kendi başına görsel üretmez ve repoya herhangi bir API anahtarı koymaz.

## Gereksinimler

- Node.js 20 veya üzeri
- Google Chrome (alternatif: Edge; `VITRIN_CHROME_CHANNEL=msedge`)
- Aynı bilgisayarda çalışan veya erişilebilir bir `vitrin-studio` klasörü

Vitrin Studio'yu ayrıca kurun, bağımlılıklarını yükleyin ve gerekiyorsa kendi
`.env` dosyasını o projenin kökünde oluşturun. `.env` dosyasını bu repoya veya
GitHub'a kopyalamayın.

## MCP'yi hazırlama

```bash
git clone https://github.com/cosmnet/Vitrin.git
cd Vitrin/vitrin-mcp
npm ci
npm run build
npm run check:secrets
```

`VITRIN_DIR`, Vitrin Studio klasörünün mutlak yoludur. Ayarlanmazsa önce aynı
depodaki `../vitrin-studio`, sonra `~/Vitrin/vitrin-studio` aranır. Başka bir yerdeyse aşağıdaki örneklerdeki
yolu değiştirin.

Uzun işler için istemciye 10 dakikalık süre verin:

```bash
export VITRIN_DIR="$HOME/Vitrin/vitrin-studio"
export VITRIN_PORT=4780
```

## Codex

Codex CLI ile kullanıcı hesabına ekleyin:

```bash
codex mcp add vitrin \
  --env VITRIN_DIR="$HOME/Vitrin/vitrin-studio" \
  --env VITRIN_PORT=4780 \
  -- node "$HOME/Vitrin/vitrin-mcp/dist/index.js"

codex mcp list
```

Daha ayrıntılı ayar için [`examples/codex.config.toml`](../examples/codex.config.toml)
içindeki bloğu `~/.codex/config.toml` dosyasına ekleyebilirsiniz. Örnek, uzun
`vitrin_export` işleri için başlatma süresini 60 saniyeye, araç süresini 600
saniyeye çıkarır. TUI içinde `/mcp` ile bağlı sunucuları görürsünüz.

## Cursor

Global kullanım için `~/.cursor/mcp.json`; yalnızca açık proje için proje
kökündeki `.cursor/mcp.json` dosyasını oluşturun. [`examples/cursor.mcp.json`](../examples/cursor.mcp.json)
dosyasını kopyalayıp `/absolute/path/to/...` bölümlerini kendi yollarınızla
değiştirin.

Alternatif olarak Cursor'da **Settings / Customize → MCPs → Add New MCP**
üzerinden `node /.../Vitrin/vitrin-mcp/dist/index.js` komutunu, `stdio` türünde
ekleyin; `VITRIN_DIR` ve `VITRIN_PORT` ortam değişkenlerini tanımlayın.

## Claude Code

Kullanıcı hesabına eklemek için:

```bash
claude mcp add --scope user vitrin \
  --transport stdio \
  --env VITRIN_DIR="$HOME/Vitrin/vitrin-studio" \
  --env VITRIN_PORT=4780 \
  -- node "$HOME/Vitrin/vitrin-mcp/dist/index.js"

claude mcp list
```

Yalnızca belirli bir projede paylaşmak için proje kökünde `.mcp.json` oluşturup
[`examples/claude.mcp.json`](../examples/claude.mcp.json) içeriğini kullanın.
Claude Code proje kapsamındaki MCP sunucusu için ilk kullanımda onay isteyebilir.

Bu repo ayrıca Claude eklentisi olarak da düzenlenmiştir:

```text
/plugin marketplace add /absolute/path/to/Vitrin/vitrin-mcp
/plugin install vitrin@cosm-labs
```

Eklenti yolu MCP'yi ve Türkçe Vitrin iş akışı becerisini birlikte yükler. Bu
yöntemde Vitrin Studio varsayılan olarak `~/Vitrin/vitrin-studio` altında
aranır; farklı konum için Claude Code'u başlatmadan önce `VITRIN_DIR` ortam
değişkenini ayarlayın veya doğrudan `claude mcp add` yolunu kullanın.

## Doğrulama

İstemcide `vitrin_status` aracını çağırın. Başarılı sonuçta Vitrin Studio
sunucusu, port, klasör, tarayıcı/WebGL durumu ve proje sayısı görünür.

Sorun giderme:

- `Vitrin Studio klasörü bulunamadı`: `VITRIN_DIR` yolunu düzeltin.
- Sunucu başlamıyor: Vitrin Studio klasöründe `npm install` ve `npm run dev`
  çalıştırıp `http://127.0.0.1:4780` adresini kontrol edin.
- Tarayıcı bulunamadı: Chrome kurun veya `VITRIN_CHROME_CHANNEL=msedge` verin.
- Uzun işlem kesiliyorsa istemcinin araç zaman aşımını en az 600 saniyeye çıkarın;
  Vitrin tarafında `VITRIN_RENDER_TIMEOUT` değerini de en az `600000` yapın.
