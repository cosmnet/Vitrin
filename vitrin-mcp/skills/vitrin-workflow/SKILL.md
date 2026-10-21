---
name: vitrin-workflow
description: Vitrin Studio ile App Store ekran görüntüsü seti üretme akışı. Kullanıcı "Lumo için 10 screenshot yap", "ekran görüntülerini hazırla", "App Store görsellerini üret", "vitrin", "kurgula ve export al" gibi bir şey istediğinde ya da vitrin_* araçlarından biri gerektiğinde kullan.
---

# Vitrin akışı

Vitrin Studio, iOS uygulamaları için App Store ekran görüntüsü seti üreten bir
stüdyo. Sen `vitrin_*` araçlarıyla onu sürüyorsun. **Kullanıcıyla her zaman
Türkçe konuş.**

## Altın kurallar

1. **Önce `vitrin_status`.** Dev sunucu kapalıysa araç kendi başlatır; sen
   sadece sonucu söyle. Aynı çağrı proje listesini de verir.
2. **Ham JSON isteme, göstermeyi hiç deneme.** Proje dosyaları onlarca MB
   olabilir. Her araç zaten ÖZET döner; slayt tablosu için `vitrin_open_project`.
3. **Görsel göster, tarif etme.** Kurgu bitince `vitrin_render_contact_sheet`
   (10 slayt = 1 görsel). Tek slayt tartışılıyorsa `vitrin_render_preview`.
   Slayt slayt 10 ayrı önizleme ASLA çekme — token yakar.
4. **Yıkıcı işlemden önce sor.** `vitrin_import` ve `vitrin_art_direct` seçili
   dilin slaytlarını DEĞİŞTİRİR. Projede zaten slayt varsa önce "mevcut kurgu
   korunsun mu?" diye sor.
5. **Uzun işler.** `vitrin_art_direct` ve `vitrin_translate` Claude API'ye
   çıkar (1–3 dk); `vitrin_export` dil başına ~1–2 dk. Kullanıcıya süreyi söyle,
   sonucu bekle, araç çağrısını tekrarlama.
6. **Hata gelirse** (`isError`) mesajı olduğu gibi aktar ve önerilen adımı at —
   uydurma, yeniden denemeden önce nedeni söyle.

## Netleştirme soruları (iş başlamadan)

Kullanıcı "X için N screenshot yap" dediğinde önce şunları netleştir:

1. **Klasör** — ekran görüntüleri ve `*.md` kare dosyaları nerede?
   (`vitrin_scan_folder` ile doğrula, kaç dil/kaç görsel bulduğunu raporla.)
2. **Diller** — sadece `tr` mi, yoksa `en-US`, `de-DE`… de mi?
3. **Mevcut kurgu** — proje varsa: tasarımı koruyup slayt mı ekleyeyim, yoksa
   baştan mı kurgulayayım?

## Standart akış

```
vitrin_status
vitrin_list_projects            → proje var mı
vitrin_create_project           → yoksa
vitrin_scan_folder              → klasörde kaç dil, kaç görsel, dil kovaları
vitrin_import                   → kareler slayta, ekranlar eşleşir (designKey f01…)
vitrin_art_direct               → (opsiyonel) metinleri Claude kurgular
vitrin_render_contact_sheet     → KULLANICIYA GÖSTER
  ↳ düzeltmeler: vitrin_edit_slide / vitrin_apply_theme / vitrin_apply_template
  ↳ tek slayt kontrolü: vitrin_render_preview
vitrin_translate                → diğer diller
vitrin_sync_design              → tasarımı dillere yay (metin yerinde kalır)
vitrin_export                   → ~/Desktop/Vitrin/<app>/<dil>/01.png…
vitrin_open_studio              → kullanıcı elle devralmak isterse
```

`vitrin_import` zaten MD'den metin getiriyorsa `vitrin_art_direct` gerekmez;
Art Director yalnız "metin yok, ekranlara bakıp sen kurgula" durumunda çağrılır
ve içe aktarılmış metinleri EZER.

## Diller ve tasarım senkronu

- Slaytlar diller arasında `designKey` (MD kare numarası: `f01`, `f02`…) ile
  eşleşir, index ile değil.
