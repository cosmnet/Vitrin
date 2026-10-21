// 2D cihaz kompozisyonu: frameless (2026 trendi), prosedürel kontur ve
// ince fiziksel gövde çizgileri.
//
// Cihaz gövdesi önce kendi katmanına çizilir; yansıma bu katmanın dikey aynası
// olduğu için çerçeveli/çerçevesiz her iki yolda da bedavaya çalışır.

import { drawCover, loadImage, roundedRectPath } from "./assets";

import { screenCornerRadius, screenRectPath } from "./screenCorners";
import { clamp, deviceAspectOf, duoScreenAspectOf, isTabletKind, isDuoKind, type Device2DShadow, type DeviceStyle2D } from "./types";

/** iPhone ekran en-boy — GERİYE DÖNÜK sabit. Yeni kod `deviceAspectOf(style.kind)` okur. */
export const DEVICE_ASPECT = 1320 / 2868;

export type DeviceBox = { cx: number; cy: number; h: number; rotation: number };

export type Device2DOpts = {
  ctx: CanvasRenderingContext2D;
  style: DeviceStyle2D;
  screenshot: HTMLImageElement | null;
  box: DeviceBox;       // gerçek px
  scale: number;        // BASE → gerçek
};

export async function renderDevice2D(o: Device2DOpts): Promise<void> {
  const { ctx, style, box } = o;
  const h = box.h;
  // Cihaz türü formattan gelir (render enjekte eder): telefon 0.46, tablet 0.75.
  const screenOnly = isDuoKind(style.kind) && style.frame === "none";
  const w = h * (screenOnly ? duoScreenAspectOf(style.kind) : deviceAspectOf(style.kind));
  const x = box.cx - w / 2;
  const y = box.cy - h / 2;

  ctx.save();
  if (box.rotation) {
    ctx.translate(box.cx, box.cy);
    ctx.rotate(box.rotation);
    ctx.translate(-box.cx, -box.cy);
  }

  // 2) Cihaz gövdesini kendi katmanına çiz
  const layer = await buildDeviceLayer(o, w, h);

  const soft = style.reflection === true; // yansıma varken gölge daha hafif
  if (style.shadow !== false) {
    // Clip, outline and shadow follow exactly the same device profile.
    const bezel = (style.frame ?? "kontur") === "none" ? 0 :
      isTabletKind(style.kind) ? Math.max(2, Math.min(w, h) * 0.026) : Math.max(2, 14 * o.scale);
    const shadowR = screenCornerRadius(style, w - 2 * bezel, h - 2 * bezel) + bezel;
    softShadow(ctx, x, y, w, h, o.scale, soft, shadowCfgOf(style.shadow), shadowR, style.cornerMode !== "custom");
  }
  if (soft && layer) drawReflection(ctx, layer, x, y, w, h);
  if (layer) ctx.drawImage(layer, x, y, w, h);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Cihaz katmanı
// ---------------------------------------------------------------------------

/** Cihazı (ekran + çerçeve/kontur) w×h boyutunda saydam bir katmana çizer. */
async function buildDeviceLayer(
  o: Device2DOpts,
  w: number,
  h: number
): Promise<HTMLCanvasElement | null> {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d");
  if (!g) return null;
  const sx = cw / w; // yuvarlamadan doğan sapmayı telafi et
  const sy = ch / h;
  g.scale(sx, sy);

  const frame = o.style.frame ?? "kontur"; // yeni varsayılan: iPhone silüeti

  // Duo'nun saf ekran seçeneği: kamera, kasa, menteşe ve kenar süsü yok.
  // Kırpma da yok; farklı oranlı kaynaklar contain ile tamamen görünür.
  if (isDuoKind(o.style.kind) && frame === "none") {
    g.fillStyle = "#101014"; g.fillRect(0, 0, w, h);
    if (o.screenshot) {
      const k = Math.min(w / o.screenshot.width, h / o.screenshot.height);
      const sw = o.screenshot.width * k, sh = o.screenshot.height * k;
      g.drawImage(o.screenshot, (w-sw)/2, (h-sh)/2, sw, sh);
    }
    return c;
  }

  // Eski "iphone-frame" değeri (kaldırıldı) kontur gibi çizilir — proje bozulmaz.


  if (frame === "kontur") {
    drawKontur(g, o.screenshot, w, h, o.style, o.scale);
    return c;
  }

  // frameless: yuvarlak köşeli ekran + ince kenar
  const r = screenCornerRadius(o.style, w, h);
  const continuous = o.style.cornerMode !== "custom";
  g.save();
  screenRectPath(g, 0, 0, w, h, r, continuous);
  g.clip();
  if (o.screenshot) drawScreenImage(g, o.screenshot, 0, 0, w, h, isTabletKind(o.style.kind));
  else {
    g.fillStyle = "#101014";
    g.fillRect(0, 0, w, h);
  }
  g.restore();
  // ince kontur — koyu/açık her zeminde okunur
  g.save();
  screenRectPath(g, 0, 0, w, h, r, continuous);
  g.lineWidth = Math.max(1.5, 3 * o.scale);
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.stroke();
  // cornerRadius 0 (DO IT: sıfır köşe) → r-1 negatif olur, arcTo fırlatır.
  screenRectPath(g, 1, 1, w - 2, h - 2, Math.max(0, r - 1), continuous);
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.stroke();
  g.restore();
  return c;
}

// ---------------------------------------------------------------------------
// "kontur" — prosedürel iPhone silüeti
// ---------------------------------------------------------------------------

/**
 * Screenshot'ın çevresine gerçek iPhone silüeti çizer:
 * koyu dış gövde (köşesi ekrandan büyük, ~14 BASE px kalınlık), içte ekran,
 * üst ortada Dynamic Island hapı ve ince metalik kenar çizgisi.
 */
function drawKontur(
  g: CanvasRenderingContext2D,
  shot: HTMLImageElement | null,
  w: number,
  h: number,
  style: DeviceStyle2D,
  scale: number
): void {
  const tablet = isTabletKind(style.kind);
  // iPad: bezel kısa kenarın ~%2.6'sı; Dynamic Island yok.
  const short = Math.min(w, h);
  const b = tablet ? Math.max(2, short * 0.026) : Math.max(2, 14 * scale);
  const rs = screenCornerRadius(style, w - 2 * b, h - 2 * b);
  const continuous = style.cornerMode !== "custom";
  const R = rs + b;                                     // dış köşe ekrandan büyük

  // 1) Dış gövde — koyu titanyum, hafif dikey degrade
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, "#1a1a1f");
  body.addColorStop(0.5, "#0e0e12");
  body.addColorStop(1, "#15151a");
  screenRectPath(g, 0, 0, w, h, R, continuous);
  g.fillStyle = body;
  g.fill();

  // 2) İnce metalik kenar çizgisi — üst/alt kenarlarda parlar
  const lw = Math.max(1, 2.5 * scale);
  const metal = g.createLinearGradient(0, 0, 0, h);
  metal.addColorStop(0, "rgba(236,236,242,0.9)");
  metal.addColorStop(0.12, "rgba(150,150,160,0.5)");
  metal.addColorStop(0.5, "rgba(196,196,206,0.38)");
  metal.addColorStop(0.88, "rgba(130,130,140,0.5)");
  metal.addColorStop(1, "rgba(226,226,234,0.85)");
  screenRectPath(g, lw / 2, lw / 2, w - lw, h - lw, R - lw / 2, continuous);
  g.lineWidth = lw;
  g.strokeStyle = metal;
  g.stroke();

  // 3) Ekran — gövdenin içinde
  const sx = b;
  const sy = b;
  const sw = w - 2 * b;
  const sh = h - 2 * b;
  g.save();
  screenRectPath(g, sx, sy, sw, sh, rs, continuous);
  g.clip();
  if (shot) drawScreenImage(g, shot, sx, sy, sw, sh, tablet);
  else {
    g.fillStyle = "#101014";
    g.fillRect(sx, sy, sw, sh);
  }
  g.restore();
  // ekran ile gövde arasında çok ince koyu ayrım
  screenRectPath(g, sx, sy, sw, sh, rs, continuous);
  g.lineWidth = Math.max(1, 1.5 * scale);
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.stroke();

  // A subtle center seam identifies the open folding display in 2D.
  if (style.duoCrease !== false && (style.kind === "foldable" || style.kind === "foldable-portrait")) {
    g.beginPath();g.strokeStyle="rgba(0,0,0,.14)";g.lineWidth=Math.max(1,1.2*scale);
    if(style.kind==="foldable"){g.moveTo(w/2,sy);g.lineTo(w/2,sy+sh);}else{g.moveTo(sx,h/2);g.lineTo(sx+sw,h/2);}
    g.stroke();
  }
  // Dynamic Island is represented by the uploaded Duo interface itself.
  if (tablet || isDuoKind(style.kind)) return;
  const k = sw / 1320;
  const iw = 375 * k;
  const ih = 110 * k;
  roundedRectPath(g, sx + sw / 2 - iw / 2, sy + 33 * k, iw, ih, ih / 2);
  g.fillStyle = "#050507";
  g.fill();
}

