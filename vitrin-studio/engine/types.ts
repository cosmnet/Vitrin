// Vitrin Studio — merkez veri modeli.
// Set Plan JSON: LLM üretir, renderer çizer, editör düzenler, export basar.
// Tüm px değerleri 1320×2868 (6.9" App Store) tabanındadır; renderer ölçekler.

import { L } from "@/lib/i18n";

export const BASE_W = 1320;
export const BASE_H = 2868;

/* ---------- FORMAT (iPhone / iPad) ----------
   Proje düzeyinde tek bir format vardır; iPad seti AYRI projedir (aynı
   uygulamanın iPad arayüzü ayrı çekilir, dil senkronu formatlar arasında
   koşmaz).

   TASARIM KARARI — tuval oranı = cihaz oranı. iPhone'da 1320/2868 = 0.4603
   ile telefon eni birebir aynıydı ("cihaz eni ≈ scale × slayt eni" özdeşliği
   layouts.ts'in tüm yatay bütçesi bunun üstüne kurulu). iPad'de de tuvali
   3:4, cihazı 0.75 tutunca özdeşlik AYNEN korunur:
       cihaz eni / tuval eni = scale × (H/W) × cihazOranı = scale
   Yani 20 düzenin hiçbiri iPad için yeniden bütçelenmedi; gerekmedi.

   `base` = o formatın "BASE px" tabanı. BASE px cinsinden tutulan her şey
   (yazı puntosu, nudge, öğe koordinatı, gölge, blur) `scale = W / base.w` ile
   ölçeklenir. iPad tabanı bilerek export boyutundan KÜÇÜK (1548×2064, tam 3:4):
   temalar 1320 enine göre ayarlı; iPad'de aynı punto genişliğe göre biraz
   küçük durur — App Store iPad setlerinde zaten öyle, geniş tuvalde başlık
   ekranın %9'unu değil ~%7.7'sini kaplar. */
export type Format = "iphone" | "ipad" | "ipad-landscape" | "iphone-duo" | "iphone-duo-portrait" | "iphone-duo-cover" | "iphone-duo-cover-landscape";
export type DeviceKind = "phone" | "tablet" | "tablet-landscape" | "foldable" | "foldable-portrait" | "foldable-cover" | "foldable-cover-landscape";

export const FORMATS: Record<
  Format,
  {
    label: string;
    /** BASE px tabanı — bu formatta "1 BASE px" neye ölçeklenir. */
    base: { w: number; h: number };
    /** Cihaz en/boy oranı (ekran değil, gövde kadrajı). */
    deviceAspect: number;
    kind: DeviceKind;
    /** Bu formatın zorunlu App Store export boyutu. */
    exportSize: ExportSizeId;
  }
> = {
  iphone: {
    label: "iPhone",
    base: { w: BASE_W, h: BASE_H },
    deviceAspect: 0.4603,
    kind: "phone",
    exportSize: "iphone-69",
  },
  ipad: {
    label: "iPad",
    base: { w: 1548, h: 2064 },
    deviceAspect: 0.75,
    kind: "tablet",
    exportSize: "ipad-13",
  },
  // YATAY iPad (App Store 2752×2064'ü de kabul eder). Tuval 4:3, cihaz yatay
  // tablet; özdeşlik yine tutar (tuval oranı = cihaz oranı = 1.333).
  "ipad-landscape": {
    label: L("iPad · yatay", "iPad · landscape"),
    base: { w: 2064, h: 1548 },
    deviceAspect: 4 / 3,
    kind: "tablet-landscape",
    exportSize: "ipad-13-land",
  },
  // İç ekran BASE = Apple screenshot exportunun tam 2/3'ü. Tasarım
  // koordinatlarıdır; native panel çözünürlüğü veya export boyutu değildir.
  // Kayıtlı projelerin metin/nudge ölçülerini korumak için değiştirmeyin.
  "iphone-duo": { label: L("iPhone Duo · iç ekran · yatay", "iPhone Duo · inner screen · landscape"), base: { w: 1902, h: 1338 }, deviceAspect: 164.6 / 117.8, kind: "foldable", exportSize: "duo-inner-land" },
  "iphone-duo-portrait": { label: L("iPhone Duo · iç ekran · portre", "iPhone Duo · inner screen · portrait"), base: { w: 1338, h: 1902 }, deviceAspect: 117.8 / 164.6, kind: "foldable-portrait", exportSize: "duo-inner" },
  "iphone-duo-cover": { label: L("iPhone Duo · dış ekran · portre", "iPhone Duo · outer screen · portrait"), base: { w: 1398, h: 2034 }, deviceAspect: 84.1 / 117.8, kind: "foldable-cover", exportSize: "duo-outer" },
  "iphone-duo-cover-landscape": { label: L("iPhone Duo · dış ekran · yatay", "iPhone Duo · outer screen · landscape"), base: { w: 2034, h: 1398 }, deviceAspect: 117.8 / 84.1, kind: "foldable-cover-landscape", exportSize: "duo-outer-land" },
};

