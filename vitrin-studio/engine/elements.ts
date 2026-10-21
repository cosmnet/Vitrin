// SERBEST ÖĞE KATMANI — R8 / Wave-2.
//
// Tek SAF çizici, İKİ çağrı yeri yok: `composeStatic` (engine/render.ts) bu
// dosyayı çağırır, Stage de aynı `composeStatic`i çağırır. Yani "3D slaytta
// sticker görünmüyor" sınıfı ikizleme hataları yapısal olarak imkânsız.
//
// KOORDİNAT SÖZLEŞMESİ: her şey BASE (1320×2868) px, SOL-ÜST köşe. Çizici
// `scale = W / BASE_W` ile ölçekler — 440px önizleme ile 1320px export aynı
// kompozisyonu verir.
//
// Z SIRASI: dizi sırası z sırasıdır (son çizilen = en üstte), kova içinde.
// "under" cihazdan ÖNCE, "over" metinden SONRA ama `applyOverlays`ten ÖNCE
// çizilir — gren/vignette her şeyin üstünde kalsın (r8-a0 §3 uyarısı).

import { L } from "@/lib/i18n";
import { drawCover, loadImage, roundedRectPath } from "./assets";
import { drawTextBlock, resolveText } from "./text";
import { drawEditedImage, imageFilter } from "./imageEdit";
import {
  BASE_W,
  clamp,
  type ElementBucket,
  type ElKind,
  type SlideElement,
  type TextStyle,
} from "./types";

/* ------------------------------------------------------------------ *
   Blend beyaz listesi (r8-a0 §3.1)

   Canvas `globalCompositeOperation` bir çuval dolusu mod kabul eder ama
   çoğu (source-in, xor, destination-atop…) kompozisyonda ALAN SİLER —
   bir öğeye verildiğinde altındaki her şeyi keser. Beyaz liste yalnız
   "ışık/ton" ailesini açar; glowRing zaten `lighter` kullanıyor.
 * ------------------------------------------------------------------ */

