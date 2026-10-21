// SNAPPING + AKILLI KILAVUZLAR — R8 / Wave-2 (r8-a0 §2).
//
// Saf geometri: DOM yok, React yok. Tüm koordinatlar BASE (1320×2868) px.
// Stage sürüklerken buradan bir DÜZELTME DELTASI ve gösterilecek kılavuz
// konumlarını alır; kılavuzlar CSS <div> olarak çizilir — tuvale ASLA
// çizilmez (taslak render pompasını kirletirdi).
//
// TEK İSTİSNA: defne çelengi artık metne göre büyüyüp küçüldüğü için cihaz
// itmesi metin ÖLÇÜSÜNE bağlı. Ölçüm ornament.ts'in kendi offscreen
// context'inde yapılır; buradan görünen yine saf bir sayıdır.
//
// EŞİK EKRAN PİKSELİDİR: `th = 8 * toBase`. %24 zoom'da da %200'de de
// kullanıcı aynı 8 CSS px'lik yapışma alanını hisseder. Sabit BASE eşiği
// yüksek zoom'da yapış-kaç hissi verirdi.
//
// ÇÖZÜCÜ: sürüklenen kutunun her eksende 3 adayı vardır (sol/orta/sağ,
// üst/orta/alt). Eşiği geçen adaylar arasında MUTLAK FARKI EN KÜÇÜK olan
// kazanır, delta o eksende düzeltilir. İki eksen BAĞIMSIZ çözülür.

import { getLayoutForFormat, LAYOUTS } from "./layouts";
import { splitFrames } from "./splitScreens";
import { getTheme } from "./themes";
import { ornamentAdvance, ornamentDevicePush, ornamentPushesDevice } from "./ornament";
import {
  baseOf,
  deviceAspectOf,
  deviceStyleForFormat,
  type Format,
  type LayoutSpec,
  type Slide,
} from "./types";

/**
 * Format bağlamı — BASE px tabanı ve cihaz oranı buradan. Verilmezse iPhone;
 * böylece eski çağıranlar (ve testler) birebir aynı sayıları alır.
 */
export type SnapFormat = Format | undefined;
function baseFor(f: SnapFormat) {
  return baseOf(f);
}

/** Güvenli alan — .safe-guide CSS'iyle (inset: 5.5% 7%) AYNI değerler. */
const SAFE_X = 0.07;
const SAFE_Y = 0.055;

export type SnapKind = "slide" | "safe" | "device" | "text" | "el";

export type SnapTarget = { v: number; kind: SnapKind };
export type SnapTargets = { x: SnapTarget[]; y: SnapTarget[] };

export type SnapBox = { x: number; y: number; w: number; h: number };

export type SnapResult = {
  /** BASE px düzeltme — çağıran `x += dx` yapar. */
  dx: number;
  dy: number;
  /** Yakalanan kılavuzun BASE px konumu (yoksa null). */
  gx: number | null;
  gy: number | null;
};

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, gx: null, gy: null };

/** Sürüklenen nesne — kendi kenarları hedef listesine GİRMEZ. */
export type SnapSubject =
  | { kind: "element"; id: string }
  | { kind: "device" }
  | { kind: "text" }
  | { kind: "none" };

function pushEdges(list: SnapTarget[], a: number, b: number, kind: SnapKind): void {
  list.push({ v: a, kind }, { v: (a + b) / 2, kind }, { v: b, kind });
}