export function isDuoFormat(format?: Format): boolean { return !!format?.startsWith("iphone-duo"); }
export function isDuoKind(kind?: DeviceKind): boolean { return !!kind?.startsWith("foldable"); }
/** Saf ekran sunumu: App Store screenshot oranı, kasa oranından ayrıdır. */
export function duoScreenAspectOf(kind?: DeviceKind): number {
  if (kind === "foldable") return 2853 / 2007;
  if (kind === "foldable-portrait") return 2007 / 2853;
  if (kind === "foldable-cover-landscape") return 2034 / 1398;
  return 1398 / 2034;
}
export const DUO_UPLOAD_NOTE = L("Apple, Duo yükleme desteğinin 2026 içinde açılacağını belirtiyor.", "Apple says Duo upload support will open in 2026.");
export const DUO_SCREENSHOT_SOURCE = "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications";
export function formatLabel(format: Format): string { return FORMATS[format].label; }

/** Eski projelerde alan yok → iPhone. */
export function formatOf(p: { format?: Format } | null | undefined): Format {
  const f = p?.format;
  return f && f in FORMATS ? f : "iphone";
}

/** Tablet türleri (portre ya da yatay) — cihaz seçici, gövde, 2D silüet bunu sorar. */
export function isTabletKind(kind?: DeviceKind): boolean {
  return kind === "tablet" || kind === "tablet-landscape";
}

export function baseOf(format?: Format): { w: number; h: number } {
  return FORMATS[format ?? "iphone"].base;
}

/** Cihaz en/boy oranı — device2d / snap / Stage hepsi BURADAN okur (üç
 *  kopya sabit vardı, iPad ile ayrıştılar). */
export function deviceAspectOf(kind?: DeviceKind): number {
  if (kind === "tablet") return FORMATS.ipad.deviceAspect;
  if (kind === "tablet-landscape") return FORMATS["ipad-landscape"].deviceAspect;
  const entry = Object.values(FORMATS).find(f => f.kind === kind);
  return entry?.deviceAspect ?? FORMATS.iphone.deviceAspect;
}

export function kindOfFormat(format?: Format): DeviceKind {
  return FORMATS[format ?? "iphone"].kind;
}

export const EXPORT_SIZES = {
  "iphone-69": { w: 1320, h: 2868, label: L('6.9″ iPhone (zorunlu)', '6.9″ iPhone (required)') },
  "iphone-65": { w: 1284, h: 2778, label: '6.5″ iPhone' },
  "ipad-13": { w: 2064, h: 2752, label: '13″ iPad' },
  "ipad-13-land": { w: 2752, h: 2064, label: L('13″ iPad · yatay', '13″ iPad · landscape') },
  "duo-inner": { w: 2007, h: 2853, label: L("Duo · iç ekran · portre", "Duo · inner screen · portrait") },
  "duo-inner-land": { w: 2853, h: 2007, label: L("Duo · iç ekran · yatay", "Duo · inner screen · landscape") },
  "duo-outer": { w: 1398, h: 2034, label: L("Duo · dış ekran · portre", "Duo · outer screen · portrait") },
  "duo-outer-land": { w: 2034, h: 1398, label: L("Duo · dış ekran · yatay", "Duo · outer screen · landscape") },
} as const;
export type ExportSizeId = keyof typeof EXPORT_SIZES;

/* ---------- App preview VİDEO slotları (R8/W5) ----------
   AYRI TABLO: `EXPORT_SIZES`/`ExportSizeId` PNG akışının sözleşmesidir,
   kirletilmez. Video slotları store'da BAŞKA boyutlar ister ve karıştırmak
   sessiz redde yol açar:

     · 886×1920  → 6.9″ / 6.5″ / 6.3″ / 6.1″ iPhone'ların ORTAK portre slotu.
       1080×1920 yalnız eski 5.5″ slotudur; yanlış slota yüklenen video
       HATA VERMEDEN reddedilir (2026'da doğrulandı).
     · 1200×1600 → 13″ iPad.

   Ayrıca sabitler: 15–30 sn, 30 fps SABİT. */
export const VIDEO_SIZES = {
  "iphone-video": { w: 886, h: 1920, label: '6.9″/6.5″/6.3″/6.1″ iPhone' },
  "ipad-13-video": { w: 1200, h: 1600, label: "13″ iPad" },
} as const;
export type VideoSizeId = keyof typeof VIDEO_SIZES;

/** App Store app preview: sabit 30 fps, 15–30 sn. */
export const VIDEO_FPS = 30;
export const VIDEO_MIN_SEC = 15;
export const VIDEO_MAX_SEC = 30;

