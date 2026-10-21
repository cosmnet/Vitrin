// Şablon kütüphanesi — 8 hazır set kurgusu.
//
// Bir şablon "hangi tema + hangi yerleşim + hangi kamera, kaçıncı slaytta"
// sorusunun cevabıdır. İki kullanım yeri var:
//
//   build(n)   → n slaytlık, placeholder metinli taze bir set (boş projeler
//                ve "Şablonlar" bölümü için)
//   style(i)   → var olan i. slaytı şablonun o adımına göre yeniden giydirir;
//                metin, rozet, ekran görüntüsü ve süs olduğu gibi kalır.
//                MD içe aktarma bunu kullanır: metin MD'den, giysi şablondan.
//
// Adımlar bilerek tekdüze değil: aynı temanın altBackgrounds çeşitlemeleri ve
// kamera açıları dönüşümlü kullanılır, böylece 8-10 slaytlık set sayfa sayfa
// aynı kadraja düşmez.

import { privateLegacyTemplates } from "@private";
import { COLLECTIONS } from "./collections";
import { L } from "@/lib/i18n";
import { BRAND_TEMPLATES } from "./brandTemplates";
import { THEMES, getTheme } from "./themes";
import {
  uid,
  type Background,
  type CameraPresetId,
  type DeviceStyle,
  type LayoutId,
  type Slide,
  type SlideElement,
} from "./types";

/* ------------------------------------------------------------------ *
   Tipler
 * ------------------------------------------------------------------ */

export type TemplateId = `${(typeof COLLECTIONS)[number]["id"]}-${"iphone" | "ipad" | "duo"}`
  | "fintech-bold"
  | "dark-neon"
  | "editorial-lux"
  | "clean-apple"
  | "playful"
  | "riso-zine"
  | "panorama-trio"
  | "award-editors-choice"
  | "award-rating"
  | "award-rank-one"
  | "award-blank"
  // --- R10: yeni temaların set kurguları ---
  | "glass-product"
  | "brutalist-zine"
  | "paper-press"
  | "mono-manifesto"
  | "dune-story"
  // --- R11: yeni on temanın set kurguları ---
  | "bento-panel"
  | "chrome-launch"
  | "film-story"
  | "colour-press"
  | "clay-habit"
  | "zine-white"
  | "notebook"
  | "calm-daily"
  | "panorama-city"
  | "stat-hero"
  | "diptik-katalog"
  | "aurora-lansman"
  | "gece-altin-seri"
  | "isvicre-afis"
  | "terracotta-yaz"
  | "sivi-cam-seti"
  | "buz-cam-seti"
  | "klein-blur-seti"
  | "ipad-masa-seti"
  | "ipad-studyo-seti"
  | "ipad-cam-seti"
  | "ipad-editoryal-seti"
  | "ipad-gece-seti"
  | "split-onboarding"
  | "split-workflow"
  | "ipad-workspace-seti"
  | "ipad-review-seti"
  | "glacier-studio-ipad"
  | "glacier-studio-duo"
  | "midnight-graphite-ipad"
  | "midnight-graphite-duo"
  | "warm-editorial-ipad"
  | "warm-editorial-duo";

/** Galeri sekmesi. Şablon tanımında belirtilmezse "hero" kabul edilir. */
export type TemplateKategori = "hero" | "award" | "minimal" | "panorama" | "ipad" | "split" | "duo";

/** Galeri sekme sırası ve Türkçe etiketleri ("all" = Tümü). */
export const TEMPLATE_KATEGORILER: { id: TemplateKategori | "all"; label: string }[] = [
  { id: "all", label: L("Tümü", "All") },
  { id: "hero", label: "Hero" },
  { id: "award", label: L("Ödül", "Awards") },
  { id: "minimal", label: "Minimal" },
  { id: "panorama", label: "Panorama" },
  { id: "split", label: L("İki özellik", "Two features") },
  { id: "duo", label: "iPhone Duo" },
  { id: "ipad", label: "iPad" },
];

/** Bir slaytın "giysisi" — metin dışındaki her şey. */
export type SlideStyle = {
  themeId: string;
  layout: LayoutId;
  background?: Background;
  device?: DeviceStyle;
  frameLabel?: string;
  hideDevice?: boolean;
  elements?: SlideElement[];
  headlineStyle?: Slide["headlineStyle"];
  subStyle?: Slide["subStyle"];
  textOffset?: Slide["textOffset"];
  deviceOffset?: Slide["deviceOffset"];
  device2Offset?: Slide["device2Offset"];
  device3Offset?: Slide["device3Offset"];
};

export type Template = {
  id: TemplateId;
  name: string;
  /** Tek satırlık karakter tarifi — diyalogda alt satır olarak görünür. */
  hint: string;
  /** Önizleme noktasının rengi (temanın vurgu rengi). */
  color: string;
  /** Galeri sekmesi — tanımlanmamış şablonlar "hero" sayılır. */
  kategori: TemplateKategori;
  themeId: string;
  family?: "iphone" | "ipad" | "duo";
  /** Boş projede kaç slayt üretilir. */
  defaultCount: number;
  /** i. adımın giysisi (adımlar biterse baştan döner). */
  style: (i: number) => SlideStyle;
  /** n slaytlık placeholder set. */
  build: (n?: number) => Slide[];
};

/* ------------------------------------------------------------------ *
   Kurucu
 * ------------------------------------------------------------------ */

type Step = {
  layout: LayoutId;
  /** Temanın altBackgrounds dizisindeki indeks; yoksa temanın ana zemini. */
  alt?: number;
  device?: DeviceStyle;
};

/** ornament verilirse o slayta defne çelengi (LAUREL) konur — award ailesi bunu kullanır. */
/** `elements` verilirse o slayta öğeler eklenir (logo/maskot çıkartması gibi) —
 *  marka şablonlarının HERO karesi bunu kullanır. Kimlikler sabit yazılır;
 *  diller arası eşleşme anahtarı olduğu için kopyalanırken korunur. */
type Copy = {
  headline: string;
  sub: string;
  badge?: string;
  ornament?: string;
  elements?: SlideElement[];
};

export type TemplateConfig = Config;
type Config = {
  id: TemplateId;
  name: string;
  hint: string;
  /** Belirtilmezse "hero". */
  kategori?: TemplateKategori;
  themeId: string;
  defaultCount: number;
  steps: Step[];
  copy: Copy[];
};

/** Temanın i. çeşitleme zeminini kopyalayarak verir (paylaşılan referans olmasın). */
function alt(themeId: string, i?: number): Background | undefined {
  if (i === undefined) return undefined;
  const list = getTheme(themeId).altBackgrounds;
  if (!list || list.length === 0) return undefined;
  return structuredClone(list[i % list.length]);
}

function makeTemplate(cfg: Config): Template {
  // background/device her zaman yazılır (adım tanımlamıyorsa undefined) —
  // böylece restyleSlides eski override'ları da temizler.
  const style = (i: number): SlideStyle => {
    const step = cfg.steps[i % cfg.steps.length];
    return {
      themeId: cfg.themeId,
      layout: step.layout,
      background: alt(cfg.themeId, step.alt),
      // Template defaults obey the theme's dimensional language. This runs
      // only on application/import, never while rendering a customized slide.
      device: step.device
        ? structuredClone(step.device.mode === getTheme(cfg.themeId).device.mode
          ? step.device : getTheme(cfg.themeId).device)
        : undefined,
    };
  };

  const build = (n = cfg.defaultCount): Slide[] => {
    const count = Math.max(1, Math.min(12, Math.round(n)));
    const slides: Slide[] = [];
    for (let i = 0; i < count; i++) {
      const c = cfg.copy[i % cfg.copy.length];
      const slide: Slide = {
        id: uid(),
        headline: c.headline,
        sub: c.sub,
        ...style(i),
      };
      if (c.badge) slide.badge = c.badge;
      // Çelenk metni boş string de olabilir (kullanıcı doldursun diye) —
      // bu yüzden !== undefined ile bakılır, truthy kontrolüyle değil.
      if (c.ornament !== undefined) slide.ornament = { kind: "laurel", text: c.ornament };
      if (c.elements?.length) slide.elements = structuredClone(c.elements);
      slides.push(slide);
    }
    return slides;
  };

  return {
    id: cfg.id,
    name: cfg.name,
    hint: cfg.hint,
    color: getTheme(cfg.themeId).accent,
    kategori: cfg.kategori ?? "hero",
    themeId: cfg.themeId,
    defaultCount: cfg.defaultCount,
    style,
    build,
  };
}

/* ------------------------------------------------------------------ *
   Sık kullanılan cihaz giysileri
 * ------------------------------------------------------------------ */

/**
 * Şablonların standart 3D cihazı.
 *
 * R9: adı tarihsel — ESKİDEN prosedürel "kontur" silüeti üretiyordu. Kullanıcı
 * "tüm temalarda varsayılan telefon iPhone 15 Pro Max olsun" dediği için artık
 * gerçek GLB üretiyor (model: "real" → DEFAULT_GLB). Kontur, Inspector'dan
 * seçilebilen açık bir tercih olarak duruyor.
 */
const kontur = (
  camera: CameraPresetId,
  bodyColor: string,
  env: "studio" | "night" | "soft" = "studio",
  extra?: { reflection?: boolean }
): DeviceStyle => ({
  mode: "3d",
  model: "real",
  camera,
  bodyColor,
  env,
  shadow: true,
  ...extra,
});

/** GLB gerçek model — vitrinin "ürün fotoğrafı" hissi istenen karelerinde. */
const real = (
  camera: CameraPresetId,
  bodyColor: string,
  env: "studio" | "night" | "soft" = "studio"
): DeviceStyle => ({
  mode: "3d",
  model: "real",
  camera,
  bodyColor,
  env,
  shadow: true,
  reflection: true,
});

/** Çerçevesiz 2D — 2026'nın varsayılanı. */
const flat = (opts?: { reflection?: boolean; cornerRadius?: number }): DeviceStyle => ({
  mode: "2d",
  frame: "none",
  cornerRadius: opts?.cornerRadius ?? 72,
  shadow: true,
  reflection: opts?.reflection ?? false,
});

/* --- R11 giysileri: temanın kendi karakterini taşıyan özel cihazlar ---------
   Genel `kontur`/`real` yardımcıları bu dört temada karakteri SİLİYOR
   (kil maketi gerçek GLB'ye, krom rim ışığı stüdyoya dönüyordu). Bu yüzden
   şablon adımları kendi giysilerini kuruyor; kamera hâlâ adım adım değişiyor. */

/** Mat kil maketi — gerçek GLB değil, kısılmış kontur (Kil Oyuncak). */
const clay = (camera: CameraPresetId): DeviceStyle => ({
  mode: "3d",
  model: "kontur",
  finish: "clay",
  camera,
  lightRig: "softbox",
  bodyColor: "#f3e3ce",
  konturWidth: 0.35,
  konturDepth: 0.62,
  island: false,
  shadow: true,
  float: 0.3,
});

/** Krom: kenar ışığı + ekran camında ince parıltı (Sıvı Krom). */
const chrome = (camera: CameraPresetId): DeviceStyle => ({
  mode: "3d",
  model: "real",
  camera,
  lightRig: "rim",
  bodyColor: "#20262e",
  shadow: true,
  reflection: true,
  float: 0.18,
  glare: 0.18,
});

/** Gün ışığı rigi, havada süzülen — wellness dili (Adaçayı). */
const daylight = (camera: CameraPresetId, bodyColor: string): DeviceStyle => ({
  mode: "3d",
  model: "real",
  camera,
  lightRig: "daylight",
  bodyColor,
  shadow: true,
  float: 0.24,
});

