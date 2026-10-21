// DEFNE ÇELENGİ GEOMETRİSİ — TEK KAYNAK.
//
// Çelenk artık TEK parça bir halka değil: asset'in SOL YARISI iki kez basılır,
// sağdaki aynalanarak. Aynı pikselden gelen iki dal kusursuz simetriktir (yeni
// asset gerekmez) ve aralarındaki AÇIKLIK serbest kalır — metin oraya yazılır.
//
// Bütün ölçüler METİNDEN türetilir: punto temanın başlık puntosundan, dal boyu
// ölçülen satır sayısından, açıklık ölçülen satır genişliğinden. Böylece tek
// kelimelik "Ödül" de üç satırlık bir gerekçe de aynı niyetle oturur; eskiden
// çelenk 640px sabitti, metin ise 34px'te kalıp içinde kaybolurdu.
//
// NEDEN AYRI DOSYA: aynı yükseklik ÜÇ yerde lazım — render.ts (çizim + cihazı
// aşağı itme), snap.ts (sürükleme kılavuzları), LocQa.tsx (taşma ölçümü).
// Eskiden üçü de `min(blockW*0.6, 640)` sabitini elle taşıyordu; ölçü artık
// metne bağlı olduğu için o kopyalar kaçınılmaz olarak ayrışırdı.
//
// TÜM DEĞERLER BASE px'tir (1320×2868). Çağıran kendi `scale`'iyle çarpar.

import { applyTransform, resolveText, wrapLines, type ResolvedText } from "./text";
import { cssFont } from "./fonts";
import { getTheme } from "./themes";
import { baseOf, type Format, type LayoutSpec, type Slide, type TextStyle, type Theme } from "./types";

/* ------------------------------------------------------------------ *
   Ayar sabitleri — hepsi tek yerde, hepsi oran
 * ------------------------------------------------------------------ */

/** Yarım asset'in en/boy oranı: asset kare, yarısı da yarım en → 0.5. */
export const BRANCH_AR = 0.5;

/** Ana asset'in açıklık oranı — snap/QA çelengin hangi dosyadan geldiğini
 *  bilmez ama açıklık YALNIZ `gap`'i etkiler, yüksekliği değil. */
export const LAUREL_INNER_W = 0.58;

/** Punto: temanın başlık puntosunun oranı, okunur bir bantta kelepçeli.
 *  Başlıklar 112-150 arasında; bu oran 43-57px verir (eskiden sabit 34). */
const FONT_RATIO = 0.38;
const FONT_MIN = 34;
const FONT_MAX = 58;
const LINE_H = 1.25;

/** Metin bloğunun en fazla bu kadarı çelengin içine girer — kalanı dallara. */
const TEXT_W_MAX = 0.6;
/** Metin ile dalın iç kenarı arasındaki nefes (punto çarpanı). */
const PAD_X = 0.45;
/** Dal boyu = metin boyu × bu + punto × BH_PAD. */
const BH_LINES = 1.5;
const BH_PAD = 0.8;
/** …ama en az metin ENİNİN bu kadarı: tek satırlık UZUN bir ödül adında
 *  satır sayısına bakan formül cılız kalır, dallar iki cansız çengele döner. */
const BH_OF_W = 0.42;
/** En kısa dal (punto çarpanı) ve en uzun dal (blok genişliği çarpanı). */
const BH_MIN = 2.6;
const BH_MAX = 0.46;
/** En dar açıklık (dal eni çarpanı) — dallar asla iç içe geçmez. */
const GAP_MIN = 0.18;
/** Açıklık halka merkezinden uzaklaştıkça DARALIR (yaprakların kıvrımı).
 *  Asset alfasında ölçüldü: iç kenar merkez bandında 0.21, y=0.20'de 0.33.
 *  CURL_SAFE = metnin güvenle yayılabildiği yarı-bant, CURL_K = ötesinde
 *  kaybedilen payın eğimi. Çok satırlı metinde dallar bu kadar açılır. */
const CURL_SAFE = 0.22;
const CURL_K = 3.4;
/** Çelenkten sonraki nefes. */
const ADVANCE_PAD = 18;