// ---------- Arka plan ----------
export type GradientStop = [color: string, at: number];

/** Image content inside its frame. Focus is normalized; zoom never resizes the frame. */
export type ImageCrop = {
  x?: number;
  y?: number;
  zoom?: number;
  fit?: "cover" | "contain" | "stretch";
  flipX?: boolean;
  flipY?: boolean;
};
export type ImageFx = { blur?: number; brightness?: number; contrast?: number; sat?: number };
export type TextFrame = { x: number; y: number; w: number; rotation?: number };
export type LayerState = { hidden?: boolean; locked?: boolean; name?: string };

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "linear"; stops: GradientStop[]; angle: number }
  | { kind: "radial"; stops: GradientStop[]; cx: number; cy: number; r: number } // 0..1 oransal
  | { kind: "mesh"; colors: string[]; seed: number }
  | { kind: "shader"; shaderId: string; colors: string[]; seed: number; params?: Record<string, number> }
  | {
      kind: "image";
      src: string;
      overlayColor?: string;
      overlayAlpha?: number;
      /**
       * Renk katmanının harman modu (R8/W4 · B-3.2). Yoksa bugünkü düz
       * `source-over` — eski projeler bit-bit aynı basar. `multiply` foto
       * zeminlerde marka rengini gerçekten ısırtır, `screen` açar.
       */
      overlayBlend?: GlobalCompositeOperation;
      blur?: number;
      imageCrop?: ImageCrop;
      /**
       * PANORAMA DİLİMİ (R13): kaynağın yalnız bu yatay penceresi kadraja
       * cover-fit edilir — `x` pencere başlangıcı, `w` pencere eni, ikisi de
       * kaynak ENİNİN oranı (0..1). Ardışık slaytlara aynı görselin komşu
       * dilimleri verilince (x 0/0.33/0.66, w 0.33) üç kare mağazada yan yana
       * TEK sahne gibi okunur. Yoksa eski davranış: tam görsel.
       */
      crop?: { x: number; w: number };
    };

// ---------- Cihaz ----------
export type CameraPresetId =
  | "front"          // düz karşıdan, hafif derinlik
  | "hero-left"      // 12° sol hero tilt
  | "hero-right"
  | "iso"            // 30° izometrik
  | "laydown"        // üstten, yatık
  | "pair"           // 25° perspektif iki telefon
  | "fan3"           // 3'lü yelpaze
  | "stack3"         // derinlik kademeli üçlü (ön keskin, arka DoF ile erir)
  | "dutch"          // roll'lü sinematik açı
  | "low-hero"       // alttan kahraman açısı
  | "close-top"      // ekran üst yarısı yakın plan
  | "close-bottom"
  | "lean-back"      // R12: geriye yaslanmış, hafif alttan — masada duran ürün hissi
  | "three-quarter"  // R12: 3/4 profil — gövde yanı okunur, ekran hâlâ baskın
  | "top-down"       // R12: üstten diyagonal — laydown'dan dik, editoryal
  | "custom";

export type Orbit = { theta: number; phi: number; distance: number; targetY?: number };

/**
 * 2D cihaz gölgesinin elle ayarı (R8/W4 · B-5.1/5.2/5.3).
 *
 * TAMAMEN OPSİYONEL: verilmeyen her alan `engine/device2d.ts`'teki
 * BUGÜNKÜ literal değere düşer, yani `shadow: true` ile `shadow: {}` aynı
 * pikseli basar. Varsayılan tablosu yansımaya göre ikiye ayrılır (yansıma
 * varken gölge daha hafif) — bkz. SHADOW_DEFAULTS.
 */
export type Device2DShadow = {
  dx?: number;                      // yatay ofset, BASE px (vars. 0)
  dy?: number;                      // dikey ofset, BASE px (vars. 38 / yansımalı 30)
  blur?: number;                    // bulanıklık, BASE px (vars. 112 / yansımalı 130)
  color?: string;                   // hex — tema accent'i düşük alfayla renkli gölge verir
  opacity?: number;                 // 0..1 (vars. 0.34 / yansımalı 0.26)
};

export type DeviceStyle2D = {
  mode: "2d";
  /** Yalnız Duo silüetinde görsel menteşe izi. Frameless ekranda çizilmez. */
  duoCrease?: boolean;
  /** Cihaz türü. SLAYTA YAZILMAZ — render/Stage proje formatından enjekte
   *  eder (formatOf → kindOfFormat). Eksikse telefon. */
  kind?: DeviceKind;
  /** "kontur" = prosedürel silüet (varsayılan), "none" = frameless.
   *  Eski "iphone-frame" (PNG çerçeve) R14'te kaldırıldı — plates2 gerçek
   *  mockup'ları onun yerini aldı; eski projelerde okunursa kontur sayılır. */
  frame?: "kontur" | "none";
  /** Device profile by default, including legacy slides. Custom is an explicit opt-in. */
  cornerMode?: "device" | "custom";
  cornerRadius?: number;            // custom mode only: radius at reference device height
  /**
   * `false` = gölge yok, `true`/yok = bugünkü hazır gölge,
   * nesne = elle ayarlanmış gölge (Device2DShadow).
   */
  shadow?: boolean | Device2DShadow;
  reflection?: boolean;             // cihazın altında dikey aynalı, fade'li yansıma
  plate2?: string;                  // plates2/meta.json'daki plate adı — gerçek PSD mockup
};