/** Sert ofset gölgeli düz cihaz — neo-brutalist mühür (Beyaz Brutalist). */
const stamp = (): DeviceStyle => ({
  mode: "2d",
  frame: "none",
  cornerRadius: 28,
  shadow: { dx: 22, dy: 22, blur: 0, opacity: 1, color: "#0b0b0b" },
});

/* ------------------------------------------------------------------ *
   Şablonlar
 * ------------------------------------------------------------------ */

export const TEMPLATES: Template[] = [
  // 1) Fintech Bold — doygun mor blok, dev versal başlık, cihaz alttan taşar.
  //    Banka, bütçe, üretkenlik: "ciddi ama cesur".
  makeTemplate({
    id: "fintech-bold",
    name: "Fintech Bold",
    hint: L("Mor blok zemin, dev versal başlık, taşan cihaz", "Purple block background, giant all-caps headline, overflowing device"),
    themeId: "bold-block",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: flat() },
      { layout: "text-top", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 2, device: flat() },
      { layout: "split-diagonal", alt: 1, device: flat() },
      { layout: "text-bottom", alt: 3, device: flat() },
      { layout: "device-bleed-bottom", alt: 4, device: flat() },
    ],
    copy: [
      { headline: L("Paran, tek ekranda", "Your money, on one screen"), sub: L("Hesaplar, kartlar ve bütçe bir arada", "Accounts, cards and budget together"), badge: L("YENİ", "NEW") },
      { headline: L("Harcamanı anla", "Understand your spending"), sub: L("Her kalem otomatik sınıflanır", "Every item is categorized automatically") },
      { headline: L("Saniyede transfer", "Transfers in seconds"), sub: L("IBAN yaz, gerisi hallolur", "Enter the IBAN, we handle the rest") },
      { headline: L("Bütçen taşmasın", "Stay within budget"), sub: L("Sınırı aşmadan önce haber verir", "Warns you before you go over the limit") },
      { headline: L("Sıfır komisyon", "Zero fees"), sub: L("Gizli ücret yok, sürpriz yok", "No hidden fees, no surprises") },
      { headline: L("Bugün başla", "Start today"), sub: L("Kurulum iki dakika sürer", "Setup takes two minutes") },
    ],
  }),

  // 2) Dark Neon — siyaha yakın zemin, magenta/cyan neon, 3D kamera dansı.
  //    Oyun, müzik, sosyal: gece afişi enerjisi.
  makeTemplate({
    id: "dark-neon",
    name: "Dark Neon",
    hint: L("Karanlık zemin, neon halka, dönen 3D kameralar", "Dark background, neon ring, orbiting 3D cameras"),
    themeId: "neon-3d",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: kontur("hero-right", "#0d0b16", "night") },
      { layout: "split-diagonal", alt: 0, device: kontur("iso", "#0d0b16", "night") },
      { layout: "text-overlay", alt: 2, device: kontur("close-top", "#0d0b16", "night") },
      { layout: "text-top", alt: 1, device: kontur("hero-left", "#0d0b16", "night") },
      { layout: "badge-hero", alt: 3, device: kontur("front", "#0d0b16", "night") },
      { layout: "panorama-mid", alt: 4, device: kontur("pair", "#0d0b16", "night") },
    ],
    copy: [
      { headline: L("Gece başlar", "The night begins"), sub: L("Sesi aç, ekranı bırak", "Turn the sound up, put the screen down"), badge: L("CANLI", "LIVE") },
      { headline: L("Sınırsız akış", "Unlimited stream"), sub: L("Kesintisiz, reklamsız, senin ritminde", "Uninterrupted, ad-free, at your own pace") },
      { headline: L("Herkes burada", "Everyone's here"), sub: L("Arkadaşlarını çağır, oda senin", "Invite your friends, the room is yours") },
      { headline: L("Anında tepki", "Instant reaction"), sub: L("Gecikme yok — dokunduğun an", "No delay — the moment you tap") },
      { headline: L("Kendi listen", "Your own list"), sub: L("Beğendiğin her şey tek yerde", "Everything you like in one place") },
      { headline: L("Şimdi katıl", "Join now"), sub: L("İlk hafta ücretsiz", "First week free") },
    ],
  }),

  // 3) Editorial Lüks — koyu mermer, altın damar, versal serif başlık.
  //    Moda, mücevher, seyahat: dergi kapağı sakinliği.
  makeTemplate({
    id: "editorial-lux",
    name: L("Editorial Lüks", "Editorial Luxe"),
    hint: L("Koyu mermer, altın serif başlık, aynalı cihaz", "Dark marble, gold serif headline, mirrored device"),
    themeId: "editorial",
    defaultCount: 6,
    steps: [
      { layout: "text-top", device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 0, device: flat({ reflection: true }) },
      { layout: "badge-hero", alt: 1, device: flat({ reflection: true }) },
      { layout: "device-bleed-top", alt: 2, device: flat({ reflection: true }) },
      { layout: "text-top", alt: 3, device: flat({ reflection: true }) },
      { layout: "split-diagonal", alt: 4, device: flat({ reflection: true }) },
    ],
    copy: [
      { headline: L("Seçilmiş, sıradan değil", "Curated, not ordinary"), sub: L("Her parça elle küratörlendi", "Every piece is hand-curated"), badge: L("ÖZEL", "EXCLUSIVE") },
      { headline: L("Zamansız tasarım", "Timeless design"), sub: L("Sezon geçer, iyi tasarım kalır", "Seasons pass, good design stays") },
      { headline: L("Sana özel liste", "A list made for you"), sub: L("Zevkini öğrenir, önerisini ona göre kurar", "Learns your taste and tailors its suggestions") },
      { headline: L("Kapına kadar", "Right to your door"), sub: L("Ücretsiz kargo, kolay iade", "Free shipping, easy returns") },
      { headline: L("Ustaların işi", "Master craft"), sub: L("Küçük atölyeler, gerçek zanaat", "Small workshops, real craftsmanship") },
      { headline: L("Koleksiyonu gör", "See the collection"), sub: L("Yeni sezon yayında", "New season is live") },
    ],
  }),

  // 4) Clean Apple — beyaz zemin, koyu metin, neredeyse görünmez doku.
  //    Apple editorial sadeliği; en güvenli, en okunur set.
  makeTemplate({
    id: "clean-apple",
    name: "Clean Apple",
    hint: L("Beyaz zemin, koyu başlık, cam masa yansıması", "White background, dark headline, glass tabletop reflection"),
    kategori: "minimal",
    themeId: "clean-light",
    defaultCount: 6,
    steps: [
      { layout: "text-top", device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 0, device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 1, device: flat({ reflection: true }) },
      { layout: "text-top", alt: 2, device: flat({ reflection: true }) },
      { layout: "badge-hero", alt: 3, device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 1, device: flat({ reflection: true }) },
    ],
    copy: [
      { headline: L("Sade, hızlı, senin", "Simple, fast, yours"), sub: L("Gereksiz hiçbir şey yok", "Nothing unnecessary"), badge: L("YENİ", "NEW") },
      { headline: L("Bir dokunuş yeter", "One tap is enough"), sub: L("Aradığın her zaman bir adım uzakta", "What you need is always one step away") },
      { headline: L("Her cihazda", "On every device"), sub: L("Telefon, tablet, saat — hepsi eşzamanlı", "Phone, tablet, watch — all in sync") },
      { headline: L("Gizliliğin senin", "Your privacy is yours"), sub: L("Veriler cihazında kalır", "Data stays on your device") },
      { headline: L("Pil dostu", "Battery friendly"), sub: L("Arka planda seni yormaz", "Doesn't drain you in the background") },
      { headline: L("Hemen dene", "Try it now"), sub: L("Ücretsiz indir, kayıt gerekmez", "Free download, no sign-up needed") },
    ],
  }),

  // 5) Playful — şeker pastel, yuvarlak enerji, 3D hero açıları.
  //    Çocuk, eğitim, alışkanlık: neşeli ve davetkâr.
  makeTemplate({
    id: "playful",
    name: "Playful",
    hint: L("Pastel dalgalar, rozetli başlık, neşeli 3D açılar", "Pastel waves, badge headline, playful 3D angles"),
    themeId: "playful-3d",
    defaultCount: 6,
    steps: [
      { layout: "badge-hero", device: kontur("hero-left", "#2b1230") },
      { layout: "device-bleed-bottom", alt: 0, device: kontur("hero-right", "#2b1230") },
      { layout: "split-diagonal", alt: 1, device: kontur("iso", "#2b1230") },
      { layout: "text-top", alt: 2, device: kontur("front", "#2b1230") },
      { layout: "badge-hero", alt: 3, device: kontur("pair", "#2b1230") },
      { layout: "text-bottom", alt: 4, device: kontur("laydown", "#2b1230") },
    ],
    copy: [
      { headline: L("Öğrenmek eğlenceli", "Learning is fun"), sub: L("Günde beş dakika yeter", "Five minutes a day is enough"), badge: L("5 DK", "5 MIN") },
      { headline: L("Seriyi bozma", "Keep your streak"), sub: L("Her gün küçük bir adım", "A small step every day") },
      { headline: L("Rozetleri topla", "Collect badges"), sub: L("İlerledikçe yeni ödüller açılır", "New rewards unlock as you progress") },
      { headline: L("Ailece oyna", "Play as a family"), sub: L("Herkes için ayrı profil", "A separate profile for everyone") },
      { headline: L("Reklamsız", "Ad-free"), sub: L("Çocuğun ekranında sürpriz yok", "No surprises on your child's screen") },
      { headline: L("Hadi başlayalım", "Let's get started"), sub: L("İlk ders bedava", "First lesson free") },
    ],
  }),

  // 7) Riso Zine — kirli krem kâğıt, iki mürekkep, kasten sola hizalı sıkı
  //    tipografi. Bağımsız uygulamaların "poster" dili.
  makeTemplate({
    id: "riso-zine",
    name: "Riso Zine",
    hint: L("Risograf kâğıt, iki mürekkep, sola hizalı sıkı tipografi", "Risograph paper, two inks, tight left-aligned typography"),
    themeId: "riso",
    defaultCount: 6,
    steps: [
      { layout: "split-diagonal", device: flat({ cornerRadius: 60 }) },
      { layout: "text-top", alt: 0, device: flat({ cornerRadius: 60 }) },
      { layout: "device-bleed-top", alt: 1, device: flat({ cornerRadius: 60 }) },
      { layout: "split-diagonal", alt: 2, device: flat({ cornerRadius: 60 }) },
      { layout: "text-bottom", alt: 3, device: flat({ cornerRadius: 60 }) },
      { layout: "badge-hero", alt: 4, device: flat({ cornerRadius: 60 }) },
    ],
    copy: [
      { headline: L("Kendi işini yap", "Do your own thing"), sub: L("Şablon değil, senin fikrin", "Your idea, not a template"), badge: "INDIE" },
      { headline: L("Elle dizilmiş his", "Hand-set feel"), sub: L("Her kare baskıdan çıkmış gibi", "Every frame looks fresh off the press") },
      { headline: L("Hızlı taslak", "Quick draft"), sub: L("Fikirden postere on dakika", "From idea to poster in ten minutes") },
      { headline: L("Bulut yok", "No cloud"), sub: L("Dosyaların cihazında kalır", "Your files stay on your device") },
      { headline: L("Tek seferlik ödeme", "One-time payment"), sub: L("Abonelik asla", "Never a subscription") },
      { headline: L("Şimdi dene", "Try it now"), sub: L("İlk üç poster ücretsiz", "First three posters free") },
    ],
  }),

  // 8) Panorama Trio — cihaz tam merkezde, kısa tek satır metin. Üç-beş kare
  //    yan yana asıldığında tek bir uzun sahne gibi okunur.
  makeTemplate({
    id: "panorama-trio",
    name: "Panorama Trio",
    hint: L("Ortalı cihaz, tek satır metin — yan yana tek sahne", "Centered device, single line of text — one scene across frames"),
    kategori: "panorama",
    themeId: "obsidian",
    defaultCount: 5,
    steps: [
      { layout: "device-bleed-top", device: kontur("hero-left", "#16171f", "night") },
      { layout: "panorama-mid", alt: 0, device: kontur("front", "#16171f", "night") },
      { layout: "panorama-mid", alt: 1, device: real("front", "#16171f", "night") },
      { layout: "panorama-mid", alt: 3, device: kontur("front", "#16171f", "night") },
      { layout: "device-bleed-bottom", alt: 4, device: kontur("hero-right", "#16171f", "night") },
    ],
    copy: [
      { headline: L("Bir bakışta", "At a glance"), sub: L("Her şey yerli yerinde", "Everything in its place") },
      { headline: L("Derinlik", "Depth"), sub: L("Katman katman, karışıksız", "Layer by layer, never cluttered") },
      { headline: L("Odak", "Focus"), sub: L("Sadece işine yarayan", "Only what's useful") },
      { headline: L("Akış", "Flow"), sub: L("Duraksamadan, pürüzsüz", "Smooth, without a pause") },
      { headline: L("Başla", "Start"), sub: L("Bugün, şimdi", "Today, now") },
    ],
  }),

  /* ---------------------------------------------------------------- *
     ÖDÜL AİLESİ

     Hepsi aynı kurguyu paylaşır: ilk slayt defne çelenkli ödül karesi,
     ardından iki destek karesi. Çelenkli karede daima "text-top" kullanılır —
     render.ts'teki ornament-push tam bu koşulda (metin üstte + cihaz altta)
     devreye girip cihazı aşağı iter, böylece çelenk ile cihaz çakışmaz.

     Başlıklar bilerek KISA: çelenk slayt yüksekliğinin ~%23'ünü yediği için
     tek satırda kalan başlık dengeyi korur. Rozet yok — çelengin kendisi rozet.
     Tüm metinler yer tutucudur, Denetçi'den serbestçe düzenlenir.
   * ---------------------------------------------------------------- */

  // 9) Editörün Seçimi — koyu mermer + altın serif. Altın çelengin doğal evi.
  makeTemplate({
    id: "award-editors-choice",
    name: L("Editörün Seçimi", "Editors' Choice"),
    hint: L("Koyu mermer + altın çelenk, versal serif — editör vitrini", "Dark marble + gold laurel, all-caps serif — editor's showcase"),
    kategori: "award",
    themeId: "editorial",
    defaultCount: 3,
    steps: [
      { layout: "text-top", device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 0, device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 1, device: flat({ reflection: true }) },
    ],
    copy: [
      {
        ornament: L("Editörün Seçimi", "Editors' Choice"),
        headline: L("Yılın seçkisi", "Pick of the year"),
        sub: L("App Store editörleri tarafından öne çıkarıldı", "Featured by App Store editors"),
      },
      { headline: L("Zamansız tasarım", "Timeless design"), sub: L("Her ekran tek tek elden geçti", "Every screen was refined one by one") },
      { headline: L("Sen de keşfet", "Discover it too"), sub: L("Ücretsiz indir, hemen başla", "Download free, start right away") },
    ],
  }),

  // 10) Puan ödülü — derin gece mavisi, altın çelenk içinde yıldız.
  makeTemplate({
    id: "award-rating",
    name: L("4.9 ★ · 12B değerlendirme", "4.9 ★ · 12K ratings"),
    hint: L("Gece mavisi zemin, çelenk içinde yıldız puanı", "Midnight blue background, star rating inside a laurel"),
    kategori: "award",
    themeId: "obsidian",
    defaultCount: 3,
    steps: [
      { layout: "text-top", device: kontur("front", "#16171f", "night") },
      { layout: "panorama-mid", alt: 0, device: kontur("hero-left", "#16171f", "night") },
      { layout: "device-bleed-bottom", alt: 2, device: kontur("hero-right", "#16171f", "night") },
    ],
    copy: [
      {
        ornament: "4.9 ★",
        headline: L("12 bin oy", "12K votes"),
        sub: L("Değerlendirmelerin ortalaması 5 üzerinden 4.9", "Average rating of 4.9 out of 5"),
      },
      { headline: L("Neden sevildi", "Why people love it"), sub: L("Hızlı, sade ve tamamen reklamsız", "Fast, simple and completely ad-free") },
      { headline: L("Sıradaki sensin", "You're next"), sub: L("İndir, ilk gün farkı gör", "Download it and see the difference on day one") },
    ],
  }),

  // 11) Kategori birinciliği — kumlu koyu kâğıt, turuncu vurgu altınla ısınır.
  makeTemplate({
    id: "award-rank-one",
    name: L("#1 — Yaşam Tarzı", "#1 — Lifestyle"),
    hint: L("Kumlu koyu zemin, çelenkte kategori birinciliği", "Sandy dark background, category #1 in a laurel"),
    kategori: "award",
    themeId: "granular",
    defaultCount: 3,
    steps: [
      { layout: "text-top", device: flat({ reflection: true }) },
      { layout: "badge-hero", alt: 1, device: flat() },
      { layout: "device-bleed-bottom", alt: 3, device: flat() },
    ],
    copy: [
      {
        ornament: L("#1 Yaşam Tarzı", "#1 Lifestyle"),
        headline: L("Zirvedeyiz", "We're at the top"),
        sub: L("Türkiye App Store · Yaşam Tarzı kategorisi", "Turkey App Store · Lifestyle category"),
      },
      { headline: L("Herkes kullanıyor", "Everyone's using it"), sub: L("Bir milyondan fazla indirme", "Over a million downloads") },
      { headline: L("Sen de katıl", "Join in"), sub: L("Kurulum iki dakika sürer", "Setup takes two minutes") },
    ],
  }),

  // 13) Boş ödül — düz derin siyah zemin (editorial alt 5). Çelenk ve metinler
  //     yer tutucu: hangi ödül olursa olsun üstüne yazılır.
  makeTemplate({
    id: "award-blank",
    name: L("Ödül (boş)", "Award (blank)"),
    hint: L("Düz siyah zemin, boş çelenk — ödül metnini sen yaz", "Plain black background, empty laurel — write your own award text"),
    kategori: "award",
    themeId: "editorial",
    defaultCount: 3,
    steps: [
      { layout: "text-top", alt: 5, device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 5, device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 5, device: flat({ reflection: true }) },
    ],
    copy: [
      { ornament: L("Ödül adı", "Award name"), headline: L("Ödül başlığı", "Award title"), sub: L("Ödülü veren kurum ve tarih", "Awarding organization and date") },
      { headline: L("İkinci kare", "Second frame"), sub: L("Öne çıkarmak istediğin özellik", "The feature you want to highlight") },
      { headline: L("Üçüncü kare", "Third frame"), sub: L("Kapanış cümlesi veya çağrı", "Closing line or call to action") },
    ],
  }),

  /* ------------------------------------------------------------------ *
     R10 — yeni temaların set kurguları.
     Yalnız MEVCUT layout id'leri kullanılıyor (split-v/split-h dışarıda:
     placeholder setlerde ikinci ekran görüntüsü yok, motor onları text-top'a
     düşürür ve şablon yarım görünürdü).
   * ------------------------------------------------------------------ */

  // 14) Cam Aurora — koyu cam, süzülen cihaz, yumuşak softbox.
  //     SaaS / üretkenlik / yapay zekâ: "ciddi ürün, modern yüzey".
  makeTemplate({
    id: "glass-product",
    name: L("Cam Ürün", "Glass Product"),
    hint: L("Koyu cam zemin, süzülen cihaz, sıkı geometrik başlık", "Dark glass background, floating device, tight geometric headline"),
    themeId: "glass-aurora",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: kontur("front", "#12162a", "soft") },
      { layout: "text-top", alt: 0, device: kontur("hero-right", "#12162a", "soft") },
      { layout: "badge-hero", alt: 1, device: real("front", "#12162a", "soft") },
      { layout: "text-bottom", alt: 2, device: kontur("hero-left", "#12162a", "soft") },
      { layout: "text-overlay", alt: 3, device: kontur("close-top", "#12162a", "soft") },
      { layout: "device-bleed-bottom", alt: 4, device: kontur("iso", "#12162a", "soft") },
    ],
    copy: [
      { headline: L("Her şey tek yüzeyde", "Everything on one surface"), sub: L("Dağınık sekmeler yerine tek akış", "One flow instead of scattered tabs"), badge: L("YENİ", "NEW") },
      { headline: L("Sen yazarken düşünür", "Thinks as you type"), sub: L("Öneriler bağlamdan gelir", "Suggestions come from context") },
      { headline: L("Saniyede arama", "Search in a second"), sub: L("Ne aradığını bilmesen de bulur", "Finds it even if you don't know what you're after") },
      { headline: L("Ekibinle aynı sayfada", "On the same page as your team"), sub: L("Değişiklikler anında görünür", "Changes appear instantly") },
      { headline: L("Verin sende kalır", "Your data stays with you"), sub: L("Uçtan uca şifreli, cihazda saklı", "End-to-end encrypted, stored on device") },
      { headline: L("Ücretsiz başla", "Start free"), sub: L("Kart istemiyoruz", "No card required") },
    ],
  }),

  // 15) Brutalist Zine — is rengi, asit sarısı, dev mono versal.
  //     Geliştirici araçları, indie yazılım, terminal kültürü.
  makeTemplate({
    id: "brutalist-zine",
    name: "Brutalist Zine",
    hint: L("İs rengi blok, asit sarısı vurgu, dev mono versal başlık", "Soot-colored block, acid-yellow accent, giant mono all-caps headline"),
    themeId: "brut-mono",
    defaultCount: 5,
    steps: [
      { layout: "split-diagonal", device: flat() },
      { layout: "text-top", alt: 0, device: flat() },
      { layout: "device-bleed-bottom", alt: 1, device: flat() },
      { layout: "text-bottom", alt: 2, device: flat() },
      { layout: "split-diagonal", alt: 3, device: flat() },
    ],
    copy: [
      { headline: L("Sıfır gürültü", "Zero noise"), sub: L("Reklam yok · takip yok · abonelik yok", "No ads · no tracking · no subscription"), badge: "1.0" },
      { headline: L("Yerelde çalışır", "Works locally"), sub: L("İnternet olmadan da açılır", "Opens without internet too") },
      { headline: L("Klavyeyle hızlı", "Fast with the keyboard"), sub: L("Her komut için bir kısayol", "A shortcut for every command") },
      { headline: L("Açık biçim", "Open format"), sub: L("Verini istediğin an dışa aktar", "Export your data anytime") },
      { headline: L("Kur ve unut", "Set it and forget it"), sub: L("Tek dosya, iki dakika", "One file, two minutes") },
    ],
  }),

  // 16) Kâğıt Baskı — fildişi kâğıt, yüksek kontrastlı serif.
  //     Okuma, günlük, tarif, dergi: sakin ve editoryal.
  makeTemplate({
    id: "paper-press",
    name: L("Kâğıt Baskı", "Paper Print"),
    hint: L("Fildişi kâğıt, editoryal serif, kâğıt lifi dokusu", "Ivory paper, editorial serif, paper fiber texture"),
    kategori: "minimal",
    themeId: "paper-editorial",
    defaultCount: 5,
    steps: [
      { layout: "text-top", device: flat() },
      { layout: "device-bleed-bottom", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 2, device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 4, device: flat() },
      { layout: "text-top", alt: 1, device: flat({ reflection: true }) },
    ],
    copy: [
      { headline: L("Yavaş okumak için", "For slow reading"), sub: L("Dikkatini dağıtmayan bir sayfa", "A page that doesn't distract you"), badge: L("YENİ", "NEW") },
      { headline: L("Kaldığın yerden", "Pick up where you left off"), sub: L("Cihazlar arasında aynı satır", "The same line across devices") },
      { headline: L("Kendi kütüphanen", "Your own library"), sub: L("Etiketle, ara, geri dön", "Tag, search, come back") },
      { headline: L("Gözünü yormaz", "Easy on the eyes"), sub: L("Kâğıt kontrastı, gerçek tipografi", "Paper contrast, real typography") },
      { headline: L("İlk ay bizden", "First month on us"), sub: L("İstediğin an vazgeç", "Cancel anytime") },
    ],
  }),

  // 17) Mono Manifesto — siyah-beyaz, tek kırmızı. Ajans/portfolyo dili;
  //     her karede TEK cümle, gravür dokusu üstünde.
  makeTemplate({
    id: "mono-manifesto",
    name: "Mono Manifesto",
    hint: L("Siyah-beyaz yüksek kontrast, tek kırmızı aksan, dev versal", "High-contrast black and white, single red accent, giant all-caps"),
    themeId: "mono-red",
    defaultCount: 5,
    steps: [
      { layout: "text-top", device: flat() },
      { layout: "device-bleed-bottom", alt: 0, device: flat() },
      { layout: "text-bottom", alt: 2, device: flat() },
      { layout: "badge-hero", alt: 3, device: flat() },
      { layout: "text-top", alt: 4, device: flat() },
    ],
    copy: [
      { headline: L("Az ama doğru", "Less but right"), sub: L("Bir iş, bir ekran", "One task, one screen"), badge: "1 ★" },
      { headline: L("Süs yok", "No frills"), sub: L("Sadece işini yapan arayüz", "An interface that just does its job") },
      { headline: L("Hızlı ya da hiç", "Fast or nothing"), sub: L("Her ekran 100 ms altında açılır", "Every screen opens in under 100 ms") },
      { headline: L("Sana ait", "Yours alone"), sub: L("Hesap yok, bulut yok", "No account, no cloud") },
      { headline: L("Şimdi indir", "Download now"), sub: L("Ücretsiz ve reklamsız", "Free and ad-free") },
    ],
  }),

  // 18) Kum Tepesi — çöl alacakaranlığı, sıcak serif + italik spot.
  //     Seyahat, yemek, sağlık: hikâye anlatan, sıcak setler.
  makeTemplate({
    id: "dune-story",
    name: L("Kum Tepesi", "Sand Dune"),
    hint: L("Çöl alacakaranlığı, sıcak serif başlık, italik spot satır", "Desert twilight, warm serif headline, italic spot line"),
    themeId: "sunset-dune",
    defaultCount: 6,
    steps: [
      { layout: "badge-hero", device: kontur("low-hero", "#3a2018", "studio") },
      { layout: "device-bleed-bottom", alt: 0, device: kontur("hero-left", "#3a2018", "studio") },
      { layout: "text-top", alt: 2, device: real("front", "#3a2018", "studio") },
      { layout: "text-bottom", alt: 3, device: kontur("hero-right", "#3a2018", "studio") },
      { layout: "panorama-mid", alt: 4, device: kontur("front", "#3a2018", "studio") },
      { layout: "device-bleed-top", alt: 5, device: kontur("iso", "#3a2018", "studio") },
    ],
    copy: [
      { headline: L("Yola çıkmadan önce", "Before you set off"), sub: L("Rotanı bir akşamda kur", "Plan your route in one evening"), badge: L("YENİ", "NEW") },
      { headline: L("Yerel tavsiyeler", "Local tips"), sub: L("Turist değil, komşu gözüyle", "Through a neighbor's eyes, not a tourist's") },
      { headline: L("Çevrimdışı harita", "Offline map"), sub: L("Şebeke yokken de yolunu bulursun", "Find your way even without signal") },
      { headline: L("Bütçen sende", "Your budget, your call"), sub: L("Her gün ne harcadığını görürsün", "See what you spend each day") },
      { headline: L("Anıları topla", "Collect memories"), sub: L("Fotoğraflar rotana iliştirilir", "Photos are pinned to your route") },
      { headline: L("İlk rotan bizden", "Your first route is on us"), sub: L("Kaydol, hemen başla", "Sign up and start right away") },
    ],
  }),

  /* ------------------------------------------------------------------ *
     R11 — yeni on temanın set kurguları.
     Kural aynı: yalnız MEVCUT layout id'leri, split-v/split-h yok (placeholder
     setlerde ikinci ekran görüntüsü olmadığı için motor onları text-top'a
     düşürür ve şablon yarım görünürdü).
   * ------------------------------------------------------------------ */

  // 19) Bento Panel — arduvaz ızgara, kılcal çizgiler, mono etiketler.
  //     Üretkenlik / takvim / dosya: "her şey modüllere yerleşmiş".
  makeTemplate({
    id: "bento-panel",
    name: "Bento Panel",
    hint: L("Arduvaz ızgara zemin, kılcal çizgiler, mono etiket alt satır", "Slate grid background, hairlines, mono label subline"),
    themeId: "bento-grid",
    defaultCount: 6,
    steps: [
      { layout: "text-top", device: flat() },
      { layout: "device-bleed-bottom", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 2, device: flat() },
      { layout: "text-bottom", alt: 3, device: flat() },
      { layout: "text-top", alt: 4, device: flat() },
      { layout: "device-bleed-bottom", alt: 1, device: flat() },
    ],
    copy: [
      { headline: L("Her şey tek panelde", "Everything in one panel"), sub: L("Görevler, notlar ve takvim yan yana", "Tasks, notes and calendar side by side"), badge: L("YENİ", "NEW") },
      { headline: L("Modüllerini sen kur", "Build your own modules"), sub: L("Sürükle, bırak, yerine otursun", "Drag, drop, and it snaps into place") },
      { headline: L("Tek bakışta gün", "Your day at a glance"), sub: L("Bugün ne varsa üstte", "Whatever's on today is on top") },
      { headline: L("Aramak yerine bulmak", "Finding, not searching"), sub: L("Yaz, anında süzülsün", "Type and results filter instantly") },
      { headline: L("Ekiple ortak pano", "A shared board for the team"), sub: L("Değişiklik herkeste anında", "Changes reach everyone instantly") },
      { headline: L("Ücretsiz başla", "Start free"), sub: L("Kart istemiyoruz", "No card required") },
    ],
  }),

  // 20) Krom Lansman — dökme metal rampa, rim ışıklı cihaz.
  //     Donanım, yapay zekâ, premium abonelik: "ürün lansmanı".
  makeTemplate({
    id: "chrome-launch",
    name: L("Krom Lansman", "Chrome Launch"),
    hint: L("Dökme krom rampa, kenar ışığı, geniş geometrik başlık", "Poured chrome ramp, rim light, wide geometric headline"),
    themeId: "liquid-chrome",
    defaultCount: 6,
    steps: [
      { layout: "text-top", device: chrome("hero-right") },
      { layout: "device-bleed-bottom", alt: 0, device: chrome("front") },
      { layout: "badge-hero", alt: 1, device: chrome("hero-left") },
      { layout: "text-bottom", alt: 2, device: chrome("iso") },
      { layout: "text-top", alt: 4, device: chrome("low-hero") },
      { layout: "device-bleed-bottom", alt: 3, device: chrome("front") },
    ],
    copy: [
      { headline: L("Işık hızında çalışır", "Runs at light speed"), sub: L("Her işlem anında tamamlanır", "Every action completes instantly"), badge: L("YENİ", "NEW") },
      { headline: L("Cihazında kalır", "Stays on your device"), sub: L("Bulut yok, gecikme yok", "No cloud, no lag") },
      { headline: L("Tek dokunuş", "One tap"), sub: L("Kurulum diye bir adım yok", "There's no setup step") },
      { headline: L("Sessiz ve güçlü", "Quiet and powerful"), sub: L("Pili değil işini tüketir", "Uses up your work, not your battery") },
      { headline: L("Yeni nesil motor", "Next-generation engine"), sub: L("Baştan yazıldı, baştan hızlandı", "Rewritten and faster from scratch") },
      { headline: L("Bugün dene", "Try it today"), sub: L("İlk ay bizden", "First month on us") },
    ],
  }),

  // 21) Film Hikâyesi — çöl fotoğrafı, kehribar çarpım, ağır gren.
  //     Seyahat, fotoğraf, günlük: analog bir kare gibi.
  makeTemplate({
    id: "film-story",
    name: L("Film Hikâyesi", "Film Story"),
    hint: L("Sıcak fotoğraf zemin, film greni, yüksek kontrastlı serif", "Warm photo background, film grain, high-contrast serif"),
    themeId: "warm-film",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: flat() },
      { layout: "text-top", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 3, device: flat() },
      { layout: "text-bottom", alt: 1, device: flat() },
      { layout: "device-bleed-top", alt: 4, device: flat() },
      { layout: "text-top", alt: 5, device: flat() },
    ],
    copy: [
      { headline: L("Anı olduğu gibi kalsın", "Keep the moment as it was"), sub: L("Film dokusu, gerçek renkler", "Film texture, true colors"), badge: L("YENİ", "NEW") },
      { headline: L("Işığı sen seç", "Choose the light"), sub: L("On iki analog profil, tek kaydırma", "Twelve analog profiles, one swipe") },
      { headline: L("Kadrajı boz", "Break the frame"), sub: L("Gren, halo ve kenar sızması", "Grain, halation and edge bleed") },
      { headline: L("Rulon mantığı", "Roll logic"), sub: L("Otuz altı kare, sonra beklemek", "Thirty-six frames, then the wait") },
      { headline: L("Tam çözünürlük", "Full resolution"), sub: L("Dışa aktarımda sıkıştırma yok", "No compression on export") },
      { headline: L("İlk rulon bizden", "First roll is on us"), sub: L("Kaydol, çekmeye başla", "Sign up and start shooting") },
    ],
  }),

  // 22) Renk Blok Baskı — her kare başka bir mürekkep bloğu, serif başlık.
  //     Okuma, dergi, kültür: dergi kapağı serisi.
  makeTemplate({
    id: "colour-press",
    name: L("Renk Blok Baskı", "Color Block Print"),
    hint: L("Doygun renk blokları, dev serif başlık, baskı dişi", "Saturated color blocks, giant serif headline, print texture"),
    themeId: "editorial-colour",
    defaultCount: 6,
    steps: [
      { layout: "text-top", device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 1, device: flat({ reflection: true }) },
      { layout: "text-bottom", alt: 2, device: flat() },
      { layout: "text-top", alt: 4, device: flat() },
      { layout: "device-bleed-bottom", alt: 3, device: flat({ reflection: true }) },
    ],
    copy: [
      { headline: L("Okumak için tasarlandı", "Designed for reading"), sub: L("Dikkatini dağıtmayan bir sayfa", "A page that doesn't distract you"), badge: L("YENİ", "NEW") },
      { headline: L("Her sayı bir renk", "Every issue a color"), sub: L("Arşivin raftaki gibi dizilir", "Your archive lines up like a shelf") },
      { headline: L("Yazarını takip et", "Follow your writer"), sub: L("Yeni yazı çıkınca haber gelir", "Get notified when a new piece is out") },
      { headline: L("Çevrimdışı oku", "Read offline"), sub: L("Uçakta da, metroda da", "On the plane, on the subway") },
      { headline: L("Alıntıyı sakla", "Save the quote"), sub: L("Seçtiğin satır defterine düşer", "The line you pick lands in your notebook") },
      { headline: L("İlk sayı ücretsiz", "First issue free"), sub: L("Beğenmezsen bir tık", "One tap if you don't like it") },
    ],
  }),

  // 23) Kil Alışkanlık — tek renk pastel zemin, mat kil maketi.
  //     Alışkanlık, çocuk, eğitim: yumuşak ve şenlikli.
  makeTemplate({
    id: "clay-habit",
    name: L("Kil Alışkanlık", "Clay Habit"),
    hint: L("Tek renk pastel zemin, mat kil telefon, yuvarlak başlık", "Single-color pastel background, matte clay phone, rounded headline"),
    themeId: "clay-toy",
    defaultCount: 6,
    steps: [
      { layout: "badge-hero", device: clay("hero-left") },
      { layout: "text-top", alt: 1, device: clay("front") },
      { layout: "device-bleed-bottom", alt: 2, device: clay("hero-right") },
      { layout: "text-bottom", alt: 3, device: clay("iso") },
      { layout: "badge-hero", alt: 4, device: clay("low-hero") },
      { layout: "text-top", alt: 5, device: clay("front") },
    ],
    copy: [
      { headline: L("Alışkanlık şenlikli olsun", "Make habits festive"), sub: L("Küçük adımlar, günlük seri", "Small steps, daily streak"), badge: L("4,9 ★", "4.9 ★") },
      { headline: L("Bir gün kaçırsan da", "Even if you miss a day"), sub: L("Seri kırılmaz, esner", "Your streak bends, not breaks") },
      { headline: L("Kendi hedefini koy", "Set your own goal"), sub: L("Günde bir bardak su da sayılır", "A glass of water a day counts too") },
      { headline: L("Rozetleri topla", "Collect badges"), sub: L("Her hafta yeni bir şekil", "A new shape every week") },
      { headline: L("Aileyle birlikte", "Together with family"), sub: L("Herkesin kendi kartı var", "Everyone has their own card") },
      { headline: L("Hemen başla", "Start now"), sub: L("Kayıt yok, iki dokunuş", "No sign-up, two taps") },
    ],
  }),

  // 24) Beyaz Zine — kâğıt beyazı, sert ofset gölge, mono versal.
  //     Indie yazılım, tek seferlik ödeme, "abonelik yok" mesajı.
  makeTemplate({
    id: "zine-white",
    name: L("Beyaz Zine", "White Zine"),
    hint: L("Kâğıt beyazı zemin, sert ofset gölge, mono versal başlık", "Paper-white background, hard offset shadow, mono all-caps headline"),
    kategori: "minimal",
    themeId: "brut-paper",
    defaultCount: 5,
    steps: [
      { layout: "split-diagonal", device: stamp() },
      { layout: "text-top", alt: 0, device: stamp() },
      { layout: "device-bleed-bottom", alt: 2, device: stamp() },
      { layout: "text-bottom", alt: 4, device: stamp() },
      { layout: "split-diagonal", alt: 1, device: stamp() },
    ],
    copy: [
      { headline: L("Sıfır abonelik", "Zero subscriptions"), sub: L("Bir kez al, ömür boyu kullan", "Buy once, use forever"), badge: "1.0" },
      { headline: L("Takip yok", "No tracking"), sub: L("Tek bir istek bile dışarı çıkmaz", "Not a single request leaves your device") },
      { headline: L("Klavyeyle hızlı", "Fast with the keyboard"), sub: L("Her komut için bir kısayol", "A shortcut for every command") },
      { headline: L("Verin senin", "Your data is yours"), sub: L("İstediğin an düz metin olarak al", "Get it as plain text anytime") },
      { headline: L("İndir ve aç", "Download and open"), sub: L("Tek dosya, iki dakika", "One file, two minutes") },
    ],
  }),

  // 25) Not Defteri — kâğıt zemin, temiz başlık + markör el yazısı.
  //     Not, çizim, öğrenme: "bir defterin kenarına yazılmış" ton.
  makeTemplate({
    id: "notebook",
    name: L("Not Defteri", "Notebook"),
    hint: L("Kâğıt zemin, temiz başlık, markör kırmızısı el yazısı", "Paper background, clean headline, marker-red handwriting"),
    kategori: "minimal",
    themeId: "note-marker",
    defaultCount: 5,
    steps: [
      { layout: "text-top", device: flat() },
      { layout: "device-bleed-bottom", alt: 0, device: flat() },
      { layout: "badge-hero", alt: 1, device: flat() },
      { layout: "text-bottom", alt: 3, device: flat() },
      { layout: "text-top", alt: 5, device: flat() },
    ],
    copy: [
      { headline: L("Aklındakini yakala", "Capture what's on your mind"), sub: L("not al, çiz, işaretle", "take notes, draw, mark up"), badge: L("YENİ", "NEW") },
      { headline: L("Elle yazar gibi", "Like writing by hand"), sub: L("kalem gecikmesi yok", "no pen lag") },
      { headline: L("Sayfaları bağla", "Link your pages"), sub: L("bir not diğerine açılsın", "let one note open into another") },
      { headline: L("Ara ve bul", "Search and find"), sub: L("el yazını bile okur", "it even reads handwriting") },
      { headline: L("Defterin sende", "The notebook is yours"), sub: L("dışa aktar, kimseye sorma", "export it, ask no one") },
    ],
  }),

  // 26) Sakin Günlük — adaçayı zemin, kitap serifi, havada süzülen cihaz.
  //     Meditasyon, uyku, sağlık: düşük doygunluk, geniş nefes.
  makeTemplate({
    id: "calm-daily",
    name: L("Sakin Günlük", "Calm Journal"),
    hint: L("Adaçayı zemin, kitap serifi başlık, süzülen cihaz", "Sage background, book-serif headline, floating device"),
    kategori: "minimal",
    themeId: "sage-calm",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: daylight("front", "#3b4436") },
      { layout: "text-top", alt: 0, device: daylight("hero-left", "#3b4436") },
      { layout: "badge-hero", alt: 2, device: daylight("front", "#3b4436") },
      { layout: "text-bottom", alt: 3, device: daylight("hero-right", "#3b4436") },
      { layout: "panorama-mid", alt: 1, device: daylight("front", "#3b4436") },
      { layout: "device-bleed-top", alt: 5, device: daylight("iso", "#3b4436") },
    ],
    copy: [
      { headline: L("Nefesini geri kazan", "Win your breath back"), sub: L("Günde beş dakika yeter", "Five minutes a day is enough"), badge: L("YENİ", "NEW") },
      { headline: L("Uykuya yumuşak iniş", "A soft landing into sleep"), sub: L("Ses, ışık ve ritim birlikte", "Sound, light and rhythm together") },
      { headline: L("Gününü işaretle", "Mark your day"), sub: L("Nasıl hissettiğini tek dokunuşla", "How you feel, in one tap") },
      { headline: L("Sessizlik de bir seans", "Silence is a session too"), sub: L("Rehbersiz oturumlar", "Unguided sessions") },
      { headline: L("Kaldığın yerden", "Pick up where you left off"), sub: L("Program seninle ilerler", "The program moves with you") },
      { headline: L("İlk hafta ücretsiz", "First week free"), sub: L("İstediğin an bırak", "Stop anytime") },
    ],
  }),

  // 27) Panorama Şehir — tek geniş ışık şeridi kareler boyunca sürer.
  //     Harita, seyahat, etkinlik: kaydırmayı sürdüren seri.
  makeTemplate({
    id: "panorama-city",
    name: L("Panorama Şehir", "Panorama City"),
    hint: L("Kadrajı kesen ışık şeridi, seri boyunca süren zemin", "Light streak cutting across the frame, background continuing through the series"),
    kategori: "panorama",
    themeId: "panorama-sweep",
    defaultCount: 6,
    steps: [
      { layout: "device-bleed-bottom", device: real("front", "#241634", "studio") },
      { layout: "panorama-mid", alt: 1, device: real("front", "#241634", "studio") },
      { layout: "text-top", alt: 0, device: real("hero-left", "#241634", "studio") },
      { layout: "panorama-mid", alt: 2, device: real("front", "#241634", "studio") },
      { layout: "text-bottom", alt: 3, device: real("hero-right", "#241634", "studio") },
      { layout: "badge-hero", alt: 4, device: real("front", "#241634", "studio") },
    ],
    copy: [
      { headline: L("Şehri baştan keşfet", "Rediscover the city"), sub: L("Rotan sen yürüdükçe büyür", "Your route grows as you walk"), badge: L("YENİ", "NEW") },
      { headline: L("Yakınında ne var", "What's nearby"), sub: L("Beş dakikalık her şey", "Everything within five minutes") },
      { headline: L("Kendi listen", "Your own list"), sub: L("Gittiğin yeri işaretle", "Mark the places you go") },
      { headline: L("Çevrimdışı harita", "Offline map"), sub: L("Şebeke yokken de çalışır", "Works without signal too") },
      { headline: L("Arkadaşlarınla", "With your friends"), sub: L("Aynı rotayı birlikte kurun", "Build the same route together") },
      { headline: L("Hemen başla", "Start now"), sub: L("Kayıt istemiyoruz", "No sign-up needed") },
    ],
  }),

  // 28) Rakam Kahraman — kırık beyaz, tek vurgu, sayfayı kaplayan başlık.
  //     Fintech, ölçüm, sağlık verisi: kare başına TEK çıktı.
  //     Kopya bilerek üç kelimeyi geçmiyor — 168 punto uzun cümle kaldırmaz.
  makeTemplate({
    id: "stat-hero",
    name: L("Rakam Kahraman", "Number Hero"),
    hint: L("Kırık beyaz zemin, tek vurgu, sayfayı kaplayan kısa başlık", "Off-white background, single accent, short page-filling headline"),
    kategori: "minimal",
    themeId: "mono-numerals",
    defaultCount: 5,
    steps: [
      { layout: "badge-hero", device: flat({ reflection: true }) },
      { layout: "text-top", alt: 0, device: flat({ reflection: true }) },
      { layout: "device-bleed-bottom", alt: 2, device: flat() },
      { layout: "text-bottom", alt: 3, device: flat() },
      { layout: "badge-hero", alt: 4, device: flat({ reflection: true }) },
    ],
    copy: [
      { headline: L("3 dakikada kur", "Set up in 3 minutes"), sub: L("Kart yok · reklam yok", "No card · no ads"), badge: L("%0 komisyon", "0% fees") },
      { headline: L("Her kuruş yerinde", "Every penny in place"), sub: L("Harcama otomatik sınıflanır", "Spending is categorized automatically") },
      { headline: L("Tek ekran", "One screen"), sub: L("Bütün hesaplar bir arada", "All accounts together") },
      { headline: L("Sıfır sürpriz", "Zero surprises"), sub: L("Gizli ücret diye bir şey yok", "There's no such thing as hidden fees") },
      { headline: L("Bugün başla", "Start today"), sub: L("İlk ay tamamen ücretsiz", "First month completely free"), badge: L("4,9 ★", "4.9 ★") },
    ],
  }),

  // ===========================================================================
  // R12 — Fable temalarının şablonları. Kural: adım cihazı temanın cihazını
  // ezmez; sadece poz/köşe değişir ki temanın karakteri (kil, çerçevesiz,
  // sert gölge) her karede kalsın.
  // ===========================================================================
  makeTemplate({
    id: "diptik-katalog",
    name: L("Diptik Katalog", "Diptych Catalog"),
    hint: L("Telefonsuz çift kare — beyaz kart, kılcal ayraç, italik serif", "Phoneless double frame — white card, hairline divider, italic serif"),
    kategori: "minimal",
    themeId: "diptik",
    defaultCount: 5,
    steps: [
      { layout: "diptych" },
      { layout: "screen-card", alt: 0 },
      { layout: "diptych", alt: 2 },
      { layout: "screen-card", alt: 3 },
      { layout: "diptych", alt: 4 },
    ],
    copy: [
      { headline: "İki ekran, tek fikir", sub: "Sol: bugün · Sağ: vakitler" },
      { headline: "Sade bir başlangıç", sub: "İlk açılış" },
      { headline: "Kıble ve zikir", sub: "Yan yana" },
      { headline: "Gece modu", sub: "Göz yormaz" },
      { headline: "Bugün başla", sub: "Ücretsiz", badge: "4,9 ★" },
    ],
  }),
  makeTemplate({
    id: "aurora-lansman",
    name: L("Aurora Lansman", "Aurora Launch"),
    hint: L("Kuzey ışığı zemin, buzlu cam panel, çerçevesiz cihaz", "Northern lights background, frosted glass panel, frameless device"),
    kategori: "hero",
    themeId: "aurora-cam",
    defaultCount: 6,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "duo-hero-aside", alt: 1 },
      { layout: "text-top", alt: 3 },
      { layout: "device-bleed-bottom", alt: 2 },
      { layout: "text-top", alt: 4 },
    ],
    copy: [
      { headline: L("Işık gibi hafif", "Light as light"), sub: L("Her sabah yeni bir gökyüzü", "A new sky every morning"), badge: L("YENİ", "NEW") },
      { headline: L("Vakit, parıltıyla", "Time, with a shimmer"), sub: L("Tek dokunuşla bugünün planı", "Today's plan in one tap") },
      { headline: L("İki özellik, tek kare", "Two features, one frame"), sub: L("Takvim ve hatırlatıcı", "Calendar and reminders") },
      { headline: L("Karanlıkta bile net", "Clear even in the dark"), sub: L("Gece modu otomatik", "Night mode is automatic") },
      { headline: L("Cebinde aurora", "Aurora in your pocket"), sub: L("Widget'lar kilit ekranında", "Widgets on the lock screen") },
      { headline: L("Bugün indir", "Download today"), sub: L("Reklamsız, sonsuza dek", "Ad-free, forever"), badge: L("4,9 ★", "4.9 ★") },
    ],
  }),
  makeTemplate({
    id: "gece-altin-seri",
    name: L("Gece Altın", "Night Gold"),
    hint: L("Siyah kadife, altın kılcal çerçeve, yaslanmış gerçek model", "Black velvet, gold hairline frame, reclined real model"),
    kategori: "hero",
    themeId: "gece-altin",
    defaultCount: 5,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "text-bottom", alt: 3 },
      { layout: "text-top", alt: 1 },
      { layout: "badge-hero", alt: 2 },
    ],
    copy: [
      { headline: "Zamanın ağırlığı", sub: "Her vakit, tek satırda" },
      { headline: "Sessiz lüks", sub: "Bildirim yok, huzur var" },
      { headline: "Altın saat", sub: "Gün doğumu, gün batımı" },
      { headline: "Sadece sen", sub: "Hesap yok, izleme yok" },
      { headline: "Seçkin", sub: "Editörlerin seçimi", badge: "★" },
    ],
  }),
  makeTemplate({
    id: "isvicre-afis",
    name: L("İsviçre Afiş", "Swiss Poster"),
    hint: L("Kırık beyaz, siyah cetvel, tek kırmızı kare, sert gölge", "Off-white, black ruler, single red square, hard shadow"),
    kategori: "minimal",
    themeId: "isvicre",
    defaultCount: 5,
    steps: [
      { layout: "split-diagonal" },
      { layout: "duo-stagger", alt: 0 },
      { layout: "split-diagonal", alt: 2 },
      { layout: "duo-editorial", alt: 1 },
      { layout: "split-diagonal", alt: 3 },
    ],
    copy: [
      { headline: "Vakit. Nokta.", sub: "Fazlası yok", badge: "01" },
      { headline: "İki ekran", sub: "Bugün ve yarın", badge: "02" },
      { headline: "Kıble", sub: "Yanılmaz", badge: "03" },
      { headline: "Zikir", sub: "Sayaç, hedef, seri", badge: "04" },
      { headline: "İndir", sub: "Ücretsiz", badge: "05" },
    ],
  }),
  makeTemplate({
    id: "terracotta-yaz",
    name: L("Terracotta Yaz", "Terracotta Summer"),
    hint: L("Kil gradient, toprak kırmızısı kil telefon, üstten diyagonal poz", "Clay gradient, earth-red clay phone, diagonal pose from above"),
    kategori: "hero",
    themeId: "terracotta",
    defaultCount: 6,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "text-bottom", alt: 1 },
      { layout: "text-top", alt: 2 },
      { layout: "badge-hero", alt: 4 },
      { layout: "text-top", alt: 5 },
    ],
    copy: [
      { headline: "Güneşle uyan", sub: "İmsak, sabah, öğle" },
      { headline: "Sıcak bir rutin", sub: "Her gün aynı huzur" },
      { headline: "Kıble pusulası", sub: "Yönünü bul" },
      { headline: "Zikir vakti", sub: "Tespih ağırlığında" },
      { headline: "Akdeniz sakinliği", sub: "Bildirim yok, telaş yok", badge: "YENİ" },
      { headline: "Bugün başla", sub: "Ücretsiz, reklamsız", badge: "4,9 ★" },
    ],
  }),

  // R14 — 3D glass şablonları.
  makeTemplate({
    id: "sivi-cam-seti",
    name: L("Sıvı Cam", "Liquid Glass"),
    hint: L("Koyu aurora, gerçek buzlu cam kart, çerçevesiz cihaz", "Dark aurora, real frosted glass card, frameless device"),
    kategori: "hero",
    themeId: "sivi-cam",
    defaultCount: 6,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "duo-hero-aside", alt: 1 },
      { layout: "text-top", alt: 3 },
      { layout: "text-bottom", alt: 2 },
      { layout: "text-top", alt: 5 },
    ],
    copy: [
      { headline: L("Camdan hafif", "Lighter than glass"), sub: L("2026'nın dili: derinlik, ışık, sükûnet", "The language of 2026: depth, light, calm"), badge: L("YENİ", "NEW") },
      { headline: L("Her şey görünür", "Everything is visible"), sub: L("Katmanlar birbirini gizlemez", "Layers don't hide each other") },
      { headline: L("İki özellik", "Two features"), sub: L("Tek kare, tek nefes", "One frame, one breath") },
      { headline: L("Gece de net", "Clear at night too"), sub: L("Kontrast kendini ayarlar", "Contrast adjusts itself") },
      { headline: L("Dokunmadan hisset", "Feel it before you touch"), sub: L("Mikro hareketler, gerçek geri bildirim", "Micro-motions, real feedback") },
      { headline: L("Bugün indir", "Download today"), sub: L("Ücretsiz · reklamsız", "Free · ad-free"), badge: L("4,9 ★", "4.9 ★") },
    ],
  }),
  makeTemplate({
    id: "buz-cam-seti",
    name: L("Buz Cam", "Ice Glass"),
    hint: L("Pastel mesh, beyaz buzlu cam kart, mürekkep başlık — açık tema", "Pastel mesh, white frosted glass card, ink headline — light theme"),
    kategori: "minimal",
    themeId: "buz-cam",
    defaultCount: 6,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "duo-hero-aside", alt: 3 },
      { layout: "text-top", alt: 1 },
      { layout: "text-bottom", alt: 4 },
      { layout: "text-top", alt: 5 },
    ],
    copy: [
      { headline: L("Hafif, ferah", "Light and airy"), sub: L("Sabah gibi bir arayüz", "An interface like morning"), badge: L("YENİ", "NEW") },
      { headline: L("Bir bakışta", "At a glance"), sub: L("Ne varsa camın arkasında", "Everything sits behind the glass") },
      { headline: L("İki ekran", "Two screens"), sub: L("Plan ve gerçek", "Plan and reality") },
      { headline: L("Sakin renkler", "Calm colors"), sub: L("Gözü yormaz, dikkati dağıtmaz", "Easy on the eyes, never distracting") },
      { headline: L("Küçük anlar", "Small moments"), sub: L("Her tamamlanan iş kutlanır", "Every finished task is celebrated") },
      { headline: L("Bugün başla", "Start today"), sub: L("Hesap yok, kurulum yok", "No account, no setup"), badge: L("ÜCRETSİZ", "FREE") },
    ],
  }),
  makeTemplate({
    id: "klein-blur-seti",
    name: "Klein Blur",
    hint: L("Klein mavisi, bulanık ışık lekeleri, cam kart, gümüş model", "Klein blue, blurred light spots, glass card, silver model"),
    kategori: "hero",
    themeId: "klein-blur",
    defaultCount: 6,
    steps: [
      { layout: "text-top" },
      { layout: "text-top", alt: 0 },
      { layout: "text-bottom", alt: 1 },
      { layout: "text-top", alt: 2 },
      { layout: "duo-hero-aside", alt: 3 },
      { layout: "badge-hero", alt: 4 },
    ],
    copy: [
      { headline: L("Mavi.", "Blue."), sub: L("Tek renk, tam odak", "One color, full focus"), badge: L("YENİ", "NEW") },
      { headline: L("Derinlik", "Depth"), sub: L("Işık camın içinden geçer", "Light passes through the glass") },
      { headline: L("Akış", "Flow"), sub: L("Duraksamadan, pürüzsüz", "Smooth, without a pause") },
      { headline: L("Net", "Sharp"), sub: L("Karanlıkta da, güneşte de", "In the dark and in the sun") },
      { headline: L("İki ekran", "Two screens"), sub: L("Yan yana, tek sahne", "Side by side, one scene") },
      { headline: L("Başla", "Start"), sub: L("Ücretsiz · reklam yok", "Free · no ads"), badge: L("4,9 ★", "4.9 ★") },
    ],
  }),

  // ===========================================================================
  // R15 — iPAD SETLERİ. Kategori "ipad". Adımlar hem portre hem yatay iPad
  // projesinde çalışır (wide-* düzenleri yatayda parlar, portrede de geçerli).
  // ===========================================================================
  makeTemplate({
    id: "ipad-masa-seti",
    name: L("iPad · Masa", "iPad · Desk"),
    hint: L("Meşe masa, üstten çekim, gümüş iPad Pro — sıcak ürün fotoğrafı", "Oak desk, top-down shot, silver iPad Pro — warm product photo"),
    kategori: "ipad",
    themeId: "ipad-masa",
    defaultCount: 5,
    steps: [
      { layout: "text-top" },
      { layout: "wide-hero", alt: 0 },
      { layout: "text-top", alt: 1 },
      { layout: "wide-left", alt: 0 },
      { layout: "badge-hero", alt: 2 },
    ],
    copy: [
      { headline: L("Masanın üstünde, elinin altında", "On your desk, at your fingertips"), sub: L("iPad'de tam ekran deneyim", "A full-screen experience on iPad"), badge: "iPad" },
      { headline: L("Geniş tuval", "Wide canvas"), sub: L("Yan yana iki pencere", "Two windows side by side") },
      { headline: L("Kalemle", "With the pen"), sub: L("Not al, çiz, işaretle", "Take notes, draw, mark up") },
      { headline: L("Klavye ile hızlı", "Fast with a keyboard"), sub: L("Kısayollar, çoklu görev", "Shortcuts, multitasking") },
      { headline: L("Bugün başla", "Start today"), sub: L("iPhone'daki hesabınla", "With your iPhone account"), badge: L("ÜCRETSİZ", "FREE") },
    ],
  }),
  makeTemplate({
    id: "ipad-studyo-seti",
    name: L("iPad · Stüdyo", "iPad · Studio"),
    hint: L("Beyaz stüdyo fonu, 3/4 duran iPad, yansıma — Apple ürün çekimi", "White studio backdrop, 3/4 standing iPad, reflection — Apple-style product shot"),
    kategori: "ipad",
    themeId: "ipad-studyo",
    defaultCount: 5,
    steps: [
      { layout: "text-top" },
      { layout: "wide-left", alt: 0 },
      { layout: "text-bottom", alt: 1 },
      { layout: "wide-right", alt: 0 },
      { layout: "badge-hero", alt: 2 },
    ],
    copy: [
      { headline: L("iPad için tasarlandı", "Designed for iPad"), sub: L("Büyük ekran, büyük düşünce", "Big screen, big thinking"), badge: L("YENİ", "NEW") },
      { headline: L("Her şey görünür", "Everything is visible"), sub: L("Kenar çubuğu + içerik", "Sidebar + content") },
      { headline: L("Odaklan", "Focus"), sub: L("Tek pencere, sıfır dikkat dağınıklığı", "One window, zero distraction") },
      { headline: L("Çoklu görev", "Multitasking"), sub: L("Bölünmüş ekran, sürükle bırak", "Split screen, drag and drop") },
      { headline: L("İndir", "Download"), sub: L("Universal — tek satın alma", "Universal — one purchase"), badge: "★" },
    ],
  }),
  makeTemplate({
    id: "ipad-cam-seti",
    name: L("iPad · Cam", "iPad · Glass"),
    hint: L("Koyu aurora, yüzen iPad, cam halesi — 2026 dili", "Dark aurora, floating iPad, glass halo — 2026 look"),
    kategori: "ipad",
    themeId: "ipad-cam",
    defaultCount: 5,
    steps: [
      { layout: "text-top" },
      { layout: "wide-hero", alt: 0 },
      { layout: "text-top", alt: 1 },
      { layout: "wide-left", alt: 2 },
      { layout: "badge-hero", alt: 3 },
    ],
    copy: [
      { headline: L("Işıkta yüzer", "Floats in the light"), sub: L("iPad'de derinlik ve hafiflik", "Depth and lightness on iPad"), badge: L("YENİ", "NEW") },
      { headline: L("Tam ekran", "Full screen"), sub: L("Kenarsız, kesintisiz", "Edgeless, seamless") },
      { headline: L("Gece modu", "Night mode"), sub: L("Kontrast kendini ayarlar", "Contrast adjusts itself") },
      { headline: L("Klavye kısayolları", "Keyboard shortcuts"), sub: L("Elin klavyeden kalkmaz", "Your hands never leave the keyboard") },
      { headline: L("Bugün indir", "Download today"), sub: L("Ücretsiz · reklamsız", "Free · ad-free"), badge: L("4,9 ★", "4.9 ★") },
    ],
  }),
  makeTemplate({
    id: "ipad-editoryal-seti",
    name: L("iPad · Editoryal", "iPad · Editorial"),
    hint: L("Kağıt beyazı, sol sütun serif, çerçevesiz geniş ekran", "Paper white, left-column serif, frameless wide screen"),
    kategori: "ipad",
    themeId: "ipad-editoryal",
    defaultCount: 5,
    steps: [
      { layout: "wide-left" },
      { layout: "text-top", alt: 0 },
      { layout: "wide-right", alt: 1 },
      { layout: "text-top", alt: 2 },
      { layout: "wide-hero", alt: 0 },
    ],
    copy: [
      { headline: L("Okumak için geniş", "Wide for reading"), sub: L("Dergi sayfası gibi", "Like a magazine page"), badge: "iPad" },
      { headline: L("Notlar yanında", "Notes alongside"), sub: L("Metin ve kenar notu bir arada", "Text and margin notes together") },
      { headline: L("Sessiz arayüz", "Quiet interface"), sub: L("İçerik önde, kabuk geride", "Content up front, chrome behind") },
      { headline: L("Koleksiyon", "Collection"), sub: L("Rafın, klasörlerin, etiketlerin", "Your shelf, folders and tags") },
      { headline: L("Başla", "Start"), sub: L("İlk hafta ücretsiz", "First week free") },
    ],
  }),
  makeTemplate({
    id: "ipad-gece-seti",
    name: L("iPad · Gece", "iPad · Night"),
    hint: L("Lacivert-siyah, yaslanmış iPad, altın cetvel — gece okuma", "Navy-black, reclined iPad, gold ruler — night reading"),
    kategori: "ipad",
    themeId: "ipad-gece",
    defaultCount: 5,
    steps: [
      { layout: "text-top" },
      { layout: "wide-left", alt: 0 },
      { layout: "text-top", alt: 1 },
      { layout: "wide-hero", alt: 2 },
      { layout: "badge-hero", alt: 3 },
    ],
    copy: [
      { headline: L("Gece, sayfa sayfa", "Night, page by page"), sub: L("Göz yormayan iPad okuma", "Eye-friendly reading on iPad"), badge: L("GECE", "NIGHT") },
      { headline: L("Karanlıkta net", "Sharp in the dark"), sub: L("Sıcak ton, düşük parlaklık", "Warm tone, low brightness") },
      { headline: L("Bir dokunuş uzakta", "One tap away"), sub: L("Yer imi, not, vurgu", "Bookmark, note, highlight") },
      { headline: L("Tam ekran", "Full screen"), sub: L("Sadece metin", "Just the text") },
      { headline: L("Bu gece başla", "Start tonight"), sub: L("Ücretsiz deneme", "Free trial"), badge: "★" },
    ],
  }),
  makeTemplate({
    id: "split-onboarding", name: L("Giriş → Ana ekran", "Sign-in → Home"),
    hint: L("Giriş ve ana ekrandan yakın plan kesitler; iki kırpılmış panel, cihaz gövdesi yok", "Close-up crops from sign-in and home screens; two cropped panels, no device body"),
    kategori: "split", themeId: "clean-light", defaultCount: 3,
    steps: [{ layout: "split-h" }, { layout: "split-v", alt: 1 }, { layout: "split-h", alt: 0 }],
    copy: [
      { headline: L("Girişten ana ekrana", "From sign-in to home"), sub: L("01 · Giriş     02 · Ana ekran", "01 · Sign-in     02 · Home") },
      { headline: L("Keşfet, ayrıntıya in", "Explore, dive into the details"), sub: L("01 · Keşif     02 · Detay", "01 · Explore     02 · Detail") },
      { headline: L("Seçimden sonuca", "From choice to result"), sub: L("01 · Seçim     02 · Sonuç", "01 · Choice     02 · Result") },
    ],
  }),
  makeTemplate({
    id: "split-workflow", name: L("İki adım · Gece", "Two Steps · Night"),
    hint: L("Koyu zeminde iki büyük görsel kesiti; giriş / ana ekran ve arama / sonuç çiftleri", "Two large visual crops on a dark background; sign-in / home and search / results pairs"),
    kategori: "split", themeId: "obsidian", defaultCount: 3,
    steps: [
      { layout: "split-v", device: kontur("front", "#16171f", "night") },
      { layout: "split-h", alt: 0, device: kontur("front", "#16171f", "night") },
      { layout: "split-v", alt: 2, device: kontur("front", "#16171f", "night") },
    ],
    copy: [
      { headline: L("Bir hesap, tüm deneyim", "One account, the full experience"), sub: L("01 · Giriş     02 · Ana ekran", "01 · Sign-in     02 · Home") },
      { headline: L("Ara ve bul", "Search and find"), sub: L("01 · Arama     02 · Sonuçlar", "01 · Search     02 · Results") },
      { headline: L("Planla, tamamla", "Plan, complete"), sub: L("01 · Plan     02 · İlerleme", "01 · Plan     02 · Progress") },
    ],
  }),
  makeTemplate({
    id: "ipad-workspace-seti", name: L("iPad · Çalışma alanı", "iPad · Workspace"),
    hint: L("Düz ve okunaklı tablet ekranları: giriş, pano ve detay çiftleri", "Flat, legible tablet screens: sign-in, board and detail pairs"),
    kategori: "ipad", themeId: "ipad-workspace", defaultCount: 4,
    steps: [{ layout: "wide-left" }, { layout: "split-v" }, { layout: "split-h", alt: 0 }, { layout: "wide-right", alt: 1 }],
    copy: [
      { headline: L("Çalışmana yer aç", "Make room for your work"), sub: L("Projelerin, notların ve araçların aynı tuvalde", "Your projects, notes and tools on the same canvas"), badge: "iPad" },
      { headline: L("Girişten çalışma alanına", "From sign-in to workspace"), sub: L("01 · Giriş     02 · Proje panosu", "01 · Sign-in     02 · Project board") },
      { headline: L("Bütünü gör, detaya in", "See the whole, dive into detail"), sub: L("01 · Pano     02 · Görev detayı", "01 · Board     02 · Task detail") },
      { headline: L("Kalemle düşün", "Think with the pen"), sub: L("Not al, işaretle, çalışmana devam et", "Take notes, mark up, keep working") },
    ],
  }),
  makeTemplate({
    id: "ipad-review-seti", name: L("iPad · Oku ve not al", "iPad · Read and Annotate"),
    hint: L("Sıcak kâğıt üzerinde iki tablet ekranı: okuma ve notlar", "Two tablet screens on warm paper: reading and notes"),
    kategori: "ipad", themeId: "ipad-editoryal", defaultCount: 3,
    steps: [{ layout: "split-h" }, { layout: "split-v", alt: 0 }, { layout: "wide-left", alt: 2 }],
    copy: [
      { headline: L("Oku, not al", "Read, take notes"), sub: L("01 · Okuma     02 · Notlar", "01 · Reading     02 · Notes") },
      { headline: L("Kaynağın yanında", "Next to the source"), sub: L("01 · Belge     02 · İşaretlemeler", "01 · Document     02 · Markups") },
      { headline: L("Düşüncelerini düzenle", "Organize your thoughts"), sub: L("Koleksiyonların geniş ekranda", "Your collections on a wide screen"), badge: "iPad" },
    ],
  }),
];
TEMPLATES.push(...privateLegacyTemplates({ makeTemplate, real, kontur }));