export const BLEND_MODES = [
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "color-dodge",
  "difference",
  "luminosity",
  "lighter",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/** UI etiketleri — Inspector select'i buradan beslenir ("Normal" = alan yok). */
export const BLEND_LABELS: { value: "" | BlendMode; label: string }[] = [
  { value: "", label: "Normal" },
  { value: "multiply", label: L("Çarp", "Multiply") },
  { value: "screen", label: L("Ekran", "Screen") },
  { value: "overlay", label: L("Kaplama", "Overlay") },
  { value: "soft-light", label: L("Yumuşak ışık", "Soft light") },
  { value: "color-dodge", label: L("Renk soldur", "Color dodge") },
  { value: "difference", label: L("Fark", "Difference") },
  { value: "luminosity", label: L("Parlaklık", "Luminosity") },
  { value: "lighter", label: L("Toplamalı", "Additive") },
];

const BLEND_SET = new Set<string>(BLEND_MODES);

/** Beyaz listede olmayan bir mod gelirse sessizce normale düşer. */
export function safeBlend(b: string | undefined): GlobalCompositeOperation | null {
  return b && BLEND_SET.has(b) ? (b as GlobalCompositeOperation) : null;
}

/* ------------------------------------------------------------------ *
   Varsayılanlar
 * ------------------------------------------------------------------ */

/** Yeni metin öğesinin taban stili — tema fontuna değil, nötr bir sisteme oturur. */
export const EL_TEXT_BASE: TextStyle = {
  fontFamily: "Inter",
  weight: 600,
  sizePx: 56,
  lineHeight: 1.2,
  color: "#f2f1ec",
  align: "center",
};

export const EL_DEFAULT_FILL = "#c6ff3a";

/** Öğe kovası — alan yoksa "over" (metnin üstü), en sezgisel yer. */
export function bucketOf(e: SlideElement): ElementBucket {
  return e.z === "under" ? "under" : "over";
}

/* ------------------------------------------------------------------ *
   Çizim
 * ------------------------------------------------------------------ */

function px(v: number | undefined, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

/** Ok başlı çizgi — kutunun sol-ortasından sağ-ortasına. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  lw: number
): void {
  const cy = h / 2;
  const head = Math.min(w * 0.34, Math.max(lw * 3.2, h * 0.5));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(Math.max(0, w - head * 0.72), cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w, cy);
  ctx.lineTo(w - head, cy - head * 0.55);
  ctx.lineTo(w - head, cy + head * 0.55);
  ctx.closePath();
  ctx.fill();
}

/** Tek öğe — çağıran save/restore ve dönüşü zaten kurmuş olur. */
async function drawOne(
  ctx: CanvasRenderingContext2D,
  e: SlideElement,
  scale: number,
  locale?: string
): Promise<void> {
  const w = e.w * scale;
  const h = e.h * scale;
  const st = e.style ?? {};
  const fill = st.fill ?? EL_DEFAULT_FILL;
  const stroke = st.stroke;
  const lw = px(st.strokeW, 8) * scale;

  switch (e.kind) {
    // -----------------------------------------------------------------------
    // GLASS (R14) — 2026 "liquid glass": arkasındaki pikselleri ÖRNEKLEYİP
    // bulanıklaştırır, renk katar, kılcal kenar ve üst ışık şeridi çizer.
    // Düz yarı saydam dikdörtgenden farkı tam olarak bu: cam, arkasındakini
    // gerçekten kırar. Örnekleme çizim ANINDAKİ tuvalden yapılır — under
    // kovasında zemini, over kovasında zemin+cihaz+metni görür.
    // ctx zaten öğenin sol-üstüne taşınmış/döndürülmüş; örnekleme kutusu
    // dünya uzayında (dönüşüm sonrası bbox) alınır, geri çizim klip içinde
    // kimlik dönüşümüyle yapılır.
    // -----------------------------------------------------------------------
    case "glass": {
      const r = px(st.radius, 48) * scale;
      const blurPx = Math.max(0, px(st.blur, 28) * scale);
      const m = ctx.getTransform();
      const pts = [
        m.transformPoint(new DOMPoint(0, 0)),
        m.transformPoint(new DOMPoint(w, 0)),
        m.transformPoint(new DOMPoint(0, h)),
        m.transformPoint(new DOMPoint(w, h)),
      ];
      const pad = Math.ceil(blurPx * 2) + 2;
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const sx = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) - pad));
      const sy = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) - pad));
      const ex = Math.min(cw, Math.ceil(Math.max(...pts.map((p) => p.x)) + pad));
      const ey = Math.min(ch, Math.ceil(Math.max(...pts.map((p) => p.y)) + pad));
      const sw = ex - sx;
      const sh = ey - sy;

      if (sw > 0 && sh > 0 && typeof document !== "undefined") {
        // 1) Bölgeyi kopyala, 2) bulanık kopyasını üret.
        const src = document.createElement("canvas");
        src.width = sw;
        src.height = sh;
        const sctx = src.getContext("2d");
        const blurred = document.createElement("canvas");
        blurred.width = sw;
        blurred.height = sh;
        const bctx = blurred.getContext("2d");
        if (sctx && bctx) {
          sctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          bctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
          // Kenar soldurmasını gizlemek için önce keskin kopya, üstüne bulanık.
          bctx.drawImage(src, 0, 0);
          // 3) Klip içinde, kimlik dönüşümüyle geri bas.
          ctx.save();
          roundedRectPath(ctx, 0, 0, w, h, r);
          ctx.clip();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(blurred, sx, sy);
          ctx.restore();
        }
      }

      // 4) Cam rengi + kılcal kenar + üst ışık şeridi (öğe uzayında).
      const tint = st.tint ?? "#ffffff";
      const ta = st.tintAlpha ?? 0.12;
      ctx.save();
      roundedRectPath(ctx, 0, 0, w, h, r);
      ctx.clip();
      ctx.globalAlpha = ta;
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
      // Üstten aşağı sönen ince parlaklık — camın yüzey yansıması.
      const hl = st.highlight ?? 0.6;
      if (hl > 0) {
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
        g.addColorStop(0, `rgba(255,255,255,${0.35 * hl})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 0.5);
      }
      ctx.restore();
      ctx.save();
      roundedRectPath(ctx, 0, 0, w, h, r);
      ctx.lineWidth = Math.max(1, (st.strokeW ?? 2) * scale);
      ctx.strokeStyle = stroke ?? "rgba(255,255,255,0.38)";
      ctx.stroke();
      // Üst kenarda daha parlak kısa şerit (ışık düşen kenar).
      if (hl > 0) {
        const g2 = ctx.createLinearGradient(0, 0, w, 0);
        g2.addColorStop(0, "rgba(255,255,255,0)");
        g2.addColorStop(0.5, `rgba(255,255,255,${0.9 * hl})`);
        g2.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g2;
        ctx.lineWidth = Math.max(1, 2 * scale);
        ctx.beginPath();
        ctx.moveTo(r, 1);
        ctx.lineTo(w - r, 1);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "rect":
    case "pill": {
      const r = e.kind === "pill" ? Math.min(w, h) / 2 : px(st.radius, 0) * scale;
      roundedRectPath(ctx, 0, 0, w, h, r);
      if (fill && fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke && lw > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      break;
    }
    case "line": {
      ctx.strokeStyle = stroke || fill;
      ctx.lineWidth = Math.max(1, lw);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      break;
    }
    case "arrow": {
      drawArrow(ctx, w, h, stroke || fill, Math.max(1, lw));
      break;
    }
    case "image":
    case "sticker": {
      if (!e.src) break;
      const img = await loadImage(e.src);
      if (!img) break;
      // sticker = ALFA'sı olan kesme asset: kutuya AYNEN gerilir (tutamaklarla
      // WYSIWYG). image = fotoğraf: kutuyu taşırmadan doldurur (cover).
      if (e.kind === "sticker" && !e.crop && !e.imageFx) ctx.drawImage(img, 0, 0, w, h);
      else {
        ctx.save();
        roundedRectPath(ctx, 0, 0, w, h, px(st.radius, 0) * scale);
        ctx.clip();
        ctx.filter = imageFilter(e.imageFx, scale);
        if (!e.crop && !e.imageFx) drawCover(ctx, img, 0, 0, w, h);
        else drawEditedImage(ctx, img, 0, 0, w, h, e.crop, e.kind === "sticker" ? "stretch" : "cover");
        ctx.restore();
      }
      if (stroke && lw > 0) {
        roundedRectPath(ctx, 0, 0, w, h, px(st.radius, 0) * scale);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      break;
    }
    case "text": {
      const style = resolveText(EL_TEXT_BASE, st);
      // drawTextBlock'un x/y/w'si GERÇEK px'tir (scale yalnız font metriğine
      // uygulanır — engine/render.ts de blockX/blockW'yi ölçekli veriyor).
      // ctx zaten öğenin sol-üstüne taşınmış durumda, bu yüzden x/y = 0.
      drawTextBlock(ctx, {
        text: e.text ?? "",
        style,
        x: 0,
        y: 0,
        w,
        scale,
        locale,
      });
      break;
    }
  }
}

/**
 * Bir kovadaki tüm öğeleri çizer. Boş dizi / eksik alan = HİÇBİR ŞEY yapmaz
 * (tek `ctx` dokunuşu bile olmaz) → eski slaytlar bit-bit aynı basar.
 */
export async function drawElements(
  ctx: CanvasRenderingContext2D,
  els: SlideElement[] | undefined,
  W: number,
  H: number,
  scale: number,
  bucket: ElementBucket,
  locale?: string
): Promise<void> {
  if (!els || !els.length) return;
  for (const e of els) {
    if (e.hidden) continue;
    if (bucketOf(e) !== bucket) continue;
    const a = clamp(px(e.opacity, 1), 0, 1);
    if (a <= 0) continue;
    if (!(e.w > 0) || !(e.h > 0)) continue;

    ctx.save();
    const blend = safeBlend(e.blend);
    if (blend) ctx.globalCompositeOperation = blend;
    if (a < 1) ctx.globalAlpha = a;
    // Dönüş çapası KUTU MERKEZİ (seçim çerçevesiyle birebir aynı kural).
    const cx = (e.x + e.w / 2) * scale;
    const cy = (e.y + e.h / 2) * scale;
    ctx.translate(cx, cy);
    if (e.rotation) ctx.rotate((e.rotation * Math.PI) / 180);
    ctx.translate(-(e.w / 2) * scale, -(e.h / 2) * scale);
    try {
      await drawOne(ctx, e, scale, locale);
    } finally {
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ *
   Hit-test — DOM'suz (r8-a0 §1.5)

   Nokta öğenin MERKEZİ etrafında ters döndürülür, sonra eksen hizalı
   dikdörtgen testi yapılır. En ÜSTTEKİ kova (over) önce, kova içinde son
   çizilen önce — yani çizim sırasının tersi.
 * ------------------------------------------------------------------ */

/** Nokta bu öğenin (döndürülmüş) kutusunda mı? Koordinatlar BASE px. */
export function hitsElement(e: SlideElement, bx: number, by: number, pad = 0): boolean {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  let dx = bx - cx;
  let dy = by - cy;
  if (e.rotation) {
    const t = (-e.rotation * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const nx = dx * c - dy * s;
    dy = dx * s + dy * c;
    dx = nx;
  }
  return Math.abs(dx) <= e.w / 2 + pad && Math.abs(dy) <= e.h / 2 + pad;
}

/** En üstteki uygun öğe (gizli/kilitli atlanır) ya da null. */
export function hitTest(
  els: SlideElement[] | undefined,
  bx: number,
  by: number,
  pad = 0
): SlideElement | null {
  if (!els || !els.length) return null;
  const over = els.filter((e) => bucketOf(e) === "over");
  const under = els.filter((e) => bucketOf(e) === "under");
  for (const list of [over, under]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.hidden || e.locked) continue;
      if (hitsElement(e, bx, by, pad)) return e;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
   Dizi yardımcıları — hepsi YENİ dizi döndürür (updateSlide yaması)
 * ------------------------------------------------------------------ */

export function elementById(
  els: SlideElement[] | undefined,
  id: string | null | undefined
): SlideElement | null {
  if (!els || !id) return null;
  return els.find((e) => e.id === id) ?? null;
}

export function patchElement(
  els: SlideElement[] | undefined,
  id: string,
  patch: Partial<SlideElement>
): SlideElement[] {
  return (els ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e));
}

export function removeElement(els: SlideElement[] | undefined, id: string): SlideElement[] {
  return (els ?? []).filter((e) => e.id !== id);
}

/**
 * Öğeyi kendi kovasının en üstüne / en altına taşır.
 * Dizi sırası z sırası olduğu için "öne al" = kovadaki son öğeden sonraya git.
 */
export function reorderElement(
  els: SlideElement[] | undefined,
  id: string,
  dir: "front" | "back"
): SlideElement[] {
  const list = [...(els ?? [])];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return list;
  const [el] = list.splice(i, 1);
  const bucket = bucketOf(el);
  if (dir === "front") {
    let at = list.length;
    for (let j = list.length - 1; j >= 0; j--) {
      if (bucketOf(list[j]) === bucket) {
        at = j + 1;
        break;
      }
    }
    list.splice(at, 0, el);
  } else {
    let at = 0;
    for (let j = 0; j < list.length; j++) {
      if (bucketOf(list[j]) === bucket) {
        at = j;
        break;
      }
      at = j + 1;
    }
    list.splice(at, 0, el);
  }
  return list;
}

/* ------------------------------------------------------------------ *
   Öğe stil panosu — components/styleClip.ts kalıbının birebir eşi.

   Oturum aracıdır: projeye girmez, kaydedilmez, undo yığınına yazılmaz.
   Taşınan şey GÖRÜNÜŞTÜR — geometri (x/y/w/h) ve içerik (text/src) ASLA.
 * ------------------------------------------------------------------ */

export type ElementStyleClip = Pick<SlideElement, "style" | "opacity" | "blend" | "rotation">;

let elClip: ElementStyleClip | null = null;
let elClipLabel = "";

export function copyElementStyle(e: SlideElement): void {
  elClip = structuredClone({
    style: e.style,
    opacity: e.opacity,
    blend: e.blend,
    rotation: e.rotation,
  });
  elClipLabel = elementLabel(e);
}

export function elementStyleClip(): ElementStyleClip | null {
  return elClip ? structuredClone(elClip) : null;
}

export function elementStyleClipLabel(): string {
  return elClipLabel;
}

/* ------------------------------------------------------------------ *
   Fabrika — yeni öğe üretimi (bağlam menüsü / çekmece / Inspector)
 * ------------------------------------------------------------------ */

const KIND_LABEL: Record<ElKind, string> = {
  text: L("Metin", "Text"),
  image: L("Görsel", "Image"),
  sticker: "Sticker",
  rect: L("Dikdörtgen", "Rectangle"),
  pill: L("Hap", "Pill"),
  arrow: L("Ok", "Arrow"),
  line: L("Çizgi", "Line"),
  glass: L("Cam panel", "Glass panel"),
};

/** Listede görünen ad — metin öğesi kendi içeriğini gösterir. */
export function elementLabel(e: SlideElement): string {
  if (e.name?.trim()) return e.name.trim();
  const coverName: Record<string, string> = { "cover-split:backing": L("Kapak kağıdı", "Cover paper"), "cover-split:style-picker": L("Kapak stilleri", "Cover styles"), "cover-split:atelier-editor": L("Kapak atölyesi", "Cover studio") };
  if (coverName[e.id]) return coverName[e.id];
  if (e.kind === "text") return (e.text || "").trim().slice(0, 22) || L("Metin", "Text");
  if ((e.kind === "sticker" || e.kind === "image") && e.src) {
    return e.src.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") || KIND_LABEL[e.kind];
  }
  return KIND_LABEL[e.kind];
}

export function kindLabel(k: ElKind): string {
  return KIND_LABEL[k];
}

/** Türe göre makul bir başlangıç kutusu (BASE px). */
export function defaultSize(kind: ElKind): { w: number; h: number } {
  switch (kind) {
    case "text":
      return { w: 720, h: 120 };
    case "pill":
      return { w: 460, h: 120 };
    case "glass":
      return { w: 900, h: 600 };
    case "line":
      return { w: 520, h: 24 };
    case "arrow":
      return { w: 420, h: 120 };
    case "sticker":
      return { w: 320, h: 320 };
    case "image":
      return { w: 560, h: 560 };
    default:
      return { w: 460, h: 300 };
  }
}

export type NewElementOpts = {
  /** Merkez konumu, BASE px. Verilmezse slayt merkezi. */
  cx?: number;
  cy?: number;
  w?: number;
  h?: number;
  src?: string;
  text?: string;
  accent?: string;
};

/** Yeni öğe — `id` çağıranın verdiği üreticiden gelir (types.uid). */
export function makeElement(
  kind: ElKind,
  id: string,
  o: NewElementOpts = {}
): SlideElement {
  const d = defaultSize(kind);
  const w = o.w ?? d.w;
  const h = o.h ?? d.h;
  const cx = o.cx ?? BASE_W / 2;
  const cy = o.cy ?? 2868 / 2;
  const el: SlideElement = {
    id,
    kind,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    z: "over",
  };
  if (kind === "text") el.text = o.text ?? L("Yeni metin", "New text");
  if (kind === "sticker" || kind === "image") el.src = o.src;
  if (kind === "glass") el.style = { radius: 56, blur: 28, tintAlpha: 0.12 };
  if (kind === "rect" || kind === "pill") {
    el.style = { fill: o.accent ?? EL_DEFAULT_FILL, radius: kind === "rect" ? 24 : undefined };
  }
  if (kind === "line" || kind === "arrow") {
    el.style = { stroke: o.accent ?? EL_DEFAULT_FILL, strokeW: 10 };
  }
  if (kind === "text") el.style = { color: o.accent ?? EL_TEXT_BASE.color, sizePx: 56 };
  return el;
}
