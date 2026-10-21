// Arka plan çizici — Background union'ının tüm kind'larını 2d context'e basar.
// Sözleşme: asla throw etmez. Herhangi bir adım çökerse koyu fallback zemin kalır.

import { drawCover, loadImage } from "./assets";
import { drawEditedImage } from "./imageEdit";
import { renderShader } from "./shaders";
import { BASE_W, clamp, type Background, type GradientStop, type Slide } from "./types";

export { SHADER_DEFS } from "./shaders";

/** Görsel yüklenemediğinde / beklenmedik hatada basılan sessiz zemin. */
const FALLBACK = "#101014";

// ---------- Efekt katmanı (slide.bgFx) ----------

export type BgFx = NonNullable<Slide["bgFx"]>;

/** Efektin GERÇEKTEN bir şey yaptığı mı? Yoksa eski (efektsiz) yol kullanılır. */
export function hasBgFx(fx?: BgFx): fx is BgFx {
  if (!fx) return false;
  return (fx.blur ?? 0) > 0 || (fx.dim ?? 0) > 0 || ((fx.sat ?? 1) !== 1);
}

/**
 * Arka planı çizer ve (varsa) slide.bgFx efektlerini YALNIZ arka plan
 * katmanına uygular. Efekt yoksa doğrudan `renderBackground` çağrılır —
 * offscreen canvas bile açılmaz, çıktı bit-bit eskisiyle aynıdır.
 *
 * blur BASE_W tabanında px'tir; hedef genişliğe ölçeklenir. Taslak modda
 * (yarı çözünürlük) blur yarıya indirilir — hem doğru ölçek hem ucuz.
 */