/**
 * iPad capture'ları pencere/orientation nedeniyle fiziksel ekran oranından
 * farklı gelebilir. Tam UI'yi contain ile koru; kalan ince şeritleri kaynağın
 * en yakın kenar pikselinden üret. Telefonun tarihsel cover davranışı değişmez.
 */
function drawScreenImage(
  g: CanvasRenderingContext2D,
  shot: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  contain: boolean
): void {
  if (!contain) {
    drawCover(g, shot, x, y, w, h, 0);
    return;
  }

  const iw = shot.naturalWidth || shot.width;
  const ih = shot.naturalHeight || shot.height;
  if (!(iw > 0 && ih > 0)) return;
  const imageAspect = iw / ih;
  const rectAspect = w / h;
  if (Math.abs(imageAspect - rectAspect) < 1e-6) {
    g.drawImage(shot, x, y, w, h);
  } else if (imageAspect < rectAspect) {
    const dw = h * imageAspect;
    const dx = x + (w - dw) / 2;
    g.drawImage(shot, 0, 0, 1, ih, x, y, dx - x, h);
    g.drawImage(shot, iw - 1, 0, 1, ih, dx + dw, y, x + w - dx - dw, h);
    g.drawImage(shot, dx, y, dw, h);
  } else {
    const dh = w / imageAspect;
    const dy = y + (h - dh) / 2;
    g.drawImage(shot, 0, 0, iw, 1, x, y, w, dy - y);
    g.drawImage(shot, 0, ih - 1, iw, 1, x, dy + dh, w, y + h - dy - dh);
    g.drawImage(shot, x, dy, w, dh);
  }
}