// Each family retains its material and lighting through all three camera beats.
// Device kind / GLB are resolved from project format, never pinned by a theme.
function familyDevice(themeId: string, camera: CameraPresetId): DeviceStyle {
  const device = getTheme(themeId).device;
  if (device.mode !== "3d") throw new Error(`Expected a 3D theme: ${themeId}`);
  return { ...structuredClone(device), camera };
}

TEMPLATES.push(
  makeTemplate({
    id: "glacier-studio-ipad", name: "Glacier Studio · iPad",
    hint: L("Buz mavisi stüdyo, Jakarta başlık, gerçek 3D tablet · portre ve yatay", "Ice-blue studio, Jakarta headline, real 3D tablet · portrait and landscape"),
    kategori: "ipad", themeId: "glacier-studio", defaultCount: 3,
    steps: [
      { layout: "wide-hero", device: familyDevice("glacier-studio", "hero-right") },
      { layout: "wide-left", alt: 0, device: familyDevice("glacier-studio", "front") },
      { layout: "wide-hero", alt: 1, device: familyDevice("glacier-studio", "hero-left") },
    ],
    copy: [
      { headline: L("Fikrine yer aç", "Make room for your idea"), sub: L("Düşün, düzenle, tek yerde üret", "Think, organize, create in one place"), badge: "STUDIO" },
      { headline: L("Tam odak", "Full focus"), sub: L("Her detay elinin altında", "Every detail at your fingertips") },
      { headline: L("Akışını bul", "Find your flow"), sub: L("İlk fikirden son dokunuşa", "From first idea to final touch") },
    ],
  }),
  makeTemplate({
    id: "glacier-studio-duo", name: "Glacier Studio · iPhone Duo",
    hint: L("Açık stüdyo ışığında iki gerçek 3D iPhone · bindirme, destek, derinlik", "Two real 3D iPhones in bright studio light · overlap, support, depth"),
    kategori: "duo", themeId: "glacier-studio", defaultCount: 3,
    steps: [
      { layout: "duo-overlap", device: familyDevice("glacier-studio", "hero-right") },
      { layout: "duo-hero-aside", alt: 0, device: familyDevice("glacier-studio", "front") },
      { layout: "duo-depth", alt: 1, device: familyDevice("glacier-studio", "hero-left") },
    ],
    copy: [
      { headline: L("Birlikte daha net", "Clearer together"), sub: L("Planın ve ilerlemen yan yana", "Your plan and progress side by side"), badge: "STUDIO" },
      { headline: L("Detayı yakala", "Catch the detail"), sub: L("Genel bakıştan tek bir adıma", "From overview to a single step") },
      { headline: L("Akış sende", "The flow is yours"), sub: L("İki ekran, kesintisiz deneyim", "Two screens, a seamless experience") },
    ],
  }),
  makeTemplate({
    id: "midnight-graphite-ipad", name: "Midnight Graphite · iPad",
    hint: L("Grafit fon, Onest başlık, kenar ışıklı gerçek 3D tablet · portre ve yatay", "Graphite backdrop, Onest headline, rim-lit real 3D tablet · portrait and landscape"),
    kategori: "ipad", themeId: "midnight-graphite", defaultCount: 3,
    steps: [
      { layout: "wide-hero", device: familyDevice("midnight-graphite", "hero-left") },
      { layout: "wide-right", alt: 0, device: familyDevice("midnight-graphite", "front") },
      { layout: "wide-hero", alt: 1, device: familyDevice("midnight-graphite", "hero-right") },
    ],
    copy: [
      { headline: L("Odağın burada", "Your focus is here"), sub: L("Fikirlerine geniş bir çalışma alanı", "A wide workspace for your ideas"), badge: "GRAPHITE" },
      { headline: L("Kontrol sende", "You're in control"), sub: L("Bütünü gör, detaya in", "See the whole, dive into detail") },
      { headline: L("Daha ileri", "Further"), sub: L("Her adımda daha net bir görünüm", "A clearer view at every step") },
    ],
  }),
  makeTemplate({
    id: "midnight-graphite-duo", name: "Midnight Graphite · iPhone Duo",
    hint: L("Grafit sahnede iki gerçek 3D iPhone · derinlik ve soğuk kenar ışığı", "Two real 3D iPhones on a graphite stage · depth and cool rim light"),
    kategori: "duo", themeId: "midnight-graphite", defaultCount: 3,
    steps: [
      { layout: "duo-depth", device: familyDevice("midnight-graphite", "hero-left") },
      { layout: "duo-overlap", alt: 0, device: familyDevice("midnight-graphite", "front") },
      { layout: "duo-hero-aside", alt: 1, device: familyDevice("midnight-graphite", "hero-right") },
    ],
    copy: [
      { headline: L("Her açıdan net", "Clear from every angle"), sub: L("Büyük resim ve önemli detaylar", "The big picture and the important details"), badge: "GRAPHITE" },
      { headline: L("Bir adım önde", "One step ahead"), sub: L("Keşfet, seç, kaldığın yerden devam et", "Explore, choose, pick up where you left off") },
      { headline: L("Tam kontrol", "Full control"), sub: L("Planın yanında sonuçlarını da gör", "See your results next to your plan") },
    ],
  }),
  makeTemplate({
    id: "warm-editorial-ipad", name: "Warm Editorial · iPad",
    hint: L("Sıcak kâğıt, Newsreader serif, gün ışığında gerçek 3D tablet · portre ve yatay", "Warm paper, Newsreader serif, real 3D tablet in daylight · portrait and landscape"),
    kategori: "ipad", themeId: "warm-editorial", defaultCount: 3,
    steps: [
      { layout: "wide-left", device: familyDevice("warm-editorial", "hero-right") },
      { layout: "wide-hero", alt: 0, device: familyDevice("warm-editorial", "front") },
      { layout: "wide-right", alt: 1, device: familyDevice("warm-editorial", "hero-left") },
    ],
    copy: [
      { headline: L("Bir fikir", "An idea"), sub: L("Düşüncelerine yer aç", "Make room for your thoughts"), badge: "EDITION 01" },
      { headline: L("Kendi ritminde", "At your own rhythm"), sub: L("Oku, not al, yeni bağlantılar kur", "Read, take notes, make new connections") },
      { headline: L("Yeni sayfa", "New page"), sub: L("Her gün bir adım daha", "One more step every day") },
    ],
  }),
  makeTemplate({
    id: "warm-editorial-duo", name: "Warm Editorial · iPhone Duo",
    hint: L("Kâğıt dokusu ve serif başlıkla iki gerçek 3D iPhone · editoryal ritim", "Two real 3D iPhones with paper texture and serif headline · editorial rhythm"),
    kategori: "duo", themeId: "warm-editorial", defaultCount: 3,
    steps: [
      { layout: "duo-editorial", device: familyDevice("warm-editorial", "hero-right") },
      { layout: "duo-overlap", alt: 0, device: familyDevice("warm-editorial", "front") },
      { layout: "duo-stagger", alt: 1, device: familyDevice("warm-editorial", "hero-left") },
    ],
    copy: [
      { headline: L("Oku. Düşün.", "Read. Think."), sub: L("Bir sayfa, yeni bir fikir", "One page, a new idea"), badge: "EDITION 01" },
      { headline: L("Yanına not düş", "Jot a note beside it"), sub: L("Okudukların ve düşündüklerin bir arada", "What you read and what you think, together") },
      { headline: L("İz bırak", "Leave a mark"), sub: L("Kendi koleksiyonunu oluştur", "Build your own collection") },
    ],
  }),
);