/** Işık kurgusu — engine/scene3dCore.ts LIGHT_RIGS defterindeki hazır setler. */
export type LightRigId = "studio" | "softbox" | "rim" | "night" | "daylight";

export type DeviceStyle3D = {
  mode: "3d";
  duoPosture?: "open" | "closed";
  /** Duo hinge opening in degrees: 180 fully open, 90 book posture. */
  foldAngle?: number;
  /** Cihaz türü — bkz. DeviceStyle2D.kind. Prosedürel gövde ölçüleri ve
   *  model seçici filtresi bunu okur. */
  kind?: DeviceKind;
  /** "real" (VARSAYILAN, R9) = GLB gerçek model — iPhone 15 Pro Max;
   *  "kontur" = temiz, butonsuz prosedürel silüet (açık tercih). */
  model?: "kontur" | "real";
  /** Kontur kaplaması: "metal" (vars.) | "clay" = düz renk, mat (clay mockup). */
  finish?: "metal" | "clay";
  camera: CameraPresetId;
  orbit?: Orbit;                    // camera === "custom" veya preset üstüne elle bozma
  bodyColor?: string;               // kasa rengi (vars: koyu titanyum)
  /** ESKİ alan — hâlâ okunur. lightRig yoksa buradan türetilir
   *  (soft→softbox, studio→studio, night→night). */
  env?: "studio" | "night" | "soft";
  /** Işık kurgusu. Yoksa env'den türetilir → kayıtlı projeler aynı basılır. */
  lightRig?: LightRigId;
  lightIntensity?: number;          // 0.5–2, vars. 1 — tüm ışıkları ölçekler
  lightAngle?: number;              // derece, -90…90 — rigi Y ekseninde döndürür
  lightWarmth?: number;             // -1 soğuk … +1 sıcak, vars. 0
  /** Yumuşak parlama. R9'dan beri AÇIK TERCİH: yalnız `true` iken çalışır
   *  (eskiden night/rim rigleri kendiliğinden bloom basıyordu → ekrandaki
   *  parlak UI'nin etrafında istenmeyen hale). */
  bloom?: boolean;
  shadow?: boolean;                 // zemin contact shadow (katmanlı yumuşak)
  reflection?: boolean;             // zeminde GERÇEK düzlemsel yansıma (MeshReflectorMaterial)
  /** Kontur kontur kalınlığı — bezel + metal bant birlikte, 0.15–1.7 (vars. 1).
   *  Düşük değerler kılcal çerçeve verir (2D sticker görünümü). */
  konturWidth?: number;
  /** Kontur gövde DERİNLİĞİ çarpanı, 0.05–1.6 (vars. 1).
   *  0'a yaklaştıkça telefon bir karta düşer — "2D gibi" kontur için
   *  kalınlıkla birlikte kısılır. Cam, ring ve ekran z'leri gövdeden
   *  türediği için tek çarpan tüm yığını doğru toplar. */
  konturDepth?: number;
  /** Kontur Dynamic Island hapı (vars. true). */
  island?: boolean;
  glb?: string;                     // /assets/models/x.glb — varsa prosedürel model yerine
  /** Alan derinliği (bokeh) — focus 0..1 cihaz kutusu derinliğinde, amount 0..1.
   *  engine/scene3dCore uygular; draft render'da atlanır. */
  dof?: { focus?: number; amount?: number; maxPx?: number };
  /** Havada süzülme 0..1 — cihaz yükselir, contact gölge ayrışıp yumuşar,
   *  yansıma opaklığı düşer (Rotato "float" görünümü). */
  float?: number;
  /** Anamorfik yatay parıltı çizgisi (bloom kitine ek hedef).
   *  R9'dan beri AÇIK TERCİH — yalnız `true` iken çalışır. */
  streak?: boolean;
  /** Ekran camındaki diyagonal yansıma şeridi, 0–1 (VARSAYILAN 0 = kapalı).
   *  R9: eskiden riglere gömülüydü ve kapatılamıyordu. */
  glare?: number;
};

export type DeviceStyle = DeviceStyle2D | DeviceStyle3D;

