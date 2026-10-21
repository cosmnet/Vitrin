// Tema kütüphanesi — 20 sanat yönü (1-10 ilk tur, 11-20 R10).
// Sanat yönü notu (2026 App Store vitrini): koyu zemin + tek güçlü vurgu rengi,
// frameless cihaz, thumbnail'de bile okunan dev başlık. Bu yüzden headline.sizePx
// 96–152 aralığında tutuldu; alt yazı 34–48 bandında ve her zaman düşük kontrastlı.
// Renkler arka plana karşı kontrol edilerek seçildi (koyu zemin → açık metin, tersi de).
//
// SIRA KONTRATTIR: kullanıcının projeleri slaytlarda `themeId` taşır, o yüzden
// mevcut temalar ne silinir ne yeniden adlandırılır; yenisi SONA eklenir.
//
// Bitiriciler (engine/overlays.ts):
//   overlay.grain    → film greni; koyu temalarda bantlaşmayı kırar
//   overlay.vignette → kenar karartma; kadrajı cihaza toplar
//   overlay.texture  → baskı/doku plakası (kâğıt lifi, beton, tram, tarama)
//   glowRing         → cihazın ARKASINDA duran ışık halkası; R9'dan beri yalnız
//                      slaytta `glow.on` iken çizilir (varsayılan KAPALI)

import { L } from "@/lib/i18n";
import { COLLECTION_THEMES } from "./collections";
import { BRAND_THEMES } from "./brandThemes";
import { PRIVATE_CURATED_THEME_IDS, privateLegacyThemes } from "@private";
import type { Background, Theme } from "./types";

// Sık kullanılan görsel arka plan yolları (public/assets/bg altında .jpg)
const BG = {
  marble1: "/assets/bg/marble-1.jpg",
  marble2: "/assets/bg/marble-2.jpg",
  marble3: "/assets/bg/marble-3.jpg",
  marble4: "/assets/bg/marble-4.jpg",
  abyss: "/assets/bg/abyss.jpg",
  midnight: "/assets/bg/midnight.jpg",
  gold: "/assets/bg/gold.jpg",
  sand: "/assets/bg/sand.jpg",
  ocean: "/assets/bg/ocean.jpg",
} as const;

/** grad-01..10 — siyaha yakın zeminde sıcak ışık şeritleri (soyut gradient). */
const grad = (n: number): string => `/assets/bg/grad-${String(n).padStart(2, "0")}.jpg`;
/** granular-01..08 — grenli, doygun renkli modern gradientler. */
const granular = (n: number): string => `/assets/bg/granular-${String(n).padStart(2, "0")}.jpg`;
/** halftone-1..16 — açık kâğıt / baskı dokuları; multiply ile bindirilir. */
const halftone = (n: number): string => `/assets/textures/halftone-${n}.jpg`;

/** tex-* — akışkan, çok doygun renk geçişleri. */
const TEX = {
  ember: "/assets/bg/tex-345.jpg",    // kırmızı-turuncu akışkan
  ice: "/assets/bg/tex-443.jpg",      // camgöbeği-pembe akışkan
  candy: "/assets/bg/tex-63.jpg",     // pembe-sarı-kırmızı
  prism: "/assets/bg/tex-7345.jpg",   // camgöbeği-turuncu-pembe (gökkuşağı)
  orchid: "/assets/bg/tex-7464.jpg",  // magenta-mor
  violet: "/assets/bg/tex-847.jpg",   // magenta-mor diyagonal
} as const;

/**
 * R10 doku plakaları — `scripts/gen-textures.mjs` üretir (deterministik, seed'li).
 *
 * public/assets/bg altındaki hazır dokulardan farkı: bunlar RENKSİZ ve nötr
 * gri (128) tabanlı. `soft-light`/`overlay` ile bindirilince zeminin tonunu
 * kaydırmadan yalnız yüzey dokusu ekler — foto kaynaklı dokular bunu yapamaz.
 * halftone plakaları istisna: onlar mürekkep, `multiply` ile biner.
 */
const PLATE = {
  paperFiber: "/assets/tex/paper-fiber.png",       // kâğıt lifi — sıcak nötrler
  paperCold: "/assets/tex/paper-cold.png",         // soğuk pres kâğıt dişi
  filmGrain: "/assets/tex/film-grain.png",         // iri film greni
  halftone45: "/assets/tex/halftone-45.png",       // 45° ince tram
  halftoneCoarse: "/assets/tex/halftone-coarse.png", // pop-art iri tram
  scanline: "/assets/tex/scanline.png",            // tarama çizgisi
  weave: "/assets/tex/weave.png",                  // keten dokuma
  concrete: "/assets/tex/concrete.png",            // beton
  hatch: "/assets/tex/hatch.png",                  // gravür taraması
} as const;

// Koyu temalarda ekranı dinlendiren ortak grain dokusu üretici.
function grain(colors: string[], seed: number): Background {
  return { kind: "shader", shaderId: "grain", colors, seed, params: { strength: 0.14 } };
}

