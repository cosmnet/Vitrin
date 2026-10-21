#!/usr/bin/env node
// Deterministik doku üreteci — public/assets/tex/*.png
//
// NEDEN BU SCRIPT VAR
// public/assets/bg altındaki hazır dokular (halftone-*, granular-*) fotoğraf
// kaynaklı: RENKLİ ve kendi ışığını taşıyorlar, yani `soft-light` ile bindirince
// zeminin rengini kaydırıyorlar. Tema bitiricisinde istenen şey renksiz bir
// YÜZEY: kâğıt lifi, film greni, tarama çizgisi. Bunlar nötr griden (128)
// sapmayan tek kanallı plakalar olmalı ki `overlay`/`soft-light` yalnız
// aydınlık-karanlık dokusu eklesin, tonu bozmasın.
//
// Kural: ZAMAN YOK, RASTGELE YOK. Aynı seed → aynı piksel. Dosyalar repo'ya
// girer, tekrar üretilmesi gerekmez; sadece tarif değişirse çalıştır:
//   node scripts/gen-textures.mjs           # eksikleri üret
//   node scripts/gen-textures.mjs --force   # hepsini yeniden üret
//
// BOYUT SÖZLEŞMESİ
// engine/overlays.ts `textureOverlay` dokuyu TİLE ETMEZ, cover-fit eder. Bu
// yüzden her plaka 1320×2868 slayt ORANINDA (0.4603) üretilir; ölçek büyütmesi
// yalnız 1.2–1.8x kalır, desen bulanıklaşmaz. Yine de desenler periyodik
// lattice ile üretiliyor (tileable) — ileride repeat modu gerekirse hazır.
//
// DOSYA BOYUTU: gürültü PNG'de sıkışmaz. Gürültülü plakalar bu yüzden hem daha
// küçük tuvalde hem de kuantalanmış (adım) genlikle üretilir; hepsi < 400 KB.

import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "assets", "tex");
const FORCE = process.argv.includes("--force");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

/** Slayt oranı — cover-fit'te kırpma olmasın diye her plaka bu oranda. */
const ASPECT = 1320 / 2868;

/* ------------------------------------------------------------------ *
   Gürültü altyapısı — engine/shaders.ts ile aynı aile (mulberry32 + value noise)
 * ------------------------------------------------------------------ */

function hash2i(x, y, seed) {
  // Tamsayı lattice hash'i: periyodik sarma yapabilmek için tamsayı girişli.
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periyodik value noise: px/py periyodunda dikişsiz. */
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (n, p) => ((n % p) + p) % p;
  const x0 = w(xi, px);
  const x1 = w(xi + 1, px);
  const y0 = w(yi, py);
  const y1 = w(yi + 1, py);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed);
  const d = hash2i(x1, y1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Oktavlı fbm; periyot her oktavda ikiye katlanır → dikiş yine yok. */
function fbm(x, y, px, py, seed, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let ppx = px;
  let ppy = py;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(fx, fy, ppx, ppy, seed + i * 1013);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
    ppx *= 2;
    ppy *= 2;
  }
  return sum / norm;
}

/** Beyaz gürültü — piksel başına, deterministik. */
function white(x, y, seed) {
  return hash2i(x | 0, y | 0, seed);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ *
   Plaka üretimi
 * ------------------------------------------------------------------ */

/**
 * @param w,h       tuval
 * @param fn        (u, v, x, y) → 0..1 gri
 * @param steps     kuantalama adımı (0 = kapalı). Gürültü plakalarında PNG
 *                  entropisini düşürür; göz farkı görmez, dosya yarıya iner.
 */
function plate(w, h, fn, steps = 0) {
  const buf = Buffer.allocUnsafe(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      let g = clamp01(fn(x / w, v, x, y));
      if (steps > 0) g = Math.round(g * steps) / steps;
      buf[y * w + x] = Math.round(g * 255);
    }
  }
  return buf;
}

async function write(name, w, h, buf) {
  const file = path.join(OUT_DIR, name);
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toFile(file);
  return file;
}

/* ------------------------------------------------------------------ *
   Tarifler
 * ------------------------------------------------------------------ */

/** Nötr gri (128) etrafında ±amp salınan bir tarifi 0..1'e taşır. */
const around = (amp, f) => (u, v, x, y) => 0.5 + (f(u, v, x, y) - 0.5) * amp * 2;