export async function renderBackgroundWithFx(
  bg: Background,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fx?: BgFx,
  draft = false
): Promise<void> {
  if (!hasBgFx(fx)) {
    await renderBackground(bg, ctx, w, h);
    return;
  }

  const scale = w / BASE_W;
  let blurPx = Math.max(0, clamp(fx.blur ?? 0, 0, 160) * scale);
  if (draft) blurPx /= 2;
  const sat = clamp(fx.sat ?? 1, 0, 3);
  const dim = clamp(fx.dim ?? 0, 0, 0.8);

  // Arka planı ayrı bir tuvale bas; filtreyi geri çizerken uygula.
  let layer: HTMLCanvasElement | null = null;
  try {
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(w));
    off.height = Math.max(1, Math.round(h));
    const octx = off.getContext("2d");
    if (octx) {
      await renderBackground(bg, octx, off.width, off.height);
      layer = off;
    }
  } catch {
    layer = null;
  }

  if (!layer) {
    // Offscreen açılamadıysa efektsiz ama DOĞRU bir zemin bas.
    await renderBackground(bg, ctx, w, h);
  } else {
    const parts: string[] = [];
    if (blurPx > 0) parts.push(`blur(${blurPx}px)`);
    if (sat !== 1) parts.push(`saturate(${sat})`);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = parts.length ? parts.join(" ") : "none";
    if (blurPx > 0) {
      // Blur kenarları soldurur: taşırıp çizip kenarları kırpıyoruz.
      const ov = Math.ceil(blurPx * 2.5);
      ctx.drawImage(layer, -ov, -ov, w + ov * 2, h + ov * 2);
    } else {
      ctx.drawImage(layer, 0, 0, w, h);
    }
    ctx.restore();
  }

  if (dim > 0) {
    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = dim;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// ---------- Kamusal API ----------

export async function renderBackground(
  bg: Background,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): Promise<void> {
  try {
    switch (bg.kind) {
      case "solid":
        paintSolid(ctx, bg.color || FALLBACK, w, h);
        return;
      case "linear":
        drawLinear(ctx, bg.stops, bg.angle, w, h);
        return;
      case "radial":
        drawRadial(ctx, bg.stops, bg.cx, bg.cy, bg.r, w, h);
        return;
      case "mesh":
        drawMesh(ctx, bg.colors, bg.seed, w, h);
        return;
      case "shader":
        drawShader(ctx, bg.shaderId, bg.colors, bg.seed, bg.params, w, h);
        return;
      case "image":
        await drawImageBg(ctx, bg, w, h);
        return;
      default: {
        // Tip düzeyinde eksiksizlik kontrolü.
        const _exhaustive: never = bg;
        void _exhaustive;
        paintSolid(ctx, FALLBACK, w, h);
      }
    }
  } catch (err) {
    console.warn("[backgrounds] çizim hatası, fallback zemin basıldı:", err);
    try {
      paintSolid(ctx, FALLBACK, w, h);
    } catch {
      /* burada yapılabilecek bir şey kalmadı */
    }
  }
}

// ---------- solid ----------

function paintSolid(ctx: CanvasRenderingContext2D, color: string, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------- renk ayrıştırma ----------

type RGB = [number, number, number];

/** "#abc" / "#aabbcc" / "rgb()" → 0..255 RGB. Ayrıştırılamazsa null. */
function parseRgb(color: string): RGB | null {
  const s = (color || "").trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    if (p.length < 3 || p.some((x, i) => i < 3 && !Number.isFinite(x))) return null;
    return [p[0], p[1], p[2]];
  }
  let hex = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    hex = hex.slice(0, 3).split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) return null;
  const n = parseInt(hex.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbCss(c: RGB): string {
  return `rgb(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(
    clamp(c[2], 0, 255)
  )})`;
}

/**
 * Yarı-ışık-uzayı karışım. Düz sRGB lerp iki doygun rengin ortasında luminansı
 * düşürüp çamurlu bir ara ton bırakır; tam ışık uzayı (gamma 2) ise fazla açar.
 * İkisinin ortası, premium gradient'lerin "temiz orta ton" hissini verir.
 */
const SMOOTH_MIX = 0.5;

function mixPerceptual(a: RGB, b: RGB, t: number): RGB {
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const al = a[i] * a[i];
    const bl = b[i] * b[i];
    const lin = Math.sqrt(al + (bl - al) * t);
    const srgb = a[i] + (b[i] - a[i]) * t;
    out[i] = srgb + (lin - srgb) * SMOOTH_MIX;
  }
  return out;
}

// ---------- gradient yardımcıları ----------

/** Stop'ları 0..1'e kıstırıp sıralar; boşsa null döner. */
function normStops(stops: GradientStop[] | undefined): GradientStop[] | null {
  if (!stops || !stops.length) return null;
  const list = stops
    .filter((s) => Array.isArray(s) && typeof s[0] === "string")
    .map((s): GradientStop => [s[0], clamp(Number.isFinite(s[1]) ? s[1] : 0, 0, 1)])
    .sort((a, b) => a[1] - b[1]);
  return list.length ? list : null;
}

/**
 * Uzak stop çiftlerinin arasına algısal ara duraklar serpiştirir.
 * Canvas iki stop arasını düz sRGB'de interpole eder; iki doygun rengin
 * ortası bu yüzden sönük çıkar. Ara duraklar rampayı düzeltir ve uzun
 * geçişlerde bant konturunu da yumuşatır.
 * Sapma 1.5/255'in altındaysa durak eklenmez (gereksiz iş yapmayalım).
 */
function refineStops(list: GradientStop[]): GradientStop[] {
  if (list.length < 2) return list;
  const out: GradientStop[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    const next = list[i + 1];
    if (!next) break;
    const gap = next[1] - list[i][1];
    if (gap < 0.14) continue;
    const a = parseRgb(list[i][0]);
    const b = parseRgb(next[0]);
    if (!a || !b) continue;

    const mid = mixPerceptual(a, b, 0.5);
    const flat: RGB = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const dev = Math.max(
      Math.abs(mid[0] - flat[0]),
      Math.abs(mid[1] - flat[1]),
      Math.abs(mid[2] - flat[2])
    );
    if (dev < 1.5) continue;

    const n = Math.min(3, Math.floor(gap / 0.12));
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([rgbCss(mixPerceptual(a, b, t)), list[i][1] + gap * t]);
    }
  }
  return out;
}

/**
 * Sıralı dither için rengi DITHER_BIAS kadar karartır; addDither aynı miktarı
 * ortalama olarak geri ekler. Net sonuç: kayma yok, ama her piksel ±2 LSB'lik
 * deterministik bir sapma alır → bant konturu kırılır.
 */