- `vitrin_sync_design` yalnız **tasarımı** taşır: tema, yerleşim, zemin, cihaz,
  nudge, metin stilleri. Başlık, alt satır, rozet, ekran görüntüsü ve çelenk
  METNİ yerinde kalır.
- Motor RTL dillerde hizalamayı aynalar, kasasız yazılarda (ar/hi/ja/ko/zh)
  BÜYÜK HARF dönüşümünü atlar, hedef dilin yazısını kapsamayan fontu yazmaz.
  Bunlar `note` alanında raporlanır — kullanıcıya aktar.
- `vitrin_edit_slide` zaten otomatik yayar (proje senkronu açıksa). Ayrıca
  `vitrin_sync_design` çağırmana gerek yok.

## Export

- Varsayılan hedef `~/Desktop/Vitrin/<app>/<dil>/` — fastlane düzeni,
  `01.png … 10.png`.
- Varsayılan boyut `iphone-69` = **1320×2868**, App Store'un zorunlu ölçüsü.
  `iphone-65` ve `ipad-13` isteğe bağlı, `sizes` ile eklenir.
- Başka klasör isteniyorsa `outDir` ver.

## MD dosyası nasıl yazılır

**ELLE YAZMA — `vitrin_write_frames` kullan.** Araç kanonik biçimi kendisi
üretir (başlık satırı, alan adları, karakter sayısı) ve yazmadan ÖNCE
doğrular: eksik HEADLINE, tekrar eden kare numarası, SCREEN'siz SCREEN2,
bilinmeyen LAYOUT — hepsi dosya oluşmadan hata olarak döner. Format hatası
bu yolla mümkün değil.

```
vitrin_write_frames
  folder: "/Users/…/Lumo Screenshots"
  locale: "tr"
  frames: [
    { no: 1, title: "Today", headline: "Sıfır reklam, doğru vakit", screen: "bugun",
      layout: "device-bleed-bottom" },
    { no: 2, title: "Times + Transparency", headline: "Her vakit, ve nereden geldiği",
      screen: "vakitler", screen2: "seffaflik", layout: "split-v" }
  ]
```

Var olan dosyanın üzerine yazmak için `overwrite: true`.

**Vitrin artık serbest MD'leri de okuyor.** Alan biçimi hiç kare vermezse
motor ikinci bir toleranslı geçiş yapar: markdown TABLOSU
(`| R01 | tek | 01-bugun.png | Başlık |`) ya da numaralı liste
(`1. Başlık`) da kare üretir; sütun sırası serbesttir, sütunlar içeriğine
göre tanınır (numara / görsel adı / en uzun düz metin). Yani insan eliyle
yazılmış bir kare tablosu artık doğrudan içe aktarılabiliyor. Yine de
ÜRETİRKEN her zaman `vitrin_write_frames` kullan — toleranslı geçiş bir
kurtarma yolu, hedef biçim değil.