// Five art directions, each authored for three physical device families.
const activeThemes = new Set(THEMES.map(t => t.id));
const retiredTemplates = new Set(["dark-neon", "editorial-lux", "riso-zine", "award-editors-choice", "award-blank"]);
for (let i = TEMPLATES.length - 1; i >= 0; i--) {
  if (!activeThemes.has(TEMPLATES[i].themeId) || retiredTemplates.has(TEMPLATES[i].id) || TEMPLATES[i].kategori === "duo") TEMPLATES.splice(i, 1);
}
const launches: Template[] = [];
for (const c of COLLECTIONS) for (const family of ["iphone", "ipad", "duo"] as const) {
  const theme = getTheme(c.id);
  const device = { ...theme.device };
  const layouts: LayoutId[] = family === "duo" ? ["wide-left", "text-top", "wide-right", "wide-hero", "text-bottom"] : family === "ipad" ? ["text-top", "wide-left", "wide-hero", "text-bottom", "screen-card"] : ["text-top", "device-bleed-bottom", "text-bottom", "split-diagonal", "screen-card"];
  const tpl = makeTemplate({
    id: `${c.id}-${family}`, name: `${c.name} · ${family === "iphone" ? "iPhone" : family === "ipad" ? "iPad" : "iPhone Duo"}`,
    hint: `${c.description} · ${family === "duo" ? L("Katlanabilir 3D gövde, iç ve dış ekran", "Foldable 3D body, inner and outer screen") : L("Gerçek 3D cihaz, beş özgün kadraj", "Real 3D device, five distinct compositions")}`,
    kategori: family === "duo" ? "duo" : family === "ipad" ? "ipad" : "hero", themeId: c.id, defaultCount: 5,
    steps: layouts.map((layout, i) => ({ layout, alt: i === 2 ? 0 : i === 4 ? 1 : undefined, device: device.mode === "3d" ? { ...device, camera: i === 1 ? "front" : i === 3 ? "lean-back" : device.camera, ...(family === "duo" ? { model: "kontur" as const, foldAngle: i === 1 ? 180 : i === 3 ? 110 : 155 } : {}) } : device })),
    copy: [
      { headline: L("Büyük fikirler.\nYeni bir alan.", "Big ideas.\nA new space."), sub: L("Uygulamanı en iyi haliyle keşfet.", "Discover your app at its best."), badge: c.name.toUpperCase() },
      { headline: L("Her şey\nbir bakışta.", "Everything\nat a glance."), sub: L("İhtiyacın olan özellikler, tek yerde.", "The features you need, in one place.") },
      { headline: L("Sana göre\ntasarlandı.", "Designed\nfor you."), sub: L("Daha az adım. Daha çok imkan.", "Fewer steps. More possibilities.") },
      { headline: family === "duo" ? L("Aç. Keşfet.\nDevam et.", "Open. Explore.\nContinue.") : L("Yeni bir\nperspektif.", "A new\nperspective."), sub: L("Her detayda daha iyi bir deneyim.", "A better experience in every detail.") },
      { headline: L("İyi hissettiren\nbir başlangıç.", "A start that\nfeels good."), sub: L("Kendi ritmini bul. Bugün başla.", "Find your own rhythm. Start today.") },
    ],
  });
  tpl.family = family;
  launches.push(tpl);
}
TEMPLATES.unshift(...launches);
TEMPLATES.unshift(...BRAND_TEMPLATES);
export function templateForFormat(t: Template, format: import("./types").Format): boolean {
  const family = format.startsWith("iphone-duo") ? "duo" : format.startsWith("ipad") ? "ipad" : "iphone";
  return t.family ? t.family === family : family === "duo" ? false : family === "ipad" ? t.kategori !== "duo" : t.kategori !== "ipad" && t.kategori !== "duo";
}