const LEGACY_THEMES: Theme[] = [
  // ---------------------------------------------------------------------------
  // 2) BOLD BLOCK — doygun tek renk zemin, dev beyaz Syne başlık, frameless 2D
  // cihaz alt kenardan taşar. Fintech / üretkenlik vitrinlerinin dili.
  // Düz zeminde bantlaşmayı kıran çok hafif bir gren dışında bitirici yok:
  // bu temanın gücü tam da yüzeyin dümdüz olmasında.
  // ---------------------------------------------------------------------------
  {
    id: "bold-block",
    name: "Bold Block",
    background: { kind: "solid", color: "#5a2bf0" },
    altBackgrounds: [
      { kind: "solid", color: "#3f18c9" },
      {
        kind: "linear",
        stops: [
          ["#6d3bff", 0],
          ["#3a13c0", 1],
        ],
        angle: 155,
      },
      { kind: "solid", color: "#2a49f2" },
      // Grenli mor-turuncu — blok zeminin nefes alan çeşitlemesi
      { kind: "image", src: granular(6), overlayColor: "#3f18c9", overlayAlpha: 0.42 },
      { kind: "image", src: TEX.orchid, overlayColor: "#31128f", overlayAlpha: 0.46 },
      grain(["#5a2bf0", "#4a1fd8"], 9),
    ],
    headline: {
      fontFamily: "Syne",
      weight: 700,
      sizePx: 142,
      lineHeight: 1.02,
      letterSpacing: -3,
      color: "#ffffff",
      align: "center",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 46,
      lineHeight: 1.36,
      letterSpacing: 0,
      color: "#d9cdff",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ffd84d", color: "#2a0f6b", fontFamily: "Outfit" },
    device: { mode: "2d", frame: "none", cornerRadius: 72, shadow: true },
    defaultLayout: "device-bleed-bottom",
    accent: "#ffd84d",
    overlay: { grain: 0.06 },
  },

  // ---------------------------------------------------------------------------
  // 3) OBSIDIAN — siyaha yakın zemin + tek neon vurgu (elektrik mavisi).
  // "halo" cihazın arkasında ışık kaynağı gibi durur; 3D hero-right, night env.
  // Gren + güçlü vignette, kadrajı ekrana kilitler.
  // ---------------------------------------------------------------------------
  {
    id: "obsidian",
    name: "Obsidian",
    background: {
      kind: "shader",
      shaderId: "halo",
      colors: ["#0a0a0f", "#101a3c", "#2f6bff"],
      seed: 5,
      params: { radius: 0.5, glow: 0.7, cy: 0.42 },
    },
    altBackgrounds: [
      {
        kind: "radial",
        stops: [
          ["#16204a", 0],
          ["#0a0a0f", 0.7],
          ["#050508", 1],
        ],
        cx: 0.5,
        cy: 0.38,
        r: 0.9,
      },
      { kind: "image", src: BG.abyss, overlayColor: "#05050a", overlayAlpha: 0.58, blur: 3 },
      // Soyut gradient şeritleri, mavi perdeyle soğutuldu
      { kind: "image", src: grad(3), overlayColor: "#070b1e", overlayAlpha: 0.52 },
      { kind: "image", src: grad(8), overlayColor: "#080a18", overlayAlpha: 0.48 },
      { kind: "image", src: grad(10), overlayColor: "#0a0a12", overlayAlpha: 0.55 },
      grain(["#0a0a0f", "#141426"], 23),
    ],
    headline: {
      fontFamily: "Kiltier",
      weight: 700,
      sizePx: 138,
      lineHeight: 1.04,
      letterSpacing: -2.5,
      color: "#f3f6ff",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 44,
      lineHeight: 1.38,
      letterSpacing: 0,
      color: "#8e9bc6",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#2f6bff", color: "#f2f7ff", fontFamily: "Outfit" },
    device: { mode: "3d", camera: "hero-right", env: "night", bodyColor: "#16171f", shadow: true },
    defaultLayout: "text-top",
    accent: "#2f6bff",
    overlay: { grain: 0.12, vignette: 0.42 },
    glowRing: { color: "#2f6bff", alpha: 0.44 },
  },

  // ---------------------------------------------------------------------------
  // 4) EDITORIAL — krem/fildişi zemin, mermer doku, versal serif başlık,
  // ince altın detay. Moda dergisi kapağı hissi; 2D frameless, yumuşak gölge
  // ve zeminde yansıma. Üstte multiply halftone: matbaa kâğıdı dokusu.
  // ---------------------------------------------------------------------------
  {
    // Not: marble-1..4 "siyah-altın lüks mermer" paketinden — hepsi KOYU.
    // Tema bu yüzden koyu-lüks kurulur: krem serif başlık altın damarların üstünde.
    id: "editorial",
    name: "Editorial",
    background: { kind: "image", src: BG.marble1, overlayColor: "#0c0a08", overlayAlpha: 0.38 },
    altBackgrounds: [
      { kind: "image", src: BG.marble2, overlayColor: "#0c0a08", overlayAlpha: 0.34 },
      { kind: "image", src: BG.marble3, overlayColor: "#120e08", overlayAlpha: 0.4 },
      { kind: "image", src: BG.marble4, overlayColor: "#0c0a08", overlayAlpha: 0.36 },
      { kind: "image", src: BG.gold, overlayColor: "#141006", overlayAlpha: 0.45 },
      { kind: "image", src: grad(4), overlayColor: "#0e0b06", overlayAlpha: 0.4 },
      { kind: "solid", color: "#100d0a" },
    ],
    // R10 RÖTUŞU — aile değişti: BetroVogue ş/Ş/ğ/Ğ/İ İÇERMİYOR (ölçüldü,
    // scripts/check-glyphs.mjs) ve versal Türkçe başlıkta İ/Ş/Ö harf harf
    // sistem fontuna düşüp yüz karışıyordu. Instrument Serif aynı yüksek
    // kontrastlı versal-serif karakteri verir ve latin-ext'i tamdır.
    // Punto 126 → 138: Instrument Serif optik olarak daha küçük oturuyor,
    // geniş harf aralığı (3) korunarak eski satır uzunluğu yakalandı.
    headline: {
      fontFamily: "Instrument Serif",
      weight: 400,
      sizePx: 138,
      lineHeight: 1.08,
      letterSpacing: 3,
      color: "#f0e7d4",
      align: "center",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Arseri",
      weight: 400,
      sizePx: 48,
      lineHeight: 1.42,
      letterSpacing: 0.5,
      color: "#c4b491",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#b8912f", color: "#fffaf0", fontFamily: "Outfit" },
    device: { mode: "2d", frame: "none", cornerRadius: 72, shadow: true, reflection: true },
    defaultLayout: "text-top",
    accent: "#b8912f",
    overlay: {
      grain: 0.07,
      vignette: 0.24,
    },
  },

  // ---------------------------------------------------------------------------
  // 5) AURORA MESH — pastel aurora/mesh zemin. Açık zeminde beyaz metin okunmaz,
  // bu yüzden başlık koyu indigo; alt yazı Outfit ile mor-gri. Cihaz zeminde
  // yansır: pastel yüzeye cam masa etkisi.
  // ---------------------------------------------------------------------------
  {
    id: "aurora-mesh",
    name: "Aurora Mesh",
    // Not: "aurora" shader'ı koyu gece paleti ister; pastel ana zemin mesh ile kurulur.
    background: { kind: "mesh", colors: ["#ffe0ef", "#d3e9ff", "#e2d9ff", "#d6f7ea"], seed: 12 },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "aurora",
        colors: ["#e6e4ff", "#d7ceff", "#c9f0f6", "#ffe0ef"],
        seed: 7,
      },
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#e8dcff", "#cfe9ff", "#ffe4f0"],
        seed: 29,
        params: { frequency: 0.8 },
      },
      {
        kind: "linear",
        stops: [
          ["#ffe4f1", 0],
          ["#dcdcff", 0.52],
          ["#cdf3e8", 1],
        ],
        angle: 145,
      },
      // Doygun akışkan gradientler beyaz perde + blur ile pastele çekildi
      { kind: "image", src: TEX.ice, overlayColor: "#ffffff", overlayAlpha: 0.56, blur: 8 },
      { kind: "image", src: TEX.prism, overlayColor: "#fdfbff", overlayAlpha: 0.6, blur: 10 },
    ],
    headline: {
      fontFamily: "Kiltier",
      weight: 700,
      sizePx: 132,
      lineHeight: 1.05,
      letterSpacing: -2.5,
      color: "#1b1636",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 46,
      lineHeight: 1.4,
      letterSpacing: 0,
      color: "#544c7d",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#1b1636", color: "#f2ecff", fontFamily: "Outfit" },
    device: { mode: "2d", frame: "none", cornerRadius: 72, shadow: true, reflection: true },
    defaultLayout: "text-top",
    accent: "#7c5cff",
    overlay: { grain: 0.05, vignette: 0.14 },
  },

  // ---------------------------------------------------------------------------
  // 6) NEON 3D — karanlık zemin, iki renkli neon (magenta + cyan) metaball,
  // izometrik 3D cihaz, night env. Oyun / müzik / sosyal uygulamalar için.
  // Magenta halka + kalın gren: kulüp afişi enerjisi.
  // ---------------------------------------------------------------------------
  {
    id: "neon-3d",
    name: "Neon 3D",
    background: {
      kind: "shader",
      shaderId: "metaball",
      colors: ["#07040f", "#ff2bd6", "#22e6ff"],
      seed: 21,
      params: { blobs: 5, blur: 0.55 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "waves",
        colors: ["#07040f", "#ff2bd6", "#22e6ff"],
        seed: 33,
        params: { amplitude: 0.35, frequency: 1.4 },
      },
      {
        kind: "radial",
        stops: [
          ["#3d0a53", 0],
          ["#12042a", 0.6],
          ["#07040f", 1],
        ],
        cx: 0.52,
        cy: 0.44,
        r: 0.92,
      },
      { kind: "image", src: BG.abyss, overlayColor: "#160030", overlayAlpha: 0.62, blur: 4 },
      // Akışkan neon gradientler — koyu perdeyle metin kontrastı korunur
      { kind: "image", src: TEX.candy, overlayColor: "#12001f", overlayAlpha: 0.5 },
      { kind: "image", src: TEX.violet, overlayColor: "#0d0018", overlayAlpha: 0.46 },
      { kind: "image", src: granular(1), overlayColor: "#0a0014", overlayAlpha: 0.34 },
    ],
    headline: {
      fontFamily: "Syne",
      weight: 700,
      // R10 RÖTUŞU 140 → 126: riso ile aynı gerekçe — split-diagonal'de
      // üç satırlık versal başlık alt satırı cihaza yapıştırıyordu.
      sizePx: 126,
      lineHeight: 1.04,
      letterSpacing: -2.5,
      color: "#ffffff",
      align: "center",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 44,
      lineHeight: 1.36,
      letterSpacing: 0,
      color: "#93e9fb",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ff2bd6", color: "#12001a", fontFamily: "Outfit" },
    device: { mode: "3d", camera: "iso", env: "night", bodyColor: "#0d0b16", shadow: true },
    defaultLayout: "split-diagonal",
    accent: "#22e6ff",
    overlay: { grain: 0.14, vignette: 0.46 },
    glowRing: { color: "#ff2bd6", alpha: 0.4 },
  },

  // ---------------------------------------------------------------------------
  // 7) CLEAN LIGHT — beyaz/açık gri, Apple editorial sadeliği. Koyu metin,
  // ince gölgeli frameless 2D cihaz, neredeyse görünmez grain dokusu.
  // Beyaz zeminde cam masa yansıması: ürün fotoğrafı hissi.
  // ---------------------------------------------------------------------------
  {
    id: "clean-light",
    name: "Clean Light",
    background: {
      kind: "shader",
      shaderId: "grain",
      colors: ["#ffffff", "#f1f2f4"],
      seed: 2,
      params: { strength: 0.08 },
    },
    altBackgrounds: [
      { kind: "solid", color: "#ffffff" },
      { kind: "solid", color: "#f5f5f7" },
      {
        kind: "linear",
        stops: [
          ["#ffffff", 0],
          ["#e9ebef", 1],
        ],
        angle: 180,
      },
      { kind: "image", src: halftone(11), overlayColor: "#ffffff", overlayAlpha: 0.42 },
    ],
    headline: {
      fontFamily: "Kiltier",
      weight: 600,
      sizePx: 130,
      lineHeight: 1.06,
      letterSpacing: -2.5,
      color: "#0b0b0d",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 44,
      lineHeight: 1.42,
      letterSpacing: 0,
      color: "#6b6b73",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#0b0b0d", color: "#ffffff", fontFamily: "Outfit" },
    device: { mode: "2d", frame: "none", cornerRadius: 72, shadow: true, reflection: true },
    defaultLayout: "text-top",
    accent: "#0071e3",
    overlay: { grain: 0.04, vignette: 0.1 },
  },

  // ---------------------------------------------------------------------------
  // 8) PLAYFUL 3D — şeker pasteli (mercan / nane / sarı), Syne başlık,
  // hero-left 3D cihaz. Yüksek enerji: çocuk, eğitim, alışkanlık uygulamaları.
  // ---------------------------------------------------------------------------
  {
    id: "playful-3d",
    name: "Playful 3D",
    background: {
      kind: "shader",
      shaderId: "waves",
      colors: ["#ff8a75", "#ffd166", "#5fe3c0", "#7bb8ff"],
      seed: 11,
      params: { amplitude: 0.3, frequency: 1.1 },
    },
    altBackgrounds: [
      { kind: "mesh", colors: ["#ff9e88", "#ffd97a", "#78ecd0", "#8fc4ff"], seed: 19 },
      {
        kind: "linear",
        stops: [
          ["#ff9f8a", 0],
          ["#ffd88a", 1],
        ],
        angle: 160,
      },
      {
        kind: "radial",
        stops: [
          ["#8ff0d6", 0],
          ["#4fc9ad", 0.65],
          ["#2f9a86", 1],
        ],
        cx: 0.5,
        cy: 0.42,
        r: 0.95,
      },
      // Gökkuşağı akışkan — beyaz perdeyle yumuşatıldı
      { kind: "image", src: TEX.prism, overlayColor: "#ffffff", overlayAlpha: 0.34 },
      { kind: "image", src: TEX.ember, overlayColor: "#fff3e0", overlayAlpha: 0.38 },
    ],
    headline: {
      fontFamily: "Syne",
      weight: 700,
      sizePx: 138,
      lineHeight: 1.03,
      letterSpacing: -2,
      color: "#2b1230",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 46,
      lineHeight: 1.38,
      letterSpacing: 0,
      color: "#5c3350",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#2b1230", color: "#ffe6b8", fontFamily: "Outfit" },
    device: { mode: "3d", camera: "hero-left", env: "studio", bodyColor: "#2b1230", shadow: true },
    defaultLayout: "badge-hero",
    accent: "#ff5f4d",
    overlay: { grain: 0.06 },
  },

  // ---------------------------------------------------------------------------
  // 9) RISO — risograph baskı. Kirli krem kâğıt, iki mürekkep (fosforlu pembe +
  // mürekkep mavisi), üstte multiply halftone: yanlış hizalanmış baskı hissi.
  // Tipografi kasten cesur ve sıkı: Syne 700 versal, negatif harf aralığı.
  // Bilinçli olarak yansıma/parlaklık YOK — kâğıt yansıtmaz.
  // ---------------------------------------------------------------------------
  {
    id: "riso",
    name: "Riso",
    background: { kind: "image", src: halftone(8), overlayColor: "#f4ecdc", overlayAlpha: 0.26 },
    altBackgrounds: [
      { kind: "image", src: halftone(13), overlayColor: "#ffe3ec", overlayAlpha: 0.34 },
      { kind: "image", src: halftone(15), overlayColor: "#e2e8ff", overlayAlpha: 0.32 },
      { kind: "image", src: halftone(4), overlayColor: "#f6efe2", overlayAlpha: 0.22 },
      { kind: "solid", color: "#f2ebdd" },
      {
        kind: "linear",
        stops: [
          ["#ffd9e4", 0],
          ["#f4ecdc", 0.6],
          ["#dfe6ff", 1],
        ],
        angle: 165,
      },
    ],
    headline: {
      fontFamily: "Syne",
      weight: 700,
      // R10 RÖTUŞU 148 → 130: uzun Türkçe başlık (ör. "VAKİTLER ŞEHRİNE
      // GÖRE") üç satıra çıkıp alt satırı cihazın ekranına bindiriyordu.
      sizePx: 130,
      lineHeight: 1.0,
      letterSpacing: -3.4,
      color: "#141a4f",
      align: "left",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 46,
      lineHeight: 1.34,
      letterSpacing: 0,
      color: "#5a5f86",
      align: "left",
      transform: "none",
    },
    badge: { bg: "#ff4a7d", color: "#fff6ef", fontFamily: "Syne" },
    device: { mode: "2d", frame: "none", cornerRadius: 60, shadow: true },
    defaultLayout: "split-diagonal",
    accent: "#ff4a7d",
    overlay: {
      texture: { src: halftone(10), blend: "multiply", alpha: 0.44 },
      grain: 0.1,
      vignette: 0.2,
    },
  },

  // ---------------------------------------------------------------------------
  // 10) GRANULAR — grenli gradient, modern indie. Koyu grafit zeminde tek sıcak
  // ışık; kalın gren yüzeyi kumlu kâğıda çevirir. Kiltier başlık, turuncu vurgu.
  // Bağımsız stüdyo / müzik / fotoğraf uygulamalarının dili.
  // ---------------------------------------------------------------------------
  {
    id: "granular",
    name: "Granular",
    background: { kind: "image", src: granular(4), overlayColor: "#0d0a10", overlayAlpha: 0.26 },
    altBackgrounds: [
      { kind: "image", src: granular(2), overlayColor: "#0a0a18", overlayAlpha: 0.4 },
      { kind: "image", src: granular(7), overlayColor: "#07110f", overlayAlpha: 0.34 },
      { kind: "image", src: granular(8), overlayColor: "#0b0710", overlayAlpha: 0.38 },
      { kind: "image", src: granular(3), overlayColor: "#08120f", overlayAlpha: 0.36 },
      { kind: "image", src: grad(1), overlayColor: "#0c0810", overlayAlpha: 0.42 },
      grain(["#141019", "#0b0810"], 77),
    ],
    headline: {
      fontFamily: "Kiltier",
      weight: 700,
      sizePx: 136,
      lineHeight: 1.03,
      letterSpacing: -2.6,
      color: "#f5f1e8",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Outfit",
      weight: 500,
      sizePx: 45,
      lineHeight: 1.38,
      letterSpacing: 0,
      color: "#a99fb0",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ff7a3d", color: "#160d0a", fontFamily: "Outfit" },
    device: { mode: "2d", frame: "none", cornerRadius: 84, shadow: true },
    defaultLayout: "device-bleed-bottom",
    accent: "#ff7a3d",
    overlay: { grain: 0.17, vignette: 0.4 },
    glowRing: { color: "#ff7a3d", alpha: 0.28 },
  },

  // ===========================================================================
  // R10 — 2026 VİTRİN DİLİ. Aşağıdaki on tema mevcut onun YANINA eklendi;
  // eski id'ler kullanıcının projelerinde `themeId` olarak yaşıyor, hiçbiri
  // değiştirilmedi.
  //
  // Ortak kararlar:
  //   · 3D cihaz her yerde `model: "real"` (iPhone 15 Pro Max GLB) — kullanıcı
  //     "tüm temalarda varsayılan telefon 15 Pro Max olsun" dedi.
  //   · bloom / streak / glare HİÇBİRİNDE yok: ekranda parlama istenmiyor.
  //     `glowRing` alanı duruyor ama artık yalnız slaytta `glow.on` iken çizilir.
  //   · Doku plakaları nötr gri tabanlı (scripts/gen-textures.mjs) ve
  //     `soft-light` / `overlay` ile biniyor: yüzey dokusu ekler, TONU KAYDIRMAZ.
  //     Yalnız halftone plakaları `multiply` — onlar mürekkep, ışık değil.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 11) CAM AURORA — koyu cam üstünde odak dışı ışık diskleri. visionOS /
  // Arc marka dili: derinlik var, kontur yok. Manrope 800 sıkı negatif
  // tracking ile "yazılım ürünü" gibi okunur; alt satır Instrument Sans,
  // yuvarlak Outfit'ten daha nötr durduğu için başlıkla yarışmaz.
  // Doku: film greni plakası soft-light — camın üstündeki ince buğu.
  // ---------------------------------------------------------------------------
  {
    id: "glass-aurora",
    name: L("Cam Aurora", "Glass Aurora"),
    background: {
      kind: "shader",
      shaderId: "bokeh",
      colors: ["#080b1a", "#3b5bff", "#a06bff", "#38e8d0"],
      seed: 13,
      // İlk ayarda (0.9 / 1.15) diskler bulanık bir nebulaya eriyordu; daha
      // iri ve parlak diskler "cam arkasında ışık" okumasını geri getiriyor.
      params: { intensity: 1.05, size: 1.4 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "prism",
        colors: ["#0b1030", "#2f4bd8", "#7a4ddd", "#1fb6c9"],
        seed: 5,
        params: { warp: 0.8, spread: 1.25 },
      },
      {
        kind: "shader",
        shaderId: "aurora",
        colors: ["#070a18", "#4f7cff", "#9b6bff", "#2ee6c8"],
        seed: 44,
      },
      {
        kind: "radial",
        stops: [
          ["#22307a", 0],
          ["#0c1130", 0.62],
          ["#05070f", 1],
        ],
        cx: 0.5,
        cy: 0.36,
        r: 0.96,
      },
      { kind: "image", src: BG.abyss, overlayColor: "#0a1030", overlayAlpha: 0.62, blur: 6 },
      { kind: "image", src: TEX.ice, overlayColor: "#080d24", overlayAlpha: 0.58 },
      grain(["#080b1a", "#131a3a"], 61),
    ],
    headline: {
      fontFamily: "Manrope",
      weight: 800,
      sizePx: 130,
      lineHeight: 1.04,
      letterSpacing: -3.4,
      color: "#f2f5ff",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 43,
      lineHeight: 1.4,
      letterSpacing: 0.2,
      color: "#9fabd8",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#6ea8ff", color: "#061024", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "real",
      camera: "front",
      lightRig: "softbox",
      bodyColor: "#12162a",
      shadow: true,
      float: 0.22,
    },
    defaultLayout: "text-top",
    accent: "#6ea8ff",
    overlay: {
      texture: { src: PLATE.filmGrain, blend: "soft-light", alpha: 0.3 },
      vignette: 0.34,
    },
    glowRing: { color: "#6ea8ff", alpha: 0.3 },
  },

  // ---------------------------------------------------------------------------
  // 12) BRUTALIST MONO — is rengi zemin, asit sarısı tek vurgu, DEV mono başlık.
  // Mono yüz bilerek: brutalist afişin "sistem çıktısı" tavrı buradan gelir.
  // Mono glifler geniş olduğu için punto 100'e indirildi (Syne 142 ile aynı
  // fiziksel satır uzunluğunu verir); tracking -4 harfleri blok gibi kilitler.
  // Alt satır de mono ama VERSAL + pozitif tracking: künye/etiket dili.
  // Doku: beton plakası soft-light — düz zemine döküm yüzeyi verir.
  // ---------------------------------------------------------------------------
  {
    id: "brut-mono",
    name: "Brutalist Mono",
    background: { kind: "solid", color: "#121211" },
    altBackgrounds: [
      { kind: "solid", color: "#1c1c19" },
      {
        kind: "shader",
        shaderId: "grid",
        colors: ["#0e0e0d", "#1c1c1a", "#d6ff3d", "#8a9c22"],
        seed: 7,
        params: { glow: 0.85, cells: 1.1 },
      },
      {
        kind: "linear",
        stops: [
          ["#232320", 0],
          ["#0c0c0b", 1],
        ],
        angle: 180,
      },
      // Foto zemin `color` harmanıyla GRİYE indiriliyor: granular/marble
      // paketleri renkli ve brutalist tek-vurgu kuralını bozuyordu.
      { kind: "image", src: BG.marble3, overlayColor: "#121211", overlayBlend: "color", overlayAlpha: 1 },
      { kind: "solid", color: "#26261f" },
      grain(["#151513", "#0b0b0a"], 88),
    ],
    headline: {
      fontFamily: "JetBrains Mono",
      weight: 700,
      sizePx: 112,
      lineHeight: 1.08,
      letterSpacing: -4,
      color: "#f4f4ee",
      align: "left",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "JetBrains Mono",
      weight: 500,
      sizePx: 36,
      lineHeight: 1.5,
      letterSpacing: 1.8,
      color: "#9e9e93",
      align: "left",
      transform: "uppercase",
    },
    badge: { bg: "#d6ff3d", color: "#14140f", fontFamily: "JetBrains Mono" },
    // Sert, kısa gölge: brutalist afişte cihaz "yüzer" değil, yüzeye BASILIDIR.
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 44,
      shadow: { dx: 0, dy: 26, blur: 58, opacity: 0.55 },
    },
    defaultLayout: "split-diagonal",
    accent: "#d6ff3d",
    overlay: {
      texture: { src: PLATE.concrete, blend: "soft-light", alpha: 0.42 },
      grain: 0.08,
      vignette: 0.26,
    },
  },

  // ---------------------------------------------------------------------------
  // 13) KÂĞIT EDİTORYAL — sıcak fildişi, yüksek kontrastlı Instrument Serif.
  // Editorial temasından farkı: o KOYU lüks mermer, bu gerçekten KÂĞIT.
  // Başlık 150/0.98 — satır aralığı 1'in altında, dergi kapağı sıkılığı;
  // serif zaten büyük x-yüksekliği taşımadığı için satırlar çakışmaz.
  // Doku: kâğıt lifi soft-light — multiply denendi, fildişini griye çekiyor.
  // ---------------------------------------------------------------------------
  {
    id: "paper-editorial",
    name: L("Kâğıt Editoryal", "Paper Editorial"),
    background: { kind: "solid", color: "#ece5d8" },
    altBackgrounds: [
      {
        kind: "linear",
        stops: [
          ["#f5f0e5", 0],
          ["#e2d9ca", 1],
        ],
        angle: 168,
      },
      { kind: "solid", color: "#f5f1e8" },
      { kind: "image", src: halftone(11), overlayColor: "#efe8da", overlayAlpha: 0.52 },
      { kind: "image", src: halftone(4), overlayColor: "#f1ece0", overlayAlpha: 0.44 },
      {
        kind: "radial",
        stops: [
          ["#f8f4eb", 0],
          ["#e6ddcd", 0.7],
          ["#d7cdba", 1],
        ],
        cx: 0.5,
        cy: 0.32,
        r: 1.0,
      },
      { kind: "solid", color: "#e0d7c6" },
    ],
    headline: {
      fontFamily: "Instrument Serif",
      weight: 400,
      sizePx: 150,
      lineHeight: 0.98,
      letterSpacing: -2.5,
      color: "#1b1814",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 44,
      lineHeight: 1.44,
      letterSpacing: 0.3,
      color: "#6d6455",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#b0432a", color: "#f7f1e4", fontFamily: "Instrument Sans" },
    // Gölge sıcak kahveye çekildi: fildişi kâğıtta nötr siyah gölge kirli durur.
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 64,
      shadow: { dy: 34, blur: 96, opacity: 0.22, color: "#4a3d2a" },
    },
    defaultLayout: "text-top",
    accent: "#b0432a",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.85 },
      grain: 0.05,
      vignette: 0.14,
    },
  },

  // ---------------------------------------------------------------------------
  // 14) GECE MÜREKKEBİ — neredeyse siyah zemin, TEK neon (nane) vurgu ve
  // arkada teknik ızgara. Obsidian mavi/Neon 3D magenta ile çakışmasın diye
  // nane seçildi. Alt satır mono + geniş tracking: terminal künyesi hissi.
  // Doku: tarama çizgisi overlay — CRT değil, çok ince bir tarama izi.
  // ---------------------------------------------------------------------------
  {
    id: "ink-neon",
    name: L("Gece Mürekkebi", "Night Ink"),
    background: {
      kind: "shader",
      shaderId: "grid",
      colors: ["#04070a", "#0a1518", "#00e5a0", "#00b487"],
      seed: 19,
      params: { glow: 1.0, cells: 0.9 },
    },
    altBackgrounds: [
      {
        kind: "radial",
        stops: [
          ["#0a2220", 0],
          ["#05100f", 0.62],
          ["#020506", 1],
        ],
        cx: 0.5,
        cy: 0.4,
        r: 0.94,
      },
      {
        kind: "shader",
        shaderId: "halo",
        colors: ["#04070a", "#0f3d33", "#00e5a0", "#0b5f4c"],
        seed: 29,
        params: { intensity: 0.85, size: 1.1 },
      },
      { kind: "solid", color: "#050809" },
      { kind: "image", src: grad(10), overlayColor: "#031310", overlayAlpha: 0.58 },
      { kind: "image", src: grad(8), overlayColor: "#04100d", overlayAlpha: 0.62 },
      grain(["#04070a", "#0b1a17"], 53),
    ],
    headline: {
      fontFamily: "Space Grotesk",
      weight: 700,
      sizePx: 134,
      lineHeight: 1.04,
      letterSpacing: -3.2,
      color: "#eefaf5",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "JetBrains Mono",
      weight: 500,
      sizePx: 35,
      lineHeight: 1.52,
      letterSpacing: 1.2,
      color: "#6d9689",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#00e5a0", color: "#03120e", fontFamily: "JetBrains Mono" },
    device: {
      mode: "3d",
      model: "real",
      camera: "hero-right",
      lightRig: "night",
      bodyColor: "#0b1113",
      shadow: true,
    },
    defaultLayout: "text-top",
    accent: "#00e5a0",
    overlay: {
      texture: { src: PLATE.scanline, blend: "overlay", alpha: 0.22 },
      grain: 0.11,
      vignette: 0.44,
    },
    glowRing: { color: "#00e5a0", alpha: 0.34 },
  },

  // ---------------------------------------------------------------------------
  // 15) KİL — pastel mesh zemin, mat kil gövdeli telefon, havada süzülen kadraj.
  // Bricolage Grotesque'in yumuşak-ama-kararlı harfleri clay dilinin tam
  // karşılığı; Figtree alt satırda okunur ve tatlı, Outfit'ten daha az resmi.
  // Doku: kâğıt lifi çok düşük soft-light — pastelin plastikliğini kırar.
  // ---------------------------------------------------------------------------
  {
    id: "clay-soft",
    name: L("Kil", "Clay"),
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#f6e7ea", "#ffd9c7", "#e4dcff", "#cdeee2"],
      seed: 23,
      params: { warp: 0.7, spread: 1.35 },
    },
    altBackgrounds: [
      { kind: "mesh", colors: ["#ffe3d6", "#f0e0ff", "#d7f2e6", "#ffeecd"], seed: 31 },
      {
        kind: "linear",
        stops: [
          ["#ffe9dd", 0],
          ["#eee2ff", 0.55],
          ["#d9f3e9", 1],
        ],
        angle: 150,
      },
      {
        kind: "radial",
        stops: [
          ["#fff4ed", 0],
          ["#f2dfe6", 0.62],
          ["#dcd0ea", 1],
        ],
        cx: 0.5,
        cy: 0.36,
        r: 1.0,
      },
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#ffe6dd", "#f2e2ff", "#d9f1ea", "#ffeede"],
        seed: 47,
        params: { sheen: 0.7, scale: 1.4 },
      },
      { kind: "image", src: TEX.candy, overlayColor: "#fff4ee", overlayAlpha: 0.64, blur: 9 },
    ],
    headline: {
      fontFamily: "Bricolage Grotesque",
      weight: 700,
      sizePx: 132,
      lineHeight: 1.04,
      letterSpacing: -3,
      color: "#3b2c48",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Figtree",
      weight: 500,
      sizePx: 45,
      lineHeight: 1.4,
      letterSpacing: 0,
      color: "#7a688a",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#3b2c48", color: "#ffe6ec", fontFamily: "Figtree" },
    device: {
      mode: "3d",
      model: "real",
      camera: "hero-left",
      lightRig: "softbox",
      bodyColor: "#e8d9e4",
      shadow: true,
      float: 0.28,
    },
    defaultLayout: "badge-hero",
    accent: "#ff8fab",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.4 },
      grain: 0.04,
      vignette: 0.12,
    },
  },

  // ---------------------------------------------------------------------------
  // 16) DUOTONE BASKI — fotoğraf zemin, `overlayBlend: "color"` ile GERÇEK
  // duotone: kaynağın luminansı kalır, rengi tek mürekkebe iner. Bu yüzden
  // yalnız KOYU kaynaklar seçildi (midnight/grad/granular ~lum 30-80);
  // parlak bir foto duotone'da açık kalır ve beyaz başlık okunmaz.
  // Anton sıkışık versal + kaba halftone: eski poster baskısı.
  // ---------------------------------------------------------------------------
  {
    id: "duotone-press",
    name: L("Duotone Baskı", "Duotone Print"),
    // Ana zemin PÜRÜZSÜZ bir gradyan: midnight (yıldız/simli doku) duotone'a
    // girince parıltı Anton'un versal bloğuyla yarışıyor, başlık dağılıyor.
    // Simli kaynak çeşitleme olarak duruyor (aşağıda), varsayılan değil.
    background: {
      kind: "image",
      src: grad(9),
      overlayColor: "#2a3cf0",
      overlayBlend: "color",
      overlayAlpha: 0.92,
    },
    altBackgrounds: [
      { kind: "image", src: BG.midnight, overlayColor: "#2438e0", overlayBlend: "color", overlayAlpha: 0.9 },
      { kind: "image", src: TEX.ember, overlayColor: "#d83a24", overlayBlend: "color", overlayAlpha: 0.88 },
      { kind: "image", src: grad(5), overlayColor: "#c8342b", overlayBlend: "color", overlayAlpha: 0.9 },
      { kind: "image", src: BG.marble2, overlayColor: "#2438e0", overlayBlend: "color", overlayAlpha: 0.9 },
      { kind: "image", src: TEX.violet, overlayColor: "#1c8f6d", overlayBlend: "color", overlayAlpha: 0.88 },
    ],
    headline: {
      fontFamily: "Anton",
      weight: 400,
      // 152/0.96 Türkçe versalde çakışıyordu: Anton'un çıkıntısı zaten uzun,
      // İ/Ş/Ö noktaları bir üst satırın altına giriyor ("VAKİTLER ŞEHRİNE
      // GÖRE" iki satıra düşünce satırlar birbirine değiyordu).
      sizePx: 140,
      lineHeight: 1.05,
      letterSpacing: -1.5,
      color: "#f7f4ec",
      align: "center",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 42,
      lineHeight: 1.42,
      letterSpacing: 0.4,
      color: "#c3cbf2",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ffd23f", color: "#151a3a", fontFamily: "Instrument Sans" },
    device: { mode: "2d", frame: "none", cornerRadius: 64, shadow: true },
    defaultLayout: "device-bleed-bottom",
    accent: "#ffd23f",
    overlay: {
      // Tram 0.24'te Anton'un versal bloğunu "yiyordu" — punto büyük, nokta
      // aralığı yakın, ikisi birbirini kemiriyor. 0.16'da baskı hissi kalıyor,
      // başlık kalıyor.
      // 0.16 hâlâ Anton'un beyaz gövdesinde iri lekeler bırakıyordu (versal
      // blok + iri tram noktası). 0.12: baskı hissi kalıyor, harf temiz.
      texture: { src: PLATE.halftoneCoarse, blend: "multiply", alpha: 0.12 },
      grain: 0.1,
      vignette: 0.38,
    },
  },

  // ---------------------------------------------------------------------------
  // 17) MESH FİLM — dört renk çapalı mesh gradyan + film greni plakası.
  // Granular temasıyla karışmasın diye zemin PROSEDÜREL (foto değil) ve
  // renkler günbatımı tarafında. Sora'nın hafif teknik serifsizi sıcak
  // paletle dengelenir; başlık ve alt satır aynı aileden, ağırlık farkıyla.
  // ---------------------------------------------------------------------------
  {
    id: "mesh-film",
    name: "Mesh Film",
    background: {
      kind: "shader",
      shaderId: "prism",
      // Taban ve çapa renkleri ilk turdan sonra koyulaştırıldı: parlak turuncu
      // çapa üst banda denk gelince alt satır (düşük kontrastlı, tasarım gereği)
      // okunmuyordu. Şimdi en açık çapa bile beyaz metni taşıyor.
      colors: ["#1c1030", "#d94f6a", "#e0834a", "#4a54c9"],
      seed: 17,
      params: { warp: 1.0, spread: 1.1 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "prism",
        colors: ["#141033", "#ff5f8f", "#7a5cff", "#2fd6c8"],
        seed: 37,
        params: { warp: 1.2, spread: 1.0 },
      },
      {
        kind: "shader",
        shaderId: "bokeh",
        colors: ["#1b0f2e", "#ff7a5c", "#ffc46b", "#8f6bff"],
        seed: 51,
        params: { intensity: 0.85, size: 1.3 },
      },
      { kind: "mesh", colors: ["#3a1c4f", "#e2596a", "#f2a25c", "#4f5cc9"], seed: 63 },
      { kind: "image", src: granular(2), overlayColor: "#1d1130", overlayAlpha: 0.42 },
      { kind: "image", src: TEX.orchid, overlayColor: "#1a0f2c", overlayAlpha: 0.44 },
      grain(["#241541", "#0f0a1c"], 71),
    ],
    headline: {
      fontFamily: "Sora",
      weight: 700,
      sizePx: 128,
      lineHeight: 1.06,
      letterSpacing: -3,
      color: "#fff6ef",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Sora",
      weight: 400,
      sizePx: 43,
      lineHeight: 1.44,
      letterSpacing: 0,
      color: "#f0d6de",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ff8f6b", color: "#2a1024", fontFamily: "Sora" },
    device: {
      mode: "3d",
      model: "real",
      camera: "hero-left",
      lightRig: "studio",
      bodyColor: "#1e1430",
      shadow: true,
      float: 0.2,
    },
    defaultLayout: "device-bleed-bottom",
    accent: "#ff8f6b",
    overlay: {
      texture: { src: PLATE.filmGrain, blend: "overlay", alpha: 0.34 },
      vignette: 0.3,
    },
  },

  // ---------------------------------------------------------------------------
  // 18) MONO KIRMIZI — yüksek kontrast siyah-beyaz, TEK kırmızı aksan.
  // Archivo Black 400 zaten "black" ağırlıkta; 150 punto + versal + -3
  // tracking ile satır neredeyse bloktur. Alt satır Instrument Sans, düşük
  // kontrastlı gri: kırmızı rozet dışında sayfada başka renk YOK.
  // Doku: gravür taraması overlay — düz siyahı klişe baskı gibi kırar.
  // ---------------------------------------------------------------------------
  {
    id: "mono-red",
    name: L("Mono Kırmızı", "Mono Red"),
    background: { kind: "solid", color: "#0b0b0b" },
    altBackgrounds: [
      { kind: "solid", color: "#151515" },
      {
        kind: "linear",
        stops: [
          ["#1e1e1e", 0],
          ["#070707", 1],
        ],
        angle: 180,
      },
      {
        kind: "radial",
        stops: [
          ["#242424", 0],
          ["#0d0d0d", 0.68],
          ["#050505", 1],
        ],
        cx: 0.5,
        cy: 0.34,
        r: 0.95,
      },
      {
        kind: "shader",
        shaderId: "grid",
        colors: ["#0a0a0a", "#161616", "#6e6e6e", "#ff2d1f"],
        seed: 11,
        params: { glow: 0.7, cells: 1.4 },
      },
      { kind: "image", src: granular(1), overlayColor: "#0a0a0a", overlayAlpha: 0.66 },
      grain(["#121212", "#060606"], 97),
    ],
    headline: {
      fontFamily: "Archivo Black",
      weight: 400,
      sizePx: 148,
      lineHeight: 0.98,
      letterSpacing: -3,
      color: "#f6f6f4",
      align: "center",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 42,
      lineHeight: 1.44,
      letterSpacing: 0.4,
      color: "#8d8d8a",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ff2d1f", color: "#fff6f4", fontFamily: "Instrument Sans" },
    device: { mode: "2d", frame: "none", cornerRadius: 58, shadow: true },
    defaultLayout: "text-top",
    accent: "#ff2d1f",
    overlay: {
      texture: { src: PLATE.hatch, blend: "overlay", alpha: 0.3 },
      grain: 0.09,
      vignette: 0.36,
    },
  },

  // ---------------------------------------------------------------------------
  // 19) KUZEY BUZU — soğuk açık gri-mavi, İskandinav sadeliği. Clean Light'ın
  // aksine tamamen NÖTR değil: zemin hafif mavi, gölgeler soğuk, tek doygun
  // renk mavi aksan. Instrument Sans hem başlıkta hem altta — ağırlık ve
  // tracking farkıyla ayrışır (tek aileli sistem, arayüz dili).
  // Doku: keten dokuma soft-light — açık zemine kumaş gözü verir.
  // ---------------------------------------------------------------------------
  {
    id: "nordic-frost",
    name: L("Kuzey Buzu", "Northern Ice"),
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#eef3f8", "#d5e3ef", "#e6ecf4", "#dfeae4"],
      seed: 9,
      params: { warp: 0.6, spread: 1.5 },
    },
    altBackgrounds: [
      { kind: "solid", color: "#eef2f6" },
      {
        kind: "linear",
        stops: [
          ["#f7fafc", 0],
          ["#dde6ee", 1],
        ],
        angle: 172,
      },
      {
        kind: "radial",
        stops: [
          ["#ffffff", 0],
          ["#e7eef4", 0.66],
          ["#d2dde7", 1],
        ],
        cx: 0.5,
        cy: 0.3,
        r: 1.0,
      },
      { kind: "mesh", colors: ["#eff5fa", "#dce8f2", "#e7f0ea", "#f3f0ea"], seed: 27 },
      { kind: "image", src: halftone(15), overlayColor: "#eef3f8", overlayAlpha: 0.56 },
    ],
    headline: {
      fontFamily: "Instrument Sans",
      weight: 700,
      sizePx: 132,
      lineHeight: 1.04,
      letterSpacing: -3.2,
      color: "#0f1820",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 43,
      lineHeight: 1.44,
      letterSpacing: 0.2,
      color: "#5b6b79",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#0f6fff", color: "#f2f7ff", fontFamily: "Instrument Sans" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 68,
      shadow: { dy: 30, blur: 120, opacity: 0.2, color: "#1d3348" },
      reflection: true,
    },
    defaultLayout: "text-top",
    accent: "#0f6fff",
    overlay: {
      texture: { src: PLATE.weave, blend: "soft-light", alpha: 0.34 },
      grain: 0.04,
      vignette: 0.1,
    },
  },

  // ---------------------------------------------------------------------------
  // 20) KUM TEPESİ — çöl alacakaranlığı; terracotta, kehribar, mor gölge.
  // Fraunces başlıkta (yumuşak, sıcak serif) + Instrument Serif İTALİK alt
  // satırda: dergi spot yazısı ritmi. İtalik alt satır bilerek 48 punto —
  // italik gövde optik olarak küçüldüğü için düz 42'yle aynı ağırlıkta durur.
  // Doku: soğuk pres kâğıt soft-light; sıcak degradeye el işi dişi katar.
  // ---------------------------------------------------------------------------
  {
    id: "sunset-dune",
    name: L("Kum Tepesi", "Sand Dune"),
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#1f0d0a", "#c2582f", "#e09a4e", "#632f46"],
      seed: 33,
      params: { warp: 0.9, spread: 1.2 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "rays",
        colors: ["#1c0e0c", "#d2663b", "#f7c48a", "#8a3f4f"],
        seed: 41,
        params: { intensity: 0.7, count: 0.9 },
      },
      {
        kind: "linear",
        stops: [
          ["#f0a86a", 0],
          ["#8a3f4f", 1],
        ],
        angle: 165,
      },
      {
        kind: "radial",
        stops: [
          ["#f2a65a", 0],
          ["#a34c37", 0.58],
          ["#2a1410", 1],
        ],
        cx: 0.5,
        cy: 0.38,
        r: 0.98,
      },
      { kind: "image", src: TEX.ember, overlayColor: "#2b120c", overlayAlpha: 0.42 },
      { kind: "image", src: grad(1), overlayColor: "#24100c", overlayAlpha: 0.44 },
      { kind: "image", src: BG.sand, overlayColor: "#8a3a22", overlayBlend: "multiply", overlayAlpha: 0.72 },
    ],
    headline: {
      fontFamily: "Fraunces",
      weight: 600,
      sizePx: 134,
      lineHeight: 1.04,
      letterSpacing: -2,
      color: "#fdf1e3",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Serif",
      weight: 400,
      style: "italic",
      sizePx: 48,
      lineHeight: 1.36,
      letterSpacing: 0.2,
      color: "#f4d6b6",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#f2a65a", color: "#2a1410", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "real",
      camera: "low-hero",
      lightRig: "daylight",
      bodyColor: "#3a2018",
      shadow: true,
    },
    defaultLayout: "badge-hero",
    accent: "#f2a65a",
    overlay: {
      texture: { src: PLATE.paperCold, blend: "soft-light", alpha: 0.32 },
      grain: 0.09,
      vignette: 0.3,
    },
    glowRing: { color: "#f2a65a", alpha: 0.24 },
  },
  // ===========================================================================
  // R11 — 2026 MAĞAZA DİLİ, İKİNCİ TUR. Bu on tema öncekilerin YANINA eklendi;
  // 1-20 arası hiçbir değer değişmedi (id'ler kullanıcı projelerinde yaşıyor).
  //
  // Ortak kararlar:
  //   · Kütüphane koyu ağırlıklıydı (20 temanın 13'ü koyu). Bu turda BEŞ AÇIK
  //     tema var — 2026 vitrininde açık zemin + tek vurgu, koyu zemin kadar
  //     yaygın (bkz. Notion / Copilot Money / Flighty vitrinleri).
  //   · Her tema ayrı bir "referans dil" temsil eder: bento panel, sıvı krom,
  //     film fotoğrafı, renk-blok editoryal, kil oyuncak, neo-brutalist kâğıt,
  //     el yazısı not, sakin wellness, panorama şerit, dev rakam.
  //   · Tipografi çakışması olmasın diye bu turda ilk kez kullanılan yüzler:
  //     Unbounded, DM Serif Display, Playfair Display, Cormorant Garamond,
  //     Caveat ve başlık ağırlığında Outfit 700.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 21) BENTO IZGARA — arduvaz zeminde kılcal BEYAZ ızgara: 2026'nın bento/
  // panel dili. Kadraj modüllere bölünmüş gibi okunur ama gerçek panel yok
  // (Theme'de öğe alanı yok), yapı tamamen zeminden gelir.
  //
  // İLK TUR AÇIK ZEMİNLE DENENDİ VE ÇÖPE GİTTİ: `grid` shader'ı çizgiyi
  // SCREEN ile ekler, yani ışık KATAR. Açık gri zeminde beyaz çizgi hiçbir
  // ayarda görünmüyordu (glow 1.8'de bile +0.07 luma) — panel yapısı yok
  // olunca tema düz bir gri kalıyordu. Koyu zeminde aynı ayar kılcal ve net.
  //
  // Gece Mürekkebi de `grid` kullanır; karışmasın diye burada hücre sayısı
  // ~3 katı (cells 2.6 → 42 hücre), çizgi rengi NÖTR beyaz (orada neon nane)
  // ve hale soğuk indigo. O blueprint parıltısı, bu modüler ızgara.
  // Tipografi arayüz dilinde: Instrument Sans başlık + mono etiket alt satır.
  // ---------------------------------------------------------------------------
  {
    id: "bento-grid",
    name: L("Bento Izgara", "Bento Grid"),
    background: {
      kind: "shader",
      shaderId: "grid",
      colors: ["#121722", "#1e2635", "#dbe6ff", "#3450d8"],
      seed: 101,
      params: { glow: 1.5, cells: 2.6 },
    },
    altBackgrounds: [
      { kind: "solid", color: "#151b27" },
      {
        kind: "linear",
        stops: [
          ["#1c2431", 0],
          ["#0d1119", 1],
        ],
        angle: 180,
      },
      // Daha iri hücre — aynı ızgaranın "yakın plan" hâli
      {
        kind: "shader",
        shaderId: "grid",
        colors: ["#0f141d", "#1a2130", "#cfdcf5", "#2b3fb8"],
        seed: 7,
        params: { glow: 1.3, cells: 1.4 },
      },
      {
        kind: "radial",
        stops: [
          ["#26314b", 0],
          ["#141a26", 0.66],
          ["#0b0e15", 1],
        ],
        cx: 0.5,
        cy: 0.34,
        r: 0.96,
      },
      { kind: "image", src: BG.abyss, overlayColor: "#101724", overlayAlpha: 0.62, blur: 3 },
      grain(["#141a26", "#0b0e15"], 103),
    ],
    headline: {
      fontFamily: "Instrument Sans",
      weight: 700,
      sizePx: 128,
      lineHeight: 1.05,
      letterSpacing: -3,
      color: "#f2f5fb",
      align: "center",
      transform: "none",
    },
    // Mono + versal + geniş tracking: panel künyesi dili. Punto 34 bilerek
    // küçük — bento'da alt satır etikettir, cümle değil.
    sub: {
      fontFamily: "JetBrains Mono",
      weight: 500,
      sizePx: 34,
      lineHeight: 1.5,
      letterSpacing: 1.5,
      color: "#93a1bd",
      align: "center",
      transform: "uppercase",
    },
    badge: { bg: "#5b76ff", color: "#08101f", fontFamily: "JetBrains Mono" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 56,
      shadow: { dy: 30, blur: 92, opacity: 0.5, color: "#02060f" },
    },
    defaultLayout: "text-top",
    accent: "#5b76ff",
    overlay: { grain: 0.07, vignette: 0.3 },
  },

  // ---------------------------------------------------------------------------
  // 22) SIVI KROM — Apple'ın "Liquid Glass" sonrası kromlaşan mağaza dili.
  // `silk` shader'ı domain warping ile akışkan kıvrım üretir; renk rampası
  // siyahtan kroma çıktığı için sonuç dökülmüş metal gibi okunur (kıvrım
  // sırtlarındaki saten highlight bunu tek başına taşır, sheen 1.9).
  // Cihaz `rim` rigde ve hafif `glare` ile: kenar ışığı krom zemini tamamlar.
  // Unbounded geniş ve geometrik — krom yüzeye "endüstriyel künye" tavrı verir.
  // ---------------------------------------------------------------------------
  {
    id: "liquid-chrome",
    name: L("Sıvı Krom", "Liquid Chrome"),
    // ANA ZEMİN NEDEN SHADER DEĞİL:
    // `silk` krom kıvrımını güzel veriyor ama parlak levhanın NEREYE düşeceği
    // seed'e bağlı — üç ayrı ayarda da (scale 0.75 / 1.0 / 1.7) bir highlight
    // tam üst banda oturdu ve beyaz başlık okunmaz oldu. Bir tema varsayılanı
    // kumar olamaz. Sert krom rampası DETERMİNİSTİK: üst bant her zaman koyu,
    // metal parlaklığı kadrajın alt yarısında. Sıvı kıvrımlar çeşitlemelerde
    // duruyor — orada metin bandı zaten düzen tarafından kaydırılıyor.
    background: {
      kind: "linear",
      stops: [
        ["#070a0f", 0],
        ["#151b24", 0.34],
        ["#5d6a7a", 0.62],
        ["#c9d6e6", 0.84],
        ["#7c8a9c", 1],
      ],
      angle: 174,
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#080b10", "#3f4a59", "#9fadbf", "#eef4fb"],
        seed: 71,
        params: { sheen: 2.0, scale: 1.7 },
      },
      {
        kind: "shader",
        shaderId: "marble",
        colors: ["#0a0d12", "#2a323d", "#8b96a6", "#e8eef6"],
        seed: 13,
        params: { veins: 0.5, scale: 0.9 },
      },
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#06080c", "#2f3a4a", "#7f8fa6", "#cfe0f2"],
        seed: 29,
        params: { sheen: 2.0, scale: 1.5 },
      },
      // Mermer `color` harmanıyla ÇELİĞE indiriliyor: altın damar krom
      // paletini bozuyordu, luminans kalsın renk gitsin.
      { kind: "image", src: BG.marble2, overlayColor: "#0d1219", overlayBlend: "color", overlayAlpha: 1 },
      { kind: "image", src: BG.abyss, overlayColor: "#0d1218", overlayAlpha: 0.5, blur: 2 },
      grain(["#0a0d12", "#1a212b"], 83),
    ],
    // Unbounded optik olarak geniş: 130 puntoda iki kelimelik Türkçe başlık
    // bile satırı taşırıyordu. 116 + (-3) tracking eski satır uzunluğunu verir.
    headline: {
      fontFamily: "Unbounded",
      weight: 600,
      sizePx: 116,
      lineHeight: 1.1,
      letterSpacing: -3,
      color: "#eef4fb",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 43,
      lineHeight: 1.42,
      letterSpacing: 0.4,
      color: "#aabbd0",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#dfe9f5", color: "#0a0f16", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "real",
      camera: "hero-right",
      lightRig: "rim",
      bodyColor: "#20262e",
      shadow: true,
      reflection: true,
      float: 0.18,
      glare: 0.18,
    },
    defaultLayout: "text-top",
    accent: "#cfdcea",
    overlay: {
      texture: { src: PLATE.filmGrain, blend: "soft-light", alpha: 0.24 },
      grain: 0.06,
      vignette: 0.5,
    },
    glowRing: { color: "#9fb6d0", alpha: 0.22 },
  },

  // ---------------------------------------------------------------------------
  // 23) SICAK FİLM — fotoğraf zeminli, analog film bakışı. Kum Tepesi ile
  // karışmasın diye zemin PROSEDÜREL DEĞİL, gerçek foto; gren ağır (0.16 +
  // plaka 0.42) ve vignette güçlü. Playfair'in yüksek kontrastlı serifi
  // fotoğrafın üstünde dergi ilanı gibi durur, Figtree alt satırda ısıtır.
  // Gölge sıcak kahveye çekildi — sepya zeminde nötr siyah gölge kirli durur.
  // ---------------------------------------------------------------------------
  {
    id: "warm-film",
    name: L("Sıcak Film", "Warm Film"),
    // ZEMİN SEÇİMİ İKİ KEZ DEĞİŞTİ, İKİSİ DE ÖLÇÜMLE:
    //   1) gold.jpg sanıldığı gibi altın değil, ALACAKARANLIK PLAJI — üstteki
    //      bulut kütlesi mavi-eflatun. Koyu kahve perde onu ısıtmadı, sadece
    //      grileştirdi; tema "sıcak film" değil "gri gökyüzü" basıyordu.
    //   2) sand.jpg gerçek bir çöl fotoğrafı: bu temanın istediği tam olarak
    //      o — analog bir kare, prosedürel bir degrade değil.
    // `multiply` her kanalı sıcak tonla ÇARPAR (mavi gök kahveye iner), blur 2
    // fotoğrafın detayını başlığın altında yumuşatır.
    background: {
      kind: "image",
      src: BG.sand,
      // 0.86'da gökyüzünden geriye yeşilimsi bir tortu kalıyordu (mavi kanal
      // tam sönmüyor). Tam güçte çarpım, biraz daha açık bir kehribarla:
      // kadraj baştan sona sıcak, kontrast düşmüyor.
      overlayColor: "#a85f28",
      overlayBlend: "multiply",
      overlayAlpha: 1,
      blur: 2,
    },
    altBackgrounds: [
      // grad-05/01: siyaha yakın zeminde tek sıcak ışık şeridi — projeksiyon hüzmesi
      { kind: "image", src: grad(5), overlayColor: "#3a1608", overlayAlpha: 0.34 },
      { kind: "image", src: grad(1), overlayColor: "#8a4a20", overlayBlend: "multiply", overlayAlpha: 0.7 },
      { kind: "image", src: TEX.ember, overlayColor: "#2b1408", overlayAlpha: 0.55 },
      { kind: "image", src: BG.gold, overlayColor: "#8f4a1c", overlayBlend: "multiply", overlayAlpha: 0.86 },
      { kind: "image", src: granular(5), overlayColor: "#a05a20", overlayBlend: "multiply", overlayAlpha: 0.78 },
      { kind: "image", src: BG.marble4, overlayColor: "#8a5a24", overlayBlend: "multiply", overlayAlpha: 0.74 },
    ],
    headline: {
      fontFamily: "Playfair Display",
      weight: 600,
      sizePx: 132,
      lineHeight: 1.06,
      letterSpacing: -1.5,
      color: "#fdf3e4",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Figtree",
      weight: 500,
      sizePx: 45,
      lineHeight: 1.42,
      letterSpacing: 0.2,
      color: "#f2d3a8",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#e8a04a", color: "#2a1608", fontFamily: "Figtree" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 68,
      shadow: { dy: 40, blur: 110, opacity: 0.4, color: "#1a0c04" },
    },
    defaultLayout: "device-bleed-bottom",
    accent: "#e8a04a",
    overlay: {
      texture: { src: PLATE.filmGrain, blend: "overlay", alpha: 0.42 },
      grain: 0.16,
      vignette: 0.46,
    },
  },

  // ---------------------------------------------------------------------------
  // 24) RENKLİ EDİTORYAL — serif başlık DÜZ RENK BLOĞUNUN üstünde. Editorial
  // (koyu mermer) ve Kâğıt Editoryal'den (fildişi) farkı tam olarak bu:
  // burada zemin bir mürekkep bloğu ve her çeşitleme BAŞKA bir doygun renk —
  // dergi kapağı serisi gibi. Bu yüzden başlık/alt satır renkleri bordo,
  // yeşil, lacivert ve tütünün HEPSİNDE okunacak sıcak krem seçildi.
  // DM Serif Display yüksek kontrastlı ve geniş — büyük puntoda blok kurar.
  // ---------------------------------------------------------------------------
  {
    id: "editorial-colour",
    name: L("Renkli Editoryal", "Colorful Editorial"),
    background: { kind: "solid", color: "#5b1a2c" },
    altBackgrounds: [
      { kind: "solid", color: "#173b30" },
      { kind: "solid", color: "#1e2a5e" },
      { kind: "solid", color: "#5e3a13" },
      {
        kind: "linear",
        stops: [
          ["#74233a", 0],
          ["#3d0f1e", 1],
        ],
        angle: 168,
      },
      // Kâğıt tramı `multiply` ile mürekkebe basılıyor: renk bloğu düz kalmaz,
      // baskı dişi kazanır.
      { kind: "image", src: halftone(4), overlayColor: "#5b1a2c", overlayBlend: "multiply", overlayAlpha: 0.94 },
    ],
    headline: {
      fontFamily: "DM Serif Display",
      weight: 400,
      sizePx: 140,
      lineHeight: 1.02,
      letterSpacing: -1.5,
      color: "#f6ece0",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 43,
      lineHeight: 1.44,
      letterSpacing: 0.3,
      color: "#cbb6a6",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#e8c07a", color: "#3a0d1a", fontFamily: "Instrument Sans" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 64,
      shadow: { dy: 34, blur: 100, opacity: 0.34, color: "#180509" },
      reflection: true,
    },
    defaultLayout: "text-top",
    accent: "#e8c07a",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.35 },
      grain: 0.07,
      vignette: 0.28,
    },
  },

  // ---------------------------------------------------------------------------
  // 25) KİL OYUNCAK — tek renkli pastel zemin + MAT KİL gövdeli telefon.
  // Kil temasından farkı iki yerde: (1) zemin çok renkli mesh değil, kare
  // başına TEK hue (tereyağı, leylak, nane…); (2) cihaz `model: "kontur"` +
  // `finish: "clay"`, yani gerçek GLB değil kil maketi — konturWidth/Depth
  // kısıldığı için telefon bir oyuncak bloğuna düşer.
  // Başlık rengi bilerek mürekkep-erik: sarı, leylak ve nanenin ÜÇÜNDE de
  // okunur (kahve tonları leylakta kirli duruyordu).
  // ---------------------------------------------------------------------------
  {
    id: "clay-toy",
    name: L("Kil Oyuncak", "Clay Toy"),
    background: {
      kind: "radial",
      stops: [
        ["#fff3d2", 0],
        ["#ffe08f", 0.6],
        ["#f6c95e", 1],
      ],
      cx: 0.5,
      cy: 0.34,
      r: 1.0,
    },
    altBackgrounds: [
      { kind: "solid", color: "#ffe9a8" },
      {
        kind: "radial",
        stops: [
          ["#f4ecff", 0],
          ["#ddccff", 0.6],
          ["#c3aef5", 1],
        ],
        cx: 0.5,
        cy: 0.34,
        r: 1.0,
      },
      {
        kind: "radial",
        stops: [
          ["#eafcf1", 0],
          ["#c8f0da", 0.6],
          ["#a5e3c4", 1],
        ],
        cx: 0.5,
        cy: 0.34,
        r: 1.0,
      },
      {
        kind: "linear",
        stops: [
          ["#ffe6d5", 0],
          ["#ffc9ad", 1],
        ],
        angle: 158,
      },
      { kind: "mesh", colors: ["#ffeec2", "#ffe0a0", "#fff6dd", "#ffd98a"], seed: 91 },
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#fff6e2", "#ffe4b8", "#fffaf0", "#f7cf86"],
        seed: 93,
        params: { sheen: 0.6, scale: 1.6 },
      },
    ],
    headline: {
      fontFamily: "Outfit",
      weight: 700,
      sizePx: 138,
      lineHeight: 1.04,
      letterSpacing: -3,
      color: "#2e2233",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Figtree",
      weight: 500,
      sizePx: 45,
      lineHeight: 1.4,
      letterSpacing: 0,
      color: "#6b5c72",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#2e2233", color: "#ffe9a8", fontFamily: "Figtree" },
    device: {
      mode: "3d",
      model: "kontur",
      finish: "clay",
      camera: "hero-left",
      lightRig: "softbox",
      bodyColor: "#f3e3ce",
      konturWidth: 0.35,
      konturDepth: 0.62,
      island: false,
      shadow: true,
      float: 0.3,
    },
    defaultLayout: "badge-hero",
    accent: "#ff8a3d",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.3 },
      grain: 0.05,
      vignette: 0.14,
    },
  },

  // ---------------------------------------------------------------------------
  // 26) BEYAZ BRUTALİST — neo-brutalizmin imzası: SERT OFSET GÖLGE (blur 0),
  // kâğıt beyazı zemin, mono versal başlık ve tek elektrik mavisi. Brutalist
  // Mono'nun (is rengi + asit sarısı afiş) TERSİ kutbu: orada gece afişi,
  // burada fotokopi zine.
  // Ritim de kasten farklı: orada -4 tracking sıkı blok, burada POZİTİF
  // tracking ve sola dayalı satır — daktilo künyesi gibi seyrek.
  // Köşe 28: brutalist yüzeyde yumuşak köşe yalan söyler.
  // ---------------------------------------------------------------------------
  {
    id: "brut-paper",
    name: L("Beyaz Brutalist", "White Brutalist"),
    background: { kind: "solid", color: "#f2efe6" },
    altBackgrounds: [
      { kind: "solid", color: "#ffffff" },
      { kind: "solid", color: "#ffdd33" },
      { kind: "solid", color: "#cfe3ff" },
      { kind: "image", src: halftone(11), overlayColor: "#f4f1e8", overlayAlpha: 0.5 },
      {
        kind: "linear",
        stops: [
          ["#ffffff", 0],
          ["#e6e2d6", 1],
        ],
        angle: 180,
      },
    ],
    // Mono glifler geniş: 104 punto Instrument Sans 130 ile aynı satır
    // uzunluğunu verir. Tracking POZİTİF (0.5) — zine dizgisi seyrektir.
    headline: {
      fontFamily: "JetBrains Mono",
      weight: 700,
      sizePx: 108,
      lineHeight: 1.12,
      letterSpacing: 0.5,
      color: "#0b0b0b",
      align: "left",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 40,
      lineHeight: 1.42,
      letterSpacing: 0.2,
      color: "#4a4a44",
      align: "left",
      transform: "none",
    },
    badge: { bg: "#0512e8", color: "#ffffff", fontFamily: "JetBrains Mono" },
    // Sert ofset gölge: blur 0, opaklık tam. Mühür gibi yana kaymış blok —
    // neo-brutalizmin en tanınır tek özelliği bu.
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 28,
      shadow: { dx: 22, dy: 22, blur: 0, opacity: 1, color: "#0b0b0b" },
    },
    defaultLayout: "split-diagonal",
    accent: "#0512e8",
    overlay: {
      texture: { src: PLATE.halftone45, blend: "multiply", alpha: 0.1 },
      grain: 0.05,
      vignette: 0.08,
    },
  },

  // ---------------------------------------------------------------------------
  // 27) NOT DEFTERİ — "el yazısı açıklama" dili: temiz grotesk başlık, altında
  // MARKÖR KIRMIZISI el yazısı satır. Caveat düz metinden optik olarak çok
  // küçük durduğu için alt satır 58 punto — diğer temalarda 42-46 olan yer.
  // Kâğıt lifi plakası yüksek (0.7): sayfa gerçekten kâğıt olmalı, yoksa
  // el yazısı boşlukta asılı kalıyor.
  // ---------------------------------------------------------------------------
  {
    id: "note-marker",
    name: L("Not Defteri", "Notebook"),
    background: { kind: "image", src: halftone(11), overlayColor: "#fbf7ee", overlayAlpha: 0.55 },
    altBackgrounds: [
      { kind: "solid", color: "#fdfaf2" },
      { kind: "image", src: halftone(4), overlayColor: "#f9f4e8", overlayAlpha: 0.5 },
      {
        kind: "linear",
        stops: [
          ["#fffdf7", 0],
          ["#f2ebdb", 1],
        ],
        angle: 174,
      },
      { kind: "image", src: halftone(15), overlayColor: "#f3f7fc", overlayAlpha: 0.56 },
      { kind: "mesh", colors: ["#fdfaf2", "#f4f0e4", "#eef3fa", "#fbf6ec"], seed: 121 },
      { kind: "solid", color: "#f1f5fd" },
    ],
    headline: {
      fontFamily: "Instrument Sans",
      weight: 700,
      sizePx: 126,
      lineHeight: 1.06,
      letterSpacing: -2.6,
      color: "#161616",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Caveat",
      weight: 600,
      sizePx: 62,
      lineHeight: 1.28,
      letterSpacing: 0.5,
      color: "#e0483c",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#e0483c", color: "#fff8f0", fontFamily: "Caveat" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 60,
      shadow: { dy: 24, blur: 64, opacity: 0.2, color: "#3a3428" },
    },
    defaultLayout: "text-top",
    accent: "#e0483c",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.7 },
      grain: 0.06,
      vignette: 0.12,
    },
  },

  // ---------------------------------------------------------------------------
  // 28) ADAÇAYI — sakin/wellness dili (Headspace, Calm, Endel kuşağı): kirli
  // yeşil-gri zemin, tek doygun renk yok denecek kadar az, cihaz havada.
  // Gece + altın temalarıyla karışmaz: burada GÜNDÜZ,
  // düşük doygunluk ve `daylight` rig.
  // Cormorant Garamond küçük gövdeli, yüksek kontrastlı bir kitap serifi;
  // 152 puntoda bile "bağıran" değil "nefes alan" bir başlık verir.
  // ---------------------------------------------------------------------------
  {
    id: "sage-calm",
    name: L("Adaçayı", "Sage"),
    // `prism` iki turda da GRİ bastı: pastel-yeşil çapalar birbirine o kadar
    // yakın ki kıvrım hiç okunmuyor, geriye düz bir gri-yeşil kalıyordu.
    // Temiz bir radial hem daha yeşil hem daha sakin — wellness dilinde
    // zaten istenen "tek nefes" bu. Prism çeşitleme olarak aşağıda duruyor.
    background: {
      kind: "radial",
      stops: [
        ["#eef3e2", 0],
        ["#cbd9b8", 0.55],
        ["#9fb48d", 1],
      ],
      cx: 0.5,
      cy: 0.3,
      r: 1.05,
    },
    altBackgrounds: [
      { kind: "solid", color: "#d7e1c8" },
      {
        kind: "shader",
        shaderId: "prism",
        colors: ["#dfe7d2", "#a9c095", "#f2f5ea", "#8aa374"],
        seed: 137,
        params: { warp: 1.0, spread: 1.2 },
      },
      {
        kind: "linear",
        stops: [
          ["#f2f5ea", 0],
          ["#c9d6bf", 1],
        ],
        angle: 170,
      },
      {
        kind: "radial",
        stops: [
          ["#f4f7ec", 0],
          ["#d5e0c8", 0.65],
          ["#b6c6ac", 1],
        ],
        cx: 0.5,
        cy: 0.32,
        r: 1.0,
      },
      { kind: "mesh", colors: ["#eaf0e2", "#d3e0cd", "#e6e2d2", "#c6d6c0"], seed: 149 },
      {
        kind: "shader",
        shaderId: "silk",
        colors: ["#e6ecdd", "#cdd9c4", "#f2f5ec", "#b7c8b0"],
        seed: 151,
        params: { sheen: 0.7, scale: 1.6 },
      },
      { kind: "image", src: halftone(13), overlayColor: "#e4ead9", overlayAlpha: 0.62 },
    ],
    headline: {
      fontFamily: "Cormorant Garamond",
      weight: 600,
      sizePx: 152,
      lineHeight: 1.0,
      letterSpacing: -1,
      color: "#22301f",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Figtree",
      weight: 500,
      sizePx: 44,
      lineHeight: 1.46,
      letterSpacing: 0.3,
      color: "#5f7059",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#22301f", color: "#e8efdd", fontFamily: "Figtree" },
    device: {
      mode: "3d",
      model: "real",
      camera: "front",
      lightRig: "daylight",
      bodyColor: "#3b4436",
      shadow: true,
      float: 0.24,
    },
    defaultLayout: "device-bleed-bottom",
    accent: "#7a9a5e",
    overlay: {
      texture: { src: PLATE.paperCold, blend: "soft-light", alpha: 0.28 },
      grain: 0.04,
      vignette: 0.16,
    },
  },

  // ---------------------------------------------------------------------------
  // 29) PANORAMA ŞERİT — tek geniş ışık şeridi kadrajı yatay kesip geçer.
  // 2026'nın en etkili vitrin numarası: aynı zemin 3-4 karede sürerse kullanıcı
  // kaydırmaya devam eder. `prism` spread 2.2 ile çapalar birbirinden ayrılır,
  // renk kadrajın içinde BİR KEZ döner — mesh gibi her yerde tekrarlamaz.
  // Çeşitlemeler bilerek AYNI hikâyenin farklı dilimleri (mor→mercan→amber).
  // ---------------------------------------------------------------------------
  {
    id: "panorama-sweep",
    name: L("Panorama Şerit", "Panorama Strip"),
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#120a24", "#5c2bd0", "#e0568a", "#f2a05e"],
      seed: 211,
      params: { warp: 1.3, spread: 2.2 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "waves",
        colors: ["#0f0820", "#6a34e0", "#ff6f9c", "#ffc27a"],
        seed: 223,
        params: { intensity: 1.1, freq: 0.45 },
      },
      // Neredeyse yatay rampa — şeridin "düz" hâli
      {
        kind: "linear",
        stops: [
          ["#f2a05e", 0],
          ["#e0568a", 0.42],
          ["#3a1a86", 0.78],
          ["#140a26", 1],
        ],
        angle: 118,
      },
      {
        kind: "shader",
        shaderId: "aurora",
        colors: ["#0d0720", "#7a3ce8", "#ff6f9c", "#ffb46b"],
        seed: 227,
        params: { intensity: 1.1, softness: 1.4 },
      },
      {
        kind: "radial",
        stops: [
          ["#ff8fae", 0],
          ["#6a34c8", 0.5],
          ["#100822", 1],
        ],
        cx: 0.5,
        cy: 0.42,
        r: 1.05,
      },
      { kind: "image", src: granular(6), overlayColor: "#140a26", overlayAlpha: 0.42 },
      grain(["#180d2e", "#0c0618"], 229),
    ],
    headline: {
      fontFamily: "Space Grotesk",
      weight: 700,
      sizePx: 130,
      lineHeight: 1.05,
      letterSpacing: -3,
      color: "#fff2e8",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Sans",
      weight: 500,
      sizePx: 42,
      lineHeight: 1.42,
      letterSpacing: 0.2,
      color: "#ffe0ea",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ffc27a", color: "#2a1030", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "real",
      camera: "front",
      lightRig: "studio",
      bodyColor: "#241634",
      shadow: true,
      reflection: true,
    },
    defaultLayout: "device-bleed-bottom",
    accent: "#ff6f9c",
    overlay: { grain: 0.09, vignette: 0.3 },
    glowRing: { color: "#ff6f9c", alpha: 0.26 },
  },

  // ---------------------------------------------------------------------------
  // 30) DEV RAKAM — kırık beyaz zemin, TEK vurgu ve sayfayı kaplayan başlık.
  // Fintech/ölçüm uygulamalarının 2026 dili (Copilot Money, Revolut, Flighty):
  // kare başına tek çıktı cümlesi ya da tek rakam.
  // Punto 168 kütüphanenin en büyüğü — bu tema KISA başlık ister (üç kelime).
  // Uzun başlıkta üçüncü satıra düşer; o zaman Inspector'dan 130'a çekin.
  // Alt satır mono + versal: rakamın altındaki künye satırı.
  // ---------------------------------------------------------------------------
  {
    id: "mono-numerals",
    name: L("Dev Rakam", "Giant Number"),
    background: { kind: "solid", color: "#f6f5f1" },
    altBackgrounds: [
      { kind: "solid", color: "#ffffff" },
      {
        kind: "linear",
        stops: [
          ["#fbfaf7", 0],
          ["#eae8e1", 1],
        ],
        angle: 176,
      },
      { kind: "solid", color: "#eceae3" },
      { kind: "image", src: halftone(11), overlayColor: "#f7f6f2", overlayAlpha: 0.6 },
      {
        kind: "radial",
        stops: [
          ["#ffffff", 0],
          ["#f3f2ed", 0.66],
          ["#e4e2da", 1],
        ],
        cx: 0.5,
        cy: 0.28,
        r: 1.0,
      },
    ],
    headline: {
      fontFamily: "Manrope",
      weight: 800,
      sizePx: 168,
      lineHeight: 0.96,
      letterSpacing: -6,
      color: "#0e0e0c",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "JetBrains Mono",
      weight: 500,
      sizePx: 34,
      lineHeight: 1.5,
      letterSpacing: 1.6,
      color: "#6c6c66",
      align: "center",
      transform: "uppercase",
    },
    badge: { bg: "#00b862", color: "#03180f", fontFamily: "JetBrains Mono" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 66,
      shadow: { dy: 30, blur: 96, opacity: 0.16, color: "#1c1c18" },
      reflection: true,
    },
    defaultLayout: "badge-hero",
    accent: "#00b862",
    overlay: { grain: 0.035, vignette: 0.08 },
  },

  // ===========================================================================
  // R12 — BEŞ TEMA (Fable). Ortak ilke: her tema TEK bir fikri sonuna kadar
  // götürür; süs yok. İkisi telefonsuz (çıplak ekran + tema öğeleri), ikisi
  // 3D poz odaklı (yeni lean-back / top-down), biri afiş tipografisi.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 31) DİPTİK — TELEFONSUZ ÇİFT KARE. Kâğıt zemin, beyaz kart, ortada
  // kılcal ayraç, iki çıplak ekran; başlık kartın ALTINDA italik serif.
  // Fikir: mağaza vitrini değil, sergi kataloğu sayfası. Telefon gövdesi
  // olmayınca ekranlar %44'e büyür (split-v'de %42 tavan), kart onları tek
  // nesne yapar. Kart/ayraç `elements` ile temadan gelir; kullanıcı kendi
  // öğesini eklese de kart kaybolmaz.
  // Geometri (diptych düzeni): ekranlar cy 1147, h 1262 → 516..1778; kart
  // 578..1948 (yani ekranı 62px sarar), ayraç tam ortada 660'ta, ekran boyunda.
  // ---------------------------------------------------------------------------
  {
    id: "diptik",
    name: L("Diptik", "Diptych"),
    background: { kind: "solid", color: "#f4f1ea" },
    altBackgrounds: [
      { kind: "solid", color: "#ece7dc" },
      { kind: "solid", color: "#e9eef0" },
      {
        kind: "linear",
        stops: [
          ["#f6f3ec", 0],
          ["#e4ddcf", 1],
        ],
        angle: 165,
      },
      { kind: "image", src: halftone(2), overlayColor: "#f4f1ea", overlayBlend: "multiply", overlayAlpha: 0.9 },
      { kind: "solid", color: "#1c1a16" },
    ],
    headline: {
      fontFamily: "Instrument Serif",
      weight: 400,
      style: "italic",
      sizePx: 128,
      lineHeight: 1.0,
      letterSpacing: -1,
      color: "#17150f",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "JetBrains Mono",
      weight: 500,
      sizePx: 32,
      lineHeight: 1.5,
      letterSpacing: 3,
      color: "#6f6a5e",
      align: "center",
      transform: "uppercase",
    },
    badge: { bg: "#17150f", color: "#f4f1ea", fontFamily: "JetBrains Mono" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 40,
      shadow: { dy: 18, blur: 48, opacity: 0.16, color: "#2a2418" },
      reflection: false,
    },
    defaultLayout: "diptych",
    accent: "#c8553d",
    overlay: {
      texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.42 },
      grain: 0.03,
    },
    elements: [
      // Kart: beyaz, kılcal çerçeve, ekranların 54px dışından.
      {
        id: "th-diptik-card",
        kind: "rect",
        x: 36,
        y: 578,
        w: 1248,
        h: 1370,
        z: "under",
        locked: true,
        style: { fill: "#ffffff", stroke: "#d9d3c7", strokeW: 2, radius: 36 },
      },
      // Ayraç: ekran boyunda dikey kılcal — `line` yatay çizer, 90° döndürülür.
      {
        id: "th-diptik-divider",
        kind: "line",
        x: 660 - 631,
        y: 1147 - 12,
        w: 1262,
        h: 24,
        rotation: 90,
        z: "under",
        locked: true,
        style: { stroke: "#d9d3c7", strokeW: 2 },
      },
      // Kart üstünde iki mini künye: 01 · 02 (mono, çok küçük) — katalog dili.
      {
        id: "th-diptik-n1",
        kind: "text",
        x: 60,
        y: 598,
        w: 200,
        h: 30,
        text: "01",
        z: "under",
        locked: true,
        style: { fontFamily: "JetBrains Mono", weight: 500, sizePx: 22, letterSpacing: 4, color: "#a7a091", align: "left" },
      },
      {
        id: "th-diptik-n2",
        kind: "text",
        x: 1060,
        y: 598,
        w: 200,
        h: 30,
        text: "02",
        z: "under",
        locked: true,
        style: { fontFamily: "JetBrains Mono", weight: 500, sizePx: 22, letterSpacing: 4, color: "#a7a091", align: "right" },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 32) AURORA CAM — kuzey ışığı zemin + BUZLU CAM PANEL, cihaz panelin
  // üstünde (Liquid Glass dili, ama panel gerçek: `rect` öğesi, %10 beyaz
  // dolgu + %35 beyaz kılcal). Cihaz çerçevesiz, köşe 88; gölge lacivert.
  // Panel text-top'ın cihaz kutusuna göre yerleşti: cihaz 860..2753 / 224..1096,
  // panel 800..2800 / 160..1160 → her yanda ~60px cam payı.
  // ---------------------------------------------------------------------------
  {
    id: "aurora-cam",
    name: L("Aurora Cam", "Aurora Glass"),
    background: {
      kind: "shader",
      shaderId: "aurora",
      colors: ["#0b1026", "#1c3a6e", "#2fb8a6", "#b86bd1"],
      seed: 7,
      params: { intensity: 1.25, softness: 1.6 },
    },
    altBackgrounds: [
      {
        kind: "shader",
        shaderId: "aurora",
        colors: ["#0a0f22", "#24327a", "#5ad1c4", "#f38fb0"],
        seed: 23,
        params: { intensity: 1.1, softness: 2.0 },
      },
      { kind: "mesh", colors: ["#0b1026", "#1c3a6e", "#2fb8a6", "#7a4fd1"], seed: 9 },
      {
        kind: "shader",
        shaderId: "bokeh",
        colors: ["#070b1c", "#1c3a6e", "#2fb8a6", "#b86bd1"],
        seed: 4,
        params: { intensity: 1.2, size: 1.4 },
      },
      {
        kind: "shader",
        shaderId: "aurora",
        colors: ["#0b1026", "#123d5a", "#39c8a0", "#f1d27a"],
        seed: 41,
        params: { intensity: 1.3, softness: 1.3 },
      },
      { kind: "image", src: TEX.ice, overlayColor: "#0b1026", overlayAlpha: 0.45 },
    ],
    headline: {
      fontFamily: "Sora",
      weight: 700,
      sizePx: 122,
      lineHeight: 1.04,
      letterSpacing: -2.5,
      color: "#ffffff",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Figtree",
      weight: 500,
      sizePx: 42,
      lineHeight: 1.4,
      letterSpacing: 0.2,
      color: "#cfe0ff",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#ffffff", color: "#0b1026", fontFamily: "Figtree" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 88,
      shadow: { dy: 44, blur: 130, opacity: 0.5, color: "#070b1c" },
      reflection: false,
    },
    defaultLayout: "text-top",
    accent: "#2fb8a6",
    overlay: { grain: 0.05, vignette: 0.3 },
    glowRing: { color: "#7fe0d0", alpha: 0.28 },
    elements: [
      {
        id: "th-aurora-glass",
        kind: "rect",
        x: 160,
        y: 800,
        w: 1000,
        h: 2000,
        z: "under",
        locked: true,
        style: { fill: "rgba(255,255,255,0.10)", stroke: "rgba(255,255,255,0.36)", strokeW: 2, radius: 80 },
      },
      // Panelin üst kenarında ince ışık şeridi — camın kenar kırılması.
      {
        id: "th-aurora-edge",
        kind: "line",
        x: 240,
        y: 802 - 12,
        w: 840,
        h: 24,
        z: "under",
        locked: true,
        opacity: 0.7,
        style: { stroke: "rgba(255,255,255,0.7)", strokeW: 2 },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 33) GECE ALTIN — siyah kadife, kılcal altın çerçeve, Cormorant başlık,
  // italik altın alt satır; cihaz GERÇEK model, yeni "lean-back" pozunda,
  // rim ışığı + yansıma. Lüks saat reklamı dili: az şey, hepsi kusursuz.
  // Çerçeve `under` kovasında: cihaz taşan düzenlerde çerçevenin üstünden
  // geçer, çerçeve kesmez.
  // ---------------------------------------------------------------------------
  {
    id: "gece-altin",
    name: L("Gece Altın", "Night Gold"),
    background: {
      kind: "radial",
      stops: [
        ["#171310", 0],
        ["#080706", 0.62],
        ["#000000", 1],
      ],
      cx: 0.5,
      cy: 0.36,
      r: 0.95,
    },
    altBackgrounds: [
      grain(["#050505", "#15120e"], 61),
      { kind: "image", src: BG.abyss, overlayColor: "#000000", overlayAlpha: 0.62, blur: 1 },
      {
        kind: "linear",
        stops: [
          ["#0d0a07", 0],
          ["#000000", 1],
        ],
        angle: 180,
      },
      {
        kind: "shader",
        shaderId: "halo",
        colors: ["#000000", "#1a140c", "#8a6a34"],
        seed: 12,
        params: { intensity: 0.7, size: 1.2 },
      },
      { kind: "image", src: BG.marble4, overlayColor: "#000000", overlayBlend: "multiply", overlayAlpha: 0.7 },
    ],
    headline: {
      fontFamily: "Cormorant Garamond",
      weight: 600,
      sizePx: 152,
      lineHeight: 0.98,
      letterSpacing: -1,
      color: "#efe6d2",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Instrument Serif",
      weight: 400,
      style: "italic",
      sizePx: 48,
      lineHeight: 1.36,
      letterSpacing: 0.5,
      color: "#b8975a",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#b8975a", color: "#0a0806", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "real",
      camera: "lean-back",
      lightRig: "rim",
      env: "night",
      bodyColor: "#1a1714",
      shadow: true,
      reflection: true,
      float: 0.1,
      glare: 0.12,
    },
    defaultLayout: "text-top",
    accent: "#b8975a",
    overlay: {
      texture: { src: PLATE.filmGrain, blend: "soft-light", alpha: 0.2 },
      grain: 0.08,
      vignette: 0.55,
    },
    elements: [
      {
        id: "th-noir-frame",
        kind: "rect",
        x: 56,
        y: 56,
        w: 1208,
        h: 2756,
        z: "under",
        locked: true,
        opacity: 0.55,
        style: { fill: "none", stroke: "#b8975a", strokeW: 1.5, radius: 0 },
      },
      // Başlık altı kısa altın cetvel — göz için nefes, marka için imza.
      {
        id: "th-noir-rule",
        kind: "line",
        x: 600,
        y: 640,
        w: 120,
        h: 24,
        z: "under",
        locked: true,
        style: { stroke: "#b8975a", strokeW: 2 },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 34) İSVİÇRE — afiş tipografisi: kırık beyaz, siyah cetveller, tek kırmızı
  // kare, Archivo Black başlık SOLA yaslı ve versal, dönük mono yan etiket.
  // Cihaz çerçevesiz, köşe 24, gölge SERT (blur 0, ofset 28/28, tam siyah) —
  // afişteki "yapıştırılmış fotoğraf" hissi. Yan etiket `text` öğesi -90°.
  // ---------------------------------------------------------------------------
  {
    id: "isvicre",
    name: L("İsviçre", "Swiss"),
    background: { kind: "solid", color: "#f2f1ec" },
    altBackgrounds: [
      { kind: "solid", color: "#ffffff" },
      { kind: "solid", color: "#dcd9d0" },
      {
        kind: "linear",
        stops: [
          ["#f2f1ec", 0],
          ["#e3e0d6", 1],
        ],
        angle: 180,
      },
      { kind: "image", src: halftone(1), overlayColor: "#f2f1ec", overlayBlend: "multiply", overlayAlpha: 0.92 },
      { kind: "solid", color: "#f5d9d3" },
    ],
    headline: {
      fontFamily: "Archivo Black",
      weight: 400,
      sizePx: 136,
      lineHeight: 0.94,
      letterSpacing: -3,
      color: "#101010",
      align: "left",
      transform: "uppercase",
    },
    sub: {
      fontFamily: "Space Grotesk",
      weight: 500,
      sizePx: 40,
      lineHeight: 1.36,
      letterSpacing: 0,
      color: "#3a3a3a",
      align: "left",
      transform: "none",
    },
    badge: { bg: "#e3261a", color: "#ffffff", fontFamily: "Space Grotesk" },
    device: {
      mode: "2d",
      frame: "none",
      cornerRadius: 24,
      shadow: { dx: 28, dy: 28, blur: 0, opacity: 1, color: "#101010" },
      reflection: false,
    },
    defaultLayout: "split-diagonal",
    accent: "#e3261a",
    overlay: { texture: { src: PLATE.paperCold, blend: "soft-light", alpha: 0.3 } },
    elements: [
      // Üst cetvel 96'da, kırmızı kare SAĞ üstte: başlık split-diagonal'da
      // y=172'den başlıyor, sol üstteki kare "V" harfinin üstüne biniyordu.
      { id: "th-swiss-top", kind: "rect", x: 96, y: 96, w: 1128, h: 12, z: "under", locked: true, style: { fill: "#101010", radius: 0 } },
      { id: "th-swiss-red", kind: "rect", x: 1134, y: 132, w: 90, h: 90, z: "under", locked: true, style: { fill: "#e3261a", radius: 0 } },
      { id: "th-swiss-bottom", kind: "rect", x: 96, y: 2712, w: 1128, h: 4, z: "under", locked: true, style: { fill: "#101010", radius: 0 } },
      // Künye satırı alt cetvelin ALTINDA, sola yaslı. (Dönük yan etiket
      // denendi: split-diagonal'ın eğik cihazı sağ kenara kadar uzanıp
      // etiketi örtüyordu.)
      {
        id: "th-swiss-side",
        kind: "text",
        x: 96,
        y: 2740,
        w: 900,
        h: 40,
        text: "VİTRİN — 2026 — APP STORE",
        z: "under",
        locked: true,
        style: { fontFamily: "JetBrains Mono", weight: 700, sizePx: 26, letterSpacing: 6, color: "#101010", align: "left", transform: "uppercase" },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 35) TERRACOTTA — Akdeniz güneşi: kil rengi gradient, KİL gövdeli telefon
  // (kontur + clay, gövde toprak kırmızısı), yeni "top-down" pozu, gün ışığı
  // rig'i. Fraunces krem başlık, Lora italik alt satır. Beton dokusu ve gren
  // fotoğraf hissi verir; hiç foto yok, hepsi gradient.
  // ---------------------------------------------------------------------------
  {
    id: "terracotta",
    name: "Terracotta",
    background: {
      kind: "linear",
      stops: [
        ["#e9b48f", 0],
        ["#c8664a", 0.55],
        ["#8f3c2b", 1],
      ],
      angle: 160,
    },
    altBackgrounds: [
      {
        kind: "radial",
        stops: [
          ["#f4c9a3", 0],
          ["#d9805a", 0.5],
          ["#a04a33", 1],
        ],
        cx: 0.3,
        cy: 0.2,
        r: 1.0,
      },
      { kind: "image", src: BG.sand, overlayColor: "#c8664a", overlayBlend: "multiply", overlayAlpha: 0.6 },
      {
        kind: "shader",
        shaderId: "halo",
        colors: ["#8f3c2b", "#d9805a", "#f6d3ad"],
        seed: 5,
        params: { intensity: 1.0, size: 1.3 },
      },
      { kind: "solid", color: "#d27a57" },
      { kind: "image", src: granular(3), overlayColor: "#b3543a", overlayBlend: "multiply", overlayAlpha: 0.45 },
      {
        kind: "linear",
        stops: [
          ["#f0c9a8", 0],
          ["#e08c64", 1],
        ],
        angle: 200,
      },
    ],
    headline: {
      fontFamily: "Fraunces",
      weight: 600,
      sizePx: 134,
      lineHeight: 1.0,
      letterSpacing: -2,
      color: "#fff5ea",
      align: "center",
      transform: "none",
    },
    sub: {
      fontFamily: "Lora",
      weight: 400,
      style: "italic",
      sizePx: 44,
      lineHeight: 1.4,
      letterSpacing: 0.2,
      color: "#ffe1c6",
      align: "center",
      transform: "none",
    },
    badge: { bg: "#fff5ea", color: "#8f3c2b", fontFamily: "Instrument Sans" },
    device: {
      mode: "3d",
      model: "kontur",
      finish: "clay",
      camera: "top-down",
      lightRig: "daylight",
      bodyColor: "#a24c34",
      shadow: true,
      reflection: false,
      float: 0.12,
      konturDepth: 0.7,
      island: false,
    },
    defaultLayout: "text-top",
    accent: "#ffb27a",
    overlay: {
      texture: { src: PLATE.concrete, blend: "soft-light", alpha: 0.18 },
      grain: 0.09,
      vignette: 0.25,
    },
  },

  // ===========================================================================
  // R14 — 3D GLASS (2026). Ortak fikir: cam artık gerçek — `glass` öğesi
  // arkasını bulanıklaştırır, renk katar, kenarı ışıkla çizer. Üç tema üç
  // sıcaklık: koyu sıvı cam, açık buz cam, Klein mavisi blur.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 39) SIVI CAM — koyu indigo→camgöbeği aurora üstünde büyük kart camı,
  // cihaz camın üstünde yüzer; sol üstte küçük cam çip. Sora başlık.
  // Cihaz çerçevesiz (köşe 88), gölge derin indigo — cam üstünde "kalkık" hissi.
  // ---------------------------------------------------------------------------
  {
    id: "sivi-cam",
    name: L("Sıvı Cam", "Liquid Glass"),
    background: {
      kind: "shader",
      shaderId: "aurora",
      colors: ["#070b1e", "#1b2a6b", "#1fb9a5", "#8a5cf5"],
      seed: 31,
      params: { intensity: 1.3, softness: 1.5 },
    },
    altBackgrounds: [
      { kind: "shader", shaderId: "aurora", colors: ["#050916", "#2b1e6b", "#f06fa4", "#3ad1c9"], seed: 12, params: { intensity: 1.15, softness: 1.9 } },
      { kind: "shader", shaderId: "metaball", colors: ["#070b1e", "#1b2a6b", "#22c6b0", "#b07cff"], seed: 4, params: { softness: 2.2, scale: 1.1 } },
      { kind: "image", src: TEX.ice, overlayColor: "#070b1e", overlayAlpha: 0.5, blur: 18 },
      { kind: "shader", shaderId: "bokeh", colors: ["#05081a", "#1b2a6b", "#3ad1c9", "#ffffff"], seed: 8, params: { intensity: 1.1, size: 1.5 } },
      { kind: "image", src: TEX.prism, overlayColor: "#0a0f2a", overlayAlpha: 0.55, blur: 24 },
      { kind: "mesh", colors: ["#070b1e", "#1b2a6b", "#1fb9a5", "#8a5cf5"], seed: 19 },
    ],
    headline: { fontFamily: "Sora", weight: 700, sizePx: 120, lineHeight: 1.04, letterSpacing: -2.5, color: "#ffffff", align: "center", transform: "none" },
    sub: { fontFamily: "Figtree", weight: 500, sizePx: 42, lineHeight: 1.4, letterSpacing: 0.2, color: "#d3e2ff", align: "center", transform: "none" },
    badge: { bg: "#ffffff", color: "#0b1026", fontFamily: "Figtree" },
    device: { mode: "2d", frame: "none", cornerRadius: 88, shadow: { dy: 48, blur: 140, opacity: 0.55, color: "#05081a" }, reflection: false },
    defaultLayout: "text-top",
    accent: "#3ad1c9",
    overlay: { grain: 0.04, vignette: 0.3 },
    glowRing: { color: "#7fe0d0", alpha: 0.25 },
    elements: [
      // Kart 60..1260: tek cihazı da (224..1096) duo düzenlerdeki ikinci
      // cihazı da içine alır. (Sol üst "çip" denendi: rozetle çakışıp gri bir
      // leke gibi duruyordu, çıkarıldı.)
      { id: "th-lg-card", kind: "glass", x: 60, y: 790, w: 1200, h: 2010, z: "under", locked: true, style: { radius: 96, blur: 40, tintAlpha: 0.10, highlight: 0.7, stroke: "rgba(255,255,255,0.42)" } },
    ],
  },

  // ---------------------------------------------------------------------------
  // 40) BUZ CAM — AÇIK glassmorphism (iOS 26 açık tema dili): pastel şeftali/
  // leylak/nane mesh, BEYAZ buzlu cam kart (tint 0.42), mürekkep başlık.
  // Cihaz çerçevesiz, yumuşak gölge — kart üstünde nazik "kalkma".
  // ---------------------------------------------------------------------------
  {
    id: "buz-cam",
    name: L("Buz Cam", "Ice Glass"),
    background: { kind: "mesh", colors: ["#ffd9c7", "#dcd6ff", "#c9f3e6", "#fff3d6"], seed: 14 },
    altBackgrounds: [
      { kind: "mesh", colors: ["#ffe1d6", "#d8e8ff", "#e6d6ff", "#ffffff"], seed: 3 },
      { kind: "shader", shaderId: "aurora", colors: ["#f6f1ff", "#ffd3c4", "#bfe9dc", "#c9c4ff"], seed: 27, params: { intensity: 0.9, softness: 2.4 } },
      { kind: "image", src: granular(5), overlayColor: "#ffffff", overlayAlpha: 0.35, blur: 26 },
      { kind: "mesh", colors: ["#c9f3e6", "#dff5ff", "#fff3d6", "#f7e6ff"], seed: 9 },
      { kind: "shader", shaderId: "bokeh", colors: ["#f8f5ff", "#ffd9c7", "#dcd6ff", "#ffffff"], seed: 6, params: { intensity: 0.8, size: 1.6 } },
      { kind: "solid", color: "#f3f1fb" },
    ],
    headline: { fontFamily: "Instrument Sans", weight: 700, sizePx: 124, lineHeight: 1.02, letterSpacing: -3.5, color: "#1b1b2f", align: "center", transform: "none" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 42, lineHeight: 1.4, letterSpacing: 0, color: "#5a5a72", align: "center", transform: "none" },
    badge: { bg: "#1b1b2f", color: "#ffffff", fontFamily: "Instrument Sans" },
    device: { mode: "2d", frame: "none", cornerRadius: 80, shadow: { dy: 36, blur: 110, opacity: 0.22, color: "#3a2f5a" }, reflection: false },
    defaultLayout: "text-top",
    accent: "#ff9a7a",
    overlay: { grain: 0.025 },
    elements: [
      // Alt "hap" denendi: cihaz 2753'e kadar iniyor, hap altına giriyordu — çıkarıldı.
      { id: "th-fr-card", kind: "glass", x: 60, y: 790, w: 1200, h: 2010, z: "under", locked: true, style: { radius: 96, blur: 34, tint: "#ffffff", tintAlpha: 0.42, highlight: 0.5, stroke: "rgba(255,255,255,0.85)" } },
    ],
  },

  // ---------------------------------------------------------------------------
  // 41) KLEIN BLUR — International Klein Blue (#002FA7) tam alan, üstünde
  // bulanık ışık lekeleri (metaball), cam kart Klein'ı biraz açar. Beyaz
  // versal Instrument Sans (DO IT akrabası ama yumuşak). Cihaz gerçek model,
  // yaslanmış poz, gümüş gövde — mavi camda parlar.
  // ---------------------------------------------------------------------------
  {
    id: "klein-blur",
    name: "Klein Blur",
    background: {
      kind: "shader",
      shaderId: "metaball",
      colors: ["#001f7a", "#002FA7", "#2e5cff", "#9dbbff"],
      seed: 17,
      params: { softness: 2.6, scale: 0.9 },
    },
    altBackgrounds: [
      { kind: "shader", shaderId: "metaball", colors: ["#00196b", "#002FA7", "#4d74ff", "#dfe8ff"], seed: 41, params: { softness: 3.0, scale: 1.2 } },
      { kind: "shader", shaderId: "bokeh", colors: ["#001a6e", "#002FA7", "#4d74ff", "#ffffff"], seed: 23, params: { intensity: 1.0, size: 1.7 } },
      {
        kind: "radial",
        stops: [
          ["#2e5cff", 0],
          ["#002FA7", 0.55],
          ["#00196b", 1],
        ],
        cx: 0.5,
        cy: 0.32,
        r: 0.95,
      },
      { kind: "image", src: grad(7), overlayColor: "#002FA7", overlayBlend: "multiply", overlayAlpha: 0.85, blur: 10 },
      { kind: "solid", color: "#002FA7" },
      { kind: "shader", shaderId: "aurora", colors: ["#001a6e", "#002FA7", "#4d74ff", "#c6ff3a"], seed: 5, params: { intensity: 0.9, softness: 2.2 } },
    ],
    headline: { fontFamily: "Instrument Sans", weight: 700, sizePx: 136, lineHeight: 0.96, letterSpacing: -4, color: "#FFFFFF", align: "center", transform: "uppercase" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 38, lineHeight: 1.35, letterSpacing: 2.5, color: "#dfe8ff", align: "center", transform: "uppercase" },
    badge: { bg: "#FFFFFF", color: "#002FA7", fontFamily: "Instrument Sans" },
    device: { mode: "3d", model: "real", camera: "lean-back", lightRig: "studio", env: "studio", bodyColor: "#cfd6e6", shadow: true, reflection: true, float: 0.12, glare: 0.2 },
    defaultLayout: "text-top",
    accent: "#9dbbff",
    overlay: { grain: 0.05, vignette: 0.25 },
    glowRing: { color: "#9dbbff", alpha: 0.3 },
    elements: [
      { id: "th-kb-card", kind: "glass", x: 60, y: 780, w: 1200, h: 2030, z: "under", locked: true, style: { radius: 90, blur: 44, tint: "#ffffff", tintAlpha: 0.10, highlight: 0.7, stroke: "rgba(255,255,255,0.45)" } },
    ],
  },

  // ===========================================================================
  // R15 — iPAD TEMALARI. Bu temalar iPad tuvali (1548×2064 portre / 2064×1548
  // yatay) için kurgulandı: fotoğraf zeminleri 4:3, pozlar tablet gövdesine
  // göre, tip ölçüleri geniş tuvale göre. iPhone'da da çalışır ama iPad'de
  // tasarlandığı gibi durur. Tema öğesi KULLANILMAZ (iki yönde de doğru
  // duracak sabit koordinat yok); karakter zemin + poz + tipten gelir.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 42) iPAD · MASA — meşe masa üstten çekim (Wiro), iPad üstten diyagonal
  // pozda masada duruyor; gümüş gövde, gün ışığı rig'i. Mürekkep-kahve serif.
  // ---------------------------------------------------------------------------
  {
    id: "ipad-masa",
    name: L("iPad · Masa", "iPad · Desk"),
    background: { kind: "image", src: "/assets/brand/ipad/desk.png", overlayColor: "#fff3e0", overlayBlend: "soft-light", overlayAlpha: 0.25 },
    altBackgrounds: [
      { kind: "image", src: "/assets/brand/ipad/desk.png", overlayColor: "#3a2a18", overlayBlend: "multiply", overlayAlpha: 0.18 },
      { kind: "image", src: "/assets/brand/ipad/desk.png", blur: 10, overlayColor: "#fffaf2", overlayAlpha: 0.3 },
      { kind: "image", src: "/assets/brand/ipad/studio.png", overlayColor: "#f3e7d6", overlayBlend: "multiply", overlayAlpha: 0.5 },
      { kind: "solid", color: "#efe4d2" },
      { kind: "linear", stops: [["#f6ecdd", 0], ["#d9c3a5", 1]], angle: 165 },
    ],
    headline: { fontFamily: "Fraunces", weight: 600, sizePx: 120, lineHeight: 1.02, letterSpacing: -2, color: "#2a2118", align: "center", transform: "none" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 38, lineHeight: 1.4, letterSpacing: 0.5, color: "#6b5a46", align: "center", transform: "none" },
    badge: { bg: "#2a2118", color: "#fff5e6", fontFamily: "Instrument Sans" },
    device: { mode: "3d", model: "real", camera: "top-down", lightRig: "daylight", env: "soft", bodyColor: "#d6d9df", shadow: true, reflection: false, float: 0.02, glare: 0.08 },
    defaultLayout: "text-top",
    accent: "#b8834a",
    overlay: { grain: 0.03, vignette: 0.12 },
  },

  // ---------------------------------------------------------------------------
  // 43) iPAD · STÜDYO — dikişsiz beyaz fon (Wiro), 3/4 duran iPad, yansıma;
  // Apple ürün çekimi dili. Instrument Sans 700 mürekkep, gri alt satır.
  // ---------------------------------------------------------------------------
  {
    id: "ipad-studyo",
    name: L("iPad · Stüdyo", "iPad · Studio"),
    background: { kind: "image", src: "/assets/brand/ipad/studio.png" },
    altBackgrounds: [
      { kind: "image", src: "/assets/brand/ipad/studio.png", overlayColor: "#ffffff", overlayAlpha: 0.3 },
      { kind: "linear", stops: [["#f8f9fc", 0], ["#dce3ed", 1]], angle: 155 },
      { kind: "linear", stops: [["#ffffff", 0], ["#e6e6ea", 1]], angle: 180 },
      { kind: "solid", color: "#f2f2f4" },
      { kind: "radial", stops: [["#ffffff", 0], ["#dcdde2", 1]], cx: 0.35, cy: 0.3, r: 1.1 },
    ],
    headline: { fontFamily: "Instrument Sans", weight: 700, sizePx: 118, lineHeight: 1.02, letterSpacing: -3.5, color: "#141418", align: "center", transform: "none" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 38, lineHeight: 1.4, letterSpacing: 0, color: "#6e6e78", align: "center", transform: "none" },
    badge: { bg: "#141418", color: "#ffffff", fontFamily: "Instrument Sans" },
    device: { mode: "3d", model: "real", camera: "three-quarter", lightRig: "studio", env: "studio", bodyColor: "#cfd3da", shadow: true, reflection: true, float: 0.06, glare: 0.14 },
    defaultLayout: "text-top",
    accent: "#141418",
    overlay: { grain: 0.02 },
  },

  // ---------------------------------------------------------------------------
  // 44) iPAD · CAM — koyu aurora, iPad yüzüyor (float 0.2), camgöbeği hale;
  // çerçevesiz cihazın yerine gerçek gövde (kenar ışığı derinlik verir).
  // ---------------------------------------------------------------------------
  {
    id: "ipad-cam",
    name: L("iPad · Cam", "iPad · Glass"),
    background: { kind: "shader", shaderId: "aurora", colors: ["#060a1c", "#182a63", "#22b8a4", "#7a5cf0"], seed: 44, params: { intensity: 1.2, softness: 1.7 } },
    altBackgrounds: [
      { kind: "shader", shaderId: "metaball", colors: ["#060a1c", "#182a63", "#2ad0bb", "#a37cff"], seed: 3, params: { softness: 2.4, scale: 1.0 } },
      { kind: "shader", shaderId: "bokeh", colors: ["#04071a", "#182a63", "#3ad1c9", "#ffffff"], seed: 9, params: { intensity: 1.0, size: 1.6 } },
      { kind: "image", src: TEX.ice, overlayColor: "#060a1c", overlayAlpha: 0.5, blur: 16 },
      { kind: "mesh", colors: ["#060a1c", "#182a63", "#22b8a4", "#7a5cf0"], seed: 21 },
      { kind: "radial", stops: [["#1c2f6e", 0], ["#0a1030", 0.6], ["#04071a", 1]], cx: 0.5, cy: 0.4, r: 1.0 },
    ],
    headline: { fontFamily: "Sora", weight: 700, sizePx: 118, lineHeight: 1.04, letterSpacing: -2.5, color: "#ffffff", align: "center", transform: "none" },
    sub: { fontFamily: "Figtree", weight: 500, sizePx: 40, lineHeight: 1.4, letterSpacing: 0.2, color: "#cfe0ff", align: "center", transform: "none" },
    badge: { bg: "#ffffff", color: "#0b1026", fontFamily: "Figtree" },
    device: { mode: "3d", model: "real", camera: "lean-back", lightRig: "rim", env: "night", bodyColor: "#20242e", shadow: true, reflection: true, float: 0.2, glare: 0.2 },
    defaultLayout: "text-top",
    accent: "#3ad1c9",
    overlay: { grain: 0.05, vignette: 0.35 },
    glowRing: { color: "#7fe0d0", alpha: 0.3 },
  },

  // ---------------------------------------------------------------------------
  // 45) iPAD · EDİTORYAL — kâğıt beyazı, DM Serif sola yaslı başlık (wide-left
  // sütunu), çerçevesiz 2D ekran (iPad'de bezel zaten ince), yumuşak gölge.
  // ---------------------------------------------------------------------------
  {
    id: "ipad-editoryal",
    name: L("iPad · Editoryal", "iPad · Editorial"),
    background: { kind: "solid", color: "#f5f2ec" },
    altBackgrounds: [
      { kind: "solid", color: "#ffffff" },
      { kind: "image", src: halftone(2), overlayColor: "#f5f2ec", overlayBlend: "multiply", overlayAlpha: 0.9 },
      { kind: "linear", stops: [["#f7f4ee", 0], ["#e8e2d6", 1]], angle: 160 },
      { kind: "solid", color: "#ebe6dc" },
      { kind: "solid", color: "#e6ded0" },
    ],
    headline: { fontFamily: "DM Serif Display", weight: 400, sizePx: 124, lineHeight: 1.0, letterSpacing: -1.5, color: "#1c1a16", align: "left", transform: "none" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 36, lineHeight: 1.45, letterSpacing: 0.3, color: "#6d675c", align: "left", transform: "none" },
    badge: { bg: "#1c1a16", color: "#f5f2ec", fontFamily: "Instrument Sans" },
    device: { mode: "2d", frame: "none", cornerRadius: 60, shadow: { dy: 24, blur: 70, opacity: 0.2, color: "#2a2418" }, reflection: false },
    defaultLayout: "wide-left",
    accent: "#c8553d",
    overlay: { texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.4 }, grain: 0.03 },
  },

  // ---------------------------------------------------------------------------
  // 46) iPAD · GECE — lacivert→siyah, yaslanmış iPad, altın alt satır;
  // gece okuma / meditasyon uygulamaları.
  // ---------------------------------------------------------------------------
  {
    id: "ipad-gece",
    name: L("iPad · Gece", "iPad · Night"),
    background: { kind: "radial", stops: [["#16233b", 0], ["#0b1220", 0.6], ["#050810", 1]], cx: 0.5, cy: 0.35, r: 1.0 },
    altBackgrounds: [
      grain(["#050810", "#0e1626"], 71),
      { kind: "shader", shaderId: "bokeh", colors: ["#050810", "#16233b", "#e8b84b"], seed: 33, params: { intensity: 0.8, size: 1.2 } },
      { kind: "image", src: BG.midnight, overlayColor: "#050810", overlayAlpha: 0.55, blur: 2 },
      { kind: "linear", stops: [["#101a2e", 0], ["#050810", 1]], angle: 180 },
      { kind: "solid", color: "#0b1220" },
    ],
    headline: { fontFamily: "Cormorant Garamond", weight: 600, sizePx: 140, lineHeight: 0.98, letterSpacing: -1, color: "#f3ead6", align: "center", transform: "none" },
    sub: { fontFamily: "Instrument Serif", weight: 400, style: "italic", sizePx: 44, lineHeight: 1.36, letterSpacing: 0.4, color: "#c9a962", align: "center", transform: "none" },
    badge: { bg: "#c9a962", color: "#0b1220", fontFamily: "Instrument Sans" },
    device: { mode: "3d", model: "real", camera: "lean-back", lightRig: "rim", env: "night", bodyColor: "#1a1d26", shadow: true, reflection: true, float: 0.1, glare: 0.1 },
    defaultLayout: "text-top",
    accent: "#c9a962",
    overlay: { grain: 0.07, vignette: 0.5 },
  },
  // Tablet-first productivity: restrained surfaces keep dense dashboard UI
  // readable, with a consistent flat device language across paired screens.
  {
    id: "ipad-workspace",
    name: L("iPad · Çalışma alanı", "iPad · Workspace"),
    background: { kind: "solid", color: "#edf2f8" },
    altBackgrounds: [
      { kind: "linear", stops: [["#f7faff", 0], ["#dce7f5", 1]], angle: 150 },
      { kind: "solid", color: "#e6eee9" },
      { kind: "solid", color: "#f5f1e8" },
    ],
    headline: { fontFamily: "Instrument Sans", weight: 700, sizePx: 106, lineHeight: 1.08, letterSpacing: -2, color: "#172638", align: "left", transform: "none" },
    sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 36, lineHeight: 1.4, letterSpacing: 0, color: "#4b6075", align: "left", transform: "none" },
    badge: { bg: "#245fca", color: "#ffffff", fontFamily: "Instrument Sans" },
    device: { mode: "2d", frame: "none", shadow: { dy: 16, blur: 48, opacity: 0.16, color: "#203750" }, reflection: false },
    defaultLayout: "wide-left",
    accent: "#245fca",
    overlay: { grain: 0.025 },
  },
  // Cross-format families: the project supplies device kind and its real GLB.
  // No fixed-coordinate decorations, so portrait and landscape share the art direction.
  {
    id: "glacier-studio",
    name: "Glacier Studio",
    background: { kind: "radial", stops: [["#ffffff", 0], ["#e8f3f6", 0.58], ["#c5dce7", 1]], cx: 0.38, cy: 0.36, r: 1.05 },
    altBackgrounds: [
      { kind: "linear", stops: [["#f4fafb", 0], ["#d3e5ed", 1]], angle: 145 },
      { kind: "radial", stops: [["#ffffff", 0], ["#dae9f0", 1]], cx: 0.7, cy: 0.5, r: 1.1 },
    ],
    headline: { fontFamily: "Plus Jakarta Sans", weight: 700, sizePx: 108, lineHeight: 1.06, letterSpacing: -3, color: "#142d3c", align: "center", transform: "none" },
    sub: { fontFamily: "DM Sans", weight: 400, sizePx: 36, lineHeight: 1.4, letterSpacing: 0, color: "#456272", align: "center", transform: "none" },
    badge: { bg: "#195a72", color: "#ffffff", fontFamily: "DM Sans" },
    device: { mode: "3d", model: "real", camera: "hero-right", lightRig: "softbox", env: "soft", bodyColor: "#cbd7df", lightWarmth: -0.12, shadow: true, reflection: false, float: 0.04, glare: 0.06 },
    defaultLayout: "text-top",
    accent: "#195a72",
    overlay: { grain: 0.025 },
  },
  {
    id: "midnight-graphite",
    name: "Midnight Graphite",
    background: { kind: "radial", stops: [["#303e50", 0], ["#151b24", 0.58], ["#0b0e14", 1]], cx: 0.62, cy: 0.56, r: 0.95 },
    altBackgrounds: [
      { kind: "linear", stops: [["#252e3a", 0], ["#10151d", 0.65], ["#0b0e14", 1]], angle: 155 },
      { kind: "radial", stops: [["#354657", 0], ["#18212c", 0.5], ["#0d1118", 1]], cx: 0.3, cy: 0.6, r: 1.05 },
    ],
    headline: { fontFamily: "Onest", weight: 700, sizePx: 112, lineHeight: 1.04, letterSpacing: -3, color: "#f3f6fa", align: "center", transform: "none" },
    sub: { fontFamily: "DM Sans", weight: 400, sizePx: 36, lineHeight: 1.4, letterSpacing: 0.2, color: "#b6c3d2", align: "center", transform: "none" },
    badge: { bg: "#b5d4f2", color: "#142130", fontFamily: "Onest" },
    device: { mode: "3d", model: "real", camera: "hero-left", lightRig: "rim", env: "night", bodyColor: "#303640", lightIntensity: 1.15, lightWarmth: -0.15, shadow: true, reflection: false, float: 0.06, glare: 0.05 },
    defaultLayout: "text-top",
    accent: "#b5d4f2",
    overlay: { grain: 0.04, vignette: 0.14 },
  },
  {
    id: "warm-editorial",
    name: "Warm Editorial",
    background: { kind: "linear", stops: [["#faf4e9", 0], ["#eee1cf", 1]], angle: 165 },
    altBackgrounds: [
      { kind: "solid", color: "#f5eee2" },
      { kind: "radial", stops: [["#fffaf0", 0], ["#e6d7c2", 1]], cx: 0.6, cy: 0.45, r: 1.15 },
    ],
    headline: { fontFamily: "Newsreader", weight: 600, sizePx: 118, lineHeight: 1.06, letterSpacing: -1.8, color: "#33281f", align: "left", transform: "none" },
    sub: { fontFamily: "DM Sans", weight: 400, sizePx: 36, lineHeight: 1.42, letterSpacing: 0.2, color: "#6b5746", align: "left", transform: "none" },
    badge: { bg: "#93492f", color: "#fff8ef", fontFamily: "DM Sans" },
    device: { mode: "3d", model: "real", camera: "hero-right", lightRig: "daylight", env: "soft", bodyColor: "#c9beb0", lightWarmth: 0.2, shadow: true, reflection: false, float: 0.02, glare: 0.04 },
    defaultLayout: "wide-left",
    accent: "#93492f",
    overlay: { texture: { src: PLATE.paperFiber, blend: "soft-light", alpha: 0.22 }, grain: 0.025 },
  },
];

LEGACY_THEMES.push(...privateLegacyThemes({ halftone, grad, grain, PLATE, BG }));

// Retired directions are removed from all pickers. The lookup still reads
// saved projects so opening an old set cannot silently change its artwork.
const CURATED_IDS = new Set(["clean-light", "sage-calm", "ipad-workspace", "glacier-studio", ...PRIVATE_CURATED_THEME_IDS]);
export const THEMES: Theme[] = [...BRAND_THEMES, ...COLLECTION_THEMES, ...LEGACY_THEMES.filter(t => CURATED_IDS.has(t.id))];

/** Unknown IDs use the generic collection, independently of gallery order. */
export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? LEGACY_THEMES.find(t => t.id === id) ?? THEMES.find(t=>t.id==="solstice") ?? THEMES[0];
}
