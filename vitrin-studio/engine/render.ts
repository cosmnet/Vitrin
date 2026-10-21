// Slayt renderer'ı — Set Plan'daki bir slaytı istenen boyutta canvas'a çizer.
// Önizleme ve export aynı yoldan geçer: ölçek dışında fark yok.

import { drawCover, loadImage, sourceFingerprint } from "./assets";
import { renderBackgroundWithFx } from "./backgrounds";
import { renderDevice2D } from "./device2d";
import { drawElements } from "./elements";
import { themeElements } from "./editor";
import { ensureSlideFonts } from "./fonts";
import { applyGrade } from "./grade";
import { getLayoutForFormat, LAYOUTS } from "./layouts";
import { drawSplitScreens } from "./splitScreens";
import {
  ornamentAdvance,
  ornamentDevicePush,
  ornamentGeom,
  ornamentPushesDevice,
  ornamentStyle,
} from "./ornament";
import { applyOverlays, glowRing, mergeOverlay, seedFrom, vignette } from "./overlays";
import { perfSpan } from "./perf";
import { renderDevice3D, type Device3DRequest } from "./scene3d";
import { drawBadge, drawTextBlock, resolveText } from "./text";
import { fitPrivateTypography } from "@private";
import { getTheme } from "./themes";
import {
  BASE_H,
  BASE_W,
  baseOf,
  isDevice3D,
  deviceStyleForFormat,
  type Background,
  type DeviceStyle,
  type DeviceStyle2D,
  type Format,
  type Slide,
} from "./types";

/* ------------------------------------------------------------------ *
   C32 — ALAN BAZLI İMZA

   `JSON.stringify(slide)` bir slaytın TAMAMINI kopyalar; `screenshot` bir
   dataURL olduğu için bu her tuş vuruşunda megabaytlarca string üretmek
   demek (Stage iki efektte, thumbnail kuyruğu her karede çağırıyordu).
   Görsel alanları kısa bir parmak iziyle değiştiren imza aynı işi görür:
   dataURL'ler uzunluk + baş/son dilimle temsil edilir — aynı görsel aynı
   anahtarı, farklı görsel pratikte farklı anahtarı verir.
 * ------------------------------------------------------------------ */

/** Uzun kaynak string'ini (dataURL/yol) sabit maliyetli parmak izine indirger. */
function srcKey(src: string | undefined): string {
  return sourceFingerprint(src);
}

/** Arka planın imzası — image kaynağı parmak izine iner, kalanı aynen. */
function bgKey(bg: Background | undefined): string {
  if (!bg) return "-";
  if (bg.kind === "image") {
    // overlayBlend imzaya GİRMELİ: yoksa zemin önbelleği harman modu
    // değişince eski kareyi döndürür (C28 LRU aynı anahtarı görür).
    return `img|${srcKey(bg.src)}|${bg.overlayColor ?? ""}|${bg.overlayAlpha ?? ""}|${
      bg.overlayBlend ?? ""
    }|${bg.blur ?? ""}|${JSON.stringify(bg.crop ?? null)}|${JSON.stringify(bg.imageCrop ?? null)}`;
  }
  return JSON.stringify(bg);
}

/**
 * Slaydın render imzası — `JSON.stringify(slide)` yerine geçer.
 * Aynı imza → aynı piksel. Ekran görüntüleri ve image zeminleri parmak izidir.
 */
export function slideSignature(slide: Slide | null | undefined): string {
  if (!slide) return "-";
  const rest: Record<string, unknown> = {};
  for (const k of Object.keys(slide) as (keyof Slide)[]) {
    if (k === "screenshot" || k === "screenshot2" || k === "screenshot3" || k === "background")
      continue;
    rest[k] = slide[k];
  }
  return `${srcKey(slide.screenshot)}|${srcKey(slide.screenshot2)}|${srcKey(
    slide.screenshot3
  )}|${bgKey(slide.background)}|${JSON.stringify(rest)}`;
}

