// Font registry + FontFace yükleyici. Canvas çiziminden önce loadFonts() bekle.
//
// TÜRKÇE NOTU
// Şikayet edilen "bozuk karakter" sorununun sebebi fontun kendisi değil,
// ALTKÜMESİYDİ: Fraunces / Playfair / Syne / Outfit dosyaları yalnızca "latin"
// altkümesiyle indirilmişti, yani ş Ş ğ Ğ İ glifleri dosyada hiç yoktu ve
// tarayıcı harf harf sistem fontuna düşüyordu. Hepsi latin-ext ile yenilendi.
//
// `turkish` alanı tahmin değil ÖLÇÜM: scripts/check-glyphs.mjs her dosyanın
// cmap tablosunu açıp U+015F ş, U+011F ğ, U+0130 İ, U+0131 ı ve ç/ö/ü
// çiftlerini gerçekten arıyor. Font seti değişince tekrar çalıştır:
//   node scripts/fetch-fonts.mjs      # latin-ext woff2 indir
//   node scripts/check-glyphs.mjs     # kapsama raporu

// ---------------------------------------------------------------------------
// R7 / Wave-1 — LATİN DIŞI YAZILAR
//
// 15 dilin 6'sı (ar-SA, hi, ja, ko, ru, zh-Hans) bugüne kadar TOFU basıyordu:
// buradaki her dosya latin-ext altkümesiyle indirilmişti, yani Arap/Devanagari/
// CJK/Kiril glifleri hiçbir dosyada YOKTU. `scripts` alanı — `turkish` gibi —
// TAHMİN DEĞİL, scripts/check-glyphs.mjs'in cmap ölçümüdür:
//   node scripts/fetch-fonts.mjs && node scripts/check-glyphs.mjs
//
// İki ayrı çözüm izlendi:
//   1) Kiril'i OLAN aileler kendi kiril altkümeleriyle YENİDEN indirildi
//      (Manrope / Playfair / Unbounded / Caveat / Lora / Cormorant) — tema
//      görünümü ru'da da korunur. Dosya eki: `-latinext-cyr`.
//   2) Kiril'i OLMAYAN aileler (Outfit, Sora, Space Grotesk, Figtree, Syne,
//      Bricolage, Anton, Archivo Black, Fraunces, DM Serif + yerel Kiltier /
//      Arseri / BetroVogue) ve Arap/Devanagari/CJK için Noto aileleri eklendi.
//
// YÜKLEME — ÖNEMLİ
// loadFonts() latin + Kiril + Arapça + Devanagari'yi EAGER yükler, yani
// ru / ar-SA / hi hiçbir ek bağlantı olmadan bugün doğru basar.
// CJK yüzleri (ja / ko / zh-Hans) ~16 MB'dır ve `lazy: true` ile İSTEK ÜZERİNE
// gelir: dil değişiminde ya da export'tan ÖNCE `loadFontsForLocale(locale)`
// çağrılmalı. Çağrılmazsa CJK metin sistem fontuna düşer (headless export'ta tofu).
// Curated ek paket: 8 tam TTF, toplam 2.41 MB; EAGER sete dahildir.
// ---------------------------------------------------------------------------

/**
 * "latin" burada latin + latin-ext demektir (yani Türkçe ş/ğ/İ dahil) —
 * projenin her yerinde geçerli sözleşme. Sadece ASCII içeren bir dosya
 * "latin" SAYILMAZ (bkz. Noto Sans JP/KR/SC).
 */
export type FontScript =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "devanagari"
  | "jp"
  | "kr"
  | "sc";

