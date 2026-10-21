// Küratörlü premium arka plan paletleri — WP-F.
//
// Her palet doğrudan bir `Background` nesnesidir; galeriden tıklanınca slaytın
// `background` override'ına aynen yazılır. Renkler App Store vitrini için
// seçildi: telefon mockup'ı önde durduğundan zeminler orta-koyu bantta,
// luminans rampaları yumuşak, orta tonlar çamurlanmayacak şekilde ayarlı.
//
// Kind dağılımı bilinçli: linear/radial (temiz, hızlı, banding'i dither ile
// kırılmış), mesh (yumuşak blob kompozisyonu), shader (WebGL, deterministik).
//
// Shader renk sırası konvansiyonu (bkz. engine/shaders.ts):
//   aurora   c0 = gece zemini, c1..c3 = perde renkleri
//   silk     c0..c3 = rampa (koyu → açık ya da renk hikâyesi)
//   grain    c0 = üst, c1 = alt, c2 = üst ışık yıkaması, c3 = alt gölge tonu
//   metaball c0 = zemin, c1..c3 = blob renkleri
//   waves    c0 = zemin, c1..c3 = şerit renkleri
//   halo     c0 = neredeyse siyah zemin, c1 = halka, c2 = glow, c3 = ikinci hale
//   marble   c0/c1 = taban beneği, c2 = ara ton, c3 = damar
//   rays     c0 = zemin, c1 = ışın, c2 = çekirdek, c3 = geniş hare
//   prism    c0..c3 = dört renk çapası (kenarsız mesh gradyan)
//   grid     c0 = zemin, c1 = üst rampa, c2 = ızgara çizgisi, c3 = merkez hale
//   bokeh    c0 = zemin, c1..c3 = odak dışı disk renkleri

import type { Background } from "./types";
import { L } from "@/lib/i18n";

export type PaletteCategory =
  | "pastel"
  | "koyu-lüks"
  | "neon"
  | "günbatımı"
  | "mono"
  | "canlı";

export type Palette = {
  id: string;
  name: string;
  category: PaletteCategory;
  background: Background;
};

export const PALETTE_CATEGORIES: { id: PaletteCategory; label: string }[] = [
  { id: "koyu-lüks", label: L("Koyu lüks", "Dark luxe") },
  { id: "günbatımı", label: L("Günbatımı", "Sunset") },
  { id: "canlı", label: L("Canlı", "Vivid") },
  { id: "neon", label: "Neon" },
  { id: "pastel", label: "Pastel" },
  { id: "mono", label: "Mono" },
];