/* ------------------------------------------------------------------ *
   C28 — ZEMİN KATMANI MEMOİZASYONU

   Başlık yazarken zemin DEĞİŞMİYOR; ama her tuş vuruşunda gradient/mesh/
   shader yeniden üretiliyordu (1760px'te tek başına render'ın büyük kısmı).
   Zemin ayrı bir offscreen'e çizilir, imzayla saklanır; sonraki render
   yalnızca `drawImage` yapar — 1:1, tam sayı koordinatta, yani çıktı
   bit-bit aynıdır.

   LRU 6 girdi + toplam piksel bütçesi: tek bir 1760×3824 karesi ~27MB
   RAM demek; 6 tanesi 160MB olurdu. Bütçe büyük kareleri 3'e sınırlar,
   küçük thumbnail kareleri zaten bütçeye takılmaz.
 * ------------------------------------------------------------------ */

type BgEntry = { key: string; canvas: HTMLCanvasElement; px: number };

const BG_LRU: BgEntry[] = [];
const BG_MAX = 6;
const BG_PX_BUDGET = 20e6;

/** Ölçüm/QA için: kaç istek önbellekten karşılandı. */
export const bgCacheStats = { hit: 0, miss: 0 };

function bgCacheKey(
  bg: Background,
  fx: Slide["bgFx"],
  w: number,
  h: number,
  draft: boolean
): string {
  return `${bgKey(bg)}|${fx?.blur ?? ""},${fx?.dim ?? ""},${fx?.sat ?? ""}|${w}x${h}|${draft ? 1 : 0}`;
}

function bgTrim(): void {
  let px = BG_LRU.reduce((s, e) => s + e.px, 0);
  while (BG_LRU.length > BG_MAX || (BG_LRU.length > 1 && px > BG_PX_BUDGET)) {
    const gone = BG_LRU.shift();
    if (!gone) break;
    px -= gone.px;
    // Tarayıcıya "bu raster serbest" sinyali — Safari'de fark ediliyor.
    gone.canvas.width = 0;
    gone.canvas.height = 0;
  }
}

/** Zemini (efekt katmanıyla birlikte) önbellekten ya da üreterek ctx'e basar. */
async function paintBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  fx: Slide["bgFx"],
  W: number,
  H: number,
  draft: boolean
): Promise<void> {
  const key = bgCacheKey(bg, fx, W, H, draft);
  const at = BG_LRU.findIndex((e) => e.key === key);
  if (at >= 0) {
    const hit = BG_LRU[at];
    BG_LRU.splice(at, 1);
    BG_LRU.push(hit); // en son kullanılan sona
    bgCacheStats.hit++;
    ctx.drawImage(hit.canvas, 0, 0);
    return;
  }
  bgCacheStats.miss++;

  let layer: HTMLCanvasElement | null = null;
  try {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d");
    if (octx) {
      await renderBackgroundWithFx(bg, octx, W, H, fx, draft);
      layer = off;
    }
  } catch {
    layer = null;
  }
  if (!layer) {
    // Offscreen kurulamadıysa eski yol — önbelleksiz ama doğru.
    await renderBackgroundWithFx(bg, ctx, W, H, fx, draft);
    return;
  }
  BG_LRU.push({ key, canvas: layer, px: W * H });
  bgTrim();
  ctx.drawImage(layer, 0, 0);
}

/** Test/QA kancası — önbelleği boşaltır (ölçüm öncesi temiz başlangıç). */
export function clearBackgroundCache(): void {
  for (const e of BG_LRU) {
    e.canvas.width = 0;
    e.canvas.height = 0;
  }
  BG_LRU.length = 0;
  bgCacheStats.hit = 0;
  bgCacheStats.miss = 0;
}

/* ------------------------------------------------------------------ *
   Defne çelengi (ornament) asset'i

   Asset'ler KARE ve içerikleri ortalı BÜTÜN birer çelenk — ama artık bütün
   basılmıyor. Yalnız SOL YARISI alınıp bir dal olarak çizilir, sağdaki aynı
   yarının aynalanmışıdır: iki dal aynı pikselden geldiği için simetri
   kusursuzdur ve yeni bir dosya gerekmez. Aradaki açıklık serbest kalır,
   metin oraya yazılır (engine/ornament.ts geometriyi kurar).

   Kare kutuya göre ölçülmüş iki oran taşınır:
     innerW → çelengin iç açıklığının bütün kutuya oranı (açıklığı belirler)
     ringCy → halkanın dikey merkezi (metin bu hizaya ortalanır)
 * ------------------------------------------------------------------ */

type LaurelAsset = { img: HTMLImageElement; innerW: number; ringCy: number };

