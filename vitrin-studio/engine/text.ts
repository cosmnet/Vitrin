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
  if (!transform || transform === "none") return text;
  if (locale && isCaselessScript(scriptForLocale(locale))) return text;
  const loc = locale || "tr";
  if (transform === "uppercase") return text.toLocaleUpperCase(loc);
  if (transform === "lowercase") return text.toLocaleLowerCase(loc);
  // capitalize: her kelimenin ilk harfi büyük, kalanı olduğu gibi (marka adları bozulmasın).
  return text.replace(/(^|[\s\-–—(“"'‘])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toLocaleUpperCase(loc));
}

/**
 * v1.0 — metin efektleri (opaklık, gölge). Yalnız alan TANIMLIYSA dokunur;
 * tanımsızken ctx durumu değişmez → eski slaytlar bit-bit aynı basar.
 */
function applyEffects(ctx: CanvasRenderingContext2D, st: TextStyle, scale: number): void {
  if (st.opacity !== undefined && st.opacity < 1) ctx.globalAlpha *= Math.max(0, st.opacity);
  const sh = st.shadow;
  if (sh && (sh.blur > 0 || sh.dx || sh.dy)) {
    ctx.shadowColor = sh.color;
    ctx.shadowBlur = Math.max(0, sh.blur) * scale;
    ctx.shadowOffsetX = (sh.dx || 0) * scale;
    ctx.shadowOffsetY = (sh.dy || 0) * scale;
  }
}

/** Kontur varsa önce kenar, sonra dolgu (kontur dışa taşar, harfi yemez). */
function paintText(ctx: CanvasRenderingContext2D, st: TextStyle, text: string, x: number, y: number, scale: number): void {
  const w = st.strokeWidth ?? 0;
  if (w > 0 && st.strokeColor) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = w * 2 * scale;
    ctx.strokeStyle = st.strokeColor;
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
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

// ---------------------------------------------------------------------------
// ZENGİN METİN — style.rich === true iken *vurgu*, _el yazısı_, ~bant~.
// Bir başlığın içinde Klein ile açık rengi, düz yazı ile el yazısını iç içe
// kullanmak için. Sarma, sığdırma ve hizalama düz yoldakiyle aynı kurallar.

type RichMark = { accent: boolean; hand: boolean; band: boolean; big: boolean; under: boolean };
type RichPiece = RichMark & { text: string };
type RichWord = { pieces: RichPiece[]; spaceBefore: RichMark | null; w: number };
const PLAIN: RichMark = { accent: false, hand: false, band: false, big: false, under: false };

/** Metni işaretlere göre parçalar; satır sonları ayrı paragraf olur. */
function parseRich(text: string): RichPiece[][] {
  const mark: RichMark = { ...PLAIN };
  const paras: RichPiece[][] = [[]];
  let buf = "";
  const flush = () => {
    if (buf) paras[paras.length - 1].push({ ...mark, text: buf });
    buf = "";
  };
  for (const ch of text) {
    if (ch === "*" || ch === "_" || ch === "~" || ch === "^" || ch === "=") {
      flush();
      if (ch === "*") mark.accent = !mark.accent;
      else if (ch === "_") mark.hand = !mark.hand;
      else if (ch === "~") mark.band = !mark.band;
      else if (ch === "=") mark.under = !mark.under;
      else mark.big = !mark.big;
    } else if (ch === "\n") {
      flush();
      paras.push([]);
    } else if (ch !== "\r") {
      buf += ch;
    }
  }
  flush();
  return paras;
}

/** Parçanın punto büyüklüğü (gerçek px): el yazısı ve ^büyük^ çarpanları dahil. */
function richSize(st: ResolvedText, p: RichMark, scale: number): number {
  return st.sizePx * scale * (p.hand ? st.handScale ?? 1.22 : 1) * (p.big ? st.bigScale ?? 1.9 : 1);
}

function richFont(ctx: CanvasRenderingContext2D, st: ResolvedText, p: RichMark, scale: number, locale?: string): number {
  const size = richSize(st, p, scale);
  ctx.font = p.hand
    ? cssFont(st.handWeight ?? 600, size, st.handFamily ?? "Caveat")
    : cssFont(st.weight, size, st.fontFamily, st.style === "italic");
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${p.hand ? 0 : (st.letterSpacing || 0) * scale * (p.big ? st.bigScale ?? 1.9 : 1)}px`;
  } catch { /* eski tarayıcı */ }
  applyDirection(ctx, locale);
  return size;
}

function richWords(ctx: CanvasRenderingContext2D, para: RichPiece[], st: ResolvedText, scale: number, locale?: string): RichWord[] {
  const words: RichWord[] = [];
  let cur: RichWord | null = null;
  let pendingSpace: RichMark | null = null;
  for (const piece of para) {
    const parts = piece.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (cur) words.push(cur);
        cur = null;
        pendingSpace = { accent: piece.accent, hand: piece.hand, band: piece.band, big: piece.big, under: piece.under };
        continue;
      }
      if (!cur) {
        cur = { pieces: [], spaceBefore: words.length ? pendingSpace : null, w: 0 };
        pendingSpace = null;
      }
      richFont(ctx, st, piece, scale, locale);
      cur.pieces.push({ ...piece, text: part });
      cur.w += ctx.measureText(part).width;
    }
  }
  if (cur) words.push(cur);
  return words;
}

function drawRichBlock(ctx: CanvasRenderingContext2D, o: TextBlockOpts): number {
  const st0 = o.style;
  const paras = parseRich(applyTransform(o.text, st0.transform, o.locale));
  ctx.save();
  applyEffects(ctx, st0, o.scale);
  ctx.textBaseline = "alphabetic";

  type Line = { words: RichWord[]; w: number; size: number };
  const layout = (st: ResolvedText) => {
    // Boşluk, önündeki kelimenin büyüklüğünde: dev kelimeler arası boşluk da dev.
    const spaceOf = (m: RichMark | null) => {
      richFont(ctx, st, m ?? PLAIN, o.scale, o.locale);
      return ctx.measureText(" ").width;
    };
    // İki kelime arası boşluk, iki komşudan büyüğünün boşluğu: dev el yazısının
    // yanındaki küçük kelime ona yapışmasın.
    const gap = (prev: RichWord | undefined, word: RichWord) =>
      Math.max(spaceOf(word.spaceBefore), prev ? spaceOf(prev.pieces[prev.pieces.length - 1]) : 0);
    const base = richSize(st, PLAIN, o.scale);
    const lines: Line[] = [];
    let widest = 0;
    const sizeOf = (ws: RichWord[]) => ws.length ? Math.max(...ws.flatMap(w => w.pieces.map(p => richSize(st, p, o.scale)))) : base;
    for (const para of paras) {
      const words = richWords(ctx, para, st, o.scale, o.locale);
      if (!words.length) { lines.push({ words: [], w: 0, size: base }); continue; }
      let line: RichWord[] = [];
      let lw = 0;
      for (const word of words) {
        widest = Math.max(widest, word.w);
        const add = line.length ? gap(line[line.length - 1], word) + word.w : word.w;
        if (line.length && lw + add > o.w) {
          lines.push({ words: line, w: lw, size: sizeOf(line) });
          line = [{ ...word, spaceBefore: null }];
          lw = word.w;
        } else {
          line.push(line.length ? word : { ...word, spaceBefore: null });
          lw += add;
        }
      }
      lines.push({ words: line, w: lw, size: sizeOf(line) });
    }
    return { lines, widest, gap };
  };

  let st = st0;
  let lay = layout(st);
  if (lay.widest > o.w && o.w > 0) {
    const fit = Math.max(MIN_FIT, o.w / lay.widest);
    if (fit < 1) {
      st = { ...st0, sizePx: st0.sizePx * fit };
      lay = layout(st);
    }
  }

  const lineHeight = st.lineHeight || 1.1;
  const colorOf = (p: RichMark) =>
    p.band ? st.bandTextColor ?? st.color
    : p.hand ? st.handColor ?? st.accentColor ?? st.color
    : p.accent ? st.accentColor ?? st.color
    : st.color;
  let top = o.y;
  for (const line of lay.lines) {
    const size = line.size;
    const y = top + size * 0.82;
    let x = o.x;
    if (st.align === "center") x = o.x + (o.w - line.w) / 2;
    else if (st.align === "right") x = o.x + o.w - line.w;

    // Önce bantlar: ardışık bant parçaları (aradaki boşluk dahil) tek dikdörtgen.
    const spans: { x0: number; x1: number; size: number }[] = [];
    const unders: { x0: number; x1: number; size: number }[] = [];
    const extend = (list: typeof spans, x0: number, x1: number, size: number) => {
      const last = list[list.length - 1];
      if (last && Math.abs(last.x1 - x0) < 0.5) { last.x1 = x1; last.size = Math.max(last.size, size); }
      else list.push({ x0, x1, size });
    };
    let cx = x;
    for (const [wi, word] of line.words.entries()) {
      if (word.spaceBefore) {
        const sw = lay.gap(line.words[wi - 1], word);
        if (word.spaceBefore.band && spans.length && Math.abs(spans[spans.length - 1].x1 - cx) < 0.5) spans[spans.length - 1].x1 = cx + sw;
        if (word.spaceBefore.under && unders.length && Math.abs(unders[unders.length - 1].x1 - cx) < 0.5) unders[unders.length - 1].x1 = cx + sw;
        cx += sw;
      }
      for (const p of word.pieces) {
        const ps = richFont(ctx, st, p, o.scale, o.locale);
        const w = ctx.measureText(p.text).width;
        if (p.band) extend(spans, cx, cx + w, ps);
        if (p.under) extend(unders, cx, cx + w, ps);
        cx += w;
      }
    }
    if (spans.length && st.bandColor) {
      ctx.fillStyle = st.bandColor;
      for (const s of spans) {
        const padX = s.size * 0.14;
        roundedRectPath(ctx, s.x0 - padX, y - s.size * 0.86, s.x1 - s.x0 + padX * 2, s.size * 1.08, s.size * 0.06);
        ctx.fill();
      }
    }
    // Alt çizgi: kalın, yuvarlak uçlu, yazının hemen altında (=işaretli= parçalar).
    if (unders.length) {
      ctx.save();
      ctx.strokeStyle = st.underlineColor ?? st.accentColor ?? st.color;
      ctx.lineCap = "round";
      for (const u of unders) {
        ctx.lineWidth = u.size * (st.underlineWidth ?? 0.085);
        const uy = y + u.size * 0.17;
        ctx.beginPath();
        ctx.moveTo(u.x0 + ctx.lineWidth / 2, uy);
        ctx.lineTo(u.x1 - ctx.lineWidth / 2, uy);
        ctx.stroke();
      }
      ctx.restore();
    }

    cx = x;
    for (const [wi, word] of line.words.entries()) {
      if (word.spaceBefore) cx += lay.gap(line.words[wi - 1], word);
      for (const p of word.pieces) {
        richFont(ctx, st, p, o.scale, o.locale);
        ctx.fillStyle = colorOf(p);
        paintText(ctx, st, p.text, cx, y, o.scale);
        cx += ctx.measureText(p.text).width;
      }
    }
    top += size * lineHeight;
  }
  ctx.restore();
  return top - o.y + richSize(st, PLAIN, o.scale) * 0.1;
}

export function drawTextBlock(ctx: CanvasRenderingContext2D, o: TextBlockOpts): number {
  if (o.style.rich) return drawRichBlock(ctx, o);
  const st0 = o.style;
  const content = applyTransform(o.text, st0.transform, o.locale);
  ctx.save();
  applyStyle(ctx, st0, o.scale, o.locale);
  applyEffects(ctx, st0, o.scale);
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
    paintText(ctx, st, line, x, y, o.scale);
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