/** Canvas format and the Duo's physical orientation are independent. */
export function deviceStyleForFormat(style: DeviceStyle3D, format?: Format): DeviceStyle3D & { kind: DeviceKind };
export function deviceStyleForFormat(style: DeviceStyle2D, format?: Format): DeviceStyle2D & { kind: DeviceKind };
export function deviceStyleForFormat(style: DeviceStyle, format?: Format): DeviceStyle & { kind: DeviceKind };
export function deviceStyleForFormat(style: DeviceStyle, format?: Format): DeviceStyle & { kind: DeviceKind } {
  const formatKind = kindOfFormat(format);
  let kind = formatKind;
  if (isDuoKind(formatKind) && style.mode === "3d") {
    const closed = (style.duoPosture ?? (formatKind.includes("cover") ? "closed" : "open")) === "closed";
    // An authored Duo kind wins when it describes the active screen. Changing
    // posture without choosing a direction uses that body's native orientation.
    const authored = style.kind && isDuoKind(style.kind) && style.kind.includes("cover") === closed ? style.kind : undefined;
    const compatible = formatKind.includes("cover") === closed ? formatKind : undefined;
    const direction = authored ?? compatible ?? (closed ? "foldable-cover" : "foldable");
    const landscape = direction === "foldable" || direction === "foldable-cover-landscape";
    kind = closed ? landscape ? "foldable-cover-landscape" : "foldable-cover" : landscape ? "foldable" : "foldable-portrait";
  } else if (format === "iphone-duo-portrait" && style.kind === "foldable") {
    kind = "foldable";
  }
  return { ...style, kind };
}

// ---------- Tipografi / Layout ----------
export type TextStyle = {
  fontFamily: string;               // engine/fonts.ts registry'sindeki family adı
  weight: number;
  style?: "normal" | "italic";
  sizePx: number;                   // BASE_W tabanında px
  lineHeight?: number;              // çarpan (vars: 1.08 başlık, 1.3 alt)
  letterSpacing?: number;           // px (negatif olabilir)
  color: string;
  align?: "left" | "center" | "right";
  transform?: "none" | "uppercase";
};

export type LayoutId =
  | "text-top"            // başlık üstte, cihaz altta
  | "text-bottom"         // cihaz üstte, başlık altta
  | "device-bleed-bottom" // cihaz alt kenardan taşar, metin üstte — klasik hero
  | "device-bleed-top"    // cihaz üstten taşar, metin altta
  | "text-overlay"        // metin cihazın üstüne biner (koyu overlay ile)
  | "badge-hero"          // büyük rozet + ortada cihaz
  | "split-diagonal"      // diyagonal ikili bölme
  | "split-v"             // iki cihaz YAN YANA, metin üstte — iki özellik bir karede
  | "split-h"             // iki cihaz ÜST/ALT (kenarlardan taşar), metin ortada
  | "duo-overlap"         // iki cihaz üst üste binen, hafif dutch — tek öbek
  | "duo-depth"           // iki cihaz derinlik kademeli (arka DoF ile erir)
  | "duo-dutch"           // iki cihaz KARŞIT eğimli simetrik yelpaze (kesişimli)
  | "duo-hero-aside"      // büyük kahraman + küçük destek ekran, ortak zemin çizgisi
  | "duo-stagger"         // biri yüksek biri alçak ikili, metin SOL kolonda
  | "duo-bleed-sides"     // iki büyük cihaz karşıt kenarlardan taşar, dar oluk
  | "duo-editorial"       // metin solda kolon, sağda iki küçük ekran alt alta
  | "duo-pip"             // kahraman + üstüne binen küçük inset (resim içinde resim)
  | "diptych"       // R12: TELEFONSUZ çift kare — iki çıplak ekran yan yana, metin altta
  | "screen-card"   // R12: TELEFONSUZ tek ekran — kart içinde, metin üstte
  | "pano-left"     // R13: cihaz SAĞ kenardan yarı taşar — sonraki karede pano-right ile tamamlanır
  | "pano-right"    // R13: cihaz SOL kenardan yarı taşar — önceki karenin devamı
  | "wide-left"     // R15 yatay iPad: metin SOL sütun, cihaz sağda büyük
  | "wide-right"    // R15 yatay iPad: metin SAĞ sütun, cihaz solda
  | "wide-hero"     // R15 yatay iPad: metin üstte ortalı, cihaz alttan taşar (%92)
  | "trio-arc"            // üç cihaz hafif yay, metin üstte
  | "trio-stack"          // üç cihaz perspektif kademeli, metin altta
  | "panorama-mid";       // panorama serisi orta karesi — cihaz ortada, metin yok/az