export type FontDef = {
  family: string;
  file: string;
  weight: number;
  style?: "normal" | "italic";
  /** Ailenin İLK kaydındaki label, picker'da aile adı olarak kullanılır. */
  label: string;
  category: "display" | "serif" | "sans";
  /** false = ş/ğ/İ eksik. Atlanırsa tam destek varsayılır. */
  turkish?: boolean;
  /** Dosyanın GERÇEKTEN içerdiği yazılar. Atlanırsa ["latin"] sayılır. */
  scripts?: FontScript[];
  /** true = curated picker'da (FONT_FAMILIES) görünmez; yalnız script yedeği. */
  scriptOnly?: boolean;
  /** true = loadFonts() ile EAGER yüklenmez. MB'lık CJK dosyaları için. */
  lazy?: boolean;
};

/** Kayıtta scripts yoksa latin varsayılır — eski girdiler olduğu gibi çalışır. */
function scriptsOf(f: FontDef): FontScript[] {
  return f.scripts || ["latin"];
}

export const FONTS: FontDef[] = [
  // Curated full TTFs: 400/600/700 share one variable file per family.
  // Turkish cmap verified; no additional script coverage is claimed.
  // Sources, OFL licenses and hashes: public/assets/fonts/curated/provenance.json.
  ...([
    ["Plus Jakarta Sans", "plusjakartasans", "sans"],
    ["DM Sans", "dmsans", "sans"],
    ["Onest", "onest", "sans"],
    ["Urbanist", "urbanist", "sans"],
    ["Bodoni Moda", "bodonimoda", "serif"],
    ["Newsreader", "newsreader", "serif"],
    ["Commissioner", "commissioner", "sans"],
    ["Rubik", "rubik", "sans"],
  ] as const).flatMap(([family, id, category]) =>
    [400, 600, 700].map((weight): FontDef => ({
      family, file: `/assets/fonts/curated/${id}/roman.ttf`, weight,
      label: weight === 400 ? family : `${family} ${weight === 600 ? "SemiBold" : "Bold"}`,
      category, turkish: true, scripts: ["latin"],
    }))
  ),
  // ---------------- Sans ----------------
  { family: "Outfit", file: "/assets/fonts/Outfit-500-latinext.woff2", weight: 500, label: "Outfit", category: "sans" },
  { family: "Outfit", file: "/assets/fonts/Outfit-700-latinext.woff2", weight: 700, label: "Outfit Bold", category: "sans" },
  { family: "Manrope", file: "/assets/fonts/Manrope-500-latinext-cyr.woff2", weight: 500, label: "Manrope", category: "sans", scripts: ["latin", "cyrillic"] },
  { family: "Manrope", file: "/assets/fonts/Manrope-800-latinext-cyr.woff2", weight: 800, label: "Manrope ExtraBold", category: "sans", scripts: ["latin", "cyrillic"] },
  { family: "Figtree", file: "/assets/fonts/Figtree-500-latinext.woff2", weight: 500, label: "Figtree", category: "sans" },
  { family: "Sora", file: "/assets/fonts/Sora-400-latinext.woff2", weight: 400, label: "Sora", category: "sans" },
  { family: "Sora", file: "/assets/fonts/Sora-700-latinext.woff2", weight: 700, label: "Sora Bold", category: "sans" },
  { family: "Space Grotesk", file: "/assets/fonts/SpaceGrotesk-500-latinext.woff2", weight: 500, label: "Space Grotesk", category: "sans" },
  { family: "Space Grotesk", file: "/assets/fonts/SpaceGrotesk-700-latinext.woff2", weight: 700, label: "Space Grotesk Bold", category: "sans" },
  { family: "Instrument Sans", file: "/assets/fonts/InstrumentSans-500-latinext.woff2", weight: 500, label: "Instrument Sans", category: "sans" },
  { family: "Instrument Sans", file: "/assets/fonts/InstrumentSans-700-latinext.woff2", weight: 700, label: "Instrument Sans Bold", category: "sans" },
  // Mono — brutalist/teknik temaların yüzü. Kiril'i de var, ru'da yüz değişmez.
  { family: "JetBrains Mono", file: "/assets/fonts/JetBrainsMono-500-latinext-cyr.woff2", weight: 500, label: "JetBrains Mono", category: "sans", scripts: ["latin", "cyrillic"] },
  { family: "JetBrains Mono", file: "/assets/fonts/JetBrainsMono-700-latinext-cyr.woff2", weight: 700, label: "JetBrains Mono Bold", category: "sans", scripts: ["latin", "cyrillic"] },

  // ---------------- Display ----------------
  { family: "Kiltier", file: "/assets/fonts/Kiltier-Regular.woff2", weight: 400, label: "Kiltier", category: "display" },
  { family: "Kiltier", file: "/assets/fonts/Kiltier-SemiBold.woff2", weight: 600, label: "Kiltier SemiBold", category: "display" },
  { family: "Kiltier", file: "/assets/fonts/Kiltier-Bold.woff2", weight: 700, label: "Kiltier Bold", category: "display" },
  { family: "Syne", file: "/assets/fonts/Syne-700-latinext.woff2", weight: 700, label: "Syne", category: "display" },
  { family: "Bricolage Grotesque", file: "/assets/fonts/BricolageGrotesque-700-latinext.woff2", weight: 700, label: "Bricolage Grotesque", category: "display" },
  { family: "Unbounded", file: "/assets/fonts/Unbounded-600-latinext-cyr.woff2", weight: 600, label: "Unbounded", category: "display", scripts: ["latin", "cyrillic"] },
  { family: "Archivo Black", file: "/assets/fonts/ArchivoBlack-400-latinext.woff2", weight: 400, label: "Archivo Black", category: "display" },
  { family: "Anton", file: "/assets/fonts/Anton-400-latinext.woff2", weight: 400, label: "Anton", category: "display" },
  { family: "Caveat", file: "/assets/fonts/Caveat-600-latinext-cyr.woff2", weight: 600, label: "Caveat", category: "display", scripts: ["latin", "cyrillic"] },

  // ---------------- Serif ----------------
  { family: "Fraunces", file: "/assets/fonts/Fraunces-600-latinext.woff2", weight: 600, label: "Fraunces", category: "serif" },
  { family: "Playfair Display", file: "/assets/fonts/PlayfairDisplay-600-latinext-cyr.woff2", weight: 600, label: "Playfair", category: "serif", scripts: ["latin", "cyrillic"] },
  { family: "DM Serif Display", file: "/assets/fonts/DMSerifDisplay-400-latinext.woff2", weight: 400, label: "DM Serif Display", category: "serif" },
  { family: "Instrument Serif", file: "/assets/fonts/InstrumentSerif-400-latinext.woff2", weight: 400, label: "Instrument Serif", category: "serif" },
  { family: "Instrument Serif", file: "/assets/fonts/InstrumentSerif-400i-latinext.woff2", weight: 400, style: "italic", label: "Instrument Serif Italic", category: "serif" },
  { family: "Lora", file: "/assets/fonts/Lora-500-latinext-cyr.woff2", weight: 500, label: "Lora", category: "serif", scripts: ["latin", "cyrillic"] },
  { family: "Lora", file: "/assets/fonts/Lora-600-latinext-cyr.woff2", weight: 600, label: "Lora SemiBold", category: "serif", scripts: ["latin", "cyrillic"] },
  { family: "Lora", file: "/assets/fonts/Lora-400i-latinext-cyr.woff2", weight: 400, style: "italic", label: "Lora Italic", category: "serif", scripts: ["latin", "cyrillic"] },
  { family: "Cormorant Garamond", file: "/assets/fonts/CormorantGaramond-600-latinext-cyr.woff2", weight: 600, label: "Cormorant Garamond", category: "serif", scripts: ["latin", "cyrillic"] },
  { family: "Arseri", file: "/assets/fonts/Arseri.otf", weight: 400, label: "Arseri", category: "serif" },
  { family: "Arseri", file: "/assets/fonts/Arseri-Italic.otf", weight: 400, style: "italic", label: "Arseri Italic", category: "serif" },

  // ---------------- Türkçesi eksik ----------------
  // BetroVogue gerçekten ş/Ş/ğ/Ğ/İ içermiyor (ölçüldü). Tema bozulmasın diye
  // kaldırmıyoruz; picker'da işaretli görünür.
  { family: "BetroVogue", file: "/assets/fonts/BETROVOGUE-Regular.woff2", weight: 400, label: "Betro Vogue", category: "serif", turkish: false },

  // ------------- Latin dışı yedekler (scriptOnly: curated picker'da yok) -------------
  // Kiril/Arapça/Devanagari yüzleri latin + latin-ext DE içerir: marka adı, rakam
  // ve Türkçe glifler aynı yüzde kalır, karışık cümlede yüz değişmez.
  // CJK yüzleri içermez — aşağıdaki ölçüm uyarısına bak.

  // ru — Kiril'i olmayan aileler için gövde yedeği.
  { family: "Noto Sans", file: "/assets/fonts/NotoSans-400-cyr.woff2", weight: 400, label: "Noto Sans", category: "sans", scripts: ["latin", "cyrillic"], scriptOnly: true },
  { family: "Noto Sans", file: "/assets/fonts/NotoSans-700-cyr.woff2", weight: 700, label: "Noto Sans Bold", category: "sans", scripts: ["latin", "cyrillic"], scriptOnly: true },

  // ar-SA — Kufi, App Store başlıkları için Naskh'tan daha "display".
  { family: "Noto Kufi Arabic", file: "/assets/fonts/NotoKufiArabic-400-arabic.woff2", weight: 400, label: "Noto Kufi Arabic", category: "sans", scripts: ["latin", "arabic"], scriptOnly: true },
  { family: "Noto Kufi Arabic", file: "/assets/fonts/NotoKufiArabic-700-arabic.woff2", weight: 700, label: "Noto Kufi Arabic Bold", category: "sans", scripts: ["latin", "arabic"], scriptOnly: true },

  // hi
  { family: "Noto Sans Devanagari", file: "/assets/fonts/NotoSansDevanagari-400-devanagari.woff2", weight: 400, label: "Noto Sans Devanagari", category: "sans", scripts: ["latin", "devanagari"], scriptOnly: true },
  { family: "Noto Sans Devanagari", file: "/assets/fonts/NotoSansDevanagari-700-devanagari.woff2", weight: 700, label: "Noto Sans Devanagari Bold", category: "sans", scripts: ["latin", "devanagari"], scriptOnly: true },

  // ja / ko / zh-Hans — 2-4 MB'lık tek parça dosyalar. lazy: true ⇒ loadFonts()
  // bunları İNDİRMEZ; ensureScriptFonts()/loadFontsForLocale() ile talep üzerine gelir.
  //
  // ÖLÇÜM UYARISI: Google'ın CJK "latin-ext" altkümesi ş/Ş/ğ/Ğ/ı/İ İÇERMİYOR
  // (check-glyphs kanıtı). Bu yüzden `scripts` içinde "latin" YOK ve turkish:false.
  // Karışık cümlede Türkçe glifler cssFont() yedek zincirindeki Noto Sans'tan gelir.
  { family: "Noto Sans JP", file: "/assets/fonts/NotoSansJP-400-jp.woff2", weight: 400, label: "Noto Sans JP", category: "sans", scripts: ["jp"], turkish: false, scriptOnly: true, lazy: true },
  { family: "Noto Sans JP", file: "/assets/fonts/NotoSansJP-700-jp.woff2", weight: 700, label: "Noto Sans JP Bold", category: "sans", scripts: ["jp"], turkish: false, scriptOnly: true, lazy: true },
  { family: "Noto Sans KR", file: "/assets/fonts/NotoSansKR-400-kr.woff2", weight: 400, label: "Noto Sans KR", category: "sans", scripts: ["kr"], turkish: false, scriptOnly: true, lazy: true },
  { family: "Noto Sans KR", file: "/assets/fonts/NotoSansKR-700-kr.woff2", weight: 700, label: "Noto Sans KR Bold", category: "sans", scripts: ["kr"], turkish: false, scriptOnly: true, lazy: true },
  { family: "Noto Sans SC", file: "/assets/fonts/NotoSansSC-400-sc.woff2", weight: 400, label: "Noto Sans SC", category: "sans", scripts: ["sc"], turkish: false, scriptOnly: true, lazy: true },
  { family: "Noto Sans SC", file: "/assets/fonts/NotoSansSC-700-sc.woff2", weight: 700, label: "Noto Sans SC Bold", category: "sans", scripts: ["sc"], turkish: false, scriptOnly: true, lazy: true },
];