function biasColor(color: string): string {
  const c = parseRgb(color);
  if (!c) return color;
  return rgbCss([c[0] - DITHER_BIAS, c[1] - DITHER_BIAS, c[2] - DITHER_BIAS]);
}

function biasStops(list: GradientStop[]): GradientStop[] {
  return list.map((s): GradientStop => [biasColor(s[0]), s[1]]);
}

/** Rampa hazırlama zinciri: sırala → algısal ara duraklar → dither payı. */
function prepStops(stops: GradientStop[] | undefined): GradientStop[] | null {
  const list = normStops(stops);
  if (!list) return null;
  if (list.length === 1) return list;
  return biasStops(refineStops(list));
}

function applyStops(g: CanvasGradient, stops: GradientStop[]): void {
  let prev = -1;
  for (const [color, at] of stops) {
    // Aynı konumda iki stop olursa ikincisini bir tık ileri it (Safari sert kesme yapıyor).
    const pos = at <= prev ? Math.min(1, prev + 1e-4) : at;
    prev = pos;
    try {
      g.addColorStop(pos, color);
    } catch {
      /* geçersiz renk — atla */
    }
  }
}

/**
 * CSS konvansiyonu: angle derece, 0° = aşağıdan yukarı, saat yönünde artar.
 * 90° = soldan sağa, 180° = üstten aşağı.
 */
function drawLinear(
  ctx: CanvasRenderingContext2D,
  stops: GradientStop[],
  angle: number,
  w: number,
  h: number
): void {
  const list = prepStops(stops);
  if (!list) {
    paintSolid(ctx, FALLBACK, w, h);
    return;
  }
  if (list.length === 1) {
    paintSolid(ctx, list[0][0], w, h);
    return;
  }
  const a = ((Number.isFinite(angle) ? angle : 180) * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a); // canvas y aşağı doğru
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  const g = ctx.createLinearGradient(
    cx - (dx * len) / 2,
    cy - (dy * len) / 2,
    cx + (dx * len) / 2,
    cy + (dy * len) / 2
  );
  applyStops(g, list);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  addDither(ctx, w, h);
  addNoise(ctx, w, h, 0.012);
}

/** cx/cy 0..1 oransal; r 0..1 → uzun kenarın katı (r=1 → yarıçap = max(w,h)). */
function drawRadial(
  ctx: CanvasRenderingContext2D,
  stops: GradientStop[],
  cx: number,
  cy: number,
  r: number,
  w: number,
  h: number
): void {
  const list = prepStops(stops);
  if (!list) {
    paintSolid(ctx, FALLBACK, w, h);
    return;
  }
  // Dış rengi taban olarak bas ki gradient dairesi dışında boşluk kalmasın.
  paintSolid(ctx, list[list.length - 1][0], w, h);
  if (list.length === 1) return;

  const x = (Number.isFinite(cx) ? cx : 0.5) * w;
  const y = (Number.isFinite(cy) ? cy : 0.5) * h;
  const rad = Math.max(1, (Number.isFinite(r) ? r : 0.8) * Math.max(w, h));
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  applyStops(g, list);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  addDither(ctx, w, h);
  addNoise(ctx, w, h, 0.012);
}

// ---------- mesh ----------