export type LayoutSpec = {
  id: LayoutId;
  /** Two feature panels behind the screen slots, shared by preview and export. */
  splitPanels?: "columns" | "rows";
  // Oransal koordinatlar (0..1). text.y blok üst hizası; device cx/cy merkez.
  text: { x: number; y: number; w: number; align: "left" | "center" | "right" };
  device: { cx: number; cy: number; scale: number; rotation?: number }; // scale = cihaz yüksekliği / slayt yüksekliği
  /** İKİNCİ cihaz (split düzenler). Varsa renderer slide.screenshot2'yi buraya çizer;
   *  screenshot2 yoksa düzen sessizce "text-top"a düşer (yarım kompozisyon olmaz). */
  device2?: { cx: number; cy: number; scale: number; rotation?: number };
  /** ÜÇÜNCÜ cihaz (R10 üçlü kompozisyonlar) — slide.screenshot3 buraya düşer.
   *  Eksik ekran görüntüsü düzeni DÜŞÜRMEZ; motor sıradaki görsele geri döner. */
  device3?: { cx: number; cy: number; scale: number; rotation?: number };
  textZ?: "above" | "below";        // çakışmada metin cihazın üstünde mi (vars: above)
};

// ---------- Tema ----------
/** Slaytın en üstüne binen bitirici katmanlar (engine/overlays.ts). */
export type ThemeOverlay = {
  vignette?: number;                // 0..1 — kenar karartma gücü
  grain?: number;                   // 0..1 — film greni miktarı
  texture?: { src: string; blend: GlobalCompositeOperation; alpha: number };
};

export type Theme = {
  id: string;
  name: string;
  background: Background;
  altBackgrounds?: Background[];    // slayt çeşitlemeleri
  headline: TextStyle;
  sub: TextStyle;
  badge?: { bg: string; color: string; fontFamily?: string };
  device: DeviceStyle;
  defaultLayout: LayoutId;
  accent: string;                   // UI ve rozetler için tek vurgu rengi
  overlay?: ThemeOverlay;           // opsiyonel — her şeyin üstüne
  glowRing?: { color: string; alpha: number }; // opsiyonel — cihazın ARKASINA ışık halkası
  /**
   * TEMA ÖĞELERİ — temanın kendi getirdiği panel/çizgi/etiket katmanı
   * (kart zemini, ayraç, kenar cetveli, dönük yan etiket…). Slayt öğelerinden
   * AYRI çizilir: kullanıcı kendi öğelerini üstüne ekler, temanınkiler kaybolmaz.
   * Slayta yazılmaz, düzenlenmez, dillere yayılmaz — tema değişince gider.
   * Koordinatlar BASE px (slayt öğeleriyle aynı sözleşme). Telefonsuz
   * "çift kare" gibi kompozisyonlar bunsuz mümkün değildi.
   */
  elements?: SlideElement[];
};

// ---------- Kompozit grade ----------
/** Sinematik renk grade'i — son kompozite uygulanır (zemin+cihaz+metin tek
 *  ton eğrisinde buluşur). Tüm alanlar opsiyonel; preset id'leri engine/grade.ts
 *  kataloğundadır ("neutral-plus" | "teal-orange" | "silver" | "kodak" | "noir"). */
export type GradeSpec = {
  preset?: string;
  slope?: [number, number, number];
  offset?: [number, number, number];
  power?: [number, number, number];
  sat?: number;                       // 1 = değişmez
  splitShadow?: string;               // gölge tonu (hex)
  splitHighlight?: string;            // parlak tonu (hex)
  splitAmount?: number;               // 0..1
  aberration?: number;                // 0..1 — radyal kromatik aberasyon
  halation?: number;                  // 0..1 — highlight film halation
};

// ---------- Serbest öğeler (R8/W2) ----------

/** Öğe türleri. `text` kendi metnini taşır; `image`/`sticker` bir `src` çizer. */
export type ElKind = "text" | "image" | "sticker" | "rect" | "pill" | "arrow" | "line" | "glass";

/** v1 z kovaları: SADECE cihaz-altı ("under") ve metin-üstü ("over"). */
export type ElementBucket = "under" | "over";

/** Öğe stili — metin alanları TextStyle'dan, şekil alanları buradan. */
export type ElementStyle = Partial<TextStyle> & {
  fill?: string;
  stroke?: string;
  strokeW?: number;                 // BASE px
  radius?: number;                  // BASE px (rect); pill kendi yarıçapını kullanır
  /** glass: arkasını bu kadar bulanıklaştırır, BASE px (vars. 28). */
  blur?: number;
  /** glass: cam rengi (vars. beyaz) ve alfası (vars. 0.12). */
  tint?: string;
  tintAlpha?: number;
  /** glass: üst kenar ışık şeridi gücü 0..1 (vars. 0.6). */
  highlight?: number;
};