// Ana asset — Envato vektör çelengi. 1600×1600, içerik ortalı ve kutunun
// %92'sini kaplıyor; ölçülen iç açıklık y=0.40..0.56 bandında 0.66-0.70.
const LAUREL_MAIN = { src: "/assets/stickers/laurel-envato.png", innerW: 0.58, ringCy: 0.48 };
// Yedek — eski dolgun çelenk. İçerik kutunun ~%73'ü, açıklık ~0.53 ile daha dar.
const LAUREL_FALLBACK = { src: "/assets/stickers/laurel-gold.png", innerW: 0.46, ringCy: 0.46 };

/** Çelengi yükler; ana asset gelmezse (404/bozuk dosya) sessizce yedeğe düşer. */
async function loadLaurel(): Promise<LaurelAsset | null> {
  for (const a of [LAUREL_MAIN, LAUREL_FALLBACK]) {
    const img = await loadImage(a.src);
    if (img) return { img, innerW: a.innerW, ringCy: a.ringCy };
  }
  return null;
}

export type RenderOpts = {
  width: number;
  height: number;
  /** Taslak mod (sürükleme/thumbnail): yarı çözünürlük, overlay/gren yok,
   *  3D cihaz düşük maliyetle render edilir. Export bunu ASLA kullanmaz. */
  draft?: boolean;
  /** Set'in dili — CJK fontlarının tembel yüklenmesi, büyük harf/RTL kuralları. */
  locale?: string;
  /** Proje formatı (iPhone/iPad) — BASE px tabanını ve cihaz türünü seçer. Yoksa iPhone. */
  format?: Format;
};

export async function renderSlide(slide: Slide, opts: RenderOpts): Promise<HTMLCanvasElement> {
  if (opts.draft) {
    // Yarı boyutta çiz, istenen boyuta ölçekleyerek bas — GPU/CPU maliyeti ~1/4.
    const inner = await renderSlideAt(
      slide,
      Math.max(1, Math.round(opts.width / 2)),
      Math.max(1, Math.round(opts.height / 2)),
      true,
      opts.locale,
      opts.format
    );
    const out = document.createElement("canvas");
    out.width = opts.width;
    out.height = opts.height;
    const octx = out.getContext("2d");
    if (octx) {
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "medium";
      octx.drawImage(inner, 0, 0, out.width, out.height);
    }
    return out;
  }
  return renderSlideAt(slide, opts.width, opts.height, false, opts.locale, opts.format);
}

/* ------------------------------------------------------------------ *
   composeStatic — TEK STATİK KOMPOZİTÖR (R8/W2)

   ESKİDEN: `renderSlideAt` kompozisyonu çizerdi, `Stage.tsx` ise 3D canlı
   yol için `drawTextLayer` adında ELLE KOPYALANMIŞ bir ikiz taşırdı. İki
   kopya kaçınılmaz olarak ayrıştı (ikizde çelenk hiç yoktu, zemin önbelleği
   yoktu, glow/metin sırası tersti) ve kompozisyona giren HER yeni katman
   iki yere birden yazılmak zorundaydı.

   ŞİMDİ: tek fonksiyon, üç dilim. Kompozisyon şu sırada akar

       zemin(+bgFx) → öğeler("under") → [metin, textZ="below" ise]
         → glowRing → ⟨CİHAZ YUVASI⟩
         → [metin, textZ="above" ise] → öğeler("over") → grade → bitiriciler

   ve `bucket` bu akışın hangi diliminin çizileceğini seçer:
     "all"   → hepsi                       (2D önizleme + export)
     "under" → cihaz yuvasından ÖNCESİ     (Stage'in alt tuvali)
     "over"  → cihaz yuvasından SONRASI    (Stage'in üst tuvali)
   `skipDevice` yuvayı boş bırakır — canlı 3D'de cihaz ayrı bir DOM katmanı.

   Böylece Stage'in iki tuvali ve export AYNI fonksiyonu çağırır: yeni bir
   katman eklemek tek bir yerde iş demektir.
 * ------------------------------------------------------------------ */

export type ComposeBucket = "all" | "under" | "over";