/** Unknown IDs use the generic collection, independently of gallery order. */
export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES.find(t=>t.id==="solstice-iphone") ?? TEMPLATES[0];
}

/** Theme cards and command selection use the same editable brand frame. */
export function patchForTheme(slide: Slide, themeId: string, format: import("./types").Format = "iphone"): Partial<Slide> {
  const authored = BRAND_TEMPLATES.find(t => t.themeId === themeId && templateForFormat(t, format))?.style(0);
  const userElements = slide.elements?.filter(e => !e.id.startsWith("brand:"));
  return {
    themeId, background: undefined, device: undefined, hideDevice: undefined, frameLabel: undefined,
    headlineStyle: undefined, subStyle: undefined, overlay: undefined,
    textBoxes: undefined, layerStates: undefined, themeElementOverrides: undefined,
    ...(BRAND_TEMPLATES.some(t=>t.themeId===slide.themeId) ? { deviceOffset: undefined, device2Offset: undefined, device3Offset: undefined, textOffset: undefined } : {}),
    ...(authored ?? {}),
    elements: [...(authored?.elements ?? []), ...(userElements ?? [])],
  };
}

/**
 * Var olan slaytları şablonla yeniden giydirir — metin, rozet, süs ve ekran
 * görüntüsü korunur; elle yapılmış nudge'lar (offset) ve stil override'ları
 * temizlenir, çünkü yeni yerleşimde anlamları kalmaz.
 */
export function restyleSlides(slides: Slide[], templateId: string): Slide[] {
  const tpl = getTemplate(templateId);
  return slides.map((s, i) => {
    const next: Slide = { ...s };
    delete next.headlineStyle;
    delete next.subStyle;
    delete next.textOffset;
    delete next.textBoxes;
    delete next.layerStates;
    delete next.themeElementOverrides;
    delete next.deviceOffset;
    delete next.device2Offset;
    delete next.device3Offset;
    delete next.hideDevice;
    delete next.frameLabel;
    const style = tpl.style(i);
    // Only replace authored template art. User-added objects, screenshots
    // and translated copy survive a theme change.
    const userElements = (s.elements ?? []).filter(e => !e.id.startsWith("brand:"));
    Object.assign(next, style);
    const elements = [...(style.elements ?? []), ...userElements];
    next.elements = elements.length ? elements : undefined;
    return next;
  });
}