/**
 * Slaytın üstünde serbestçe konumlanan bir öğe.
 *
 * SENKRON BÖLÜNMESİ (engine/designsync.ts): `id` diller arası EŞLEŞME
 * anahtarıdır; geometri + stil TASARIMDIR (yayılır), `text`/`src` İÇERİKTİR
 * (yerel kalır). Bu yüzden id'yi asla yeniden üretme — kopyalarken yeni id ver.
 */
export type SlideElement = {
  id: string;                       // kalıcı, diller arası EŞLEŞME anahtarı
  kind: ElKind;
  x: number;                        // BASE 1320×2868 px, SOL-ÜST köşe
  y: number;
  w: number;
  h: number;
  rotation?: number;                // derece — textOffset.rotation ile aynı konvansiyon
  opacity?: number;                 // 0..1 (vars. 1)
  blend?: GlobalCompositeOperation; // beyaz liste: engine/elements.ts BLEND_MODES
  z?: ElementBucket;                // vars. "over"
  src?: string;                     // image | sticker — İÇERİK
  text?: string;                    // text — İÇERİK
  style?: ElementStyle;
  name?: string;
  crop?: ImageCrop;
  imageFx?: ImageFx;
  /** Çizilmez ama listede durur (Inspector göz düğmesi). */
  hidden?: boolean;
  /** Tuvalde seçilemez/sürüklenemez (Inspector kilit düğmesi). */
  locked?: boolean;
};

// ---------- Slide / SetPlan / Project ----------
export type Slide = {
  id: string;
  /** Editor-only frame name; never exported as marketing copy. */
  frameLabel?: string;
  /** Art-only frames retain their device settings without drawing a phone or screen. */
  hideDevice?: boolean;
  /** Diller arası eşleştirme anahtarı — MD kare no'sundan ("f01"); index DEĞİL. */
  designKey?: string;
  screenshot?: string;              // dataURL veya /assets yolu
  /** İkinci ekran görüntüsü — split düzenlerde sağ/alt cihazda gösterilir. */
  screenshot2?: string;
  /** Per-image crop focus in split layouts; locale-local, like the screenshots. */
  splitCrop?: ImageCrop[];
  /**
   * ÜÇÜNCÜ ekran görüntüsü (R10). Üçlü kompozisyonlarda (fan3 / stack3 / üçlü
   * split düzenleri) sıradaki cihaza düşer. Eksikse motor sırayla screenshot2
   * ve screenshot'a geri döner — kompozisyon hiçbir zaman boş cihaz göstermez.
   * İÇERİK alanıdır: dile özeldir, dillere YAYILMAZ.
   */
  screenshot3?: string;
  headline: string;
  sub?: string;
  badge?: string;                   // "YENİ", "4.9 ★" gibi kısa rozet
  themeId: string;
  layout: LayoutId;
  background?: Background;          // tema override
  device?: DeviceStyle;             // tema override
  headlineStyle?: Partial<TextStyle>;
  subStyle?: Partial<TextStyle>;
  /**
   * Metin bloğunun elle nudge'ı, BASE px.
   * `rotation` DERECE cinsindendir (vars. 0, aralık -15…15); blok kendi
   * çapası (kolon ortası, blok üst hizası) etrafında döner. R7/W3 eki.
   */
  textOffset?: { x: number; y: number; rotation?: number };
  /** Independent text frames, absent until the user moves or resizes one. */
  textBoxes?: { headline?: TextFrame; sub?: TextFrame };
  /** Visibility and editing locks for built-in layers. */
  layerStates?: Record<string, LayerState>;
  /**
   * Cihazın elle nudge'ı. `scale` çarpan, `rotation` DERECE (vars. 0) ve
   * düzenin kendi eğimine EKLENİR; 2D cihaz kutusu merkezinden döner.
   * 3D sahnede yok sayılır — orada eğim orbit ile verilir. R7/W3 eki.
   */
  deviceOffset?: { x: number; y: number; scale?: number; rotation?: number };
  /** İkinci cihazın elle nudge'ı — deviceOffset ile aynı kurallar (split düzenler). */
  device2Offset?: { x: number; y: number; scale?: number; rotation?: number };
  device3Offset?: { x: number; y: number; scale?: number; rotation?: number };
  /**
   * Arka plan efekt katmanı — arka plan TÜRÜNDEN bağımsız (solid/gradient/
   * mesh/shader/image hepsinde çalışır). YALNIZ arka plana uygulanır; cihaz,
   * metin ve bitirici katmanlar etkilenmez.
   *
   * Alan yoksa (`undefined`) ya da hiçbir değer aktif değilse renderer eski
   * yoldan geçer — çıktı bit-bit aynı kalır.
   *   blur → 0–160, BASE_W (1320) tabanında px; renderer ölçekler
   *   dim  → 0–0.8, arka planın ÜSTÜNE siyah dolgu alpha'sı
   *   sat  → 0.5–1.5 doygunluk çarpanı (1 = nötr)
   * Varsayılanlar: hepsi undefined = kapalı.
   */
  bgFx?: { blur?: number; dim?: number; sat?: number };
  /**
   * Cihazın ARKASINDAKİ ışık halkası (R9).
   *
   * ESKİDEN: yalnız `theme.glowRing` vardı ve koyu temalarda ZORLA açıktı —
   * kapatmanın hiçbir yolu yoktu. ŞİMDİ halka VARSAYILAN OLARAK KAPALI;
   * yalnız `glow.on === true` iken çizilir. Renk/şiddet verilmezse temanın
   * `glowRing` değerleri (yoksa nötr beyaz) kullanılır.
   *
   * TASARIM alanıdır (designsync DESIGN_FIELDS): dillere yayılır.
   */
  glow?: { on: boolean; color?: string; alpha?: number };
  /**
   * Bitirici katmanların SLAYT BAZLI override'ı (R8/W4 · B-4.1).
   *
   * Temanın `overlay`'i üstüne biner: `engine/overlays.ts` `mergeOverlay`
   * yalnız TANIMLI alanları geçirir, kalanlar temadan miras kalır. Alan
   * yoksa (`undefined`) motor temayı olduğu gibi kullanır → eski projeler
   * bit-bit aynı basar.
   *
   * TASARIM alanıdır (designsync DESIGN_FIELDS): dillere yayılır.
   */
  overlay?: Partial<ThemeOverlay>;
  /** Süs öğesi — ör. defne çelengi içinde kısa metin (MD "LAUREL" alanı). */
  ornament?: { kind: "laurel"; text: string };
  /**
   * Serbest öğeler (R8/W2) — dizi SIRASI z sırasıdır (son = en üstte), kova
   * içinde. Alan yoksa motor eski yoldan geçer, çıktı bit-bit aynı kalır.
   */
  elements?: SlideElement[];
  themeElementOverrides?: Record<string, Partial<SlideElement>>;
  /** Kompozit renk grade'i — ASC-CDL sınıfı; engine/grade.ts uygular.
   *  preset verilirse kalan alanlar preset üstüne ince ayar olarak biner. */
  grade?: GradeSpec;
  /**
   * App preview VİDEO çekimi (R8/W5) — bu slayt makarada nasıl görünsün.
   *
   * TAMAMEN OPSİYONEL: alan yoksa motor akıllı varsayılana düşer
   *   durSec → 3
   *   move   → 3D cihazda "orbit-slow", 2D cihazda "ken-burns"
   *   hold   → yok (0)
   * `move` id'leri engine/video.ts `MOVES` kataloğundadır; bilinmeyen bir id
   * sessizce varsayılana düşer (eski/ileri sürüm JSON'ları kırılmaz).
   *
   * TASARIM alanıdır (designsync DESIGN_FIELDS): metin taşımaz, dillere
   * yayılır — bir dilde kurulan makara ritmi 15 dilde aynı olur.
   */
  videoShot?: { durSec?: number; move?: string; hold?: number };
  /**
   * Metin kaynak dilden KOPYALANDI, henüz çevrilmedi ("Bu slaytı tüm dillere
   * ekle" işareti). Film şeridinde amber köşe olarak görünür; kullanıcı bu
   * dilde başlığı/alt satırı düzenleyince otomatik düşer.
   */
  needsCopy?: boolean;
};

