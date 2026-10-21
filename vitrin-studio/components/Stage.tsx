"use client";

// TUVAL KUYUSU — UI v3.
//
// Rapor §10: tuval, kromdan bir kademe koyu, KENARLIKSIZ ve inset gölgeyle
// çökük bir "kuyu"dur; eser onun üstünde kendi gölgesiyle yüzer. Krom
// kontrastı bilerek kısıktır ki iş öne çıksın. Üstteki eski araç şeridi
// KALDIRILDI; yerine Framer'ın yüzen alt araç adası geldi (zeminden 16px).
//
// Render hattı (R8/W2 sonrası):
//   2D slayt: renderSlide → composeStatic — export ile birebir AYNI yol.
//   3D slayt: üç katman (alt canvas · canlı WebGL cihaz · üst canvas) ama
//     alt/üst tuvaller de AYNI composeStatic'i çağırır (bucket "under"/"over",
//     skipDevice). `drawTextLayer` el-kopyası SİLİNDİ — motora eklenen her
//     katman artık tek yerde yazılır.
//
// SÜRÜKLEME (R8/W2): mutlak-delta. Sürükleme başındaki değer `origin`e
// alınır ve her karede `origin + (şimdiki - başlangıç)` hesaplanır. Eski
// kümülatif delta (her karede startX güncelleniyordu) snapping ile birlikte
// "yapış-kaç" titremesi üretirdi.
//
// ═══════════════════════════════════════════════════════════════════════
// R8/W3 — "CANVAS-FEEL": tuval artık bir PRO TUVAL gibi davranır.
//
//   ÇIPLAK TEKERLEK  → tuvali KAYDIR (eskiden cihaz ölçeğiydi)
//   ⌥ + TEKERLEK     → cihaz ölçeği (eski çıplak tekerlek buraya taşındı)
//   ⌘/Ctrl + TEKERLEK→ İMLEÇ ALTINA zoom (trackpad pinch de bu yoldan gelir)
//   BOŞLUK + SÜRÜKLE → pan (grab imleci) · ORTA TIK da aynı yol
//
// Bu bir KAS HAFIZASI kırılmasıdır; bu yüzden kuyu künyesi ve TopBar'ın
// kısayol listesi aynı dalgada güncellendi (bkz. `navHint` ve SHORTCUTS).
//
// Pan/zoom NATIVE SCROLL üzerinden yürür (`.viewer-scroll{overflow:auto}`):
// macOS'un atalet/momentum'u ve kauçuk kenarı BEDAVA gelir. Manuel bir
// transform-pan yazmak aynı hissi elde tutmayı gerektirirdi.
//
// İki ayrı "zoom" vardır ve karıştırılmamalıdır:
//   · effZoom   — GÖRSEL zoom. DOM kutusunu anında büyütür; tuvalin bitmap'i
//                 tarayıcı tarafından esnetilir → pinch 60fps.
//   · rasterZoom— RASTER zoom. 160ms sessizlikten sonra effZoom'a oturur ve
//                 asıl `renderSlide` bu ölçüde koşar → keskin kare.
//
// GEÇİŞ (C7/C8/C10): slayt değişiminde `.stage-ghost` tuvali ESKİ kareyi
// tutar ve yeni karenin İLK boyaması bitince 0.7×--t-base'de sönümlenir.
// Ek render maliyeti YOK (var olan bitmap kopyalanır) ve 2D↔3D geçişindeki
// beyaz sıçramayı da örter.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadImage } from "@/engine/assets";
import { editorLayers, editorLayout, hitLayers, layerBox, layerElement, patchLayerElement, textFramePatch, type EditorLayer } from "@/engine/editor";
import { splitCropDefault } from "@/engine/splitScreens";
import { EL_TEXT_BASE } from "@/engine/elements";
import {
  bucketOf,
  copyElementStyle,
  elementById,
  elementLabel,
  elementStyleClip,
  elementStyleClipLabel,
  makeElement,
  patchElement,
  removeElement as removeEl,
  reorderElement,
  hitTest,
} from "@/engine/elements";
import { gradeCssFilter } from "@/engine/grade";
import { getLayoutForFormat } from "@/engine/layouts";
import { composeStatic, renderSlide, slideSignature } from "@/engine/render";
import {
  preloadModels,
  subscribeGlbProgress,
  type GlbProgress,
} from "@/engine/scene3dCore";
import { createLiveDeviceView, type LiveView } from "@/engine/scene3dLive";
import {
  collectTargets,
  deviceBox,
  nearest,
  snapBox,
  textBox,
  type SnapTargets,
} from "@/engine/snap";
import { getTheme } from "@/engine/themes";
import { isSplitScreen, splitFrames } from "@/engine/splitScreens";
import { peekThumb } from "@/engine/thumbs";
import {
  baseOf,
  deviceAspectOf,
  deviceStyleForFormat,
  formatOf,
  type Format,
  clamp,
  isDevice3D,
  uid,
  type ElKind,
  type LayoutSpec,
  type Slide,
  type SlideElement,
} from "@/engine/types";
import { beginUndoGesture, clearSlideSelection, endUndoGesture, useStudio } from "@/store/studio";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  getPreviewFrame,
  previewClear,
  putPreviewFrame,
  usePreviewOverride,
} from "./previewOverride";
import { copyStyle, styleClip, styleClipLabel } from "./styleClip";
import { pushUndoToast } from "./toast";
import { Icon, useRenderRev } from "./ui";
import { L } from "@/lib/i18n";

type Tool = "device" | "text" | "orbit" | "select";
type Zoom = "fit" | number;

/** 2D önizleme rasterinin en fazla genişliği (kaynak px). */
const RENDER_CAP = 1760;
/** Canlı 3D katmanının en fazla CSS genişliği; üstü CSS scale ile büyütülür. */
const LIVE_CAP = 820;
/** Yapışma eşiği — EKRAN px (zoom'dan bağımsız his). */
const SNAP_PX = 8;
/** Kılavuz rengi — sistem kırmızısı, tuvale ASLA çizilmez. */
const GUIDE = "#ff2d55";
/** En küçük öğe kenarı (BASE px). */
const MIN_EL = 24;
/** C6 — zoom durduktan kaç ms sonra keskin raster basılsın. */
const RASTER_SETTLE_MS = 160;
/** Hayalet karenin en fazla kaç ms sonra zorla düşürüleceği (emniyet). */
const GHOST_MAX_MS = 700;
/** Hayalet sönümü — --t-base × 0.7 (çıkışlar 0.7×) + bir kare pay. */
const GHOST_FADE_MS = 200;
/** Zoom sınırları — ada butonları ve tekerlek aynı aralıkta yaşar. */
const Z_MIN = 0.08;
const Z_MAX = 8;

const ZOOM_STEPS: { id: Zoom; label: string }[] = [
  { id: "fit", label: L("Sığdır", "Fit") },
  { id: 0.5, label: "50" },
  { id: 1, label: "100" },
  { id: 2, label: "200" },
];

/* ---------------------------------------------------------------------------
   Dışarıdan "sığdır" isteği — Studio'daki F kısayolu bunu çağırır.
   --------------------------------------------------------------------------- */
const fitSubs = new Set<() => void>();

/** Viewer'ı sığdır moduna al (F kısayolu). */
export function requestFitZoom(): void {
  for (const f of fitSubs) f();
}

/* ---------------------------------------------------------------------------
   Seçim tutamakları — 8 yön + döndürme. CSS overlay olarak yaşarlar; tuvale
   çizilseler taslak render'ı kirletir ve export'a sızma riski doğardı.
   --------------------------------------------------------------------------- */
type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: { id: HandleId; x: number; y: number; cur: string }[] = [
  { id: "nw", x: 0, y: 0, cur: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cur: "ns-resize" },
  { id: "ne", x: 1, y: 0, cur: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cur: "ew-resize" },
  { id: "se", x: 1, y: 1, cur: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cur: "ns-resize" },
  { id: "sw", x: 0, y: 1, cur: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cur: "ew-resize" },
];

type DragMode =
  | { kind: "device" }
  /** Split düzenlerdeki İKİNCİ telefon — kendi nudge'ı var (device2Offset). */
  | { kind: "device2" }
  | { kind: "text" }
  | { kind: "element"; id: string }
  | { kind: "resize"; id: string; handle: HandleId }
  | { kind: "rotate"; id: string }
  | { kind: "layer"; id: string }
  | { kind: "layer-resize"; id: string; handle: HandleId }
  | { kind: "layer-rotate"; id: string }
  | { kind: "crop"; id: string };

type DragState = {
  startX: number;
  startY: number;
  mode: DragMode;
  /** Sürükleme BAŞINDAKİ değerler — mutlak delta buradan hesaplanır. */
  origin: { x: number; y: number; w: number; h: number; rot: number; ang: number; scale?: number; offX?: number; offY?: number; fontSize?: number; focusX?: number; focusY?: number; spanX?: number; spanY?: number; flipX?: boolean; flipY?: boolean };
  targets: SnapTargets;
  slideId: string;
  /** En az bir pointermove geldi mi? Gelmediyse bu bir TIKLAMADIR: commit
   *  edilmez, yoksa "seçmek için tıkla" bile bir geri alma adımı harcardı. */
  moved: boolean;
};

/** Yazı yazılan bir alanda mıyız? (kısayollar orada susar — Studio ile aynı) */
function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  return /^(input|textarea|select)$/i.test(t.tagName || "");
}



/**
 * Tuvaldeki tıklama hangi nesneye ait? (BASE px koordinatlarında)
 *
 * Sıra ÖNEMLİ:
 *   1. İkinci telefon — üstte duran, daha küçük nesne; onu kaçırmak
 *      kullanıcıyı "diğer ekrana müdahale edemiyorum" noktasına düşürüyordu.
 *   2. Metin mi cihaz mı: düzenin `textZ`'i "above" ise (varsayılan) metin
 *      önce denenir — `text-overlay` gibi metnin telefonun ÜSTÜNE bindiği
 *      düzenlerde görsel sıra neyse tıklama sırası da odur.
 *   3. Hiçbiri değilse cihaz — eski davranış, boş zemine tıklayınca telefon
 *      taşınmaya devam eder.
 *
 * Metin kutusunun yüksekliği render'dan önce bilinemez (satır sayısı orada
 * belli oluyor); bu yüzden başlık bloğu için cömert ama sınırlı bir bant
 * kullanılır. Cihaz kutusu önce/sonra sınandığı için çakışma zaten çözülür.
 */
function pickSubject(
  slide: Slide,
  layout: LayoutSpec,
  bx: number,
  by: number,
  format: Format
): "device" | "device2" | "text" {
  if (slide.hideDevice) return "text";
  const BASE_W = baseOf(format).w;
  const BASE_H = baseOf(format).h;
  const DEV_AR = deviceAspectOf(deviceStyleForFormat(slide.device ?? getTheme(slide.themeId).device, format).kind);
  const inBox = (cx: number, cy: number, h: number) => {
    const w = h * DEV_AR;
    return bx >= cx - w / 2 && bx <= cx + w / 2 && by >= cy - h / 2 && by <= cy + h / 2;
  };

  if (layout.device2 && slide.screenshot2) {
    const o2 = slide.device2Offset || { x: 0, y: 0 };
    if (
      inBox(
        layout.device2.cx * BASE_W + o2.x,
        layout.device2.cy * BASE_H + o2.y,
        layout.device2.scale * BASE_H * (o2.scale ?? 1)
      )
    ) {
      return "device2";
    }
  }

  const o1 = slide.deviceOffset || { x: 0, y: 0 };
  const onDevice = inBox(
    layout.device.cx * BASE_W + o1.x,
    layout.device.cy * BASE_H + o1.y,
    layout.device.scale * BASE_H * (o1.scale ?? 1)
  );

  const tOff = slide.textOffset || { x: 0, y: 0 };
  const tx = layout.text.x * BASE_W + tOff.x;
  const ty = layout.text.y * BASE_H + tOff.y;
  const tw = layout.text.w * BASE_W;
  // Rozet + başlık + alt satır için cömert bant (slayt yüksekliğinin ~%22'si).
  const th = BASE_H * 0.22;
  const onText = bx >= tx && bx <= tx + tw && by >= ty - BASE_H * 0.02 && by <= ty + th;

  if ((layout.textZ ?? "above") === "above") {
    if (onText) return "text";
    if (onDevice) return "device";
  } else {
    if (onDevice) return "device";
    if (onText) return "text";
  }
  return "device";
}

