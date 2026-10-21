// Canvas tipografi: sarma, letter-spacing, blok çizimi, rozet.
//
// R7 / Wave-1 — LOCALE İPUCU
// `locale` alanı OPSİYONEL ve GERİYE UYUMLU: verilmezse bugünkü davranış birebir
// korunur (uppercase = toLocaleUpperCase("tr"), yön = ltr). Veren çağıran:
//   • doğru büyük harf   — en'de "in" → "IN", tr'de "in" → "İN"
//   • latin dışı atlama  — ar/hi/ja/ko/zh'de uppercase UYGULANMAZ (PLAN-R7 §3)
//   • RTL yönü           — ar-SA'da ctx.direction = "rtl" (noktalama doğru yere)

import { cssFont, isCaselessScript, isRtlLocale, scriptForLocale } from "./fonts";
import type { TextStyle } from "./types";
import { roundedRectPath } from "./assets";

export type ResolvedText = Required<Pick<TextStyle, "fontFamily" | "weight" | "sizePx" | "color">> &
  TextStyle;

export function resolveText(base: TextStyle, over?: Partial<TextStyle>): ResolvedText {
  return { align: "center", transform: "none", lineHeight: 1.1, letterSpacing: 0, ...base, ...(over || {}) } as ResolvedText;
}