/** Bir ailenin herhangi bir dosyası eksikse aile "TR sınırlı" sayılır. */
function familyHasTurkish(family: string): boolean {
  return FONTS.filter((f) => f.family === family).every((f) => f.turkish !== false);
}

export type FontFamilyInfo = {
  family: string;
  label: string;
  category: FontDef["category"];
  turkish: boolean;
};

// UI seçicileri için benzersiz aile listesi — önce Türkçesi tam olanlar.
// scriptOnly aileler (Noto*) BURAYA GİRMEZ: curated picker aynen korunur,
// onlar fallbackFamilyForLocale() ile otomatik seçilir. Elle seçtirmek isteyen
// UI FONT_FAMILIES_ALL'ı kullanır.
export const FONT_FAMILIES: FontFamilyInfo[] = FONTS.filter((f) => !f.scriptOnly).filter(
  (f, i, arr) => arr.findIndex((g) => g.family === f.family) === i
)
  .map((f) => {
    const turkish = familyHasTurkish(f.family);
    return {
      family: f.family,
      // label: ailenin ilk kaydındaki temiz ad + eksikse uyarı eki
      label: turkish ? f.label : `${f.label} · TR sınırlı`,
      category: f.category,
      turkish,
    };
  })
  // stabil sıralama: tam destekliler üstte, grup içi sıra FONTS sırasını korur
  .sort((a, b) => Number(b.turkish) - Number(a.turkish));

