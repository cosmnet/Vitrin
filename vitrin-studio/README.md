# Vitrin Studio

App Store review görsellerini otomatik üreten, elle düzenlenebilen yerel stüdyo.

## Çalıştırma

- Çift tık: `Başlat.command` — veya `npm run dev` → http://localhost:4780
- Anahtarlar `.env`'de (`WIRO_API_KEY/SECRET` hazır; vision'lı Art Director için `ANTHROPIC_API_KEY` ekle).

## Akış

1. **Ekranlar** → uygulamanın ham UI ekran görüntülerini at.
2. **✦ Otomatik plan** → brief yaz/MD yükle → LLM seti kurar (başlıklar + tema + kadraj + ekran eşleşmesi).
3. Beğenmediğini elle düzelt: tema, layout, arka plan (shader/görsel/Wiro üretimi), 3D açı (sürükle), font, renk.
4. **Lokalize** → tek istekte N dile; her dil ayrı sekme.
5. **Export** → `~/Desktop/Vitrin/<App>/<dil>/01..10.png` (1320×2868 + seçtiklerin).
6. **Kaydet** → proje `data/projects/` içinde JSON; aynı JSON aynı görseli üretir (tekrarlanabilir).

Mimari için `PLAN.md`.