/** Deterministik PRNG — aynı seed aynı blob yerleşimi. */
function mulberry32(seed: number): () => number {
  let t = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  if (t === 0) t = 0x9e3779b9;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** "#abc" / "#aabbcc" / rgb() → "rgba(r,g,b,a)". Ayrıştırılamazsa girdiyi aynen döner. */
function toRgba(color: string, alpha: number): string {
  const s = (color || "").trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return `rgba(${p[0] || 0},${p[1] || 0},${p[2] || 0},${alpha})`;
  }
  let hex = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    hex = hex
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) return s || FALLBACK;
  const n = parseInt(hex.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Modern "mesh gradient": küçük çözünürlükte birkaç yumuşak radial blob
 * çizilir, sonra tam boya bilineer büyütülür (bedava, çok geniş bir blur) ve
 * üstüne bir tık gerçek blur + sıralı dither atılır.
 *
 * WP-F estetik pass: blob sayısı azaltıldı (4..6) ama yarıçapları belirgin
 * şekilde büyütüldü ve alfa rampası neredeyse gauss'a çevrildi. Daha az, daha
 * iri ve daha yayvan blob = premium mesh gradient; eski hâlde küçük bloblar
 * "lav lambası" gibi ayrı ayrı okunuyordu.
 */
function drawMesh(
  ctx: CanvasRenderingContext2D,
  colors: string[],
  seed: number,
  w: number,
  h: number
): void {
  const raw = colors && colors.length ? colors : ["#12121c", "#2a2350", "#6d4bff", "#20c9d6"];
  // addDither ortalama +DITHER_BIAS ekleyeceği için renkler o kadar karartılır.
  const cols = raw.map(biasColor);
  const base = cols[0];
  paintSolid(ctx, base, w, h); // tam kapsayan taban

  const sw = 200;
  const sh = Math.max(2, Math.round((sw * h) / Math.max(w, 1)));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  if (!sctx) return;

  sctx.fillStyle = base;
  sctx.fillRect(0, 0, sw, sh);

  const rnd = mulberry32(seed);
  const n = 4 + Math.floor(rnd() * 3); // 4..6 iri blob
  const maxDim = Math.max(sw, sh);
  for (let i = 0; i < n; i++) {
    const c = cols[(i + 1) % cols.length];
    // Merkezler kadraja biraz daha yakın: iri bloblar kenardan taşarsa
    // kompozisyon boşalıyor.
    const bx = (0.14 + rnd() * 0.72) * sw;
    const by = (0.08 + rnd() * 0.84) * sh;
    const rad = (0.62 + rnd() * 0.52) * maxDim;
    const g = sctx.createRadialGradient(bx, by, 0, bx, by, rad);
    // Yumuşak, gauss'a yakın düşüş — sert bir "top" kenarı bırakmaz.
    g.addColorStop(0, toRgba(c, 0.72));
    g.addColorStop(0.22, toRgba(c, 0.58));
    g.addColorStop(0.45, toRgba(c, 0.34));
    g.addColorStop(0.68, toRgba(c, 0.15));
    g.addColorStop(0.86, toRgba(c, 0.045));
    g.addColorStop(1, toRgba(c, 0));
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, sw, sh);
  }

  // Köşeleri hafif karart — kompozisyon merkeze toplansın (eskisinden yumuşak).
  const vg = sctx.createRadialGradient(sw / 2, sh / 2, maxDim * 0.32, sw / 2, sh / 2, maxDim * 0.92);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(0.6, "rgba(0,0,0,0.06)");
  vg.addColorStop(1, "rgba(0,0,0,0.22)");
  sctx.fillStyle = vg;
  sctx.fillRect(0, 0, sw, sh);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `blur(${Math.max(3, w * 0.016)}px)`;
  // Blur kenarları soldurmasın diye taşırarak çiz.
  const ov = Math.ceil(Math.max(w, h) * 0.06);
  ctx.drawImage(small, -ov, -ov, w + ov * 2, h + ov * 2);
  ctx.restore();

  addDither(ctx, w, h);
  addNoise(ctx, w, h, 0.028);
}

// ---------- shader ----------

function drawShader(
  ctx: CanvasRenderingContext2D,
  shaderId: string,
  colors: string[],
  seed: number,
  params: Record<string, number> | undefined,
  w: number,
  h: number
): void {
  const layer = renderShader(shaderId, colors, seed, params, w, h);
  ctx.save();
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.drawImage(layer, 0, 0, w, h);
  ctx.restore();
}

// ---------- image ----------