export default function Stage({
  onImport,
  onTemplates,
  onStickers,
}: {
  /** İlk açılış kartı: MD sihirbazını aç. */
  onImport?: () => void;
  /** İlk açılış kartı: şablon çekmecesini aç. */
  onTemplates?: () => void;
  /** Bağlam menüsü "Sticker…": Görseller çekmecesini aç. */
  onStickers?: () => void;
} = {}) {
  const project = useStudio((s) => s.project);
  // FORMAT: tuval oranı, BASE px tabanı ve cihaz türü buradan türer.
  // Ref'i olay dinleyicileri (pointer) güncel değeri okusun diye tutuyoruz.
  const fmt = formatOf(project);
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  const BASE_W = baseOf(fmt).w;
  const BASE_H = baseOf(fmt).h;
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const selectedId = useStudio((s) => s.selectedElementId);
  const selectedLayerId = useStudio(s => s.selectedLayerId);
  const cropEditing = useStudio(s => s.cropEditing);
  const [overlap, setOverlap] = useState<{ x: number; y: number; layers: EditorLayer[] } | null>(null);
  const [inlineText, setInlineText] = useState<{ id: string; value: string } | null>(null);
  const cropImage = useRef<HTMLImageElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const liveHostRef = useRef<HTMLDivElement>(null);
  /**
   * Canlı 3D katmanının DOM düğümü — ref DEĞİL, STATE.
   *
   * NEDEN: `firstRun` açılışta true olduğunda sahne yığını hiç basılmaz, yani
   * bu div yoktur. Kurulum efekti yalnız `is3D`'ye bağlıyken host'u null bulup
   * sessizce çıkıyor, proje yüklenince `firstRun` false olsa da `is3D`
   * değişmediği için BİR DAHA çalışmıyordu: zemin ve yazı geliyor, telefon
   * gelmiyor, ancak sayfa yenilenince düzeliyordu. Callback ref state'i
   * güncelleyince düğüm belirir belirmez efekt yeniden koşar.
   */
  const [liveHost, setLiveHost] = useState<HTMLDivElement | null>(null);
  const attachLiveHost = useCallback((node: HTMLDivElement | null) => {
    liveHostRef.current = node;
    setLiveHost(node);
  }, []);
  const liveRef = useRef<LiveView | null>(null);
  /** C7 — geçişte eski kareyi tutan hayalet tuval (üstte, pointer geçirmez). */
  const ghostRef = useRef<HTMLCanvasElement>(null);
  /** C11 — hover önizlemesinin taslak karesi. */
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** C12 — hover'ın İLK karesi: kart JPEG'i (senkron önbellek, gecikme 0). */
  const previewImgRef = useRef<HTMLImageElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fitZoom, setFitZoom] = useState(0.24);
  /** C2 — boşluk basılı: kuyu pan moduna geçer (grab imleci). */
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const [safeArea, setSafeArea] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; bx: number; by: number } | null>(null);
  /** Sürükleme sırasında yakalanan kılavuzlar (BASE px) — CSS div'lere gider. */
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  const rev = useRenderRev(); // tema yerinde düzenlenince (overlay şiddeti) tazele

  // Sürükleme/tekerlek sırasında draft render (akıcılık) — bırakınca tam kalite.
  const [dragging, setDragging] = useState(false);
  const pendingRef = useRef<(() => Promise<void>) | null>(null); // en güncel draft işi
  const pumpingRef = useRef(false); // rAF pompası çalışıyor mu
  const wheelEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = project.sets[project.activeLocale];
  const slide: Slide | undefined =
    set.slides.find((x) => x.id === activeSlideId) || set.slides[0];
  // C32: tam JSON.stringify yerine alan bazlı imza — ekran görüntüsü
  // dataURL'leri her tuş vuruşunda megabaytlarca string üretmiyor.
  const slideJson = slideSignature(slide);
  const is3D = slide ? !slide.hideDevice && !isSplitScreen(slide) && isDevice3D(slide.device ?? getTheme(slide.themeId).device) : false;

  // Canlı 3D yolunda kompozit üç DOM katmanına bölünmüştür; tek GPU grade
  // pass'i mümkün değil. Grubun üstüne KABA bir CSS filtresi konur
  // (saturate/contrast/brightness); split-tone, aberasyon ve halation atlanır.
  // 2D önizleme ve export renderSlide'dan geçtiği için TAM doğru.
  const liveGrade = is3D && slide?.grade ? gradeCssFilter(slide.grade) : undefined;

  // İlk açılış: hiç ekran yok, tek dokunulmamış slayt → üç yönlendirme kartı.
  const firstRun =
    project.screenshots.length === 0 &&
    set.slides.length <= 1 &&
    !set.slides[0]?.screenshot;

  // Aktif slayt kimliği — orbit commit callback'i güncel kimliği buradan okur.
  const slideIdRef = useRef<string | null>(null);
  slideIdRef.current = slide?.id ?? null;
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;

  const effZoom = zoom === "fit" ? fitZoom : zoom;
  const canvasWidth = Math.max(120, Math.round(BASE_W * effZoom));
  const size = {
    w: canvasWidth,
    h: Math.round(canvasWidth * BASE_H / BASE_W),
  };
  /** BASE px → ekran px çarpanı (kılavuz/tutamak yerleşimi). */
  const k = size.w / BASE_W;

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const slideRef = useRef<Slide | undefined>(slide);
  slideRef.current = slide;
  const fitZoomRef = useRef(fitZoom);
  fitZoomRef.current = fitZoom;
  const is3DRef = useRef(is3D);
  is3DRef.current = is3D;
  const panReadyRef = useRef(panReady);
  panReadyRef.current = panReady;

  // ---------------------------------------------------------------------------
  // C6 — GÖRSEL ZOOM ile RASTER ZOOM'un ayrılması.
  //
  // `size` (dolayısıyla tuvalin CSS genişliği) effZoom'u ANINDA izler: tarayıcı
  // eldeki bitmap'i esnetir, pinch tek kare bile düşürmez. `rasterZoom` ise
  // 160ms sessizlikten sonra oturur; asıl `renderSlide` YALNIZ o an koşar.
  // Eskiden her pinch karesi 1760px'lik tam bir render tetikliyordu.
  // ---------------------------------------------------------------------------
  const [rasterZoom, setRasterZoom] = useState(effZoom);
  useEffect(() => {
    if (Math.abs(rasterZoom - effZoom) < 0.0005) return;
    const t = setTimeout(() => setRasterZoom(effZoom), RASTER_SETTLE_MS);
    return () => clearTimeout(t);
  }, [effZoom, rasterZoom]);
  /** Raster'ın karşılık geldiği CSS genişliği (canlı 3D katmanı da bunu kullanır). */
  const rasterCssW = Math.max(120, Math.round(BASE_W * rasterZoom));

  // ---------------------------------------------------------------------------
  // C7 / C10 — ÇİFT TAMPON CROSSFADE (hayalet kare)
  //
  // Klasik çift tampon iki `<canvas>` tutar ve hangisinin "ön" olduğunu takas
  // eder. Burada aynı şey tek bir HAYALET tuvalle yapılır: slayt değişiminin
  // RENDER FAZINDA (DOM daha değişmeden) o an görünen kare hayalete kopyalanır,
  // hayalet opaklık 1'de üste oturur; altta yeni slayt boyanır; ilk boyama
  // biter bitmez hayalet 0.7×--t-base'de sönümlenir. Sonuç aynı, iki farkla:
  //   · 2D↔3D geçişini de örter (DOM ağacı komple değişse bile kare kalır),
  //   · ek RENDER maliyeti sıfırdır — yalnız bir `drawImage`.
  //
  // Neden render fazı: 2D↔3D geçişinde React eski `<canvas>`'ı commit'te
  // söker; layout-effect'e kaldığımızda kopyalanacak bitmap ARTIK YOKTUR.
  // Render fazında refs hâlâ ÖNCEKİ commit'in düğümlerini gösterir. Kopyalama
  // React durumuna dokunmaz (yalnız kendi tuvalimize çizeriz), bu yüzden çift
  // çağrılması (StrictMode) da zararsızdır.
  // ---------------------------------------------------------------------------
  const ghostT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captureGhost = useCallback(() => {
    const g = ghostRef.current;
    const card = cardRef.current;
    if (!g || !card) return;
    const cw = card.clientWidth;
    const ch = card.clientHeight;
    if (cw < 8 || ch < 8) return;
    // Hayalet 168ms yaşayacak: kart CSS boyutu (1×) fazlasıyla yeterli.
    const W = Math.min(1100, Math.max(64, Math.round(cw)));
    const H = Math.max(1, Math.round((W * ch) / cw));
    const ctx = g.getContext("2d");
    if (!ctx) return;
    g.width = W;
    g.height = H;
    ctx.clearRect(0, 0, W, H);
    let drew = false;
    const put = (src: HTMLCanvasElement | null | undefined) => {
      if (!src || !src.width || !src.height) return;
      try {
        ctx.drawImage(src, 0, 0, W, H);
        drew = true;
      } catch {
        /* boyanmamış tuval — atla */
      }
    };
    put(canvasRef.current); // 2D yol
    put(underRef.current); // 3D alt katman
    // Canlı WebGL tuvali `preserveDrawingBuffer` OLMADAN kurulur: kopya çoğu
    // zaman boş gelir. Denenir, gelirse kâr; gelmezse zemin+metin yine de
    // sönümlenecek bir kare verir (siyah sıçramadan iyidir).
    put(liveHostRef.current?.querySelector("canvas") as HTMLCanvasElement | null);
    put(overRef.current); // 3D üst katman
    if (!drew) return;
    if (ghostT.current) clearTimeout(ghostT.current);
    g.classList.remove("out");
    g.classList.add("on");
    // Emniyet: yeni kare hiç gelmezse hayalet sonsuza kadar asılı kalmasın.
    ghostT.current = setTimeout(() => {
      g.classList.add("out");
      ghostT.current = setTimeout(() => g.classList.remove("on", "out"), GHOST_FADE_MS);
    }, GHOST_MAX_MS);
  }, []);

  const releaseGhost = useCallback(() => {
    const g = ghostRef.current;
    if (!g || !g.classList.contains("on") || g.classList.contains("out")) return;
    if (ghostT.current) clearTimeout(ghostT.current);
    g.classList.add("out");
    // `transitionend` hareket-azaltmada (süre 0) güvenilir değil → sabit süre.
    ghostT.current = setTimeout(() => g.classList.remove("on", "out"), GHOST_FADE_MS);
  }, []);

  // RENDER FAZI: slayt kimliği değiştiyse ÖNCEKİ kareyi hemen dondur.
  const shownId = useRef<string | null>(null);
  if (slide && shownId.current !== null && shownId.current !== slide.id) captureGhost();
  if (slide) shownId.current = slide.id;

  useEffect(
    () => () => {
      if (ghostT.current) clearTimeout(ghostT.current);
    },
    []
  );

  const selected: SlideElement | null = slide ? layerElement(slide, selectedLayerId) : null;
  const selectionBox = slide ? layerBox(slide, selectedLayerId, fmt, project.activeLocale) : null;
  const selectedLayer = slide ? editorLayers(slide).find(l => l.id === selectedLayerId) : undefined;
  useEffect(() => {
    cropImage.current = null;
    const bg = slide ? slide.background ?? getTheme(slide.themeId).background : null;
    const src = selected?.src ?? (selectedLayerId === "background" && bg?.kind === "image" ? bg.src : selectedLayerId === "screen:0" ? slide?.screenshot : selectedLayerId === "screen:1" ? slide?.screenshot2 : undefined);
    let alive = true;
    if (src) void loadImage(src).then(img => { if (alive) cropImage.current = img; });
    return () => { alive = false; };
  }, [selectedLayerId, selected?.src, slide?.background, slide?.screenshot, slide?.screenshot2]);
  useEffect(() => { setInlineText(null); setOverlap(null); }, [slide?.id, project.activeLocale]);

  // Bir öğe SEÇİLDİĞİ anda seçim aracına geç: seçim panelden de gelebilir
  // (Inspector listesi, sticker çekmecesi) ve tutamaklar yalnız bu araçta
  // görünür — aksi hâlde "seçtim ama tuvalde bir şey olmadı" hissi doğuyor.
  // Yalnız null → id GEÇİŞİNDE çalışır, kullanıcının araç seçimini ezmez.
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    if (selectedLayerId) setTool("select");
    prevSel.current = selectedLayerId;
  }, [selectedLayerId]);

  // F kısayolu → sığdır
  useEffect(() => {
    const fit = () => {
      zoomAnchor.current = null;
      zoomGesture.current = null;
      setZoom("fit");
    };
    fitSubs.add(fit);
    return () => {
      fitSubs.delete(fit);
    };
  }, []);

  // Kapsayıcıya sığdırma oranı
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const pad = 78; // .viewer-scroll dolgusu + yüzen ada payı
      const cw = Math.max(160, el.clientWidth - pad);
      const ch = Math.max(220, el.clientHeight - pad);
      setFitZoom(Math.min(cw / BASE_W, ch / BASE_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [BASE_W, BASE_H]);

  // Tekerlek zamanlayıcısını unmount'ta temizle
  useEffect(
    () => () => {
      if (wheelEndRef.current) clearTimeout(wheelEndRef.current);
    },
    []
  );

  // ---------------------------------------------------------------------------
  // GLB yükleme durumu — canlı 3D ya da draft render bir modeli beklerken
  // sahnede küçük çip gösterilir (preload sessizdir, çip çıkarmaz).
  // ---------------------------------------------------------------------------
  const [glbLoad, setGlbLoad] = useState<GlbProgress>({ active: 0, ratio: 0, file: null });
  useEffect(() => subscribeGlbProgress(setGlbLoad), []);

  // İlk boyamadan sonra boşta tüm telefon modellerini ısıt.
  useEffect(() => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      // `timeout` ŞART: içe aktarma gibi yoğun anlarda boşta zaman hiç gelmez
      // ve ısıtma süresiz ertelenir — model ilk kullanımda soğuk yüklenirdi.
      ric(() => preloadModels(), { timeout: 3000 });
      return;
    }
    const t = setTimeout(() => preloadModels(), 2000);
    return () => clearTimeout(t);
  }, []);

  // ---------------------------------------------------------------------------
  // Canlı 3D görünüm — kur / boz (yalnızca 3D slaytta yaşar)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!is3D) return;
    const host = liveHost;
    if (!host) return;
    const view = createLiveDeviceView(host);
    liveRef.current = view;
    view.onOrbitCommit((orbit) => {
      // Sönüm oturunca son orbit'i store'a yaz — export/thumbnail aynı açıyı basar.
      const id = slideIdRef.current;
      if (!id) return;
      useStudio.getState().mutate((p) => {
        const sl = p.sets[p.activeLocale].slides.find((x) => x.id === id);
        if (!sl) return p;
        const d = sl.device ?? getTheme(sl.themeId).device;
        if (!isDevice3D(d)) return p;
        sl.device = { ...d, orbit };
        return p;
      });
    });
    return () => {
      view.dispose();
      liveRef.current = null;
    };
  }, [is3D, liveHost]);

  // Canlı görünümü besle — store değiştikçe stil/ekran/kutu güncellenir.
  //
  // `liveHost` BAĞIMLILIKTA OLMAK ZORUNDA: görünüm bir üstteki efektte
  // kuruluyor, yani bu efekt ilk turda `liveRef.current === null` görüp
  // çıkıyor. Sadece [slideJson, is3D]'ye bağlı kalırsa görünüm kurulduktan
  // sonra bir daha koşmaz ve sahne BOŞ kalır: zemin ile yazı gelir, telefon
  // gelmez. Kullanıcı bir şeye dokununca slideJson değişip sahne dolduğu
  // için hata "geç geliyor / yenileyince geliyor" diye görünüyordu.
  useEffect(() => {
    const view = liveRef.current;
    if (!is3D || !view || !slide) return;
    const theme = getTheme(slide.themeId);
    const dev = slide.device ?? theme.device;
    if (!isDevice3D(dev)) return;
    const layout = getLayoutForFormat(slide.layout, fmt) || getLayoutForFormat(theme.defaultLayout, fmt);
    const dOff = slide.deviceOffset || { x: 0, y: 0 };
    const d2Off = slide.device2Offset || { x: 0, y: 0 };
    const d3Off = slide.device3Offset || { x: 0, y: 0 };

    // R10 — ÇOKLU CİHAZ CANLI YOLDA. Kutu listesinin İLK elemanı `boxRatio` ile
    // aynı olmalı: motor kadrajı ona göre kurup kalanları piksel eşlemesiyle
    // yerleştiriyor. Sıra = derinlik sırası (device en önde).
    // `layout.device2 && screenshot2` koşulu composeStatic'in kuralının aynısı:
    // ikinci ekran yoksa düzen text-top'a düşüyor, canlı katman da aynı kararı
    // vermeli — yoksa statik önizleme tek, canlı iki telefon gösterirdi.
    const box1 = {
      cx: layout.device.cx + dOff.x / BASE_W,
      cy: layout.device.cy + dOff.y / BASE_H,
      scale: layout.device.scale * (dOff.scale ?? 1),
      rotation: layout.device.rotation,
    };
    const boxes = [box1];
    if (layout.device2 && slide.screenshot2 && !slide.layerStates?.device2?.hidden) {
      boxes.push({
        cx: layout.device2.cx + d2Off.x / BASE_W,
        cy: layout.device2.cy + d2Off.y / BASE_H,
        scale: layout.device2.scale * (d2Off.scale ?? 1),
        rotation: layout.device2.rotation,
      });
    }
      // Üçüncü ekran EKSİKSE motor bir öncekine geri döner.
      if (layout.device3 && slide.screenshot2 && !slide.layerStates?.device3?.hidden) {
        boxes.push({
          cx: layout.device3.cx + d3Off.x / BASE_W,
          cy: layout.device3.cy + d3Off.y / BASE_H,
          scale: layout.device3.scale * (d3Off.scale ?? 1),
          rotation: layout.device3.rotation,
        });
      }

    view.setSlide({
      screenshot: ((dev.duoPosture === "closed" || fmt.includes("duo-cover") && dev.duoPosture !== "open") && !layout.device2 ? slide.screenshot2 || slide.screenshot : slide.screenshot) ?? null,
      screenshots: [
        ((dev.duoPosture === "closed" || fmt.includes("duo-cover") && dev.duoPosture !== "open") && !layout.device2 ? slide.screenshot2 || slide.screenshot : slide.screenshot) ?? null,
        ...(layout.device2 && slide.layerStates?.device2?.hidden ? [] : [slide.screenshot2 ?? null]),
        ...(layout.device3 && slide.layerStates?.device3?.hidden ? [] : [slide.screenshot3 ?? slide.screenshot2 ?? null]),
      ],
      style: deviceStyleForFormat(dev, fmt),
      boxRatio: box1,
      boxes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideJson, is3D, liveHost, fmt, BASE_W, BASE_H]);

  // ---------------------------------------------------------------------------
  // 2D: statik render — export ile aynı yol.
  // ---------------------------------------------------------------------------
  // NOT: `size.w` DEĞİL `rasterCssW` — raster zoom'un 160ms gecikmeli hâlini
  // izler (C6). Zoom sürerken bu değer sabit kalır, yani render tetiklenmez.
  const rasterW = Math.min(Math.round(rasterCssW * 2), RENDER_CAP);
  const rasterH = Math.round((rasterW * BASE_H) / BASE_W);

  /** Tuvalde en son BOYANAN slaydın kimliği — geçiş tespiti (C8). */
  const paintedId = useRef<string | null>(null);
  /** En son boyanan raster genişliği — zoom oturması tespiti (C6). */
  const paintedRaster = useRef(0);

  useEffect(() => {
    if (!slide || is3D) return;
    let dead = false;
    const paint = async (draft: boolean) => {
      const c = await renderSlide(slide, {
        format: fmt,
        width: rasterW,
        height: rasterH,
        draft,
        locale: project.activeLocale,
      });
      if (dead) return;
      const dst = canvasRef.current;
      if (!dst) return;
      dst.width = c.width;
      dst.height = c.height;
      dst.getContext("2d")?.drawImage(c, 0, 0);
    };

    if (dragging) {
      // latest-wins: pompa kare başına en fazla bir draft render basar.
      pendingRef.current = () => paint(true);
      if (!pumpingRef.current) {
        pumpingRef.current = true;
        const pump = () => {
          const job = pendingRef.current;
          pendingRef.current = null;
          if (!job) {
            pumpingRef.current = false;
            return;
          }
          requestAnimationFrame(() => {
            job()
              .catch((e) => console.error("draft render:", e))
              .finally(pump);
          });
        };
        pump();
      }
      return () => {
        dead = true;
      };
    }

    // C8 — SLAYT DEĞİŞİMİNDE ÖNCE TASLAK, SONRA TAM KALİTE.
    // Eskiden burada koşulsuz 90ms beklenirdi: film şeridinde slayt seçince
    // eski kare 90ms boyunca duruyor, sonra sıçrıyordu ("ölü kare"). Artık
    // geçişte taslak (¼ maliyet, ~1 kare) HEMEN basılır, hayalet onun üstünde
    // sönümlenir; tam kalite 90ms sonra sessizce yerine geçer.
    const fresh = paintedId.current !== slide.id;
    paintedId.current = slide.id;
    // Zoom OTURDU: `rasterZoom` zaten 160ms sessizlik bekledi, üstüne bir de
    // 90ms yazma debounce'u koymak keskin kareyi gereksiz geciktirir. 90ms
    // metin/slider düzenlemesini toplamak için var — zoom için değil.
    const rasterChanged = paintedRaster.current !== rasterW;
    paintedRaster.current = rasterW;
    let full: ReturnType<typeof setTimeout> | null = null;

    const runFull = async () => {
      try {
        await paint(false);
        if (!dead) releaseGhost();
      } catch (e) {
        console.error("render:", e);
      }
    };

    const run = async () => {
      if (fresh) {
        try {
          await paint(true);
        } catch (e) {
          console.error("draft render:", e);
        }
        if (dead) return;
        releaseGhost();
      }
      if (rasterChanged && !fresh) {
        await runFull();
        return;
      }
      full = setTimeout(() => {
        full = null;
        void runFull();
      }, 90);
    };
    void run();

    return () => {
      dead = true;
      if (full) clearTimeout(full);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideJson, rasterW, rasterH, is3D, rev, dragging, fmt]);

  // ---------------------------------------------------------------------------
  // 3D: alt ve üst statik katmanlar — İKİSİ DE composeStatic.
  //
  // "under" = zemin + öğeler(under) + glowRing (cihaz yuvası BOŞ: cihaz canlı
  // WebGL katmanı). "over" = metin + öğeler(over) + vignette. Elle kopyalanmış
  // metin çizici artık YOK; export'a giren her katman burada da görünür.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!slide || !is3D) return;
    let dead = false;
    // C8'in 3D karşılığı: geçişte bekleme YOK (hayalet zaten üstte duruyor,
    // altta ne kadar erken kare olursa sönüm o kadar erken başlar).
    const fresh = paintedId.current !== slide.id;
    paintedId.current = slide.id;
    const t = setTimeout(async () => {
      try {
        if (dead) return;
        const W = rasterW;
        const H = rasterH;
        const under = underRef.current;
        const over = overRef.current;
        if (!under || !over) return;

        under.width = W;
        under.height = H;
        const uctx = under.getContext("2d");
        if (!uctx) return;
        await composeStatic(uctx, slide, W, H, {
          format: fmtRef.current,
          locale: project.activeLocale,
          bucket: "under",
          skipDevice: true,
        });
        if (dead) return;

        over.width = W;
        over.height = H;
        const octx = over.getContext("2d");
        if (!octx) return;
        octx.clearRect(0, 0, W, H);
        // Bitiriciler: YALNIZ vignette. Gren `overlay` blend'iyle saydam bir
        // tuvale basılırsa cihazın üstünde gri sis bırakır (bkz. ComposeOpts).
        await composeStatic(octx, slide, W, H, {
          format: fmtRef.current,
          locale: project.activeLocale,
          bucket: "over",
          overlays: "vignette",
        });
      } catch (e) {
        console.error("live-render:", e);
      } finally {
        if (!dead) releaseGhost();
      }
    }, fresh ? 0 : 60);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideJson, rasterW, rasterH, is3D, rev, fmt]);

  // ---------------------------------------------------------------------------
  // C11 / C12 / C13 — HOVER CANLI ÖNİZLEME
  //
  // Inspector'daki tema / kadraj / kamera kartı `previewOverride`'a bir patch
  // yayınlar; burada o patch slaydın ÜSTÜNE bindirilip AYRI bir katmana
  // basılır. Store'a, projeye, geçmişe tek bir yazma bile yoktur — dolayısıyla
  // otomatik kayıt da tetiklenmez (fareyi ızgaradan geçirmek 12 POST demezdi).
  //
  // Üç kademeli gecikme yönetimi:
  //   1. LRU'da kare varsa (C13) — SENKRON, 0ms.
  //   2. Tema kartının hazır JPEG'i varsa (C12) — SENKRON, `object-fit:cover`
  //      ile bindirilir; algılanan gecikme 0, arkada gerçek taslak koşar.
  //   3. Taslak render (C11) — YARI raster, `draft:true` → tipik 30-60ms.
  // ---------------------------------------------------------------------------
  const preview = usePreviewOverride();
  const sampleSlide = set.slides[0];

  useEffect(() => {
    const cv = previewRef.current;
    const im = previewImgRef.current;
    if (!cv || !im) return;
    const hide = () => {
      cv.classList.remove("on");
      im.classList.remove("on");
      im.removeAttribute("src");
    };
    if (!preview || !slide) {
      hide();
      return;
    }

    let dead = false;
    const merged = { ...slide, ...preview.patch } as Slide;
    // Yarı raster: önizleme bir KARAR anıdır, arşiv değil. 30-60ms hedefi
    // tutmanın en ucuz yolu piksel sayısını dörtte bire indirmek.
    const W = Math.max(320, Math.round(rasterW / 2));
    const H = Math.max(1, Math.round((W * BASE_H) / BASE_W));
    const ck = `${fmt}:${slideSignature(merged)}@${W}x${H}`;

    const show = (src: CanvasImageSource, w: number, h: number) => {
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      cv.width = w;
      cv.height = h;
      ctx.drawImage(src, 0, 0);
      cv.classList.add("on");
      im.classList.remove("on");
    };

    const cached = getPreviewFrame(ck);
    if (cached) {
      show(cached, cached.width, cached.height);
      return () => {
        dead = true;
      };
    }

    // C12 — ısıtma karesi: tema kartının kendi minyatürü zaten önbellekte.
    const themeId = preview.patch.themeId;
    if (themeId) {
      const warm = peekThumb("theme", themeId, sampleSlide, fmt);
      if (warm) {
        im.src = warm;
        im.classList.add("on");
        cv.classList.remove("on");
      }
    }

    renderSlide(merged, {
      format: fmtRef.current,
      width: W,
      height: H,
      draft: true,
      locale: project.activeLocale,
    })
      .then(async (c) => {
        if (dead) return;
        show(c, c.width, c.height);
        try {
          const bmp = await createImageBitmap(c);
          if (dead) bmp.close();
          else putPreviewFrame(ck, bmp);
        } catch {
          /* ImageBitmap yoksa önbelleksiz devam — davranış aynı, hız düşer */
        }
      })
      .catch((e) => console.error("preview render:", e));

    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, slideJson, rasterW, rev, project.activeLocale, fmt]);

  // ---------------------------------------------------------------------------
  // Koordinat dönüşümü — ekran → BASE px (DOM'suz hit-test'in tek girişi)
  // ---------------------------------------------------------------------------
  const toBaseXY = useCallback((clientX: number, clientY: number) => {
    const r = cardRef.current?.getBoundingClientRect();
    const kk = baseOf(fmtRef.current).w / sizeRef.current.w;
    if (!r) return { bx: clientX * kk, by: clientY * kk };
    return { bx: (clientX - r.left) * kk, by: (clientY - r.top) * kk };
  }, []);

  // ---------------------------------------------------------------------------
  // Sürükleme — MUTLAK delta (origin + toplam yer değiştirme)
  //
  // Geçmiş: pointerdown'da `beginUndoGesture()`, pointerup'ta `endUndoGesture()`.
  // Arada koşan yüzlerce `mutate(..., false)` geçmişe HİÇ yazmaz; bırakınca TEK
  // adım açılır. Bırakışta ayrıca `updateSlide` ile TEK bir tasarım yayılımı
  // koşar (öğe/cihaz/metin konumu diğer dillere burada gider).
  // ---------------------------------------------------------------------------
  const drag = useRef<DragState | null>(null);

  const commitDrag = useCallback((d: DragState) => {
    const st = useStudio.getState();
    const p = st.project;
    const sl = p.sets[p.activeLocale]?.slides.find((x) => x.id === d.slideId);
    if (!sl) return;
    if (["layer", "layer-resize", "layer-rotate", "crop"].includes(d.mode.kind)) {
      const id = (d.mode as { id: string }).id;
      const patch: Partial<Slide> = id.startsWith("theme:") ? { themeElementOverrides: sl.themeElementOverrides } : id.startsWith("element:") ? { elements: sl.elements } : id === "headline" || id === "sub" ? { textBoxes: sl.textBoxes, headlineStyle: sl.headlineStyle, subStyle: sl.subStyle } : id === "background" ? { background: sl.background } : id.startsWith("screen:") ? { splitCrop: sl.splitCrop } : id === "device3" ? { device3Offset: sl.device3Offset } : id === "device2" ? { device2Offset: sl.device2Offset } : { deviceOffset: sl.deviceOffset };
      st.updateSlide(sl.id, patch, { coalesceKey: `layer-drag:${sl.id}:${id}` });
      return;
    }
    if (d.mode.kind === "device") st.updateSlide(sl.id, { deviceOffset: sl.deviceOffset });
    else if (d.mode.kind === "device2")
      st.updateSlide(sl.id, { device2Offset: sl.device2Offset });
    else if (d.mode.kind === "text") st.updateSlide(sl.id, { textOffset: sl.textOffset });
    else {
      st.updateSlide(
        sl.id,
        { elements: sl.elements },
        { coalesceKey: `el:${d.mode.id}:xy` }
      );
    }
  }, []);

  const onMoveWin = useCallback((e: PointerEvent) => {
    const d = drag.current;
    const sl = slideRef.current;
    if (!d || !sl) return;
    const { w: BASE_W, h: BASE_H } = baseOf(fmtRef.current);
    const toBase = BASE_W / sizeRef.current.w; // ekran px → BASE px
    const dx = (e.clientX - d.startX) * toBase;
    const dy = (e.clientY - d.startY) * toBase;
    // Titrek fare "tıklama"yı sürüklemeye çevirmesin: 2 CSS px ölü bölge.
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 2) return;
      d.moved = true;
    }
    const th = SNAP_PX * toBase; // eşik EKRAN px'tir → BASE'e çevrilir
    const snapOn = !e.altKey; // ⌥ = yapışmayı geçici kapat (Figma kalıbı)
    const layout = getLayoutForFormat(sl.layout, fmtRef.current) || getLayoutForFormat(getTheme(sl.themeId).defaultLayout, fmtRef.current);
    const st = useStudio.getState();
    let gx: number | null = null;
    let gy: number | null = null;

    if (d.mode.kind === "layer" || d.mode.kind === "layer-resize" || d.mode.kind === "layer-rotate" || d.mode.kind === "crop") {
      const mode = d.mode, id = mode.id, o = d.origin;
      const el = layerElement(sl, id);
      let patch: Partial<Slide> = {};
      if (mode.kind === "crop") {
        const angle = o.rot * Math.PI / 180, cropDx = dx * Math.cos(angle) + dy * Math.sin(angle), cropDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
        const crop = { x: Math.abs(o.spanX ?? 0) > 1 ? clamp((o.focusX ?? .5) - cropDx * (o.flipX ? -1 : 1) / o.spanX!, 0, 1) : o.focusX ?? .5, y: Math.abs(o.spanY ?? 0) > 1 ? clamp((o.focusY ?? .5) - cropDy * (o.flipY ? -1 : 1) / o.spanY!, 0, 1) : o.focusY ?? .5 };
        if (el) patch = patchLayerElement(sl, id, { crop: { ...el.crop, ...crop } });
        else if (id === "background") { const bg = sl.background ?? getTheme(sl.themeId).background; if (bg.kind === "image") patch = { background: { ...bg, imageCrop: { ...bg.imageCrop, ...crop } } }; }
        else { const i = Number(id.slice(7)), next = [...(sl.splitCrop ?? [])]; next[i] = { ...splitCropDefault(sl.layout), ...next[i], ...crop }; patch = { splitCrop: next }; }
      } else {
        let x = o.x, y = o.y, w = o.w, h = o.h, rotation = o.rot;
        if (mode.kind === "layer") {
          x += dx; y += dy;
          if (snapOn) { const r = snapBox({ x, y, w, h }, d.targets, th); x += r.dx; y += r.dy; gx = r.gx; gy = r.gy; }
        } else if (mode.kind === "layer-rotate") {
          const point = toBaseXY(e.clientX, e.clientY);
          rotation = o.rot + Math.atan2(point.by - o.y - o.h / 2, point.bx - o.x - o.w / 2) * 180 / Math.PI - o.ang;
          if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
        } else {
          const handle = mode.handle, radians = o.rot * Math.PI / 180;
          const localDx = dx * Math.cos(radians) + dy * Math.sin(radians), localDy = -dx * Math.sin(radians) + dy * Math.cos(radians);
          if (handle.includes("w")) { x += localDx; w -= localDx; }
          if (handle.includes("e")) w += localDx;
          if (handle.includes("n")) { y += localDy; h -= localDy; }
          if (handle.includes("s")) h += localDy;
          const corner = handle.length === 2, image = el?.kind === "image" || el?.kind === "sticker";
          if ((id === "device" || id === "device2" || id === "device3" || corner && (image ? !e.shiftKey : e.shiftKey)) && o.h > 0) {
            const ratio = o.w / o.h;
            if (Math.abs(w - o.w) >= Math.abs(h - o.h)) h = w / ratio; else w = h * ratio;
          }
          w = Math.max(24, w); h = Math.max(24, h);
          if (handle.includes("w")) x = o.x + o.w - w;
          if (handle.includes("n")) y = o.y + o.h - h;
          const dcx = x + w / 2 - o.x - o.w / 2, dcy = y + h / 2 - o.y - o.h / 2;
          x = o.x + o.w / 2 + dcx * Math.cos(radians) - dcy * Math.sin(radians) - w / 2;
          y = o.y + o.h / 2 + dcx * Math.sin(radians) + dcy * Math.cos(radians) - h / 2;
        }
        if (el) {
          const part: Partial<SlideElement> = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), rotation };
          if (el.kind === "text" && mode.kind === "layer-resize" && mode.handle.length === 2) part.style = { ...el.style, sizePx: Math.max(8, (o.fontSize ?? 56) * w / o.w) };
          patch = patchLayerElement(sl, id, part);
        } else if (id === "headline" || id === "sub") {
          patch = textFramePatch(sl, id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), rotation });
          if (mode.kind === "layer-resize" && mode.handle.length === 2) { const key = id === "headline" ? "headlineStyle" : "subStyle"; patch[key] = { ...sl[key], sizePx: Math.max(8, (o.fontSize ?? 56) * w / o.w) }; }
        } else if (id === "device" || id === "device2" || id === "device3") {
          const field = id === "device3" ? "device3Offset" : id === "device2" ? "device2Offset" : "deviceOffset";
          const layout = editorLayout(sl, fmtRef.current), device = id === "device3" ? layout.device3 : id === "device2" ? layout.device2 : layout.device;
          patch = { [field]: { ...sl[field], x: (o.offX ?? 0) + x + w / 2 - o.x - o.w / 2, y: (o.offY ?? 0) + y + h / 2 - o.y - o.h / 2, scale: clamp((o.scale ?? 1) * h / o.h, .1, 6), rotation: rotation - (device?.rotation ?? 0) * 180 / Math.PI } };
        }
      }
      st.mutate(p => { const current = p.sets[p.activeLocale].slides.find(s => s.id === d.slideId); if (current) Object.assign(current, patch); return p; }, false);
    } else if (d.mode.kind === "device") {
      let nx = d.origin.x + dx;
      let ny = d.origin.y + dy;
      if (snapOn) {
        const cur = { ...sl, deviceOffset: { ...(sl.deviceOffset || { x: 0, y: 0 }), x: nx, y: ny } };
        const r = snapBox(deviceBox(cur, layout, fmtRef.current), d.targets, th);
        nx += r.dx;
        ny += r.dy;
        gx = r.gx;
        gy = r.gy;
      }
      st.mutate((p) => {
        const s = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
        if (!s) return p;
        s.deviceOffset = { ...(s.deviceOffset || { x: 0, y: 0 }), x: nx, y: ny };
        return p;
      }, false);
    } else if (d.mode.kind === "device2") {
      // İkinci telefon: ⌥ basılıysa DİKEY sürükleme ÖLÇEK olur (Figma'daki
      // alt-drag kalıbı), yoksa düz taşıma. Yapışma hedefleri 1. cihaz ve
      // metin olduğu için ikiliyi hizalamak elle de kolay.
      if (e.altKey) {
        const k = 1 - dy / (BASE_H * 0.5); // yarım slayt = ×0 … ×2
        const scale = Math.max(0.1, Math.min(6, d.origin.w * k));
        st.mutate((p) => {
          const s2 = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
          if (!s2) return p;
          s2.device2Offset = { ...(s2.device2Offset || { x: 0, y: 0 }), scale };
          return p;
        }, false);
      } else {
        const nx = d.origin.x + dx;
        const ny = d.origin.y + dy;
        st.mutate((p) => {
          const s2 = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
          if (!s2) return p;
          s2.device2Offset = { ...(s2.device2Offset || { x: 0, y: 0 }), x: nx, y: ny };
          return p;
        }, false);
      }
    } else if (d.mode.kind === "text") {
      let nx = d.origin.x + dx;
      let ny = d.origin.y + dy;
      if (snapOn) {
        const cur = { ...sl, textOffset: { ...(sl.textOffset || { x: 0, y: 0 }), x: nx, y: ny } };
        const r = snapBox(textBox(cur, layout, fmtRef.current), d.targets, th);
        nx += r.dx;
        ny += r.dy;
        gx = r.gx;
        gy = r.gy;
      }
      st.mutate((p) => {
        const s = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
        if (!s) return p;
        s.textOffset = { ...(s.textOffset || { x: 0, y: 0 }), x: nx, y: ny };
        return p;
      }, false);
    } else if (d.mode.kind === "element") {
      let nx = d.origin.x + dx;
      let ny = d.origin.y + dy;
      if (snapOn) {
        const r = snapBox({ x: nx, y: ny, w: d.origin.w, h: d.origin.h }, d.targets, th);
        nx += r.dx;
        ny += r.dy;
        gx = r.gx;
        gy = r.gy;
      }
      const id = d.mode.id;
      const px = Math.round(nx);
      const py = Math.round(ny);
      st.mutate((p) => {
        const s = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
        if (!s) return p;
        s.elements = patchElement(s.elements, id, { x: px, y: py });
        return p;
      }, false);
    } else if (d.mode.kind === "resize") {
      const hnd = d.mode.handle;
      const o = d.origin;
      let x = o.x;
      let y = o.y;
      let w = o.w;
      let h = o.h;
      if (hnd.includes("w")) {
        x = o.x + dx;
        w = o.w - dx;
      }
      if (hnd.includes("e")) w = o.w + dx;
      if (hnd.includes("n")) {
        y = o.y + dy;
        h = o.h - dy;
      }
      if (hnd.includes("s")) h = o.h + dy;

      // ⇧ = en/boy oranını koru (köşe tutamakları).
      const corner = hnd.length === 2;
      if (e.shiftKey && corner && o.h > 0) {
        const ratio = o.w / o.h;
        if (Math.abs(w - o.w) >= Math.abs(h - o.h)) h = w / ratio;
        else w = h * ratio;
        if (hnd.includes("w")) x = o.x + o.w - w;
        if (hnd.includes("n")) y = o.y + o.h - h;
      }

      // Yapışma: YALNIZ hareket eden kenar (kutunun tamamı kaymamalı).
      if (snapOn && !e.shiftKey) {
        if (hnd.includes("e")) {
          const s = nearest(x + w, d.targets.x, th);
          if (s !== null) {
            w = s - x;
            gx = s;
          }
        } else if (hnd.includes("w")) {
          const s = nearest(x, d.targets.x, th);
          if (s !== null) {
            w = x + w - s;
            x = s;
            gx = s;
          }
        }
        if (hnd.includes("s")) {
          const s = nearest(y + h, d.targets.y, th);
          if (s !== null) {
            h = s - y;
            gy = s;
          }
        } else if (hnd.includes("n")) {
          const s = nearest(y, d.targets.y, th);
          if (s !== null) {
            h = y + h - s;
            y = s;
            gy = s;
          }
        }
      }

      if (w < MIN_EL) {
        if (hnd.includes("w")) x = o.x + o.w - MIN_EL;
        w = MIN_EL;
      }
      if (h < MIN_EL) {
        if (hnd.includes("n")) y = o.y + o.h - MIN_EL;
        h = MIN_EL;
      }
      const id = d.mode.id;
      const box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      st.mutate((p) => {
        const s = p.sets[p.activeLocale].slides.find((x2) => x2.id === d.slideId);
        if (!s) return p;
        s.elements = patchElement(s.elements, id, box);
        return p;
      }, false);
    } else if (d.mode.kind === "rotate") {
      const { bx, by } = toBaseXY(e.clientX, e.clientY);
      const cx = d.origin.x + d.origin.w / 2;
      const cy = d.origin.y + d.origin.h / 2;
      const ang = (Math.atan2(by - cy, bx - cx) * 180) / Math.PI;
      let rot = d.origin.rot + (ang - d.origin.ang);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15; // ⇧ = 15° kademe
      rot = Math.round(rot * 10) / 10;
      const id = d.mode.id;
      st.mutate((p) => {
        const s = p.sets[p.activeLocale].slides.find((x) => x.id === d.slideId);
        if (!s) return p;
        s.elements = patchElement(s.elements, id, { rotation: rot || undefined });
        return p;
      }, false);
    }

    setGuides(gx === null && gy === null ? null : { x: gx, y: gy });
  }, [toBaseXY]);

  const onUpWin = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", onMoveWin);
    window.removeEventListener("pointerup", onUpWin);
    window.removeEventListener("pointercancel", onUpWin);
    setDragging(false);
    setGuides(null);
    // Sırayla: TEK yayılım (jest içinde, geçmişe yazmaz) → jesti kapat (TEK adım).
    // Hareket etmediyse commit YOK: `updateSlide` içeriği aynı olsa bile yeni
    // bir proje nesnesi üretir ve jest kapanırken sahte bir adım açardı.
    if (d?.moved) commitDrag(d);
    endUndoGesture();
  }, [commitDrag, onMoveWin]);

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      const sl = slideRef.current;
      if (!sl) return;
      const origin: DragState["origin"] = { x: 0, y: 0, w: 0, h: 0, rot: 0, ang: 0 };
      if (mode.kind === "layer" || mode.kind === "layer-resize" || mode.kind === "layer-rotate" || mode.kind === "crop") {
        const box = layerBox(sl, mode.id, fmtRef.current, useStudio.getState().project.activeLocale); if (!box) return;
        Object.assign(origin, box, { rot: box.rotation ?? 0 });
        const el = layerElement(sl, mode.id);
        origin.fontSize = el?.style?.sizePx ?? (mode.id === "headline" ? sl.headlineStyle?.sizePx ?? getTheme(sl.themeId).headline.sizePx : mode.id === "sub" ? sl.subStyle?.sizePx ?? getTheme(sl.themeId).sub.sizePx : 56);
        if (mode.id === "device" || mode.id === "device2" || mode.id === "device3") { const off = sl[mode.id === "device3" ? "device3Offset" : mode.id === "device2" ? "device2Offset" : "deviceOffset"] ?? { x: 0, y: 0 }; origin.offX = off.x; origin.offY = off.y; origin.scale = off.scale ?? 1; }
        if (mode.kind === "layer-rotate") { const point = toBaseXY(e.clientX, e.clientY); origin.ang = Math.atan2(point.by - box.y - box.h / 2, point.bx - box.x - box.w / 2) * 180 / Math.PI; }
        if (mode.kind === "crop") {
          const bg = sl.background ?? getTheme(sl.themeId).background;
          const crop = el?.crop ?? (mode.id === "background" && bg.kind === "image" ? bg.imageCrop : mode.id.startsWith("screen:") ? { ...splitCropDefault(sl.layout), ...sl.splitCrop?.[Number(mode.id.slice(7))] } : undefined);
          origin.focusX = crop?.x ?? .5; origin.focusY = crop?.y ?? .5; origin.flipX = crop?.flipX; origin.flipY = crop?.flipY;
          const img = cropImage.current;
          if (img) { const fit = crop?.fit ?? (el?.kind === "sticker" ? "stretch" : "cover"), ratio = fit === "contain" ? Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight) : Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight); origin.spanX = (fit === "stretch" ? box.w : img.naturalWidth * ratio) * (crop?.zoom ?? 1) - box.w; origin.spanY = (fit === "stretch" ? box.h : img.naturalHeight * ratio) * (crop?.zoom ?? 1) - box.h; }
        }
      } else if (mode.kind === "device") {
        const o = sl.deviceOffset || { x: 0, y: 0 };
        origin.x = o.x;
        origin.y = o.y;
        origin.w = o.scale ?? 1;
      } else if (mode.kind === "device2") {
        const o = sl.device2Offset || { x: 0, y: 0 };
        origin.x = o.x;
        origin.y = o.y;
        origin.w = o.scale ?? 1;
      } else if (mode.kind === "text") {
        const o = sl.textOffset || { x: 0, y: 0 };
        origin.x = o.x;
        origin.y = o.y;
      } else {
        const el = elementById(sl.elements, mode.id);
        if (!el) return;
        origin.x = el.x;
        origin.y = el.y;
        origin.w = el.w;
        origin.h = el.h;
        origin.rot = el.rotation ?? 0;
        if (mode.kind === "rotate") {
          const { bx, by } = toBaseXY(e.clientX, e.clientY);
          origin.ang =
            (Math.atan2(by - (el.y + el.h / 2), bx - (el.x + el.w / 2)) * 180) / Math.PI;
        }
      }
      const subject =
        mode.kind === "device"
          ? ({ kind: "device" } as const)
          : mode.kind === "text"
            ? ({ kind: "text" } as const)
            : // device2'nin snap hedef listesinde ayrı bir kaydı yok; "none"
              // vermek 1. cihazı ve metni hedef olarak KORUR, ki ikiliyi
              // hizalarken asıl istenen yapışma zaten odur.
              mode.kind === "device2"
              ? ({ kind: "none" } as const)
              : mode.kind === "layer" || mode.kind === "layer-resize" || mode.kind === "layer-rotate" || mode.kind === "crop"
                ? mode.id === "headline" || mode.id === "sub" ? ({ kind: "text" } as const) : mode.id === "device" ? ({ kind: "device" } as const) : ({ kind: "element", id: mode.id.replace(/^element:/, "") } as const)
                : ({ kind: "element", id: mode.id } as const);
      drag.current = {
        startX: e.clientX,
        startY: e.clientY,
        mode,
        origin,
        targets: collectTargets(sl, subject, fmtRef.current),
        slideId: sl.id,
        moved: false,
      };
      // Dinleyiciler jestten ÖNCE takılır: store'un emniyet `pointerup`
      // dinleyicisi bizden SONRA kaydolsun ki commit'imiz jestin içinde koşsun.
      window.addEventListener("pointermove", onMoveWin);
      window.addEventListener("pointerup", onUpWin);
      window.addEventListener("pointercancel", onUpWin);
      beginUndoGesture();
      setDragging(true);
    },
    [onMoveWin, onUpWin, toBaseXY]
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onMoveWin);
      window.removeEventListener("pointerup", onUpWin);
      window.removeEventListener("pointercancel", onUpWin);
    },
    [onMoveWin, onUpWin]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const sl = slideRef.current; if (!sl || e.button !== 0 || is3DRef.current && toolRef.current === "orbit") return;
    clearSlideSelection(); setOverlap(null);
    const st = useStudio.getState(), point = toBaseXY(e.clientX, e.clientY);
    const hits = hitLayers(sl, point.bx, point.by, fmtRef.current, st.project.activeLocale, 3 * baseOf(fmtRef.current).w / sizeRef.current.w);
    if (e.altKey && hits.length > 1) { setOverlap({ x: e.clientX, y: e.clientY, layers: hits }); return; }
    const selectedHit = st.cropEditing ? hits.find(l => l.id === st.selectedLayerId) : undefined;
    const hit = selectedHit ?? hits[0]; if (!hit) { st.setSelectedLayer(null); return; }
    if (st.selectedLayerId !== hit.id) st.setSelectedLayer(hit.id);
    else { st.setLayerPanelOpen(true); st.setLayerPanelTab("edit"); }
    setTool("select");
    if (hit.locked) return;
    if (hit.id === "background") { if (st.cropEditing) beginDrag(e, { kind: "crop", id: hit.id }); return; }
    if (hit.id.startsWith("screen:") || st.cropEditing && (hit.type === "image")) beginDrag(e, { kind: "crop", id: hit.id });
    else beginDrag(e, { kind: "layer", id: hit.id });
  }, [beginDrag, toBaseXY]);

  const editTextAt = useCallback((e: React.MouseEvent) => {
    const sl = slideRef.current; if (!sl || toolRef.current === "orbit") return;
    const point = toBaseXY(e.clientX, e.clientY), st = useStudio.getState();
    const hits = hitLayers(sl, point.bx, point.by, fmtRef.current, st.project.activeLocale);
    const hit = hits[0]; if (!hit) return;
    st.setSelectedLayer(hit.id);
    const el = layerElement(sl, hit.id);
    if (hit.type === "text") setInlineText({ id: hit.id, value: el?.text ?? (hit.id === "sub" ? sl.sub ?? "" : sl.headline) });
    else if (hit.type === "image" || hit.type === "background") st.setCropEditing(true);
  }, [toBaseXY]);

  /* ===================================================================== *
     TUVAL NAVİGASYONU — C1 · C2 · C3 · C5
   * ===================================================================== */

  /**
   * C1 — İMLEÇ MERKEZLİ ZOOM: çapa.
   *
   * Zoom'dan ÖNCE imlecin kartın neresinde olduğunu ORANLA (u,v) not ederiz.
   * Yeni boyut commit edildikten sonra (layout-effect) kartın gerçek dikdörtgeni
   * ölçülür ve scroll, aynı oransal noktayı aynı ekran koordinatına getirecek
   * kadar kaydırılır.
   *
   * Neden analitik formül değil de ÖLÇÜM: `.stage{margin:auto}` kart kapsayıcıdan
   * küçükken onu ORTALAR, büyükken ortalamaz. Yani kartın sol kenarı scroll'un
   * DOĞRUSAL bir fonksiyonu değildir; ölçüm bu kırılmayı bedavaya doğru yapar.
   *
   * ÇAPA JEST BOYUNCA SABİTTİR — bu ayrıntı her şeyi belirliyor. İlk denemede
   * (u,v) HER tekerlek adımında yeniden ölçülüyordu; kart kapsayıcıdan küçükken
   * scroll aralığı 0 olduğu için düzeltme uygulanamıyor, bir sonraki adım da
   * "şu an imlecin altında olan" BAŞKA bir içerik noktasına kilitleniyordu.
   * Sonuç: %20'den %200'e tek pinch'te 400px kayma. Şimdi (u,v) jestin
   * başında bir kez alınır ve jest boyunca korunur: aralık kapalıyken düzeltme
   * kırpılır, aralık açılır açılmaz nokta KENDİLİĞİNDEN imlecin altına oturur.
   * (Ölçüm — %20→%200, 14 adım, imleç sabit: sapma X 401px → 3.6px, Y → 0.4px.
   * Kalan birkaç piksel `size.w = round(BASE_W·z)` yuvarlamasından geliyor.
   * Kart kuyudan KÜÇÜKKEN sapma sürer; orada eserin tamamı zaten görünür ve
   * `margin:auto` onu ortalamakta ısrar eder — kabul edilen davranış budur.)
   *
   * Jest şu durumlarda biter: imleç 6px'ten fazla kaydı, 1.2sn sessizlik oldu
   * (eşik cömert — yüksek zoom'da bir kompozisyon karesi ana iş parçacığını
   * 300ms tutabiliyor), ya da araya başka bir navigasyon girdi (pan / sığdır /
   * ada butonu → `clearAnchor`).
   */
  type ZoomAnchor = { cx: number; cy: number; u: number; v: number; at: number };
  const zoomAnchor = useRef<ZoomAnchor | null>(null);
  const zoomGesture = useRef<ZoomAnchor | null>(null);

  /** Zoom jestini bitir — jest dışı her navigasyonda çağrılır. */
  const clearAnchor = useCallback(() => {
    zoomAnchor.current = null;
    zoomGesture.current = null;
  }, []);

  const anchorAt = useCallback((cx: number, cy: number) => {
    const now = performance.now();
    const g = zoomGesture.current;
    if (g && Math.abs(cx - g.cx) <= 6 && Math.abs(cy - g.cy) <= 6 && now - g.at <= 1200) {
      g.at = now; // süren jest: İÇERİK NOKTASI aynı kalır
      zoomAnchor.current = g;
      return;
    }
    const r = cardRef.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) {
      clearAnchor();
      return;
    }
    const next: ZoomAnchor = {
      cx,
      cy,
      u: (cx - r.left) / r.width,
      v: (cy - r.top) / r.height,
      at: now,
    };
    zoomGesture.current = next;
    zoomAnchor.current = next;
  }, [clearAnchor]);

  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const sc = scrollRef.current;
    const r = cardRef.current?.getBoundingClientRect();
    if (!sc || !r) return;
    // Kırpma tarayıcıya bırakılır: aralık yoksa eser ortada kalır (margin:auto),
    // aralık açılınca aynı hesap noktayı tam yerine oturtur.
    sc.scrollLeft += r.left + a.u * r.width - a.cx;
    sc.scrollTop += r.top + a.v * r.height - a.cy;
  }, [size.w, size.h]);

  /** Zoom'u ada butonundan değiştir — çapa kuyunun ORTASI (fit hariç). */
  const zoomTo = useCallback(
    (z: Zoom) => {
      clearAnchor();
      if (z === "fit") {
        setZoom("fit");
        return;
      }
      const r = scrollRef.current?.getBoundingClientRect();
      if (r) anchorAt(r.left + r.width / 2, r.top + r.height / 2);
      setZoom(z);
    },
    [anchorAt, clearAnchor]
  );

  /**
   * C3 — TEKERLEK ANLAMI DEĞİŞTİ.
   *
   * Dinleyici NATIVE ve `passive:false`: React'in `onWheel` prop'u kök
   * kapsayıcıya PASİF bağlanır, orada `preventDefault()` sessizce yutulur
   * (tarayıcı sayfa zoom'unu yapmaya devam ederdi). Zoom ve ölçek kollarının
   * çalışması için dinleyicinin kendimizin olması şart.
   *
   * ÇIPLAK tekerlek bilerek DOKUNULMADAN geçirilir: `.viewer-scroll`
   * `overflow:auto` olduğu için tarayıcı kendi kaydırmasını yapar ve macOS'un
   * ATALETİ (C5) bedavaya gelir. Elle `scrollBy` yazsak momentum ölürdü.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      const sl = slideRef.current;
      if (!sl) return;
      // Canlı 3D orbit: tekerlek CameraControls'ün dolly'sidir, karışma.
      const t = e.target as HTMLElement | null;
      if (is3DRef.current && toolRef.current === "orbit" && t?.closest?.(".live-wrap")) return;

      // ⌘/Ctrl → imleç altına zoom. Trackpad pinch de tarayıcıya ctrl+wheel
      // olarak gelir, yani C4 (pinch) bu koldan BEDAVA gelir.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        anchorAt(e.clientX, e.clientY);
        // Üstel: aynı miktarda içeri + dışarı = tam olarak başlangıç değeri.
        const f = Math.exp(-e.deltaY * 0.0016);
        setZoom((z) => clamp((z === "fit" ? fitZoomRef.current : z) * f, Z_MIN, Z_MAX));
        return;
      }

      // ⌥ → cihaz ölçeği (R8/W3 öncesi ÇIPLAK tekerleğin işiydi).
      if (e.altKey) {
        e.preventDefault();
        if (isSplitScreen(sl)) return; // Fixed crop windows; focus is edited per image in Inspector.
        setDragging(true);
        if (wheelEndRef.current) clearTimeout(wheelEndRef.current);
        wheelEndRef.current = setTimeout(() => {
          wheelEndRef.current = null;
          if (!drag.current) setDragging(false);
        }, 180);
        const f = Math.exp(-e.deltaY * 0.001);
        useStudio.getState().mutate((p) => {
          const s = p.sets[p.activeLocale].slides.find((x) => x.id === sl.id);
          if (!s) return p;
          const o = s.deviceOffset || { x: 0, y: 0 };
          s.deviceOffset = { ...o, scale: clamp((o.scale ?? 1) * f, 0.1, 6) };
          return p;
        }, false);
        return;
      }

      // Çıplak tekerlek → tuval kaydırma. preventDefault YOK: native scroll
      // + momentum + kauçuk kenar tarayıcının işi.
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [anchorAt]);

  /* --------------------------------------------------------------------- *
     C2 — BOŞLUK + SÜRÜKLE / ORTA TIK PAN
   * --------------------------------------------------------------------- */
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  const onPanMove = useCallback((e: PointerEvent) => {
    const p = pan.current;
    const sc = scrollRef.current;
    if (!p || !sc) return;
    sc.scrollLeft = p.sl - (e.clientX - p.x);
    sc.scrollTop = p.st - (e.clientY - p.y);
  }, []);

  const onPanUp = useCallback(() => {
    pan.current = null;
    setPanning(false);
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanUp);
    window.removeEventListener("pointercancel", onPanUp);
  }, [onPanMove]);

  /* --------------------------------------------------------------------- *
     ORTA TUŞ ORBİT — 3D slaytta fareyi orta tuşla sürüklemek telefonu döndürür
   * --------------------------------------------------------------------- */
  const midOrbit = useRef<{ x: number; y: number } | null>(null);

  const onOrbitMove = useCallback((e: PointerEvent) => {
    const o = midOrbit.current;
    const view = liveRef.current;
    if (!o || !view) return;
    // Tuval eni ≈ 360°: bir uçtan bir uca sürüklemek tam tur attırır.
    const k = (Math.PI * 2) / Math.max(200, sizeRef.current.w);
    view.orbitBy((e.clientX - o.x) * k, -(e.clientY - o.y) * k);
    midOrbit.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onOrbitUp = useCallback(() => {
    midOrbit.current = null;
    setPanning(false);
    liveRef.current?.orbitBy(0, 0, "end");
    window.removeEventListener("pointermove", onOrbitMove);
    window.removeEventListener("pointerup", onOrbitUp);
    window.removeEventListener("pointercancel", onOrbitUp);
  }, [onOrbitMove]);

  /**
   * YAKALAMA fazında dinlenir: pan jesti tuvalin kendi `pointerdown`'ından
   * ÖNCE karar vermeli, yoksa boşluk basılıyken sürüklemek cihazı taşırdı.
   */
  const onPanDown = useCallback(
    (e: React.PointerEvent) => {
      // 3D slaytta ORTA TUŞ artık pan değil ORBİT. (Pan boşluk+sürükle ile
      // yerinde duruyor.) Canlı katman pointer-events almadığı için jesti
      // burada yakalayıp deltayı doğrudan görünüme veriyoruz.
      if (e.button === 1 && is3DRef.current && liveRef.current) {
        e.preventDefault();
        e.stopPropagation();
        clearAnchor();
        midOrbit.current = { x: e.clientX, y: e.clientY };
        liveRef.current.orbitBy(0, 0, "begin");
        setPanning(true); // imleç geri bildirimi pan ile aynı
        window.addEventListener("pointermove", onOrbitMove);
        window.addEventListener("pointerup", onOrbitUp);
        window.addEventListener("pointercancel", onOrbitUp);
        return;
      }
      const wantsPan = e.button === 1 || (e.button === 0 && panReadyRef.current);
      if (!wantsPan) return;
      const sc = scrollRef.current;
      if (!sc) return;
      e.preventDefault();
      e.stopPropagation();
      clearAnchor(); // elle konumlandırma → zoom borcu geçersiz
      pan.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      setPanning(true);
      window.addEventListener("pointermove", onPanMove);
      window.addEventListener("pointerup", onPanUp);
      window.addEventListener("pointercancel", onPanUp);
    },
    [clearAnchor, onPanMove, onPanUp, onOrbitMove, onOrbitUp]
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onPanMove);
      window.removeEventListener("pointerup", onPanUp);
      window.removeEventListener("pointercancel", onPanUp);
    },
    [onPanMove, onPanUp]
  );

  // Boşluk tuşu — basılıyken kuyu "grab", bırakınca normal. Yazarken susar.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      // Odaktaki butonun "boşlukla tıklanmasını" da engeller — istenen budur.
      e.preventDefault();
      setPanReady(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setPanReady(false);
    };
    const off = () => {
      setPanReady(false);
      // Pencere odağı gidince asılı kalmış bir hover önizlemesi de düşsün.
      previewClear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", off);
    };
  }, []);

  const resetNudge = () => {
    if (!slide) return;
    useStudio.getState().updateSlide(slide.id, {
      deviceOffset: undefined,
      textOffset: undefined,
      device2Offset: undefined,
      device3Offset: undefined,
    });
  };

  /* --------------------------------------------------------------------- *
     Öğe aksiyonları — hepsi `updateSlide` üzerinden (senkron + undo bedava)
   * --------------------------------------------------------------------- */

  const putElements = useCallback((next: SlideElement[], coalesce?: string) => {
    const sl = slideRef.current;
    if (!sl) return;
    useStudio
      .getState()
      .updateSlide(sl.id, { elements: next }, coalesce ? { coalesceKey: coalesce } : undefined);
  }, []);

  const addElement = useCallback(
    (kind: ElKind, at?: { bx: number; by: number }, extra?: { src?: string; w?: number; h?: number }) => {
      const sl = slideRef.current;
      if (!sl) return;
      const theme = getTheme(sl.themeId);
      const el = makeElement(kind, uid(), {
        cx: at?.bx,
        cy: at?.by,
        accent: theme.accent,
        ...extra,
      });
      putElements([...(sl.elements ?? []), el]);
      useStudio.getState().setSelectedElement(el.id);
      setTool("select");
    },
    [putElements]
  );

  /** Çekmeceden bırakılan sticker — yükseklik asset'in gerçek oranından. */
  const dropSticker = useCallback(
    async (file: string, bx: number, by: number) => {
      const sl = slideRef.current;
      if (!sl) return;
      const src = `/assets/stickers/${file}`;
      const img = await loadImage(src);
      const w = 320;
      const h = img && img.width ? Math.round((w * img.height) / img.width) : w;
      const el = makeElement("sticker", uid(), { src, cx: bx, cy: by, w, h });
      putElements([...(sl.elements ?? []), el]);
      useStudio.getState().setSelectedElement(el.id);
      setTool("select");
    },
    [putElements]
  );

  const duplicateElement = useCallback(
    (id: string) => {
      const sl = slideRef.current;
      const el = elementById(sl?.elements, id);
      if (!sl || !el) return;
      const copy: SlideElement = { ...structuredClone(el), id: uid(), x: el.x + 40, y: el.y + 40 };
      putElements([...(sl.elements ?? []), copy]);
      useStudio.getState().setSelectedElement(copy.id);
    },
    [putElements]
  );

  const deleteElement = useCallback(
    (id: string) => {
      const sl = slideRef.current;
      if (!sl) return;
      putElements(removeEl(sl.elements, id));
      useStudio.getState().setSelectedElement(null);
      pushUndoToast(L("ÖĞE SİLİNDİ", "ELEMENT DELETED"));
    },
    [putElements]
  );

  // ---------------------------------------------------------------------------
  // Klavye — seçili öğe varsa Delete siler, ok tuşları 1px (⇧ 10px) kaydırır.
  // Studio'nun global ok tuşu (cihazı kaydır) EZİLİR: Stage bir ÇOCUK olduğu
  // için efekti önce koşar, yani dinleyicisi de önce kaydolur.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useStudio.getState(), id = st.selectedLayerId, sl = slideRef.current;
      if (!id || !sl) return;
      const el = layerElement(sl, id), layer = editorLayers(sl).find(l => l.id === id);
      const focus = document.activeElement as HTMLElement | null;
      const inViewer = !focus || focus === document.body || !!focus.closest?.('[data-viewer="1"]');
      if (e.key === "Escape") { st.setSelectedLayer(null); setOverlap(null); return; }
      if (!inViewer || layer?.locked) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && el) {
        e.preventDefault(); e.stopImmediatePropagation();
        const copy = { ...structuredClone(el), id: uid(), x: el.x + 40, y: el.y + 40 };
        st.updateSlide(sl.id, { elements: [...(sl.elements ?? []), copy] }); st.setSelectedLayer(`element:${copy.id}`); return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopImmediatePropagation();
        if (el) st.updateSlide(sl.id, id.startsWith("theme:") ? patchLayerElement(sl, id, { hidden: true }) : { elements: sl.elements?.filter(item => item.id !== el.id) });
        else if (id === "headline" || id === "sub") st.updateSlide(sl.id, { [id]: "" });
        else if (id === "device") st.updateSlide(sl.id, { hideDevice: true });
        else if (id === "device2" || id === "device3" || id.startsWith("screen:")) st.updateSlide(sl.id, { layerStates: { ...sl.layerStates, [id]: { ...sl.layerStates?.[id], hidden: true } } });
        st.setSelectedLayer(null); return;
      }
      const v: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = v[e.key]; if (!dir || id === "background" || id.startsWith("screen:")) return;
      e.preventDefault(); e.stopImmediatePropagation(); const step = e.shiftKey ? 10 : 1;
      if (el) st.updateSlide(sl.id, patchLayerElement(sl, id, { x: el.x + dir[0] * step, y: el.y + dir[1] * step }), { coalesceKey: `layer:${id}:xy` });
      else if (id === "headline" || id === "sub") { const b = layerBox(sl, id, fmtRef.current, st.project.activeLocale); if (b) st.updateSlide(sl.id, textFramePatch(sl, id, { ...b, x: b.x + dir[0] * step, y: b.y + dir[1] * step }), { coalesceKey: `layer:${id}:xy` }); }
      else { const field = id === "device3" ? "device3Offset" : id === "device2" ? "device2Offset" : "deviceOffset", off = sl[field] ?? { x: 0, y: 0 }; st.updateSlide(sl.id, { [field]: { ...off, x: off.x + dir[0] * step, y: off.y + dir[1] * step } }); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* --------------------------------------------------------------------- *
     Bağlam menüsü — öğe varsa öğe kalemleri BAŞA, yoksa ekleme kalemleri
   * --------------------------------------------------------------------- */
  const menuItems = (): MenuItem[] => {
    const st = useStudio.getState();
    const p = st.project;
    const s = p.sets[p.activeLocale];
    const sl = s?.slides.find((x) => x.id === slide?.id) ?? slide;
    if (!sl) return [];
    const key = sl.designKey ?? "";
    const locked = (p.designLocks?.[p.activeLocale] ?? []).includes(key);
    const multi = Object.keys(p.sets).length > 1;
    const clip = styleClip();
    const items: MenuItem[] = [];

    // Tıklanan noktadaki öğe (kilitliye de sağ tıkla erişilebilsin diye
    // seçili öğe yedek olarak kullanılır).
    const under = menu ? hitTest(sl.elements, menu.bx, menu.by) : null;
    const target = under ?? elementById(sl.elements, st.selectedElementId);
    const at = menu ? { bx: menu.bx, by: menu.by } : undefined;
    if (menu) {
      items.push({ kind: "head", label: L("Buradaki katmanlar", "Layers here") });
      for (const layer of hitLayers(sl, menu.bx, menu.by, fmt, p.activeLocale)) items.push({ kind: "item", label: layer.label, icon: layer.type === "text" ? "text" : layer.type === "device" ? "phone" : "image", run: () => st.setSelectedLayer(layer.id) });
      items.push({ kind: "sep" });
    }

    if (target) {
      const eclip = elementStyleClip();
      items.push(
        { kind: "head", label: L(`Öğe · ${elementLabel(target)}`, `Element · ${elementLabel(target)}`) },
        {
          kind: "item",
          label: L("Öne al", "Bring forward"),
          icon: "up",
          run: () => putElements(reorderElement(sl.elements, target.id, "front")),
        },
        {
          kind: "item",
          label: L("Arkaya gönder", "Send backward"),
          icon: "down",
          run: () => putElements(reorderElement(sl.elements, target.id, "back")),
        },
        {
          kind: "item",
          label: bucketOf(target) === "under" ? L("Cihazın ÖNÜNE taşı", "Move IN FRONT of device") : L("Cihazın ARKASINA taşı", "Move BEHIND device"),
          icon: "layers",
          run: () =>
            putElements(
              patchElement(sl.elements, target.id, {
                z: bucketOf(target) === "under" ? "over" : "under",
              })
            ),
        },
        { kind: "sep" },
        { kind: "item", label: L("Çoğalt", "Duplicate"), icon: "copy", run: () => duplicateElement(target.id) },
        {
          kind: "item",
          label: target.locked ? L("Kilidi aç", "Unlock") : L("Kilitle", "Lock"),
          icon: "lock",
          run: () =>
            putElements(patchElement(sl.elements, target.id, { locked: !target.locked })),
        },
        {
          kind: "item",
          label: L("Sil", "Delete"),
          icon: "trash",
          danger: true,
          hint: "⌫",
          run: () => deleteElement(target.id),
        },
        { kind: "sep" },
        {
          kind: "item",
          label: L("Stili kopyala", "Copy style"),
          icon: "brush",
          run: () => copyElementStyle(target),
        },
        {
          kind: "item",
          label: eclip ? L(`Stili yapıştır · ${elementStyleClipLabel()}`, `Paste style · ${elementStyleClipLabel()}`) : L("Stili yapıştır", "Paste style"),
          icon: "paste",
          disabled: !eclip,
          run: () => {
            const c = elementStyleClip();
            if (c) putElements(patchElement(sl.elements, target.id, c));
          },
        },
        { kind: "sep" }
      );
    } else {
      items.push(
        { kind: "head", label: L("Ekle", "Add") },
        { kind: "item", label: L("Metin", "Text"), icon: "text", run: () => addElement("text", at) },
        { kind: "item", label: L("Dikdörtgen", "Rectangle"), icon: "grid", run: () => addElement("rect", at) },
        { kind: "item", label: L("Hap", "Pill"), icon: "layers", run: () => addElement("pill", at) },
        { kind: "item", label: L("Cam panel", "Glass panel"), icon: "plate", run: () => addElement("glass", at) },
        { kind: "item", label: L("Ok", "Arrow"), icon: "up", run: () => addElement("arrow", at) },
        { kind: "item", label: L("Çizgi", "Line"), icon: "reset", run: () => addElement("line", at) },
        ...(onStickers
          ? [{ kind: "item", label: "Sticker…", icon: "image", run: () => onStickers() } as MenuItem]
          : []),
        { kind: "sep" }
      );
    }

    items.push(
      { kind: "head", label: L(`Slayt · ${sl.headline?.slice(0, 20) || "başlıksız"}`, `Slide · ${sl.headline?.slice(0, 20) || "untitled"}`) },
      {
        kind: "item",
        label: L("Çoğalt", "Duplicate"),
        icon: "copy",
        hint: "⌘D",
        run: () => st.duplicateSlide(sl.id),
      },
      {
        kind: "item",
        label: L("Sil", "Delete"),
        icon: "trash",
        danger: true,
        disabled: s.slides.length <= 1,
        run: () => {
          st.removeSlide(sl.id);
          pushUndoToast(L("SLAYT SİLİNDİ", "SLIDE DELETED"));
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: locked ? L("Tasarım kilidini kaldır", "Unlock design") : L("Bu dilde tasarımı kilitle", "Lock design in this locale"),
        icon: "lock",
        hint: p.activeLocale.toUpperCase(),
        disabled: !key,
        run: () => st.toggleDesignLock(p.activeLocale, key),
      },
      { kind: "sep" },
      { kind: "item", label: L("Stili kopyala", "Copy style"), icon: "brush", run: () => copyStyle(sl) },
      {
        kind: "item",
        label: clip ? L(`Stili yapıştır · ${styleClipLabel()}`, `Paste style · ${styleClipLabel()}`) : L("Stili yapıştır", "Paste style"),
        icon: "paste",
        disabled: !clip,
        run: () => {
          const c = styleClip();
          if (c) st.updateSlide(sl.id, c);
        },
      },
      { kind: "sep" },
      { kind: "item", label: L("Taşımaları sıfırla", "Reset moves"), icon: "reset", run: resetNudge },
      {
        kind: "item",
        label: L("Tasarımı tüm dillere uygula", "Apply design to all locales"),
        icon: "globe",
        disabled: !multi,
        run: () => st.applyDesignToAllLocales(sl.id),
      }
    );
    return items;
  };

  const orbitLive = is3D && tool === "orbit";
  // C6'nın 3D karşılığı: WebGL tuvali `rasterCssW`'yi izler (yani zoom
  // dururken bir kez boyutlanır), aradaki farkı CSS `scale` kapatır. Eskiden
  // her pinch karesi `renderer.setSize` çağırıyordu.
  const liveW = Math.min(Math.max(120, rasterCssW), LIVE_CAP);
  const liveScale = size.w / liveW;
  const addSlide = useStudio((s) => s.addSlide);

  const hint =
    slide && isSplitScreen(slide) && tool !== "text" && tool !== "select"
      ? L("SPLIT SCREEN · KIRPMA ODAĞINI SAĞ PANELDEN AYARLA · GÖVDE VE YANSIMA YOK", "SPLIT SCREEN · SET THE CROP FOCUS IN THE RIGHT PANEL · NO BODY OR REFLECTION")
      : tool === "device"
      ? L("TIKLA-SÜRÜKLE: ALTINDAKİ NESNE · ⌥SÜRÜKLE (2. CİHAZ): ÖLÇEK · ⌥TEKERLEK: ÖLÇEK", "CLICK-DRAG: OBJECT UNDER CURSOR · ⌥DRAG (2ND DEVICE): SCALE · ⌥WHEEL: SCALE")
      : tool === "text"
        ? L("SÜRÜKLE: METİN BLOĞU", "DRAG: TEXT BLOCK")
        : tool === "select"
          ? selected
            ? L(`ÖĞE: ${elementLabel(selected).toUpperCase()} · ⌥ YAPIŞMAYI KAPAT · ⌫ SİL`, `ELEMENT: ${elementLabel(selected).toUpperCase()} · ⌥ DISABLE SNAPPING · ⌫ DELETE`)
            : L("TIKLA: KATMAN SEÇ · ÇİFT TIK: METİN / KIRPMA · ALT + TIK: ALT KATMANLAR", "CLICK: SELECT LAYER · DOUBLE-CLICK: TEXT / CROP · ALT + CLICK: LAYERS BELOW")
          : is3D
            ? L("SÜRÜKLE: CANLI ORBIT · TEKERLEK: MESAFE", "DRAG: LIVE ORBIT · WHEEL: DISTANCE")
            : L("BU SLAYT 2D — CİHAZ BÖLÜMÜNDEN 3D'YE AL", "THIS SLIDE IS 2D — SWITCH TO 3D IN THE DEVICE SECTION");

  /** Seçim çerçevesi + tutamaklar — CSS overlay, tuvale hiç dokunmaz. */
  const canTransform = selectedLayer && !selectedLayer.locked && !selectedLayer.hidden && selectedLayerId !== "background" && !selectedLayerId?.startsWith("screen:");
  const selectionOverlay = selectionBox && selectedLayer && !selectedLayer.hidden && !inlineText ? (
    <div className={`canvas-layer-selection ${cropEditing ? "crop-mode" : ""}`} data-selected-layer={selectedLayerId}
      style={{ left: selectionBox.x * k, top: selectionBox.y * k, width: Math.max(1, selectionBox.w * k), height: Math.max(1, selectionBox.h * k), transform: selectionBox.rotation ? `rotate(${selectionBox.rotation}deg)` : undefined, transformOrigin: "center" }}>
      <span className="canvas-layer-tag">{selectedLayer.label}{cropEditing ? L(" · kırpma", " · crop") : ""}</span>
      {canTransform && !cropEditing && <>
        {HANDLES.map(hd => <span key={hd.id} className="canvas-handle" role="button" aria-label={L(`Boyutlandır ${hd.id}`, `Resize ${hd.id}`)} style={{ left: `calc(${hd.x * 100}% - 5px)`, top: `calc(${hd.y * 100}% - 5px)`, cursor: hd.cur }} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); beginDrag(e, { kind: "layer-resize", id: selectedLayerId!, handle: hd.id }); }}/>) }
        {!(selectedLayer.type === "device" && is3D) && <span className="canvas-rotate" role="button" aria-label={L("Katmanı döndür", "Rotate layer")} title={L("Döndür · Shift: 15°", "Rotate · Shift: 15°")} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); beginDrag(e, { kind: "layer-rotate", id: selectedLayerId! }); }}/> }
      </>}
    </div>
  ) : null;
  const inlineBox = inlineText && slide ? layerBox(slide, inlineText.id, fmt, project.activeLocale) : null;
  const inlineElement = inlineText && slide ? layerElement(slide, inlineText.id) : null;
  const inlineStyle = inlineText && slide ? inlineElement ? { ...EL_TEXT_BASE, ...inlineElement.style } : { ...getTheme(slide.themeId)[inlineText.id === "headline" ? "headline" : "sub"], align: editorLayout(slide, fmt).text.align, ...slide[inlineText.id === "headline" ? "headlineStyle" : "subStyle"] } : null;
  const commitInlineText = () => {
    if (!inlineText || !slide) return;
    useStudio.getState().updateSlide(slide.id, inlineElement ? patchLayerElement(slide, inlineText.id, { text: inlineText.value }) : { [inlineText.id]: inlineText.value });
    setInlineText(null);
  };

  return (
    <section className="viewer">
      {overlap && <div className="canvas-overlap-menu" role="menu" style={{ left: Math.min(overlap.x, window.innerWidth - 230), top: Math.min(overlap.y, window.innerHeight - overlap.layers.length * 40 - 40) }}><p>{L("Bu noktadaki katmanlar", "Layers at this point")}</p>{overlap.layers.map(layer => <button key={layer.id} role="menuitem" onClick={() => { useStudio.getState().setSelectedLayer(layer.id); setOverlap(null); }}><Icon name={layer.type === "text" ? "text" : "layers"} size={13}/>{layer.label}</button>)}</div>}
      <div className="well-status">
        <span className="kunye hi">{project.activeLocale.toUpperCase()}</span>
        <span className="kunye">{hint}</span>
      </div>

      {/* C3 kas hafızası kırılmasının GÖRÜNÜR karşılığı: tekerleğin yeni anlamı
          kuyunun üstünde yazılı durur. Sol künyenin YANINA değil KARŞI köşeye
          konur — sol taraf çekmece açılınca kayıyor ve ikisi yan yana eserin
          sol üst köşesinin üstüne biniyordu. */}
      {!firstRun && (
        <span className="kunye well-nav" aria-hidden="true">
          {L("TEKERLEK KAYDIR · ⌘ ZOOM · ⌥ ÖLÇEK · BOŞLUK PAN · ORTA TUŞ ORBİT", "WHEEL SCROLL · ⌘ ZOOM · ⌥ SCALE · SPACE PAN · MIDDLE BUTTON ORBIT")}
        </span>
      )}

      <div
        className={`viewer-scroll${panReady ? " pan-ready" : ""}${panning ? " panning" : ""}`}
        ref={scrollRef}
        tabIndex={0}
        data-viewer="1"
        onPointerDownCapture={onPanDown}
        onAuxClick={(e) => {
          // Orta tık pan'i bitirdikten sonra tarayıcının "auto-scroll"u
          // açılmasın.
          if (e.button === 1) e.preventDefault();
        }}
        onContextMenu={(e) => {
          if (firstRun) return;
          e.preventDefault();
          const { bx, by } = toBaseXY(e.clientX, e.clientY);
          setMenu({ x: e.clientX, y: e.clientY, bx, by });
        }}
      >
        {firstRun ? (
          <div className="first-run">
            <button className="fr-card" onClick={() => onImport?.()}>
              <span className="fr-no">01</span>
              <h3>{L("MD içe aktar", "Import MD")}</h3>
              <p>{L("Pazarlama klasöründeki kareleri ve ekranları tek seferde kur.", "Set up the frames and screens from your marketing folder in one go.")}</p>
            </button>
            <button className="fr-card" onClick={() => onTemplates?.()}>
              <span className="fr-no">02</span>
              <h3>{L("Şablondan başla", "Start from a template")}</h3>
              <p>{L("Hazır bir kurgu seç; tema, yerleşim ve kamera birlikte gelsin.", "Pick a ready-made setup; theme, layout and camera come together.")}</p>
            </button>
            <button className="fr-card" onClick={() => addSlide()}>
              <span className="fr-no">03</span>
              <h3>{L("Boş slayt", "Blank slide")}</h3>
              <p>{L("Sıfırdan kur: ekranı at, başlığı yaz, kadrajı seç.", "Build from scratch: drop in the screen, write the headline, pick the framing.")}</p>
            </button>
          </div>
        ) : (
          <div className="stage">
            <div
              className="stage-card"
              ref={cardRef}
              style={{ width: size.w, height: size.h }}
              // Sticker çekmecesinden sürükle-bırak: bırakılan NOKTA öğenin
              // merkezi olur (MediaPool `text/vitrin-sticker` taşır).
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("text/vitrin-sticker")) e.preventDefault();
              }}
              onDrop={(e) => {
                const f = e.dataTransfer.getData("text/vitrin-sticker");
                if (!f) return;
                e.preventDefault();
                const { bx, by } = toBaseXY(e.clientX, e.clientY);
                void dropSticker(f, bx, by);
              }}
            >
              {is3D ? (
                <>
                  <div
                    className="stage-stack"
                    style={{
                      width: size.w,
                      height: size.h,
                      // Filtre GRUBA uygulanır: tarayıcı üç katmanı önce
                      // birleştirir, sonra filtreler — yani doğru yerde.
                      filter: liveGrade,
                    }}
                    onPointerDown={onPointerDown}
                    onDoubleClick={editTextAt}
                  >
                    <canvas ref={underRef} className="layer" />
                    <div
                      className="layer live-wrap"
                      style={{
                        width: liveW,
                        height: Math.round((liveW * BASE_H) / BASE_W),
                        transform: liveScale === 1 ? undefined : `scale(${liveScale})`,
                        transformOrigin: "top left",
                        pointerEvents: orbitLive ? "auto" : "none",
                      }}
                      ref={attachLiveHost}
                    />
                    <canvas ref={overRef} className="layer" />
                  </div>
                  {/* Künyeler filtrenin DIŞINDA: grade rozeti kendi rengini
                      grade'lemesin. .stage-card position:relative olduğu için
                      konumları değişmez. */}
                  <span className="live-badge">
                    <i />
                    {L("canlı 3d", "live 3d")}
                  </span>
                  {liveGrade && (
                    <span className="live-badge" style={GRADE_BADGE} title={liveGrade}>
                      {L("grade ≈ önizleme", "grade ≈ preview")}
                    </span>
                  )}
                </>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="stage-canvas"
                  style={{
                    width: size.w,
                    height: size.h,
                    cursor: tool === "select" ? "default" : undefined,
                  }}
                  onPointerDown={onPointerDown}
                  onDoubleClick={editTextAt}
                />
              )}

              {/* C7/C10 — geçişte eski kareyi tutan hayalet. Her zaman DOM'da
                  durur (opaklık/görünürlükle yönetilir) ki 2D↔3D dalında
                  yeniden mount edilip kaybolmasın. */}
              <canvas ref={ghostRef} className="stage-ghost" aria-hidden="true" />
              {/* C11/C12 — hover önizlemesi: önce kart JPEG'i, sonra taslak. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={previewImgRef} className="stage-preview warm" alt="" aria-hidden="true" />
              <canvas ref={previewRef} className="stage-preview" aria-hidden="true" />
              {safeArea && (
                <div className="safe-guide" aria-hidden="true">
                  <span className="sg-box" />
                  <span className="sg-v" />
                  <span className="sg-h" />
                </div>
              )}
              {selectionOverlay}
              {inlineText && inlineBox && inlineStyle && <textarea className="canvas-text-editor" aria-label={L("Tuval üzerinde metin düzenle", "Edit text on canvas")} autoFocus value={inlineText.value}
                style={{ left: inlineBox.x * k, top: inlineBox.y * k, width: inlineBox.w * k, minHeight: Math.max(inlineBox.h * k + 15, 40), fontFamily: inlineStyle.fontFamily, fontSize: inlineStyle.sizePx * k, fontWeight: inlineStyle.weight, fontStyle: inlineStyle.style, lineHeight: inlineStyle.lineHeight ?? 1.1, letterSpacing: (inlineStyle.letterSpacing ?? 0) * k, color: inlineStyle.color === "#ffffff" ? "#29263b" : inlineStyle.color, textAlign: inlineStyle.align, transform: inlineBox.rotation ? `rotate(${inlineBox.rotation}deg)` : undefined }}
                onPointerDown={e => e.stopPropagation()} onChange={e => setInlineText({ ...inlineText, value: e.target.value })} onBlur={commitInlineText} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") setInlineText(null); else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitInlineText(); }}/>}
              {/* Akıllı kılavuzlar — 1px kırmızı CSS çizgileri (canvas'a ÇİZİLMEZ) */}
              {guides?.x != null && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: Math.round(guides.x * k),
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: GUIDE,
                    zIndex: 5,
                    pointerEvents: "none",
                  }}
                />
              )}
              {guides?.y != null && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: Math.round(guides.y * k),
                    left: 0,
                    right: 0,
                    height: 1,
                    background: GUIDE,
                    zIndex: 5,
                    pointerEvents: "none",
                  }}
                />
              )}
              {glbLoad.active > 0 && (
                <span style={GLB_CHIP} aria-live="polite">
                  <i style={GLB_SPIN} />
                  {L("Model yükleniyor…", "Loading model…")}{glbLoad.ratio > 0 ? L(` %${Math.round(glbLoad.ratio * 100)}`, ` ${Math.round(glbLoad.ratio * 100)}%`) : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Yüzen alt araç adası — Framer kalıbı, zeminden 16px */}
      {!firstRun && (
        <div className="island">
          <button
            className={`tool ic ${tool === "device" ? "on" : ""}`}
            onClick={() => setTool("device")}
            title={L("Cihazı taşı / ölçekle", "Move / scale device")}
          >
            <Icon name="phone" size={14} />
          </button>
          <button
            className={`tool ic ${tool === "text" ? "on" : ""}`}
            onClick={() => setTool("text")}
            title={L("Metin bloğunu taşı", "Move text block")}
          >
            <Icon name="text" size={14} />
          </button>
          <button
            className={`tool ic ${tool === "select" ? "on" : ""}`}
            onClick={() => { setTool("select"); const st = useStudio.getState(); st.setLayerPanelTab("layers"); st.setLayerPanelOpen(true); }}
            title={L("Katman seç / taşı / boyutlandır", "Select / move / resize layer")}
          >
            <Icon name="layers" size={14} />
          </button>
          <button
            className={`tool ic ${tool === "orbit" ? "on" : ""}`}
            onClick={() => setTool("orbit")}
            title={L("Canlı 3D orbit", "Live 3D orbit")}
          >
            <Icon name="rotate" size={14} />
          </button>
          <span className="sep" />
          <button
            className={`tool ic ${safeArea ? "on" : ""}`}
            onClick={() => setSafeArea((s) => !s)}
            title={L("Güvenli alan kılavuzu", "Safe area guide")}
          >
            <Icon name="frame" size={14} />
          </button>
          <button className="tool ic" onClick={resetNudge} title={L("Taşımaları sıfırla", "Reset moves")}>
            <Icon name="reset" size={14} />
          </button>
          <span className="sep" />
          {ZOOM_STEPS.map((z) => (
            <button
              key={String(z.id)}
              className={`tool ${zoom === z.id ? "on" : ""}`}
              onClick={() => zoomTo(z.id)}
              title={z.id === "fit" ? L("Sığdır (F)", "Fit (F)") : L(`Zoom %${z.label}`, `Zoom ${z.label}%`)}
            >
              {z.label}
            </button>
          ))}
          <span
            className="zoom-read"
            title={L("⌘ + tekerlek: imleç altına zoom · boşluk + sürükle: pan", "⌘ + wheel: zoom at cursor · space + drag: pan")}
          >
            {L("%", "")}<input className="canvas-zoom-input" type="number" aria-label={L("Tuval zoom yüzdesi", "Canvas zoom percentage")} min={8} max={800} value={Math.round(effZoom * 100)} onChange={e => { const value = Number(e.target.value); if (value > 0) zoomTo(clamp(value / 100, Z_MIN, Z_MAX)); }} />{L("", "%")}
          </span>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} close={() => setMenu(null)} />
      )}

      <style>{"@keyframes vs-glb-spin{to{transform:rotate(360deg)}}"}</style>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   C36 — SAYAÇ ROLL'ü

   Zoom yüzdesi değişince yalnız DEĞİŞEN rakam 12px'lik bir yuvada kayarak
   yerine oturur (--t-fast). Değişmeyen rakamlar kıpırdamaz: mono ızgara
   sabit kalır, göz sayıyı okumaya devam eder. Yön anlamlıdır — büyürken
   aşağıdan, küçülürken yukarıdan gelir.

   Uygulama React'in `key`'ine yaslanır: bir yuvanın rakamı değişince
   `key` değişir, düğüm yeniden takılır, animasyon kendiliğinden baştan
   başlar. Zamanlayıcı, durum, ölçüm yok.
   --------------------------------------------------------------------------- */
function Roll({ value }: { value: number }) {
  const prev = useRef(value);
  const dirRef = useRef<"up" | "dn">("up");
  // Yön YALNIZ değer gerçekten değişince güncellenir. Naif hâli
  // (`dir = value < prev.current`, ardından koşulsuz `prev.current = value`)
  // StrictMode'un çift render'ında bozuluyordu: ilk geçiş prev'i güncelliyor,
  // ikinci geçiş "değişmedi" görüp yönü hep "up" yapıyordu.
  if (value !== prev.current) {
    dirRef.current = value < prev.current ? "dn" : "up";
    prev.current = value;
  }
  const dir = dirRef.current;
  return (
    <span className="roll">
      {String(value)
        .split("")
        .map((c, i) => (
          <span className="roll-slot" key={i}>
            <b key={c} className={`roll-d ${dir}`}>
              {c}
            </b>
          </span>
        ))}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   GLB yükleme çipi — .live-badge ile aynı dil, sahnenin altında.
   --------------------------------------------------------------------------- */

/**
 * "grade ≈ önizleme" künyesi — canlı 3D yolda grade'in YAKLAŞIK olduğunu söyler.
 * .live-badge'in hemen altında, aynı dilde ama vurgusuz (nokta yok).
 */
const GRADE_BADGE: React.CSSProperties = {
  top: 36,
  color: "var(--ink-3, #7c7c85)",
};

const GLB_CHIP: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 4,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  font: "400 9px/1 var(--mono)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
  background: "rgba(10, 10, 12, 0.78)",
  border: "1px solid var(--line)",
  padding: "5px 10px",
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

const GLB_SPIN: React.CSSProperties = {
  width: 9,
  height: 9,
  border: "1.5px solid rgba(242,241,236,0.16)",
  borderTopColor: "#c6ff3a",
  animation: "vs-glb-spin 0.7s linear infinite",
  display: "block",
  flex: "none",
};