/** Aile Türkçe gliflerini tam içeriyor mu? Bilinmeyen aile için true. */
export function isTurkishSafe(family: string): boolean {
  const info = FONT_FAMILIES.find((f) => f.family === family);
  return info ? info.turkish : true;
}

/** Curated liste + latin dışı yedekler. Script yüzlerini de seçtirmek isteyen UI için. */
export const FONT_FAMILIES_ALL: (FontFamilyInfo & { scripts: FontScript[] })[] = FONTS.filter(
  (f, i, arr) => arr.findIndex((g) => g.family === f.family) === i
).map((f) => {
  const turkish = familyHasTurkish(f.family);
  return {
    family: f.family,
    label: turkish ? f.label : `${f.label} · TR sınırlı`,
    category: f.category,
    turkish,
    scripts: scriptsOf(f),
  };
});

// ---------------------------------------------------------------------------
// Locale → yazı (script) eşlemesi
// ---------------------------------------------------------------------------

/**
 * Dil kodundan yazıyı çıkarır. Kod uzayı üç yerde farklı ("ru", "ru-RU",
 * "zh-Hans", "zh_CN"…), o yüzden normalize edip ÖN EK'e bakıyoruz.
 * Listede olmayan her şey latin — bugünkü davranış.
 */
export function scriptForLocale(locale: string): FontScript {
  const tag = String(locale || "").toLowerCase().replace(/_/g, "-");
  const lang = tag.split("-")[0];
  // zh-Hans / zh-CN / zh-Hant / zh-TW — hepsi Noto Sans SC'ye gider.
  // NOT: SC seti Geleneksel Çince'yi (zh-Hant) TAM kapsamaz; App Store
  // dillerinde zh-Hans var, Hant için tofu'dan iyisi diye yine SC veriliyor.
  if (lang === "zh") return "sc";
  switch (lang) {
    case "ru":
    case "uk":
    case "be":
    case "bg":
    case "sr":
    case "mk":
    case "kk":
      return "cyrillic";
    case "ar":
    case "fa":
    case "ur":
      return "arabic";
    case "hi":
    case "mr":
    case "ne":
      return "devanagari";
    case "ja":
      return "jp";
    case "ko":
      return "kr";
    default:
      return "latin";
  }
}