function applyStyle(
  ctx: CanvasRenderingContext2D,
  st: ResolvedText,
  scale: number,
  locale?: string
): void {
  ctx.font = cssFont(st.weight, st.sizePx * scale, st.fontFamily, st.style === "italic");
  ctx.fillStyle = st.color;
  // Chromium destekli; yoksa sessizce yok sayılır
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${(st.letterSpacing || 0) * scale}px`;
  } catch { /* eski tarayıcı */ }
  applyDirection(ctx, locale);
}

/**
 * Arapça'da paragraf yönü rtl olmalı, yoksa cümle sonu noktalaması yanlış
 * tarafta çıkar. x hesapları elle yapıldığı için textAlign AÇIKÇA "left"
 * sabitlenir — ltr'de "start" ile aynı, yani mevcut çıktı değişmez.
 */
function applyDirection(ctx: CanvasRenderingContext2D, locale?: string): void {
  if (!locale) return;
  try {
    ctx.textAlign = "left";
    (ctx as CanvasRenderingContext2D & { direction: string }).direction = isRtlLocale(locale)
      ? "rtl"
      : "ltr";
  } catch { /* eski tarayıcı */ }
}

/**
 * transform:"uppercase" uygulaması — dile duyarlı.
 * locale yoksa "tr" (bugünkü davranış). Kasasız yazılarda (ar/hi/ja/ko/zh)
 * uppercase ANLAMSIZ, atlanır.
 */
export function applyTransform(
  text: string,
  transform: TextStyle["transform"],
  locale?: string
): string {
  if (transform !== "uppercase") return text;
  if (locale && isCaselessScript(scriptForLocale(locale))) return text;
  return text.toLocaleUpperCase(locale || "tr");
}

// CJK: Han + Hiragana + Katakana + Hangul + CJK noktalama.
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

/**
 * Japonca/Korece/Çince'de KELİME ARASI BOŞLUK YOKTUR: bir başlık tek "kelime"
 * gibi görünür, boşluğa göre sarma hiç tetiklenmez ve satır kutudan taşar.
 * Bu yüzden yalnız CJK içeren parçalar karakter karakter kırılır. Latin
 * kelimeler ASLA ortadan kırılmaz — mevcut çıktı korunur.
 */
function breakCjk(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of Array.from(word)) {
    const probe = cur + ch;
    if (cur && ctx.measureText(probe).width > maxWidth) {
      out.push(cur);
      cur = ch;
    } else {
      cur = probe;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  // Enter ile verilen satır sonları tasarımın parçasıdır; boş satırlar da korunur.
  if (/[\r\n]/.test(text)) {
    return text.split(/\r\n|[\r\n]/).flatMap((paragraph) =>
      paragraph.trim() ? wrapLines(ctx, paragraph, maxWidth) : [""]
    );
  }
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  // Tek başına bile sığmayan CJK öbeğini karakterden kır, tamamlananları yaz.
  const splitIfCjkOverflow = () => {
    if (!line || !CJK_RE.test(line) || ctx.measureText(line).width <= maxWidth) return;
    const parts = breakCjk(ctx, line, maxWidth);
    for (const p of parts.slice(0, -1)) lines.push(p);
    line = parts[parts.length - 1] || "";
  };
  for (const word of words) {
    const probe = line ? line + " " + word : word;
    if (ctx.measureText(probe).width <= maxWidth || !line) {
      line = probe;
    } else {
      lines.push(line);
      line = word;
    }
    splitIfCjkOverflow();
  }
  if (line) lines.push(line);
  return lines;
}

export type TextBlockOpts = {
  text: string;
  style: ResolvedText;
  x: number;      // blok sol kenarı (gerçek px)
  y: number;      // blok üst kenarı
  w: number;      // blok genişliği
  scale: number;  // BASE → gerçek ölçek
  /** Slaytın dili ("tr" | "en-US" | "ar-SA"…). Yoksa bugünkü davranış: tr. */
  locale?: string;
};

/** Metin bloğunu çizer, kapladığı yüksekliği döndürür. */
/**
 * Tek bir KELİME blok enini aşarsa punto en fazla bu orana kadar küçültülür.
 * %62 altına inmek tipografiyi komşu slaytlardan görünür biçimde ayırıyor;
 * o noktada doğru çözüm metni kısaltmaktır, motorun daha fazla ezmesi değil.
 */
const MIN_FIT = 0.62;

export function drawTextBlock(ctx: CanvasRenderingContext2D, o: TextBlockOpts): number {
  const st0 = o.style;
  const content = applyTransform(o.text, st0.transform, o.locale);
  ctx.save();
  applyStyle(ctx, st0, o.scale, o.locale);
  ctx.textBaseline = "alphabetic";

  // --- SIĞDIRMA: `wrapLines` kelime İÇİNDE kırmaz (CJK hariç), yani
  // "Zikirmatik" gibi uzun tek bir kelime dar bir metin sütununda bloktan
  // TAŞAR ve cihazın üstüne biner. Yan sütunlu düzenler (duo-stagger,
  // duo-editorial) bunu kaçınılmaz kılıyor, Türkçe'de uzun kelime kural.
  // Taşma varsa punto oranla küçültülür ve yeniden sarılır; taşma yoksa
  // katsayı 1'dir, yani var olan hiçbir slaytın çıktısı değişmez.
  let st = st0;
  const probe = wrapLines(ctx, content, o.w);
  let widest = 0;
  for (const l of probe) widest = Math.max(widest, ctx.measureText(l).width);
  if (widest > o.w && o.w > 0) {
    const fit = Math.max(MIN_FIT, o.w / widest);
    if (fit < 1) {
      st = { ...st0, sizePx: st0.sizePx * fit };
      applyStyle(ctx, st, o.scale, o.locale);
      ctx.textBaseline = "alphabetic";
    }
  }

  const size = st.sizePx * o.scale;
  const lh = (st.lineHeight || 1.1) * size;
  const lines = wrapLines(ctx, content, o.w);
  let y = o.y + size * 0.82; // ilk satır baseline
  for (const line of lines) {
    const lw = ctx.measureText(line).width;
    let x = o.x;
    if (st.align === "center") x = o.x + (o.w - lw) / 2;
    else if (st.align === "right") x = o.x + o.w - lw;
    ctx.fillText(line, x, y);
    y += lh;
  }
  ctx.restore();
  return lines.length * lh + size * 0.1;
}

export type BadgeOpts = {
  text: string;
  cx: number;          // rozet merkez x (align center) veya sol (left)
  y: number;
  scale: number;
  bg: string;
  color: string;
  fontFamily: string;
  align: "left" | "center" | "right";
  blockX: number;
  blockW: number;
  /** Slaytın dili. Yalnız yazım yönü için; rozet metnine transform uygulanmaz. */
  locale?: string;
};

/** Hap rozet çizer, yüksekliğini döndürür. */
export function drawBadge(ctx: CanvasRenderingContext2D, o: BadgeOpts): number {
  const size = 40 * o.scale;
  ctx.save();
  ctx.font = cssFont(600, size, o.fontFamily);
  applyDirection(ctx, o.locale);
  const tw = ctx.measureText(o.text).width;
  const padX = 34 * o.scale;
  const h = size * 1.9;
  const w = tw + padX * 2;
  let x = o.blockX;
  if (o.align === "center") x = o.blockX + (o.blockW - w) / 2;
  else if (o.align === "right") x = o.blockX + o.blockW - w;
  roundedRectPath(ctx, x, o.y, w, h, h / 2);
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.fillStyle = o.color;
  ctx.textBaseline = "middle";
  ctx.fillText(o.text, x + padX, o.y + h / 2 + size * 0.06);
  ctx.restore();
  return h;
}