/** Cihaz kutusu (BASE px) — engine/render.ts ile AYNI formül. */
export function deviceBox(slide: Slide, layout: LayoutSpec, format?: SnapFormat): SnapBox {
  if (layout.splitPanels) return splitFrames(slide.layout, format)[0];
  const B = baseFor(format);
  const off = slide.deviceOffset || { x: 0, y: 0 };
  const h = layout.device.scale * B.h * (off.scale ?? 1);
  const cx = layout.device.cx * B.w + off.x;
  let cy = layout.device.cy * B.h + off.y;
  let hh = h;
  // Çelenk cihazı aşağı itip küçültür. Koşul da miktar da ornament.ts'ten
  // gelir — render.ts AYNI iki fonksiyonu çağırır, formül kopyası yok.
  if (ornamentPushesDevice(slide, layout)) {
    const push = ornamentDevicePush(ornamentAdvance(slide, layout, null, undefined, format), format);
    cy += push.dy;
    hh *= push.hScale;
  }
  const w = hh * deviceAspectOf(deviceStyleForFormat(slide.device ?? getTheme(slide.themeId).device, format).kind);
  return { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
}

/** Metin bloğu kutusu — yüksekliği ölçülemez (satır sayısı render'da belli), 0. */
export function textBox(slide: Slide, layout: LayoutSpec, format?: SnapFormat): SnapBox {
  const B = baseFor(format);
  const off = slide.textOffset || { x: 0, y: 0 };
  if (slide.textBoxes?.headline) return { ...slide.textBoxes.headline, h: 0 };
  return {
    x: layout.text.x * B.w + off.x,
    y: layout.text.y * B.h + off.y,
    w: layout.text.w * B.w,
    h: 0,
  };
}

/**
 * Hedef listesi: slayt merkezi/kenarları · güvenli alan · cihaz kutusu ·
 * metin bloğu · KARDEŞ öğeler. Sürüklenen nesnenin kendisi hariç tutulur
 * (yoksa nesne kendi kenarına yapışır = kilitlenir).
 */
export function collectTargets(
  slide: Slide,
  subject: SnapSubject = { kind: "none" },
  format?: SnapFormat
): SnapTargets {
  const id = LAYOUTS[slide.layout] ? slide.layout : "text-top";
  const resolved = getLayoutForFormat(id, format);
  const layout = resolved.device2 && !resolved.splitPanels && !slide.screenshot2 ? getLayoutForFormat("text-top", format) : resolved;
  const B = baseFor(format);
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];

  // Slayt kenarları + merkez
  pushEdges(x, 0, B.w, "slide");
  pushEdges(y, 0, B.h, "slide");

  // Güvenli alan (App Store kırpma payı) — merkezi tekrar etmesin diye elle.
  x.push({ v: B.w * SAFE_X, kind: "safe" }, { v: B.w * (1 - SAFE_X), kind: "safe" });
  y.push({ v: B.h * SAFE_Y, kind: "safe" }, { v: B.h * (1 - SAFE_Y), kind: "safe" });

  if (subject.kind !== "device" && !slide.hideDevice) {
    const d = deviceBox(slide, layout, format);
    pushEdges(x, d.x, d.x + d.w, "device");
    pushEdges(y, d.y, d.y + d.h, "device");
  }
  if (subject.kind !== "text") {
    const t = textBox(slide, layout, format);
    pushEdges(x, t.x, t.x + t.w, "text");
    y.push({ v: t.y, kind: "text" });
  }

  for (const e of slide.elements ?? []) {
    if (e.hidden) continue;
    if (subject.kind === "element" && e.id === subject.id) continue;
    // Döndürülmüş öğede DÖNMEMİŞ kutu kullanılır: kullanıcı hizayı öğenin
    // kendi ekseninde okur, ekrana yayılmış AABB'de değil.
    pushEdges(x, e.x, e.x + e.w, "el");
    pushEdges(y, e.y, e.y + e.h, "el");
  }
  return { x, y };
}

/**
 * Tek değer için en yakın hedef (yeniden boyutlandırmada YALNIZ hareket eden
 * kenar yapışır — kutunun tamamı kaymamalı). Eşik dışındaysa null.
 */
export function nearest(v: number, targets: SnapTarget[], th: number): number | null {
  let best: number | null = null;
  let bd = th;
  for (const t of targets) {
    const d = Math.abs(t.v - v);
    if (d <= bd) {
      bd = d;
      best = t.v;
    }
  }
  return best;
}

function solveAxis(
  cands: number[],
  targets: SnapTarget[],
  th: number
): { delta: number; at: number } | null {
  let best: { delta: number; at: number; d: number } | null = null;
  for (const c of cands) {
    for (const t of targets) {
      const d = Math.abs(t.v - c);
      if (d > th) continue;
      if (!best || d < best.d) best = { delta: t.v - c, at: t.v, d };
    }
  }
  return best ? { delta: best.delta, at: best.at } : null;
}

/**
 * Kutuyu hedeflere yapıştır. `th` BASE px eşiktir (çağıran `8 * toBase` verir).
 * Hiçbir aday eşiği geçmezse NO_SNAP döner — sürükleme ham deltayla sürer.
 */
export function snapBox(box: SnapBox, targets: SnapTargets, th: number): SnapResult {
  if (!(th > 0)) return NO_SNAP;
  const sx = solveAxis([box.x, box.x + box.w / 2, box.x + box.w], targets.x, th);
  const sy = solveAxis([box.y, box.y + box.h / 2, box.y + box.h], targets.y, th);
  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    gx: sx?.at ?? null,
    gy: sy?.at ?? null,
  };
}