/** Latin harfli olmayan diller — büyük harf dönüşümü ve hizalama için. */
export function isCaselessScript(script: FontScript): boolean {
  return script !== "latin" && script !== "cyrillic";
}

/** Sağdan sola yazılan diller (bugün yalnız Arap yazısı). */
export function isRtlLocale(locale: string): boolean {
  return scriptForLocale(locale) === "arabic";
}

/**
 * Aile bu dilin yazısını GERÇEKTEN içeriyor mu?
 * `isTurkishSafe` deseninde: ailenin TEK bir dosyası bile o yazıyı içermiyorsa
 * aile kapsamıyor sayılır (ağırlık değişince tofu'ya düşmesin).
 * Bilinmeyen aile: latin için iyimser true, latin dışı için false.
 */
export function fontCoversLocale(family: string, locale: string): boolean {
  const script = scriptForLocale(locale);
  const faces = FONTS.filter((f) => f.family === family);
  if (!faces.length) return script === "latin";
  return faces.every((f) => scriptsOf(f).includes(script));
}

/** Yazı başına yedek aile — kategoriye göre, tasarım karakteri korunsun diye. */
const SCRIPT_FALLBACK: Record<FontScript, Record<FontDef["category"], string>> = {
  latin:      { sans: "Outfit",              serif: "Lora",              display: "Syne" },
  // ru: Kiril'i olan tasarım aileleri önce; düz gövde için Noto Sans.
  cyrillic:   { sans: "Noto Sans",           serif: "Lora",              display: "Unbounded" },
  // Aşağıdakilerde tek aile var — kategori fark etmez.
  arabic:     { sans: "Noto Kufi Arabic",    serif: "Noto Kufi Arabic",  display: "Noto Kufi Arabic" },
  devanagari: { sans: "Noto Sans Devanagari", serif: "Noto Sans Devanagari", display: "Noto Sans Devanagari" },
  jp:         { sans: "Noto Sans JP",        serif: "Noto Sans JP",      display: "Noto Sans JP" },
  kr:         { sans: "Noto Sans KR",        serif: "Noto Sans KR",      display: "Noto Sans KR" },
  sc:         { sans: "Noto Sans SC",        serif: "Noto Sans SC",      display: "Noto Sans SC" },
};