Aşağıdaki biçim, aracın ürettiği (ve parser'ın birinci sınıf okuduğu) hâldir.
`HEADLINE` bulunamayan kare **sessizce atılır** — hata vermez, slayt eksilir.

### Dosya ve klasör düzeni

- **Dosya adı = dil kodu.** `tr.md`, `en-US.md`, `ar-SA.md`. Uzantısız ad
  aynen locale olur (büyük/küçük harf korunur).
- Her dil için AYRI dosya, hepsi TEK klasörde.
- Ekran görüntüleri ya aynı klasörde ya da `<klasör>/<locale>/` alt
  klasöründe (dil kovası). Dil kovası varsa o dilin kareleri önce kendi
  kovasından eşleşir.

```
Lumo-frames/
├── tr.md      en-US.md      ar-SA.md
├── tr/        01-today.png  02-lock.png …
└── en-US/     01-today.png  02-lock.png …
```

### Kare iskeleti

```markdown
## 01 — Today
EYEBROW: VITRIN
LAUREL: App Store'da 4.9
HEADLINE: Sıfır reklam, doğru vakit
CHARS: 25
SUB: Tek uygulama. Tek satın alma.
SCREEN: today
```

- Başlık satırı: `##`…`####`, hemen ardından **1-3 haneli numara**, sonra
  isteğe bağlı ayraç (`—` `–` `-` `.` `:` `)`) ve ad.
  `## 01 — Today` · `### 3. Setup` · `## 10 - Closer` → hepsi geçerli.
- Numara `designKey` olur (`f01`, `f02`…) — diller arası eşleşme buradan
  yürür, sıradan değil. **Aynı kare her dilde aynı numarayı taşımalı.**

### Alanlar

| Alan (eş anlamlıları) | Slayt karşılığı | Not |
|---|---|---|
| `HEADLINE` / `TITLE` | başlık | **Tek zorunlu alan.** Yoksa `SUB` başlığa terfi eder; o da yoksa kare atılır. |
| `SUB` / `SUBTITLE` | alt satır | Yalnız `HEADLINE` de varsa alt satır kalır. |
| `EYEBROW` / `OVERLINE` / `BADGE` | rozet | |
| `LAUREL` | çelenk metni | |
| `SCREEN` / `SCREENSHOT` | ekran eşleşme ipucu | **Her dilde İNGİLİZCE ve aynı** yazılır — dosya adlarıyla eşleşir. |
| `SCREEN2` / `SCREENSHOT2` | ikinci ekran | Verilirse kare otomatik `split-v` olur. |
| `LAYOUT` | düzen | Otomatik `split-v`'yi ezer. Geçerli id'ler aşağıda. |
| `CHARS` | — | Sadece bilgi; yazarın saydığı karakter. Motor kullanmaz. |

Geçerli `LAYOUT` değerleri: `text-top` `text-bottom` `device-bleed-bottom`
`device-bleed-top` `text-overlay` `badge-hero` `split-diagonal` `split-v`
`split-h` `duo-overlap` `duo-depth` `trio-arc` `trio-stack` `panorama-mid`.
Bilinmeyen id yazılırsa yok sayılır.

### Parser'ın affettikleri

- Alan sırası serbest, alanlar eksik olabilir.
- `**HEADLINE:**` · `- HEADLINE:` gibi markdown süsleri ve sarmalayan
  tırnaklar temizlenir.
- `---` ayraçları, dosya başındaki serbest metin ve `## Notes` gibi
  numarasız başlıklar yok sayılır (numarasız başlık açık kareyi KAPATIR).
- Değer alt satıra taşarsa aynı alana eklenir.
- Aynı alan iki kez yazılmışsa **ilki** kalır.

### Sık yapılan hatalar — bunları YAPMA

| Yanlış | Doğru | Neden |
|---|---|---|
| `## Ekran 1` | `## 01 — Ekran` | Numara `##`'den hemen sonra gelmeli, yoksa kare değil. |
| `HEADLINE = Merhaba` | `HEADLINE: Merhaba` | Ayraç iki nokta; `=` satırları bilerek eşleşmez. |
| `BAŞLIK: Merhaba` | `HEADLINE: Merhaba` | Alan adları sabit ve İngilizce. |
| `SCREEN: bugün` (tr.md), `SCREEN: today` (en.md) | ikisinde de `SCREEN: today` | İpucu dosya adlarıyla eşleşir; dile göre değişirse eşleşme kopar. |
| Sadece `SUB:` yazmak | `HEADLINE:` yaz | Başlıksız kare atılır ya da alt satır başlığa terfi eder. |
| Karelerde numarayı dilden dile kaydırmak | her dilde aynı numara | `designKey` eşleşmesi ve tasarım senkronu numaradan yürür. |

### SCREEN eşleştirmesi nasıl çalışıyor

İpucu ve dosya adı kelimelere bölünür (Türkçe aksan düşürülür), `mode`,
`screen`, `page`, `final` gibi anlamsız kelimeler atılır. Dosya adı klasör
adından ağır basar; eşik altı puan gürültü sayılır. Hiçbiri tutmazsa son
çare **kare numarası ↔ dosya adındaki numara** (`## 04` ↔ `04-addtv.png`).

Pratik kural: dosyaları `01-today.png`, `02-lock.png` diye numara + İngilizce
anahtar kelimeyle adlandır, `SCREEN:` alanına da o anahtar kelimeyi yaz —
eşleşme neredeyse hiç şaşmaz.

### Yazdıktan sonra

MD'yi yazar yazmaz `vitrin_scan_folder` ile DOĞRULA: kaç dil, kaç kare, kaç
görsel bulundu? Kare sayısı beklenenden azsa yukarıdaki "sık yapılan
hatalar" tablosuna bak — büyük ihtimalle başlık satırı ya da `HEADLINE`.

## iPad setleri

Vitrin iPad'i AYRI PROJE olarak destekler: `vitrin_create_project` içine
`format: "ipad"` (portre 2064×2752) ya da `format: "ipad-landscape"` (yatay
2752×2064) ver. Cihaz prosedürel iPad Pro gövdesidir (düz kenar, ince bezel,
arka kamera adası); iPad'e özel temalar: ipad-masa, ipad-studyo, ipad-cam,
ipad-editoryal, ipad-gece (şablon kategorisi "iPad"). Yatay projede
`wide-left` / `wide-right` / `wide-hero` düzenleri kullan. Böyle bir proje 3:4 tuval (export 2064×2752, `ipad-13`)
ve tablet cihaz kullanır; 20 düzenin hepsi iPad'de de çalışır (yatay bütçe
tuval oranıyla birlikte değiştiği için yeniden ayar gerekmez).

