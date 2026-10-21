// Slayt üstü bitirici katmanlar — vignette, film greni, ışık halkası ve doku.
// Hepsi deterministik: aynı girdi → aynı piksel (export ile önizleme birebir).
// Bağımlılık yok, saf canvas 2D.
//
// Sıra önemlidir:
//   glowRing  → cihazdan ÖNCE (arkasında ışık kaynağı gibi durur)
//   texture / grain / vignette → her şeyden SONRA (applyOverlays)

import { drawCover, loadImage } from "./assets";
import { BASE_W, clamp, type ThemeOverlay } from "./types";

// ---------------------------------------------------------------------------
// Vignette
// ---------------------------------------------------------------------------

/**
 * Kenar karartma. Dikey slaytta dairesel gradyan üstü/altı boğduğu için
 * gradyan tuval oranına göre elipse esnetilir.
 * @param strength 0 = kapalı, 1 = sert.
 */
export function vignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength: number
): void {
  const s = clamp(strength, 0, 1);
  if (s <= 0) return;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, h / w); // artık her şey w tabanında kare bir uzayda
  const r = w * 0.78;
  const g = ctx.createRadialGradient(0, 0, r * 0.34, 0, 0, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.58, `rgba(0,0,0,${(s * 0.14).toFixed(4)})`);
  g.addColorStop(1, `rgba(0,0,0,${(s * 0.72).toFixed(4)})`);
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -w / 2, w, w);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Film greni
// ---------------------------------------------------------------------------

const grainTiles = new Map<number, HTMLCanvasElement>();

/** Deterministik 32-bit PRNG (backgrounds.ts ile aynı aile). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed başına bir kez üretilen nötr-gri gürültü karosu (overlay blend'de 128 = etkisiz). */
function grainTile(seed: number): HTMLCanvasElement | null {
  const hit = grainTiles.get(seed);
  if (hit) return hit;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(size, size);
  const rnd = mulberry32(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 128 + ((rnd() - 0.5) * 220);
    const v = n < 0 ? 0 : n > 255 ? 255 : n;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTiles.set(seed, c);
  return c;
}

/**
 * Film greni. Karo BASE_W tabanına ölçeklenir; böylece 400px önizleme ile
 * 1320px export'ta gren aynı kabalıkta görünür.
 * @param amount 0..1
 */
export function filmGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  amount: number
): void {
  const a = clamp(amount, 0, 1);
  if (a <= 0) return;
  const tile = grainTile(Math.floor(seed) >>> 0);
  if (!tile) return;
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) return;
  const k = w / BASE_W;
  if (typeof DOMMatrix !== "undefined") {
    try {
      pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    } catch {
      // setTransform yoksa 1:1 karo ile devam
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = a;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Işık halkası (cihaz arkası)
// ---------------------------------------------------------------------------

export type GlowRingOpts = {
  color: string;
  cx: number;
  cy: number;
  r: number;
  alpha: number;
  blend?: GlobalCompositeOperation; // vars: "lighter" (koyu zeminlerde ışık gibi)
};

/** Cihazın arkasında duran yumuşak ışık halkası. r yarıçapı gerçek px. */
export function glowRing(ctx: CanvasRenderingContext2D, o: GlowRingOpts): void {
  const a = clamp(o.alpha, 0, 1);
  if (a <= 0 || o.r <= 0) return;
  const g = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.r);
  g.addColorStop(0, rgba(o.color, a * 0.34));
  g.addColorStop(0.42, rgba(o.color, a * 0.62));
  g.addColorStop(0.74, rgba(o.color, a * 0.28));
  g.addColorStop(1, rgba(o.color, 0));
  ctx.save();
  ctx.globalCompositeOperation = o.blend ?? "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(o.cx - o.r, o.cy - o.r, o.r * 2, o.r * 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Doku (halftone vb.)
// ---------------------------------------------------------------------------

/** Bir dokuyu tuvale cover-fit edip verilen blend + alpha ile bindirir. */
export async function textureOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  src: string,
  blend: GlobalCompositeOperation,
  alpha: number
): Promise<void> {
  const a = clamp(alpha, 0, 1);
  if (a <= 0 || !src) return;
  const img = await loadImage(src);
  if (!img) return;
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = a;
  drawCover(ctx, img, 0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Toplu uygulama
// ---------------------------------------------------------------------------

/**
 * Tema bitiricileri + SLAYT override'ı (R8/W4 · B-4.1).
 *
 * `undefined` = MİRAS: slaytta tanımlı olmayan her alan temadan gelir.
 * Bu yüzden düz `{...t, ...s}` kullanılmaz — `{grain: undefined}` taşıyan
 * bir override temanın grenini yanlışlıkla söndürürdü.
 *
 * Slaytta hiç override yoksa TEMA NESNESİ aynen döner (yeni nesne bile
 * üretilmez): eski projelerin çıktısı bit-bit korunur.
 */
export function mergeOverlay(
  theme: ThemeOverlay | undefined,
  slide: Partial<ThemeOverlay> | undefined
): ThemeOverlay | undefined {
  if (!slide) return theme;
  const out: ThemeOverlay = { ...(theme || {}) };
  if (slide.vignette !== undefined) out.vignette = slide.vignette;
  if (slide.grain !== undefined) out.grain = slide.grain;
  if (slide.texture !== undefined) out.texture = slide.texture;
  return out;
}

/** Tema overlay'ini doğru sırada uygular: doku → gren → vignette. */
export async function applyOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  overlay: ThemeOverlay | undefined,
  seed = 1
): Promise<void> {
  if (!overlay) return;
  if (overlay.texture) {
    const t = overlay.texture;
    await textureOverlay(ctx, w, h, t.src, t.blend, t.alpha);
  }
  if (overlay.grain) filmGrain(ctx, w, h, seed, overlay.grain);
  if (overlay.vignette) vignette(ctx, w, h, overlay.vignette);
}

/** Metin gibi kısa girdilerden deterministik seed (slayt id'si → gren deseni). */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------

/** #rgb / #rrggbb / rgb(...) → rgba(...) — bilinmeyen formatlar olduğu gibi döner. */
function rgba(color: string, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  let h = color.trim();
  if (h.startsWith("#")) {
    h = h.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length >= 6) {
      const n = parseInt(h.slice(0, 6), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(h);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  }
  return h;
}