/**
 * Bu dil için kayıtlı EN İYİ aile. `category` verilirse (mevcut fontun
 * kategorisi) aynı karakterde bir yedek seçilir — serif tema ru'da serif kalır.
 */
export function fallbackFamilyForLocale(
  locale: string,
  category: FontDef["category"] = "sans"
): string {
  const script = scriptForLocale(locale);
  const wanted = SCRIPT_FALLBACK[script][category];
  if (FONTS.some((f) => f.family === wanted) && fontCoversLocale(wanted, locale)) return wanted;
  // Defter bozulmuşsa: o yazıyı kapsayan ilk kayıtlı aile, o da yoksa Outfit.
  const any = FONTS.find((f) => scriptsOf(f).includes(script));
  return any ? any.family : "Outfit";
}

/** Aile bu dili kapsıyorsa aynen; kapsamıyorsa aynı kategoriden yedek. */
export function familyForLocale(family: string, locale: string): string {
  if (fontCoversLocale(family, locale)) return family;
  const known = FONTS.find((f) => f.family === family);
  return fallbackFamilyForLocale(locale, known?.category ?? "sans");
}

// ---------------------------------------------------------------------------
// Yükleyici
// ---------------------------------------------------------------------------

// Face identity includes descriptors: variable files can back multiple weights.
// The browser HTTP cache still reuses the shared URL's downloaded bytes.
const faceCache = new Map<string, Promise<void>>();