/** Cihaz itmesi: çelenk metin bloğunu uzattığı için cihaz aşağı kayar+küçülür. */
const PUSH_Y = 0.34;
const PUSH_K = 0.8;
const PUSH_MAX = 0.16;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ *
   Ölçüm bağlamı

   snap.ts saf geometridir, LocQa kendi offscreen context'ini taşır, render
   ise çizdiği context'i verir. Üçü de AYNI sonucu almalı: verilmezse burada
   tembel açılan tek bir offscreen context kullanılır (fontlar belge genelinde
   kayıtlı olduğu için ölçü render'ınkiyle örtüşür). DOM yoksa (test/SSR)
   kaba bir tahmine düşülür — ölçü bozulur ama akış kırılmaz.
 * ------------------------------------------------------------------ */

let MCTX: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (MCTX !== undefined) return MCTX;
  MCTX = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return MCTX;
}

/** Ölçüm için fontu render.ts'teki kurulumun BİREBİR aynısına getirir. */
function setFont(ctx: CanvasRenderingContext2D, st: ResolvedText): void {
  ctx.font = cssFont(st.weight, st.sizePx, st.fontFamily, st.style === "italic");
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${st.letterSpacing || 0}px`;
  } catch { /* eski tarayıcı */ }
}

/* ------------------------------------------------------------------ *
   Metin stili
 * ------------------------------------------------------------------ */

/**
 * Çelenk metninin stili — gövde ailesi + başlık rengi, punto temadan türer.
 * render/snap/QA hepsi bunu çağırır, punto tek yerde tanımlıdır.
 */
export function ornamentStyle(theme: Theme, over?: Partial<TextStyle>): ResolvedText {
  const sizePx = Math.round(clamp(theme.headline.sizePx * FONT_RATIO, FONT_MIN, FONT_MAX));
  return resolveText(
    { ...theme.sub, sizePx, lineHeight: LINE_H, align: "center" },
    { color: theme.headline.color, ...(over || {}) }
  );
}

/* ------------------------------------------------------------------ *
   Geometri
 * ------------------------------------------------------------------ */

export type OrnamentGeom = {
  /** Çözülmüş metin stili (punto BASE px). */
  style: ResolvedText;
  /** Sarma sonrası satır sayısı ve blok yüksekliği. */
  lines: number;
  textH: number;
  /** Metnin sarıldığı genişlik — en uzun satırın ölçüsü (+ kıl payı). */
  textW: number;
  /** Tek dalın kutusu (yarım asset buraya basılır). */
  bw: number;
  bh: number;
  /** İki dal kutusu arasındaki açıklık. */
  gap: number;
  /** İkilinin toplam eni: 2·bw + gap. */
  totalW: number;
  /** `y += advance` — çelenk boyu + altındaki nefes. */
  advance: number;
};

export type OrnamentGeomOpts = {
  text: string;
  /** Metin bloğunun eni (BASE px) — çelenk bunu ASLA aşmaz. */
  blockW: number;
  style: ResolvedText;
  /** Yüklenen asset'in açıklık oranı; yalnız `gap`'i etkiler. */
  innerW?: number;
  locale?: string;
  /** Ölçüm bağlamı — verilmezse modülün offscreen'i kullanılır. */
  ctx?: CanvasRenderingContext2D | null;
};

/**
 * Metni ölçer, iki dalı ve aralarındaki açıklığı ondan türetir.
 *
 * Zincir: punto → sarma → (satır sayısı, satır eni)
 *         satır sayısı → dal boyu (bh) → dal eni (bw = bh·0.5)
 *         satır eni    → açıklık (gap), dalın kendi iç payı düşülerek
 *
 * Dal kutusu C harfi gibidir: eni `bw` olan kutunun iç tarafındaki
 * `innerW·bw` kadarı zaten BOŞTUR (yaprakların içbükeyi). Metin alanı bu yüzden
 * `gap + 2·innerW·bw` olur; gap da tersinden bu denklemle çözülür.
 */
export function ornamentGeom(o: OrnamentGeomOpts): OrnamentGeom {
  const st = o.style;
  const innerW = o.innerW ?? LAUREL_INNER_W;
  const fontPx = st.sizePx;
  const ctx = o.ctx ?? measureCtx();
  const content = applyTransform(o.text || "", st.transform, o.locale);
  const maxTextW = o.blockW * TEXT_W_MAX;

  // 1) Sarma — metin bloğunun yarısından geniş satır yok.
  let lineCount = 1;
  let textW = 0;
  if (ctx) {
    ctx.save();
    setFont(ctx, st);
    const lines = wrapLines(ctx, content, maxTextW);
    lineCount = Math.max(1, lines.length);
    for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);
    ctx.restore();
    // drawTextBlock GERÇEK ölçekte yeniden sarar; ölçüm BASE'de yapıldığı için
    // kıl payı bir tolerans verilir. Tolerans `maxTextW`i geçemez, yoksa bir
    // sonraki kelime satıra sızıp satır sayısı düşerdi.
    textW = Math.min(maxTextW, textW + 2);
  } else {
    // DOM yok: karakter başına kaba bir en. Yalnız SSR/test yolunda.
    textW = Math.min(maxTextW, content.length * fontPx * 0.52);
  }
  textW = Math.max(textW, fontPx * 0.8);
  const textH = lineCount * (st.lineHeight || LINE_H) * fontPx;

  // 2) Dal boyu metin ÖLÇÜSÜNDEN: satır sayısı ve en, hangisi daha çok yer
  //    istiyorsa. En/boy oranı asset'in yarısından gelir, yaprak ezilmez.
  const padX = fontPx * PAD_X;
  const bh = clamp(
    Math.max(textH * BH_LINES + fontPx * BH_PAD, (textW + 2 * padX) * BH_OF_W),
    fontPx * BH_MIN,
    o.blockW * BH_MAX
  );
  const bw = bh * BRANCH_AR;
  // 3) Açıklık: metin eni + nefes, dalın KENDİ iç boşluğu düşülerek. Uç
  //    satırlar halka merkezinden uzaklaştıkça kıvrıma girdiği için kaybedilen
  //    pay (curl) geri eklenir — dal uzadıkça bu pay kendiliğinden erir.
  const curl = Math.max(0, (textH * BRANCH_AR) / 2 - CURL_SAFE * bw) * CURL_K;
  let gap = Math.max(bw * GAP_MIN, textW + 2 * padX + 2 * curl - 2 * innerW * bw);

  // 4) Emniyet: ikili metin bloğundan geniş olamaz. Dallar yerinde kalır,
  //    açıklık bloğa oturtulur (metin zaten blockW·TEXT_W_MAX ile sınırlı).
  if (2 * bw + gap > o.blockW) gap = Math.max(bw * GAP_MIN, o.blockW - 2 * bw);

  return {
    style: st,
    lines: lineCount,
    textH,
    textW,
    bw,
    bh,
    gap,
    totalW: 2 * bw + gap,
    advance: bh + ADVANCE_PAD,
  };
}

/**
 * Slayttan doğrudan geometri — tema/düzen çözümü burada yapılır ki çağıranlar
 * (snap, QA) aynı puntoyu ve aynı blok enini kendileri kurmak zorunda kalmasın.
 * Çelenk yoksa null.
 */
export function ornamentGeomFor(
  slide: Slide,
  layout: LayoutSpec,
  ctx?: CanvasRenderingContext2D | null,
  locale?: string,
  format?: Format
): OrnamentGeom | null {
  if (!slide.ornament) return null;
  const theme = getTheme(slide.themeId);
  return ornamentGeom({
    text: slide.ornament.text,
    blockW: layout.text.w * baseOf(format).w,
    style: ornamentStyle(theme),
    locale,
    ctx,
  });
}

/** Çelengin metin bloğunda kapladığı yükseklik (BASE px) — yoksa 0. */
export function ornamentAdvance(
  slide: Slide,
  layout: LayoutSpec,
  ctx?: CanvasRenderingContext2D | null,
  locale?: string,
  format?: Format
): number {
  return ornamentGeomFor(slide, layout, ctx, locale, format)?.advance ?? 0;
}

/* ------------------------------------------------------------------ *
   Cihaz itmesi
 * ------------------------------------------------------------------ */

/**
 * Çelenk metin bloğunu uzatır: metin ÜSTTE + cihaz ALTTA düzenlerinde cihaz
 * aşağı itilip biraz küçültülür, yoksa başlık cihaza biner.
 * Split düzenlerde atlanır — iki cihazın hizası bozulur, ikili öbek dağılır.
 */
export function ornamentPushesDevice(slide: Slide, layout: LayoutSpec): boolean {
  return !layout.device2 && !!slide.ornament && layout.device.cy > 0.45 && layout.text.y < 0.4;
}

/** İtme miktarı — çelenk küçüldükçe cihaz da daha az rahatsız edilir. */
export function ornamentDevicePush(advance: number, format?: Format): { dy: number; hScale: number } {
  return {
    dy: advance * PUSH_Y,
    hScale: 1 - Math.min(PUSH_MAX, (advance / baseOf(format).h) * PUSH_K),
  };
}