- iPad projesine **iPad arayüzünden çekilmiş** ekran görüntüleri yüklenir;
  iPhone görselleri tablet ekranına kırpılarak oturur, güzel durmaz.
- Aynı uygulamanın iPhone ve iPad setleri iki projedir; metin/kurguyu
  iPhone projesinden alıp iPad projesine `vitrin_write_frames` ile taşımak
  en hızlı yol (kare numaraları ve SCREEN ipuçları aynen kalır, sadece klasör
  iPad ekranlarının klasörü olur).
- Export: iPad projesinde varsayılan boyut kendiliğinden `ipad-13`.

## Örnek konuşma

> **Kullanıcı:** Lumo için 10 screenshot yap
>
> **Claude** *(`vitrin_status` → sunucu kapalıydı, başlattı; `vitrin_list_projects` → "Lumo" var)*:
> Lumo projesi mevcut (tr, 6 slayt). Üç şey netleşsin: (1) Ekran görüntüleri
> hangi klasörde — `~/Desktop/Lumo/screens` mi? (2) Sadece **tr** mi, yoksa
> en/ar/de gibi diller de? (3) Mevcut 6 slaytın tasarımını koruyup 4 ekleyeyim
> mi, yoksa 10'unu baştan mı kurgulayayım?
>
> **Kullanıcı:** klasör doğru, tr + en, baştan kurgula
>
> **Claude** *(`vitrin_scan_folder` → 14 görsel, `tr.md`+`en.md`; `vitrin_import`;
> `vitrin_art_direct n=10 locale=tr`; `vitrin_render_contact_sheet` → görsel döner)*:
> 10 slaytlık kurgu hazır — kontak sayfası yukarıda. 3. slaytta başlık iki
> satıra taşmış, 7'de tema koyu kalmış. Düzelteyim mi?
>
> **Kullanıcı:** düzelt, sonra en'e de çek ve export al
>
> **Claude** *(`vitrin_edit_slide` ×2 → `vitrin_render_preview slide=3` →
> `vitrin_translate langs=["en"]` → `vitrin_sync_design from=tr to=all` →
> `vitrin_export locales=all sizes=["iphone-69"]`)*:
> Bitti — `~/Desktop/Vitrin/Lumo/tr` ve `/en` altında 10'ar PNG (1320×2868).
> Elden geçirmek istersen `vitrin_open_studio` ile stüdyoyu açayım.

## Sık karşılaşılanlar

| Belirti | Anlamı / çözüm |
|---|---|
| `EŞLEŞMEYEN kare: 09` | O karenin `SCREEN:` ipucuna uyan görsel yok. Slayt ekransız basılır. `vitrin_edit_slide` + `screenshotId` ile elle bağla. |
| "Tarayıcıda WebGL yok" | Render iptal edildi — WebGL olmadan telefon SESSİZCE çizilmez, bozuk çıktı yerine hata verilir. Chrome'u güncelle. |
| "Projede olmayan dil" | Mevcut diller hata mesajında listelenir. Önce `vitrin_translate` ya da `vitrin_import`. |
| `ÇEVİRİLMEDİ` işareti | O slaytın metni kaynak dilden kopyalandı, çevrilmedi. `vitrin_translate` tekrar çalıştır ya da elle düzelt. |
| Export uzun sürüyor | Normal: dil başına 10 slayt ~70 MB PNG üretilip diske yazılıyor. |