export const PALETTES: Palette[] = [
  // ===========================================================================
  // PASTEL — açık, yumuşak, iOS pazarlama sayfası hissi.
  // Koyu metin ister; cihaz gölgesi bu zeminlerde çok iyi oturur.
  // ===========================================================================
  {
    id: "pastel-sis",
    name: L("Sabah Sisi", "Morning Mist"),
    category: "pastel",
    background: {
      kind: "linear",
      angle: 168,
      stops: [
        ["#f5f8fc", 0],
        ["#e7effa", 0.42],
        ["#d3e3f3", 0.74],
        ["#bcd2e9", 1],
      ],
    },
  },
  {
    id: "pastel-seftali",
    name: L("Şeftali Kreması", "Peach Cream"),
    category: "pastel",
    background: {
      kind: "linear",
      angle: 158,
      stops: [
        ["#fff4ea", 0],
        ["#ffe0d1", 0.4],
        ["#fbc5b7", 0.74],
        ["#f0a89f", 1],
      ],
    },
  },
  {
    id: "pastel-nane",
    name: L("Nane Buzu", "Mint Ice"),
    category: "pastel",
    background: {
      kind: "radial",
      cx: 0.5,
      cy: 0.3,
      r: 1.0,
      stops: [
        ["#f1fbf6", 0],
        ["#d7f0e6", 0.45],
        ["#b7ddd0", 0.78],
        ["#9dc9bd", 1],
      ],
    },
  },
  {
    id: "pastel-leylak",
    name: L("Leylak Rüyası", "Lilac Dream"),
    category: "pastel",
    background: {
      kind: "shader",
      shaderId: "silk",
      colors: ["#efeafc", "#e0d5f7", "#c9b8ef", "#f8f2ff"],
      seed: 21,
      params: { sheen: 0.55, scale: 0.7 },
    },
  },
  {
    id: "pastel-tozpembe",
    name: L("Toz Pembe", "Dusty Pink"),
    category: "pastel",
    background: {
      kind: "radial",
      cx: 0.48,
      cy: 0.26,
      r: 1.05,
      stops: [
        ["#fdf2f5", 0],
        ["#f7dde6", 0.42],
        ["#e8c2d4", 0.75],
        ["#d3a9c2", 1],
      ],
    },
  },

  // ===========================================================================
  // KOYU LÜKS — derin zemin + tek değerli metal vurgusu.
  // Beyaz/krem başlıkla en yüksek kontrastı veren aile.
  // ===========================================================================
  {
    id: "lux-obsidyen",
    name: L("Obsidyen & Altın", "Obsidian & Gold"),
    category: "koyu-lüks",
    background: {
      kind: "shader",
      shaderId: "halo",
      colors: ["#08080b", "#d8b45a", "#8a6a22", "#241c10"],
      seed: 11,
      params: { intensity: 0.8, size: 1.05 },
    },
  },
  {
    id: "lux-zumrut",
    name: L("Zümrüt Kasa", "Emerald Vault"),
    category: "koyu-lüks",
    background: {
      kind: "radial",
      cx: 0.5,
      cy: 0.3,
      r: 1.05,
      stops: [
        ["#12785e", 0],
        ["#0a4436", 0.45],
        ["#052018", 0.78],
        ["#020c09", 1],
      ],
    },
  },
  {
    id: "lux-bordo",
    name: L("Bordo Kadife", "Burgundy Velvet"),
    category: "koyu-lüks",
    background: {
      kind: "linear",
      angle: 165,
      stops: [
        ["#5c1730", 0],
        ["#390d20", 0.42],
        ["#1c0512", 0.74],
        ["#0a0208", 1],
      ],
    },
  },
  {
    id: "lux-pirinc",
    name: L("Gece Pirinci", "Night Brass"),
    category: "koyu-lüks",
    background: {
      kind: "shader",
      shaderId: "rays",
      colors: ["#05070e", "#b28c43", "#f0d79a", "#1b1c33"],
      seed: 5,
      params: { intensity: 0.5, count: 0.75 },
    },
  },
  {
    id: "lux-sampanya",
    name: L("Grafit & Şampanya", "Graphite & Champagne"),
    category: "koyu-lüks",
    background: {
      kind: "linear",
      angle: 158,
      stops: [
        ["#3b362d", 0],
        ["#24242b", 0.38],
        ["#14141a", 0.72],
        ["#08080b", 1],
      ],
    },
  },
  {
    id: "lux-mermer",
    name: L("Siyah Mermer", "Black Marble"),
    category: "koyu-lüks",
    background: {
      kind: "shader",
      shaderId: "marble",
      colors: ["#0b0b0e", "#1b1c22", "#2b2c35", "#c9a227"],
      seed: 7,
      params: { veins: 0.28, scale: 0.9 },
    },
  },
  {
    id: "lux-safir",
    name: L("Safir Salonu", "Sapphire Lounge"),
    category: "koyu-lüks",
    background: {
      kind: "shader",
      shaderId: "halo",
      colors: ["#04060f", "#3462d8", "#8fb4ff", "#0e1c3c"],
      seed: 29,
      params: { intensity: 0.75, size: 1.2 },
    },
  },

  // ===========================================================================
  // NEON — gece zemininde doygun ışık. Cihaz konturu bu zeminlerde parlar.
  // ===========================================================================
  {
    id: "neon-siber",
    name: L("Siber Mor", "Cyber Purple"),
    category: "neon",
    background: {
      kind: "shader",
      shaderId: "aurora",
      colors: ["#07061a", "#4c1d95", "#a855f7", "#22d3ee"],
      seed: 13,
      params: { intensity: 1.05, softness: 1.25 },
    },
  },
  {
    id: "neon-tokyo",
    name: L("Tokyo Gecesi", "Tokyo Night"),
    category: "neon",
    background: {
      kind: "linear",
      angle: 162,
      stops: [
        ["#150826", 0],
        ["#3d1268", 0.38],
        ["#8a1d70", 0.72],
        ["#e0357c", 1],
      ],
    },
  },
  {
    id: "neon-limon",
    name: L("Elektrik Limon", "Electric Lemon"),
    category: "neon",
    background: {
      kind: "shader",
      shaderId: "waves",
      colors: ["#07120c", "#12492a", "#5fe08a", "#d9f99d"],
      seed: 8,
      params: { intensity: 0.85, freq: 0.8 },
    },
  },
  {
    id: "neon-magenta",
    name: L("Magenta Hale", "Magenta Halo"),
    category: "neon",
    background: {
      kind: "shader",
      shaderId: "halo",
      colors: ["#0a0410", "#ff2d95", "#ff9ad2", "#4a0f6e"],
      seed: 23,
      params: { intensity: 0.9, size: 0.95 },
    },
  },
  {
    id: "neon-buz",
    name: L("Buz Neon", "Ice Neon"),
    category: "neon",
    background: {
      kind: "radial",
      cx: 0.5,
      cy: 0.3,
      r: 0.95,
      stops: [
        ["#4ae0f2", 0],
        ["#127c9c", 0.36],
        ["#07293f", 0.72],
        ["#030b14", 1],
      ],
    },
  },

  // ===========================================================================
  // GÜNBATIMI — sıcak → soğuk geçişler. Orta ton çamurlanmasın diye
  // ara duraklar el ile konumlandırıldı.
  // ===========================================================================
  {
    id: "sunset-kum",
    name: L("Kum Günbatımı", "Sand Sunset"),
    category: "günbatımı",
    background: {
      kind: "linear",
      angle: 170,
      stops: [
        ["#f7c977", 0],
        ["#e2795f", 0.36],
        ["#8e3a6b", 0.7],
        ["#2b1140", 1],
      ],
    },
  },
  {
    id: "sunset-kor",
    name: L("Kor", "Ember"),
    category: "günbatımı",
    background: {
      kind: "shader",
      shaderId: "rays",
      colors: ["#150409", "#8a1f1f", "#f97316", "#fcd34d"],
      seed: 4,
      params: { intensity: 0.7, count: 0.7 },
    },
  },
  {
    id: "sunset-pasifik",
    name: L("Pasifik Akşamı", "Pacific Evening"),
    category: "günbatımı",
    background: {
      kind: "linear",
      angle: 174,
      stops: [
        ["#fbcb8b", 0],
        ["#ec7357", 0.32],
        ["#5d5f9c", 0.68],
        ["#0f2a44", 1],
      ],
    },
  },
  {
    id: "sunset-altin-saat",
    name: L("Altın Saat", "Golden Hour"),
    category: "günbatımı",
    background: {
      kind: "radial",
      cx: 0.5,
      cy: 0.24,
      r: 1.1,
      stops: [
        ["#ffd28a", 0],
        ["#e08b4e", 0.32],
        ["#8b3d43", 0.66],
        ["#25101d", 1],
      ],
    },
  },
  {
    id: "sunset-alacakaranlik",
    name: L("Mor Alacakaranlık", "Purple Twilight"),
    category: "günbatımı",
    background: {
      kind: "shader",
      shaderId: "silk",
      colors: ["#190b2c", "#4c1d6b", "#b0407a", "#f2ab7c"],
      seed: 31,
      params: { sheen: 0.75, scale: 0.7 },
    },
  },

  // ===========================================================================
  // MONO — renksiz, tipografiyi öne çıkaran zeminler.
  // ===========================================================================
  {
    id: "mono-grafit",
    name: L("Grafit", "Graphite"),
    category: "mono",
    background: {
      kind: "linear",
      angle: 165,
      stops: [
        ["#26282f", 0],
        ["#181920", 0.48],
        ["#0d0e12", 0.8],
        ["#08080b", 1],
      ],
    },
  },
  {
    id: "mono-kagit",
    name: L("Kâğıt", "Paper"),
    category: "mono",
    background: {
      kind: "linear",
      angle: 172,
      stops: [
        ["#fdfcf8", 0],
        ["#f4f2ec", 0.5],
        ["#e7e4da", 0.82],
        ["#dcd8cc", 1],
      ],
    },
  },
  {
    id: "mono-komur",
    name: L("Kömür Hale", "Charcoal Halo"),
    category: "mono",
    background: {
      kind: "shader",
      shaderId: "halo",
      colors: ["#0a0a0c", "#e8e9ef", "#9aa0ae", "#26272e"],
      seed: 19,
      params: { intensity: 0.5, size: 1.25 },
    },
  },
  {
    id: "mono-arduvaz",
    name: L("Arduvaz", "Slate"),
    category: "mono",
    background: {
      kind: "radial",
      cx: 0.5,
      cy: 0.3,
      r: 1.0,
      stops: [
        ["#414753", 0],
        ["#282d36", 0.44],
        ["#13161b", 0.78],
        ["#0a0b0e", 1],
      ],
    },
  },
  {
    id: "mono-noir",
    name: L("Noir Gren", "Noir Grain"),
    category: "mono",
    background: {
      kind: "shader",
      shaderId: "grain",
      colors: ["#1c1d23", "#08080a", "#9498a6", "#000000"],
      seed: 12,
      params: { grain: 0.07, curve: 1.15 },
    },
  },

  // ===========================================================================
  // CANLI — doygun, modern SaaS/marka gradient'leri (Linear/Stripe hissi).
  // ===========================================================================
  {
    id: "canli-indigo",
    name: L("İndigo & Turkuaz", "Indigo & Turquoise"),
    category: "canlı",
    background: {
      kind: "linear",
      angle: 164,
      stops: [
        ["#6d5bf5", 0],
        ["#4a7ef0", 0.36],
        ["#2aa8e0", 0.68],
        ["#12657f", 1],
      ],
    },
  },
  {
    id: "canli-narenciye",
    name: L("Narenciye Mesh", "Citrus Mesh"),
    category: "canlı",
    background: {
      kind: "mesh",
      colors: ["#1b1207", "#f97316", "#fbbf24", "#ef4444", "#78350f"],
      seed: 27,
    },
  },
  {
    id: "canli-bogurtlen",
    name: L("Böğürtlen", "Blackberry"),
    category: "canlı",
    background: {
      kind: "shader",
      shaderId: "metaball",
      colors: ["#160726", "#7c3aed", "#db2777", "#f472b6"],
      seed: 15,
      params: { softness: 1.35, scale: 1.15 },
    },
  },
  {
    id: "canli-okyanus",
    name: L("Okyanus Akışı", "Ocean Flow"),
    category: "canlı",
    background: {
      kind: "shader",
      shaderId: "silk",
      colors: ["#04202e", "#0b6b7a", "#22c9c2", "#b6f5e0"],
      seed: 9,
      params: { sheen: 0.9, scale: 0.8 },
    },
  },
  {
    id: "canli-mercan",
    name: L("Mercan Mesh", "Coral Mesh"),
    category: "canlı",
    background: {
      kind: "mesh",
      colors: ["#1a0a14", "#ff6b6b", "#ffa07d", "#c44569", "#5a1d3f"],
      seed: 33,
    },
  },

  // ===========================================================================
  // R10 — yeni prosedürel zeminler (engine/shaders.ts: prism / grid / bokeh).
  // Şablon ve temaların dışında da seçilebilsinler diye galeriye alındı.
  //   prism  c0..c3 = dört renk ÇAPASI (kenarsız mesh gradyan)
  //   grid   c0 = zemin, c1 = üst rampa, c2 = ızgara çizgisi, c3 = merkez hale
  //   bokeh  c0 = zemin, c1..c3 = disk renkleri
  // ===========================================================================
  {
    id: "koyu-cam-bokeh",
    name: L("Cam Bokeh", "Glass Bokeh"),
    category: "koyu-lüks",
    background: {
      kind: "shader",
      shaderId: "bokeh",
      colors: ["#080b1a", "#3b5bff", "#a06bff", "#38e8d0"],
      seed: 13,
      params: { intensity: 1.05, size: 1.4 },
    },
  },
  {
    id: "mono-izgara",
    name: L("Teknik Izgara", "Technical Grid"),
    category: "mono",
    background: {
      kind: "shader",
      shaderId: "grid",
      colors: ["#0a0a0c", "#17171c", "#6e6e78", "#b9c0cc"],
      seed: 11,
      params: { glow: 0.8, cells: 1.3 },
    },
  },
  {
    id: "neon-izgara-nane",
    name: L("Nane Izgara", "Mint Grid"),
    category: "neon",
    background: {
      kind: "shader",
      shaderId: "grid",
      colors: ["#04070a", "#0a1518", "#00e5a0", "#00b487"],
      seed: 19,
      params: { glow: 1.0, cells: 0.9 },
    },
  },
  {
    id: "canli-prizma-film",
    name: L("Prizma Film", "Prism Film"),
    category: "canlı",
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#1c1030", "#d94f6a", "#e0834a", "#4a54c9"],
      seed: 17,
      params: { warp: 1.0, spread: 1.1 },
    },
  },
  {
    id: "pastel-prizma-kil",
    name: L("Kil Prizma", "Clay Prism"),
    category: "pastel",
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#f6e7ea", "#ffd9c7", "#e4dcff", "#cdeee2"],
      seed: 23,
      params: { warp: 0.7, spread: 1.35 },
    },
  },
  {
    id: "gunbatimi-kum-tepesi",
    name: L("Kum Tepesi", "Sand Dune"),
    category: "günbatımı",
    background: {
      kind: "shader",
      shaderId: "prism",
      colors: ["#1f0d0a", "#c2582f", "#e09a4e", "#632f46"],
      seed: 33,
      params: { warp: 0.9, spread: 1.2 },
    },
  },
];

/** Kategoriye göre filtreli liste (kategori sırası PALETTE_CATEGORIES'e sadık). */
export function palettesByCategory(category: PaletteCategory): Palette[] {
  return PALETTES.filter((p) => p.category === category);
}

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

/**
 * Paletin Background'unun derin kopyası — galeri tıklamasında store'a bunun
 * dönmesi şart, yoksa slayt üzerinden yapılan düzenleme modül sabitini bozar.
 */
export function paletteBackground(id: string): Background | undefined {
  const p = getPalette(id);
  return p ? (structuredClone(p.background) as Background) : undefined;
}