/** Load only the typography used by this slide, including its locale fallback. */
export function ensureSlideFonts(slide: import("./types").Slide, theme: import("./types").Theme, locale = "tr"): Promise<void> {
  const families = new Set([
    slide.headlineStyle?.fontFamily || theme.headline.fontFamily,
    slide.subStyle?.fontFamily || theme.sub.fontFamily,
    theme.badge?.fontFamily || "Instrument Sans",
    "Instrument Sans", "Inter", "Noto Sans",
    fallbackFamilyForLocale(locale),
    ...(slide.elements || []).filter(e => e.kind === "text").map(e => e.style?.fontFamily || "Inter"),
  ]);
  for (const family of [...families]) families.add(familyForLocale(family, locale));
  return loadMany(FONTS.filter(f => families.has(f.family)));
}

function loadFace(f: FontDef): Promise<void> {
  const key = JSON.stringify([f.file, f.family, f.weight, f.style || "normal"]);
  let p = faceCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const face = new FontFace(f.family, `url(${encodeURI(f.file)})`, {
          weight: String(f.weight),
          style: f.style || "normal",
        });
        await face.load();
        document.fonts.add(face);
      } catch {
        // font yüklenemezse sistem fallback ile devam
      }
    })();
    faceCache.set(key, p);
  }
  return p;
}

function loadMany(list: FontDef[]): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  return Promise.all(list.map(loadFace)).then(() => undefined);
}

let loaded: Promise<void> | null = null;

/**
 * Eager set: latin + Kiril + Arapça + Devanagari, curated tam TTF'ler dahil.
 * CJK yüzleri (lazy: true, ~16 MB) BİLEREK dışarıda — ja/ko/zh açılırken
 * loadFontsForLocale() ile gelir.
 */
export function loadFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (loaded) return loaded;
  loaded = loadMany(FONTS.filter((f) => !f.lazy));
  return loaded;
}

/** Tek bir yazının tüm yüzlerini yükler (CJK dahil). Tekrar çağırmak ücretsiz. */
export function ensureScriptFonts(script: FontScript): Promise<void> {
  return loadMany(FONTS.filter((f) => scriptsOf(f).includes(script)));
}

/**
 * Bir dilin çizilebilmesi için gereken HER ŞEYİ yükler.
 * Render/export başlamadan önce çağrılmalı — bkz. R7-W1 wiring notları.
 */
export async function loadFontsForLocale(locale: string): Promise<void> {
  await loadFonts();
  await ensureScriptFonts(scriptForLocale(locale));
}

/** Hepsini (CJK ve curated dahil) yükler. Tam matris export'u öncesi kullanılır. */
export function prefetchAllScripts(): Promise<void> {
  return loadMany(FONTS);
}

function quoteFamily(family: string): string {
  return /\s/.test(family) ? `"${family}"` : family;
}

/**
 * Latin dışı ağ: birincil aile bir glifi içermiyorsa tarayıcı KARAKTER BAŞINA
 * bu zincire düşer. Yüklenmemiş aileler zincirde zararsızdır (atlanır), o yüzden
 * CJK yüzleri lazy kalsa bile burada durabilir.
 * Sistem fontuna düşmek yerine buraya düşmek export'u platformdan bağımsız yapar
 * (headless Chrome'da sistem CJK fontu olmayabilir).
 */
const FALLBACK_CHAIN = [
  "Noto Sans",
  "Noto Kufi Arabic",
  "Noto Sans Devanagari",
  "Noto Sans JP",
  "Noto Sans KR",
  "Noto Sans SC",
]
  .map(quoteFamily)
  .join(", ");

export function cssFont(weight: number, sizePx: number, family: string, italic?: boolean): string {
  const fam = quoteFamily(family);
  return `${italic ? "italic " : ""}${weight} ${sizePx}px ${fam}, ${FALLBACK_CHAIN}, -apple-system, sans-serif`;
}