export type ComposeOpts = {
  /** Taslak mod — bitiriciler atlanır, 3D cihaz ucuz yoldan gelir. */
  draft?: boolean;
  locale?: string;
  /** Proje formatı — BASE px tabanı (scale) ve cihaz türü (kind) buradan. */
  format?: Format;
  /** Cihaz yuvası boş bırakılır (canlı 3D: cihaz ayrı WebGL katmanı). */
  skipDevice?: boolean;
  /** Akışın hangi dilimi çizilsin (vars. "all"). */
  bucket?: ComposeBucket;
  /**
   * Bitirici katmanlar:
   *   "full"     → doku + gren + vignette (tek tuval yolu; export)
   *   "vignette" → YALNIZ vignette. Katmanlı yolda zorunlu: gren `overlay`
   *                blend'iyle SAYDAM bir tuvale basılırsa cihazın üstünde
   *                gri bir sis bırakır, doku da tüm sahneyi örter.
   *   "none"     → hiçbiri (taslak)
   * Vars: taslakta "none", değilse "full".
   */
  overlays?: "full" | "vignette" | "none";
};

export async function composeStatic(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
  opts: ComposeOpts = {}
): Promise<void> {
  const draft = !!opts.draft;
  const locale = opts.locale;
  const bucket = opts.bucket ?? "all";
  const wantUnder = bucket === "all" || bucket === "under";
  const wantOver = bucket === "all" || bucket === "over";
  const overlayMode = opts.overlays ?? (draft ? "none" : "full");

  const theme = getTheme(slide.themeId);
  await ensureSlideFonts(slide, theme, locale);
  slide = fitPrivateTypography(slide);
  const fmt = opts.format ?? "iphone";
  const layoutId = LAYOUTS[slide.layout] ? slide.layout : theme.defaultLayout;
  let layout = getLayoutForFormat(layoutId, fmt);
  // Multi-device compositions fall back without a second shot. Image split
  // layouts keep both windows and show a placeholder in the missing one.
  if (layout.device2 && !layout.splitPanels && !slide.screenshot2) layout = getLayoutForFormat("text-top", fmt);
  // BASE px → gerçek px. Taban FORMATA bağlı: iPhone 1320, iPad 1548 (types.ts).
  const scale = W / baseOf(fmt).w;

  // 1) Arka plan (+ slide.bgFx efekt katmanı — yalnız zemine uygulanır).
  // C28: aynı (zemin, efekt, boyut, taslak) dörtlüsü önbellekten gelir.
  if (wantUnder) {
    const endBg = perfSpan("render.bg");
    if (!slide.layerStates?.background?.hidden) await paintBackground(ctx, slide.background ?? theme.background, slide.bgFx, W, H, draft);
    endBg();
  }

  // 2) Cihaz kutusu (layout + elle nudge)
  const dev = deviceStyleForFormat(slide.device ?? theme.device, fmt);
  const dOff = slide.deviceOffset || { x: 0, y: 0 };
  const box = {
    cx: layout.device.cx * W + dOff.x * scale,
    cy: layout.device.cy * H + dOff.y * scale,
    h: layout.device.scale * H * (dOff.scale ?? 1),
    // Slaytın kendi eğimi (derece) düzenin eğimine (radyan) EKLENİR.
    rotation: (layout.device.rotation || 0) + deg2rad(dOff.rotation),
  };
  // İkinci cihaz kutusu (split düzenler). Kendi nudge'ı var: device2Offset.
  const d2Off = slide.device2Offset || { x: 0, y: 0 };
  const box2 = layout.device2 && !slide.layerStates?.device2?.hidden
    ? {
        cx: layout.device2.cx * W + d2Off.x * scale,
        cy: layout.device2.cy * H + d2Off.y * scale,
        h: layout.device2.scale * H * (d2Off.scale ?? 1),
        rotation: (layout.device2.rotation || 0) + deg2rad(d2Off.rotation),
      }
    : null;
  const d3Off = slide.device3Offset || { x: 0, y: 0 };
  const box3 = layout.device3 && !slide.layerStates?.device3?.hidden
    ? {
        cx: layout.device3.cx * W + d3Off.x * scale,
        cy: layout.device3.cy * H + d3Off.y * scale,
        h: layout.device3.scale * H * (d3Off.scale ?? 1),
        rotation: (layout.device3.rotation || 0) + deg2rad(d3Off.rotation),
      }
    : null;
  // Defne çelengi metin bloğunu uzatır: cihazı aşağı itip biraz küçült ki
  // başlık cihaza binmesin. Koşul da miktar da ornament.ts'te — snap.ts aynı
  // iki fonksiyonu çağırdığı için sürükleme kılavuzları render'la ayrışamaz.
  if (ornamentPushesDevice(slide, layout)) {
    const push = ornamentDevicePush(ornamentAdvance(slide, layout, null, locale, fmt), fmt);
    box.cy += push.dy * scale;
    box.h *= push.hScale;
  }
  const drawsDevice = wantUnder && !opts.skipDevice && !slide.hideDevice;
  const is3D = isDevice3D(dev);
  const duoClosed = dev.mode === "3d" && dev.duoPosture === "closed" || fmt.includes("duo-cover") && !(dev.mode === "3d" && dev.duoPosture === "open");
  const primarySrc = duoClosed && !layout.device2 ? slide.screenshot2 || slide.screenshot : slide.screenshot;
  const shot = drawsDevice && primarySrc ? await loadImage(primarySrc) : null;
  // 2./3. ekran yalnız split kutusu varken DEĞİL, 3D'de her zaman yüklenir:
  // pair/fan3/stack3 presetleri layout'tan bağımsız olarak birden çok telefon
  // kuruyor ve artık her biri KENDİ ekranını alıyor.
  const shot2 =
    drawsDevice && (box2 || is3D) && slide.screenshot2 ? await loadImage(slide.screenshot2) : null;
  const src3 = slide.screenshot3 || slide.screenshot2;
  const shot3 = drawsDevice && (box3 || is3D) && src3 ? await loadImage(src3) : null;
  // Eksik ekran sırayla bir öncekine düşer — BOŞ ekranlı telefon asla
  // gösterilmez (types.ts Slide.screenshot3 sözleşmesi).
  const shotB = shot2 ?? shot;
  const shotC = shot3 ?? shotB;
  // Defne çelengi süsü (MD "LAUREL" alanı) — metinden önce yüklenir.
  const laurel = slide.ornament?.kind === "laurel" ? await loadLaurel() : null;

  // Cihazdan ÖNCE: arkasında duran ışık halkası. İki cihaz varsa TEK ve geniş
  // bir halka çizilir (iki halka ortada yanık bir bant bırakıyor).
  // "under" diliminin son adımı — canlı 3D'de de alt tuvale düşer.
  //
  // R9: halka artık VARSAYILAN KAPALI. Eskiden `theme.glowRing` varsa zorla
  // çiziliyordu ve kullanıcının kapatacağı bir yer yoktu. Şimdi yalnız
  // `slide.glow.on` ile açılır; renk/şiddet verilmezse tema değerleri taban.
  const drawGlow = () => {
    const g = slide.glow;
    if (!g?.on) return;
    // Kutuların ortak merkezi + en uzak kutuyu kapsayan yarıçap: üçlü
    // düzenlerde de tek ve geniş bir halka çıkar.
    const bs = [box, box2, box3].filter((b): b is NonNullable<typeof b> => !!b);
    const gcx = bs.reduce((s, b) => s + b.cx, 0) / bs.length;
    const gcy = bs.reduce((s, b) => s + b.cy, 0) / bs.length;
    const reach = bs.reduce(
      (m, b) => Math.max(m, Math.hypot(b.cx - gcx, b.cy - gcy) + b.h * 0.62),
      0
    );
    glowRing(ctx, {
      color: g.color ?? theme.glowRing?.color ?? "#ffffff",
      cx: gcx,
      cy: gcy,
      r: bs.length > 1 ? reach : box.h * 0.8,
      alpha: g.alpha ?? theme.glowRing?.alpha ?? 0.3,
    });
  };

  const drawDevice = async () => {
    if (slide.hideDevice) return;
    if (layout.splitPanels) {
      drawSplitScreens(ctx, slide, [shot, shot2], W, H, fmt);
      return;
    }
    // R10/E — SPLIT ARTIK 3D. Eskiden burada `flatPair` vardı: iki cihazlı her
    // düzen 3D sahneyi tamamen kapatıp iki telefonu da 2D kontur yolundan
    // çiziyordu (ışık, cam, gölge, perspektif yok). Artık N telefon TEK 3D
    // sahnede, ortak ışık/gölge/yansıma altında duruyor — kutular kamera
    // düzleminde piksel eşlemeli konumlanıyor (scene3dCore.placeByPixels).
    const flatStyle: DeviceStyle2D = isDevice3D(dev)
      ? {
          mode: "2d",
          kind: dev.kind,
          frame: "kontur",
          shadow: dev.shadow !== false,
          reflection: dev.reflection === true,
        }
      : dev;

    if (is3D) {
      const boxes = [box, box2, box3].filter((b): b is NonNullable<typeof b> => !!b);
      const multi = boxes.length > 1;
      // 1.12 = tek cihazlı 3D'nin ESKİ perspektif telafisi (3D cihaz kutuyu
      // 2D ile aynı doldursun diye). ÇOKLU cihazda uygulanmaz: düzenlerin
      // bütçesi 2D cihaz enine göre kuruldu (split-v'nin 61px oluğu gibi) ve
      // %12 şişirme o oluğu tamamen yiyor — iki telefon birbirine değiyor.
      // Çoklu kompozisyonda bağlayıcı kısıt YATAY bütçedir, kutu doluluğu değil.
      const comp = multi ? 1 : 1.12;
      const req: Device3DRequest & { draft?: boolean } = {
        screenshot: shot,
        screenshots: multi ? [shot, ...(box2 ? [shotB] : []), ...(box3 ? [shotC] : [])] : [shot, shotB, shotC],
        style: dev,
        width: W,
        height: H,
        box: { cx: box.cx, cy: box.cy, h: box.h * comp },
        boxes: multi
          ? boxes.map((b) => ({ cx: b.cx, cy: b.cy, h: b.h, rotation: b.rotation }))
          : undefined,
        draft,
      };
      const layer = await renderDevice3D(req);
      ctx.drawImage(layer, 0, 0, W, H);
      return;
    }

    await renderDevice2D({ ctx, style: flatStyle, screenshot: shot, box, scale });
    // İkinci/üçüncü cihaz — birinciyle AYNI stil, aynı 2D yol.
    if (box2) {
      await renderDevice2D({ ctx, style: flatStyle, screenshot: shotB, box: box2, scale });
    }
    if (box3) {
      await renderDevice2D({ ctx, style: flatStyle, screenshot: shotC, box: box3, scale });
    }
  };

  const drawText = () => {
    const tOff = slide.textOffset || { x: 0, y: 0 };
    const blockX = layout.text.x * W + tOff.x * scale;
    const blockW = layout.text.w * W;
    let y = layout.text.y * H + tOff.y * scale;
    const align = layout.text.align;

    // Overlay düzeninde metin cihazın üstüne biner — okunabilirlik için scrim.
    if (layout.id === "text-overlay") {
      const headColor = slide.headlineStyle?.color || theme.headline.color;
      const darkText = luminance(headColor) < 0.5;
      const scrim = darkText ? "255,255,255" : "8,8,12";
      const g = ctx.createLinearGradient(0, y - 300 * scale, 0, H);
      g.addColorStop(0, `rgba(${scrim},0)`);
      g.addColorStop(0.35, `rgba(${scrim},0.55)`);
      g.addColorStop(1, `rgba(${scrim},0.78)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 300 * scale, W, H - (y - 300 * scale));
    }

    // Metin bloğu eğimi (R7/W3): scrim DÖNMEZ — yalnız yazı öbeği döner,
    // çapa bloğun üst-orta noktasıdır. Eğim yoksa tek bir save/restore bile
    // harcanmaz, yani eski çıktı bit-bit aynı kalır.
    const textMatrix = ctx.getTransform();
    const tRot = deg2rad(tOff.rotation);
    if (tRot) {
      ctx.save();
      const ax = blockX + blockW / 2;
      ctx.translate(ax, y);
      ctx.rotate(tRot);
      ctx.translate(-ax, -y);
    }

    if (slide.badge && !slide.layerStates?.badge?.hidden) {
      const b = theme.badge || { bg: theme.accent, color: "#fff" };
      const h = drawBadge(ctx, {
        text: slide.badge,
        cx: blockX + blockW / 2,
        y,
        scale,
        bg: b.bg,
        color: b.color,
        fontFamily: b.fontFamily || theme.sub.fontFamily,
        align,
        blockX,
        blockW,
        locale,
      });
      y += h + 36 * scale;
    }

    // Defne çelengi (MD LAUREL): rozetin altında, İKİ DAL ARASINDA metin.
    // Ölçüler ornament.ts'te metinden türer (punto temadan, dal boyu satır
    // sayısından, açıklık satır eninden); burası yalnız çizer.
    if (laurel && slide.ornament) {
      const g = ornamentGeom({
        text: slide.ornament.text,
        blockW: blockW / scale,
        style: ornamentStyle(theme),
        innerW: laurel.innerW,
        locale,
      });
      const bw = g.bw * scale;
      const bh = g.bh * scale;
      const lx = blockX + (blockW - g.totalW * scale) / 2;
      const rx = lx + (g.bw + g.gap) * scale;
      // Kaynak dilim: asset'in SOL YARISI. Sağdaki dal aynı dilimin kendi sağ
      // kenarından aynalanmışı — iki dal aynı pikselden gelir, simetri tam.
      const sw = laurel.img.width / 2;
      const sh = laurel.img.height;
      ctx.drawImage(laurel.img, 0, 0, sw, sh, lx, y, bw, bh);
      ctx.save();
      ctx.translate(rx + bw, y);
      ctx.scale(-1, 1);
      ctx.drawImage(laurel.img, 0, 0, sw, sh, 0, 0, bw, bh);
      ctx.restore();

      // Metin dalların halka merkezine GERÇEK satır sayısıyla dikey ortalanır:
      // tek satırlık "Ödül" de üç satırlık gerekçe de aynı hizada durur.
      const textW = g.textW * scale;
      drawTextBlock(ctx, {
        text: slide.ornament.text,
        style: g.style,
        x: blockX + (blockW - textW) / 2,
        y: y + bh * laurel.ringCy - (g.textH * scale) / 2,
        w: textW,
        scale,
        locale,
      });
      y += g.advance * scale;
    }
    const drawCopy = (key: "headline" | "sub", text: string, style: ReturnType<typeof resolveText>, defaultY: number) => {
      const frame = slide.textBoxes?.[key];
      if (!frame) {
        if (!slide.layerStates?.[key]?.hidden) return drawTextBlock(ctx, { text, style, x: blockX, y: defaultY, w: blockW, scale, locale });
        // Hidden text retains its advance so hiding a layer does not move its siblings.
        const measure = document.createElement("canvas").getContext("2d");
        return measure ? drawTextBlock(measure, { text, style, x: 0, y: 0, w: blockW, scale, locale }) : 0;
      }
      ctx.save();
      ctx.setTransform(textMatrix);
      const fx = frame.x * scale, fy = frame.y * scale, fw = frame.w * scale;
      const measure = document.createElement("canvas").getContext("2d");
      const fh = measure ? drawTextBlock(measure, { text, style, x: 0, y: 0, w: fw, scale, locale }) : style.sizePx * scale;
      if (frame.rotation) {
        ctx.translate(fx + fw / 2, fy + fh / 2);
        ctx.rotate(deg2rad(frame.rotation));
        ctx.translate(-fx - fw / 2, -fy - fh / 2);
      }
      if (!slide.layerStates?.[key]?.hidden) drawTextBlock(ctx, { text, style, x: fx, y: fy, w: fw, scale, locale });
      ctx.restore();
      return measure ? drawTextBlock(measure, { text, style, x: 0, y: 0, w: blockW, scale, locale }) : fh;
    };
    const headStyle = resolveText({ ...theme.headline, align }, slide.headlineStyle);
    const usedH = drawCopy("headline", slide.headline, headStyle, y);
    y += usedH + 18 * scale;
    if (slide.sub) {
      const subStyle = resolveText({ ...theme.sub, align }, slide.subStyle);
      drawCopy("sub", slide.sub, subStyle, y);
    }
    if (tRot) ctx.restore();
  };

  // 3) Z sırası — cihaz yuvası akışı ikiye böler.
  const textBelow = layout.textZ === "below";
  if (wantUnder) {
    // Öğelerin "under" kovası: cihazın ARKASI. Halkadan da önce çizilir ki
    // glowRing (lighter) onların üstüne ışık serpsin.
    // Tema öğeleri ÖNCE (kart zemini, cetvel…), slaytınkiler üstüne.
    await drawElements(ctx, themeElements(slide), W, H, scale, "under", locale);
    await drawElements(ctx, slide.elements, W, H, scale, "under", locale);
    if (textBelow) drawText();
    if (!layout.splitPanels && !slide.hideDevice) drawGlow();
    if (drawsDevice) await drawDevice();
  }
  if (wantOver) {
    if (!textBelow) drawText();
    // "over" kovası metinden SONRA, bitiricilerden ÖNCE — gren en üstte kalsın.
    await drawElements(ctx, themeElements(slide), W, H, scale, "over", locale);
    await drawElements(ctx, slide.elements, W, H, scale, "over", locale);
  }

  // 4) Kompozit grade — FİLM SIRASI: grade ÖNCE, gren/vignette SONRA.
  // Zemin, cihaz ve metin burada tek ton eğrisinde buluşur; bitiriciler
  // (gren/doku/vignette) baskının üstündeki fiziksel katmandır, grade'lenmez.
  // Taslakta da uygulanır (tek GPU pass, ~2-4ms) ama halation çeyrek
  // çözünürlükten, aberasyon yarı güçten geçer.
  // KATMANLI YOLDA ATLANIR: grade bir GPU pass'idir, sahnenin TAMAMINI ister;
  // parça parça uygulanamaz (Stage grubun üstüne CSS filtresi koyar).
  if (slide.grade && bucket === "all") await applyGrade(ctx, W, H, slide.grade, draft);

  // 5) Bitirici katmanlar — her şeyin ÜSTÜNE (doku → gren → vignette)
  // Taslakta atlanır: gren/doku en pahalı adımlar, sürüklemede fark edilmez.
  //
  // R8/W4 (B-4.1): tema bitiricisi + SLAYT override'ı. `mergeOverlay` slaytta
  // TANIMLI olmayan alanları temadan miras bırakır; slide.overlay yoksa tema
  // nesnesinin KENDİSİ döner → eski çıktı bit-bit korunur.
  const ov = mergeOverlay(theme.overlay, slide.overlay);
  if (wantOver && overlayMode === "full") {
    await applyOverlays(ctx, W, H, ov, seedFrom(slide.id || slide.headline));
  } else if (wantOver && overlayMode === "vignette" && ov?.vignette) {
    vignette(ctx, W, H, ov.vignette);
  }
}

async function renderSlideAt(
  slide: Slide,
  width: number,
  height: number,
  draft: boolean,
  locale?: string,
  format?: Format
): Promise<HTMLCanvasElement> {
  const endTotal = perfSpan("render.total");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context alınamadı");
    await composeStatic(ctx, slide, width, height, { draft, locale, format });
    return canvas;
  } finally {
    endTotal();
  }
}

/** Slayt thumbnail'i (slide rail için) — küçük boyut, draft yeterli. */
export async function renderThumb(
  slide: Slide,
  height = 240,
  draft = true,
  locale?: string,
  format?: Format
): Promise<HTMLCanvasElement> {
  const b = baseOf(format);
  const w = Math.round((height * b.w) / b.h);
  return renderSlide(slide, { width: w, height, draft, locale, format });
}

/** Derece → radyan; tanımsız/0 için tam olarak 0 döner (eski çıktı korunur). */
function deg2rad(d?: number): number {
  return d ? (d * Math.PI) / 180 : 0;
}

/** Kaba luminance (0..1) — scrim renginin yönünü seçmek için yeterli. */
function luminance(hex: string): number {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}/.test(h)) return 1;
  const n = parseInt(h.slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/* ------------------------------------------------------------------ *
   Ölçüm kancası — `window.__vitrinRender`

   /headless-export'taki `window.__vitrin*` sözleşmesiyle aynı dil. Motoru
   tarayıcı konsolundan (ya da MCP'den) ölçmeye yarar: zemin önbelleğini
   boşalt, sayaçları oku, renderSlide'ı elle çağır. Üretim davranışını
   DEĞİŞTİRMEZ; yalnız var olan fonksiyonları dışarı açar.
 * ------------------------------------------------------------------ */
if (typeof window !== "undefined") {
  (window as unknown as { __vitrinRender?: unknown }).__vitrinRender = {
    renderSlide,
    slideSignature,
    bgCacheStats,
    clearBackgroundCache,
  };
}

/** Bir görseli (ör. Wiro üretimi) slayt oranına cover-fit eden yardımcı. */
export function coverCanvas(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) drawCover(ctx, img, 0, 0, w, h);
  return c;
}