export type SetPlan = {
  app: string;
  locale: string;                   // "tr" | "en" | ...
  slides: Slide[];
};

export type Screenshot = { id: string; name: string; dataUrl: string };

export type Project = {
  id: string;
  app: string;
  brief?: string;                   // MD brief
  createdAt: string;
  screenshots: Screenshot[];
  sets: Record<string, SetPlan>;    // locale -> plan
  activeLocale: string;
  /**
   * iPhone mu iPad mi (vars. iPhone). Tuval oranını, cihaz türünü ve
   * varsayılan export boyutunu belirler. Eski projelerde alan yoktur →
   * `formatOf` iPhone sayar; loadProject alanı yazar.
   */
  format?: Format;
  /**
   * Tasarım senkronu açık mı (vars. AÇIK). Bir dilde yapılan TASARIM
   * düzenlemesi diğer tüm dillere yayılır; metin/ekran yerel kalır.
   * Eski projelerde alan yoktur → loadProject `true` ile tamamlar.
   */
  syncDesign?: boolean;
  /**
   * Dil başına "bu slaytın tasarımına dokunma" kilitleri: locale → designKey[].
   * Elle ayarlanmış bir dili yayılımdan korur; kilitli hedefler atlanır ve
   * `lastSyncNote` künyesinde sayılır.
   */
  designLocks?: Record<string, string[]>;
};

// ---------- Yardımcılar ----------
export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isDevice3D(d: DeviceStyle): d is DeviceStyle3D {
  return d.mode === "3d";
}