const RECIPES = [
  // ---------------------------------------------------------------------
  // 1) KÂĞIT LİFİ — sıcak nötrler / editoryal temalar. soft-light ile bindir.
  // Uzun yatay lifler + geniş benek: elle yapılmış kâğıdın "gözü".
  // ---------------------------------------------------------------------
  {
    name: "paper-fiber.png",
    w: 700,
    steps: 26,
    fn: () => {
      const S = 7717;
      return around(0.30, (u, v, x, y) => {
        // Lif: X'te çok uzun, Y'de sık — kâğıt hamurunun yönü.
        const fib = fbm(u * 14, v * 190, 14, 190, S, 3, 0.55);
        // Benek: iri, yumuşak alan dalgalanması.
        const mott = fbm(u * 5, v * 11, 5, 11, S + 31, 5, 0.5);
        // Toz: tek piksel kırıntılar, seyrek.
        const dust = white(x, y, S + 99) > 0.985 ? 0.35 : 0;
        return clamp01(0.32 + fib * 0.42 + mott * 0.26 + dust);
      });
    },
  },

  // ---------------------------------------------------------------------
  // 2) SOĞUK PRES KÂĞIT — daha kaba diş, suluboya kâğıdı. Riso/zine dili.
  // ---------------------------------------------------------------------
  {
    name: "paper-cold.png",
    w: 620,
    steps: 22,
    fn: () => {
      const S = 4231;
      return around(0.42, (u, v, x, y) => {
        const tooth = fbm(u * 46, v * 100, 46, 100, S, 4, 0.6);
        const mott = fbm(u * 4, v * 9, 4, 9, S + 17, 4, 0.5);
        const pit = white(x, y, S + 7) > 0.96 ? -0.18 : 0;
        return clamp01(0.30 + tooth * 0.52 + mott * 0.20 + pit);
      });
    },
  },

  // ---------------------------------------------------------------------
  // 3) FİLM GRENİ — yoğun, iki oktavlı. Zaten overlays.filmGrain var ama o
  // 256'lık karo; bu plaka daha İRİ ve yönlü, "push edilmiş 400 ISO" hissi.
  // ---------------------------------------------------------------------
  {
    name: "film-grain.png",
    w: 520,
    steps: 14,
    fn: () => {
      const S = 9091;
      return around(0.55, (u, v, x, y) => {
        const n1 = white(x, y, S);
        const n2 = vnoise(x * 0.5, y * 0.5, 100000, 100000, S + 5);
        const n3 = fbm(u * 60, v * 130, 60, 130, S + 11, 2, 0.5);
        return clamp01(n1 * 0.5 + n2 * 0.32 + n3 * 0.18);
      });
    },
  },

  // ---------------------------------------------------------------------
  // 4) HALFTONE 45° — klasik matbaa tramı. Nokta yarıçapı geniş bir fbm ile
  // modüle edilir: düz bir grid yerine "mürekkep dolu / aç" alanlar.
  // Desen düzenli olduğu için tam çözünürlükte bile PNG küçük kalır.
  // ---------------------------------------------------------------------
  {
    name: "halftone-45.png",
    w: 900,
    steps: 10,
    fn: (W, H) => {
      const S = 5150;
      const period = 14; // px — 1320 tabanında ince tram
      const c = Math.SQRT1_2;
      return (u, v, x, y) => {
        // 45° döndürülmüş grid
        const rx = (x * c + y * c) / period;
        const ry = (-x * c + y * c) / period;
        const dx = rx - Math.floor(rx) - 0.5;
        const dy = ry - Math.floor(ry) - 0.5;
        const d = Math.hypot(dx, dy);
        const ink = 0.30 + fbm(u * 3, v * 7, 3, 7, S, 4, 0.5) * 0.34;
        const r = Math.sqrt(ink) * 0.62;
        // Kenar yumuşatma: ~1 piksellik geçiş bandı (period tabanında).
        // Nokta İÇİ koyu, kâğıt beyaz → `multiply` ile mürekkep gibi biner.
        // Taban 0.14, 0'a inmez: tam siyah tram alfayı boğuyor.
        const e = 1.15 / period;
        return 0.14 + 0.86 * smooth(r - e, r + e, d);
      };
    },
  },

  // ---------------------------------------------------------------------
  // 5) HALFTONE KABA — pop-art iri nokta. Duotone foto zeminler için.
  // ---------------------------------------------------------------------
  {
    name: "halftone-coarse.png",
    w: 900,
    steps: 10,
    fn: () => {
      const S = 2266;
      const period = 34;
      const c = Math.SQRT1_2;
      return (u, v, x, y) => {
        const rx = (x * c + y * c) / period;
        const ry = (-x * c + y * c) / period;
        const dx = rx - Math.floor(rx) - 0.5;
        const dy = ry - Math.floor(ry) - 0.5;
        const d = Math.hypot(dx, dy);
        // Nokta boyu yukarıdan aşağı büyür — gradyan tram, kadrajı yönlendirir.
        // Üst sınır bilerek 0.60'ta: daha yükseğinde noktalar birleşip alt
        // üçte biri düz siyah bir bloğa dönüşüyor, tram okunmuyor.
        const ink = 0.10 + v * 0.26 + fbm(u * 2.5, v * 5, 3, 5, S, 3, 0.5) * 0.18;
        const r = Math.sqrt(ink) * 0.62;
        const e = 1.4 / period;
        return 0.10 + 0.90 * smooth(r - e, r + e, d);
      };
    },
  },

  // ---------------------------------------------------------------------
  // 6) TARAMA ÇİZGİSİ — CRT/gece mürekkebi temaları. Çizgi kalınlığı sabit,
  // parlaklık dikeyde çok yavaş dalgalanır (bant hissi).
  // ---------------------------------------------------------------------
  {
    name: "scanline.png",
    w: 1000,
    steps: 16,
    fn: () => {
      const S = 3803;
      const period = 6;
      return (u, v, x, y) => {
        const t = (y % period) / period;
        // Çizgi profili: yumuşak sinüs, sert kenar yok (moiré yapmasın).
        const line = 0.5 + 0.5 * Math.cos(t * Math.PI * 2);
        const drift = fbm(u * 2, v * 3, 2, 3, S, 3, 0.5);
        const g = 0.5 + (line - 0.5) * (0.32 + drift * 0.16);
        return g;
      };
    },
  },

  // ---------------------------------------------------------------------
  // 7) KETEN DOKUMA — kumaş. Çözgü/atkı iki yönde çakışır, iplik kalınlığı
  // gürültüyle bozulur ki mekanik bir grid gibi durmasın.
  // ---------------------------------------------------------------------
  {
    name: "weave.png",
    w: 660,
    steps: 14,
    fn: () => {
      const S = 6142;
      const px = 9;
      const py = 9;
      return (u, v, x, y) => {
        const jx = (fbm(u * 30, v * 65, 30, 65, S, 2, 0.5) - 0.5) * 1.6;
        const jy = (fbm(u * 28, v * 60, 28, 60, S + 3, 2, 0.5) - 0.5) * 1.6;
        const warp = 0.5 + 0.5 * Math.cos(((x + jx) / px) * Math.PI * 2);
        const weft = 0.5 + 0.5 * Math.cos(((y + jy) / py) * Math.PI * 2);
        // Dokuma: hangi ipliğin üstte olduğu dama tahtasıyla değişir.
        const cell = (Math.floor(x / px) + Math.floor(y / py)) % 2;
        const top = cell === 0 ? warp : weft;
        const bot = cell === 0 ? weft : warp;
        const g = 0.5 + (top * 0.72 + bot * 0.28 - 0.5) * 0.46;
        const fuzz = (white(x, y, S + 21) - 0.5) * 0.06;
        return g + fuzz;
      };
    },
  },

  // ---------------------------------------------------------------------
  // 8) BETON — geniş leke + iğne deliği gözenek. Brutalist temanın yüzeyi.
  // ---------------------------------------------------------------------
  {
    name: "concrete.png",
    w: 720,
    steps: 26,
    fn: () => {
      const S = 8480;
      return around(0.34, (u, v, x, y) => {
        const broad = fbm(u * 3, v * 6.5, 3, 7, S, 5, 0.55);
        const mid = fbm(u * 12, v * 26, 12, 26, S + 13, 4, 0.5);
        // Gözenek: eşik üstü küçük koyu benekler. Eşik yükseğe, genlik düşüğe
        // alındı — daha güçlü ayarda beton değil "kir lekesi" gibi okuyordu.
        const p = vnoise(u * 110, v * 238, 110, 238, S + 41);
        const pore = p > 0.88 ? -(p - 0.88) * 1.5 : 0;
        return clamp01(0.26 + broad * 0.40 + mid * 0.30 + pore);
      });
    },
  },

  // ---------------------------------------------------------------------
  // 9) GRAVÜR TARAMASI — editoryal/serif temaların "baskı klişesi" dokusu.
  // Tek yön 22°, çizgi yoğunluğu geniş fbm ile modüle.
  // ---------------------------------------------------------------------
  {
    name: "hatch.png",
    w: 900,
    steps: 14,
    fn: () => {
      const S = 1177;
      const a = (22 * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const period = 11;
      return (u, v, x, y) => {
        const t = ((x * ca + y * sa) / period) % 1;
        const line = 0.5 + 0.5 * Math.cos(((t + 1) % 1) * Math.PI * 2);
        const dens = fbm(u * 3.5, v * 7.5, 4, 8, S, 4, 0.5);
        // Yoğunluk düşük yerde çizgi solar → klişe aşınması.
        const amt = 0.14 + dens * 0.30;
        return 0.5 + (line - 0.5) * amt;
      };
    },
  },
];

/* ------------------------------------------------------------------ *
   Çalıştırıcı
 * ------------------------------------------------------------------ */

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[gen-textures] hedef: ${OUT_DIR}\n`);

  const rows = [];
  for (const r of RECIPES) {
    if (ONLY && !r.name.includes(ONLY)) continue;
    const file = path.join(OUT_DIR, r.name);
    if (!FORCE && (await exists(file))) {
      rows.push(`  = ${r.name} (var, atlandı)`);
      continue;
    }
    const w = r.w;
    const h = Math.round(w / ASPECT);
    const fn = r.fn(w, h);
    const buf = plate(w, h, fn, r.steps ?? 0);
    await write(r.name, w, h, buf);
    const { size } = await import("node:fs").then((m) => m.promises.stat(file));
    rows.push(`  + ${r.name}  ${w}×${h}  ${(size / 1024).toFixed(0)} KB`);
  }
  console.log(rows.join("\n"));
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