async function drawImageBg(
  ctx: CanvasRenderingContext2D,
  bg: Extract<Background, { kind: "image" }>,
  w: number,
  h: number
): Promise<void> {
  const img = await loadImage(bg.src);
  if (!img) {
    paintSolid(ctx, FALLBACK, w, h); // sessiz fallback — throw yok
    return;
  }

  const scale = w / BASE_W;                 // blur değeri BASE_W tabanında px
  const blurPx = Math.max(0, (bg.blur ?? 0) * scale);

  // PANORAMA DİLİMİ: kaynağın yalnız bir yatay penceresi kullanılacaksa o
  // pencere ayrı bir tuvale kesilir ve cover-fit ONA uygulanır — böylece
  // komşu dilimler (x 0 / 0.33 / 0.66) mağazada yan yana tek sahne olur.
  const src = bg.crop ? cropWindow(img, bg.crop) : img;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (blurPx > 0) {
    ctx.filter = `blur(${blurPx}px)`;
    const ov = Math.ceil(blurPx * 2.5);     // blur kenar soldurmasını kırp
    if (bg.imageCrop) drawEditedImage(ctx, src, -ov, -ov, w + ov * 2, h + ov * 2, bg.imageCrop);
    else drawCover(ctx, src, -ov, -ov, w + ov * 2, h + ov * 2);
  } else {
    if (bg.imageCrop) drawEditedImage(ctx, src, 0, 0, w, h, bg.imageCrop);
    else drawCover(ctx, src, 0, 0, w, h);
  }
  ctx.restore();

  if (bg.overlayColor) {
    ctx.save();
    ctx.filter = "none";
    // R8/W4 (B-3.2): harman modu. Yoksa bugünkü düz "source-over".
    if (bg.overlayBlend) ctx.globalCompositeOperation = bg.overlayBlend;
    ctx.globalAlpha = clamp(bg.overlayAlpha ?? 0.35, 0, 1);
    ctx.fillStyle = bg.overlayColor;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/** Kaynak görselin yatay penceresi (oranlar 0..1) → ayrı tuval. Pencere
 *  dışına taşan değerler kırpılır; sıfır enli pencere tam görsele düşer. */
function cropWindow(
  img: HTMLImageElement,
  crop: { x: number; w: number }
): HTMLImageElement | HTMLCanvasElement {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const x0 = Math.round(clamp(crop.x, 0, 1) * iw);
  const cw = Math.round(clamp(crop.w, 0, 1 - clamp(crop.x, 0, 1)) * iw);
  if (cw < 2 || iw < 2) return img;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ih;
  const g = c.getContext("2d");
  if (!g) return img;
  g.drawImage(img, x0, 0, cw, ih, 0, 0, cw, ih);
  return c;
}

// ---------- sıralı dither (banding fix) ----------
//
// 2d canvas gradient'leri 8 bit hesaplanır; koyu ve düşük kontrastlı
// rampalarda 1320×2868'de gözle görülür bantlar oluşur. Çözüm ±1 LSB'lik
// deterministik bir sapma:
//   1) stop renkleri DITHER_BIAS kadar karartılır (biasStops),
//   2) 8×8 Bayer karosu "lighter" ile TOPLANARAK geri eklenir (0..DITHER_MAX).
// Ortalama DITHER_BIAS olduğundan net parlaklık kayması sıfırdır.
//
// Neden "overlay" değil: overlay koyu tonlarda çarpımsal davranır, sapma
// sıfıra yaklaşır — yani bandın en çok göründüğü yerde hiç iş görmez.
// "lighter" ise tonaliteden bağımsız, gerçek toplamsal dither verir.

const DITHER_MAX = 4; // karo değer aralığı 0..4
const DITHER_BIAS = 2; // ortalama ≈ 2 → net kayma yok

/** Standart 8×8 Bayer matrisi (0..63). */
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

let ditherTile: HTMLCanvasElement | null = null;

function getDitherTile(): HTMLCanvasElement | null {
  if (ditherTile) return ditherTile;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(8, 8);
  for (let i = 0; i < 64; i++) {
    const v = Math.round(((BAYER8[i] + 0.5) / 64) * DITHER_MAX);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  ditherTile = c;
  return c;
}

/** biasStops ile karartılan payı piksel piksel değişen bir sapmayla geri ekler. */
function addDither(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const tile = getDitherTile();
  if (!tile) return;
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.filter = "none";
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------- gren ----------

let noiseTile: HTMLCanvasElement | null = null;

/** 64×64 deterministik gren karosu — 2d gradient'lerdeki banding'i kırar. */
function getNoiseTile(): HTMLCanvasElement | null {
  if (noiseTile) return noiseTile;
  if (typeof document === "undefined") return null;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(size, size);
  let s = 0x2f6e2b1 >>> 0; // sabit tohum → her çalıştırmada aynı karo
  for (let i = 0; i < size * size; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = (s >>> 24) & 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

function addNoise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  if (alpha <= 0) return;
  const tile = getNoiseTile();
  if (!tile) return;
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.filter = "none";
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