// ---------------------------------------------------------------------------
// Yansıma
// ---------------------------------------------------------------------------

/** Cihazın altına dikey aynalı, aşağı doğru sönen yansıma. */
function drawReflection(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const rh = h * 0.32;              // yansımanın görünen boyu
  const gap = h * 0.008;            // cihazla arasındaki ince hava
  const cw = Math.max(1, Math.round(w));
  const chh = Math.max(1, Math.round(rh));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = chh;
  const g = c.getContext("2d");
  if (!g) return;
  g.scale(cw / w, chh / rh);

  // Alt kenardan aynala: katmanın k. satırı yansımanın (h - k). satırına düşer.
  g.save();
  g.scale(1, -1);
  g.translate(0, -h);
  g.drawImage(layer, 0, 0, w, h);
  g.restore();

  // Aşağı doğru sönüm
  g.globalCompositeOperation = "destination-in";
  const fade = g.createLinearGradient(0, 0, 0, rh);
  fade.addColorStop(0, "rgba(0,0,0,0.34)");
  fade.addColorStop(0.55, "rgba(0,0,0,0.10)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, w, rh);

  ctx.drawImage(c, x, y + h + gap, w, rh);
}

// ---------------------------------------------------------------------------

/* ------------------------------------------------------------------ *
   Gölge — R8/W4 (B-5.1/5.2/5.3)

   İmza `cfg` ile genişledi ama DEĞERLER değişmedi: aşağıdaki tablo eski
   literal'lerin birebir kendisidir. `cfg` verilmezse (eski projeler:
   `shadow: true` ya da alan yok) hesaplar aynı sayıları üretir, yani
   çıktı bit-bit aynıdır. `dx` bugün 0'dır — canvas'ın kendi varsayılanı.

   `fill`, gölgenin ARKASINDAKİ dolgunun alfası: gövde katmanı üstüne
   çizildiği için yalnız kenarlarda görünür, gölgeye gövde verir. Kullanıcı
   opaklığı değiştirince aynı ORANDA ölçeklenir; varsayılanda bölme tam
   1.0 olduğundan çarpım da tam çıkar (bit-bit koruma).
 * ------------------------------------------------------------------ */

const SHADOW_DEFAULTS = {
  hard: { dx: 0, dy: 38, blur: 112, opacity: 0.34, fill: 0.26 },
  soft: { dx: 0, dy: 30, blur: 130, opacity: 0.26, fill: 0.18 },
} as const;

/** Cihaz gölgesinin çözülmüş varsayılanları — Inspector de bunu okur. */
export function shadowDefaults(soft: boolean): {
  dx: number;
  dy: number;
  blur: number;
  opacity: number;
  color: string;
} {
  const d = soft ? SHADOW_DEFAULTS.soft : SHADOW_DEFAULTS.hard;
  return { dx: d.dx, dy: d.dy, blur: d.blur, opacity: d.opacity, color: "#000000" };
}

/** `shadow` alanı nesne mi? (boolean/undefined → ayar yok) */
export function shadowCfgOf(
  shadow: DeviceStyle2D["shadow"]
): Device2DShadow | undefined {
  return shadow && typeof shadow === "object" ? shadow : undefined;
}

function softShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  soft: boolean,
  cfg?: Device2DShadow,
  radius?: number,
  continuous = true,
): void {
  const D = soft ? SHADOW_DEFAULTS.soft : SHADOW_DEFAULTS.hard;
  const opacity = clamp(cfg?.opacity ?? D.opacity, 0, 1);
  // Dolgu alfası opaklıkla aynı oranda gider; varsayılanda oran tam 1.
  const fillA = clamp(D.fill * (opacity / D.opacity), 0, 1);
  const rgb = hexRgb(cfg?.color);

  ctx.save();
  ctx.shadowColor = `rgba(${rgb},${opacity})`;
  ctx.shadowBlur = (cfg?.blur ?? D.blur) * scale;
  ctx.shadowOffsetX = (cfg?.dx ?? D.dx) * scale;
  ctx.shadowOffsetY = (cfg?.dy ?? D.dy) * scale;
  screenRectPath(ctx, x, y, w, h, radius ?? (96 * h) / 2868, continuous);
  ctx.fillStyle = `rgba(${rgb},${fillA})`;
  ctx.fill();
  ctx.restore();
}

/** "#rgb"/"#rrggbb" → "r,g,b". Tanımsız/bozuk girdi siyaha düşer. */
function hexRgb(hex: string | undefined): string {
  let s = (hex || "#000000").trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}/.test(s)) return "0,0,0";
  const n = parseInt(s.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
