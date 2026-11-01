"use client";

// SAĞ PANEL — Inspector (UI v3).
//
// Rapor §4: referans setinde ÜÇTEN fazla sekme yok (Rive `Design|Animate`,
// Visual Electric `Tools|Properties`, Framer `Agent|Style`). Eski beş sekme
// İKİYE indi ve derinlik katlanır bölümlere taşındı:
//
//   TASARIM → Metin · Tipografi · Cihaz · Ekran · Plate · Bölünmüş
//   SAHNE   → Arka plan · Işık · Kamera · Efekt
//
// Kontrollerin İÇİ değişmedi; yalnız yerleşimi ve yoğunluğu değişti:
// 28px satır, 88px etiket kolonu, sayı alanlarında sürtme-scrub, ileri
// kontroller `GELİŞMİŞ` altında kapalı (rapor §8).
//
// Senkron sapması: bir tasarım alanı diğer dillerdeki kardeşlerinden
// ayrıştıysa bölümün başında TİLKİ bandı + "temele dön" çıkar
// (store.fieldDrift → applyDesignToAllLocales).

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BLEND_LABELS,
  bucketOf,
  EL_TEXT_BASE,
  elementById,
  elementLabel,
  kindLabel,
  makeElement,
  patchElement,
  removeElement,
} from "@/engine/elements";
import LayoutPicker from "./LayoutPicker";
import { patchForTheme, restyleSlides } from "@/engine/templates";
import { BRAND_COLLECTIONS } from "@/engine/brandThemes";
import { PRIVATE_THEME_CATEGORIES } from "@private";
import CameraPicker from "./CameraPicker";
import { previewSrc } from "@/engine/media";
import { shadowCfgOf, shadowDefaults } from "@/engine/device2d";
import { FONT_FAMILIES } from "@/engine/fonts";
import { GRADE_PRESETS, GRADE_PRESET_IDS, gradeRamp, resolveGrade } from "@/engine/grade";
import { LAYOUTS } from "@/engine/layouts";
import { mergeOverlay } from "@/engine/overlays";
import {
  DEFAULT_MODEL_FILE,
  DEFAULT_TABLET_MODEL_FILE,
  listModels,
  modelFileOf,
  modelRegistryRev,
  subscribeModelRegistry,
} from "@/engine/modelRegistry";
import { presetOrbit } from "@/engine/scene3d";
import { getTheme, THEMES } from "@/engine/themes";
import { isSplitScreen, splitCropDefault } from "@/engine/splitScreens";
import {
  peekThumb,
  syncThumbRev,
  thumbAspectOf,
  thumbFor,
  THUMB_CSS,
  THUMB_H,
} from "@/engine/thumbs";
// R8/W3 · C11+C14 — kart üstüne gelince kuyuda GEÇİCİ önizleme. Store'a
// yazmaz; `previewProps` üç ızgarada da aynı üç olayı bağlar.
import { previewProps } from "./previewOverride";
import {
  BASE_H,
  BASE_W,
  FORMATS,
  clamp,
  isDevice3D,
  deviceStyleForFormat,
  uid,
  type Background,
  type CameraPresetId,
  type Device2DShadow,
  type DeviceStyle,
  type DeviceStyle2D,
  type DeviceStyle3D,
  type ElKind,
  type Format,
  type GradeSpec,
  type LayoutId,
  type LightRigId,
  type Slide,
  type SlideElement,
  type TextStyle,
  type ThemeOverlay,
  formatOf,
  formatLabel,
  isDuoFormat,
  isTabletKind,
  kindOfFormat,
} from "@/engine/types";
import { api } from "@/lib/client";
import { L } from "@/lib/i18n";
import { fieldDrift, SHOT_FIELD, shotSlotCount, useStudio, type ShotSlot } from "@/store/studio";
import { splitPatch } from "@/engine/designsync";
import { pushToast } from "./toast";
import { SlideStrip } from "./panels/common";
import { focusPanel } from "@/store/workspace";
import { setLibraryTab } from "./panels/libraryTab";
import GradientEditor from "./GradientEditor";
import {
  Advanced,
  Icon,
  PanelTabs,
  Row,
  Section,
  Segmented,
  SliderRow,
  Swatches,
  Toggle,
  useAssets,
  useRenderRev,
  type AssetList,
  type PanelTab,
} from "./ui";

export type InspectorTab = "design" | "scene";

const INSPECTOR_TABS: PanelTab<InspectorTab>[] = [
  { id: "design", label: L("Tasarım", "Design") },
  { id: "scene", label: L("Sahne", "Scene") },
];

/**
 * Elle yazılmış düzen etiketleri. KASITLI OLARAK `Partial`: motor tarafı yeni
 * bir düzen eklediğinde (R10 çoklu ekran kompozisyonları) burası eksik kalır
 * ama derleme kırılmaz — `layoutLabel` id'den okunur bir başlık üretir, yani
 * yeni düzen panelde ETİKETSİZ ya da ham `snake-case` görünmez.
 */
const LAYOUT_LABELS: Partial<Record<LayoutId, string>> = {
  "text-top": L("Metin üstte", "Text on top"),
  "text-bottom": L("Metin altta", "Text on bottom"),
  "device-bleed-bottom": L("Hero — alttan taşar", "Hero — bleeds off bottom"),
  "device-bleed-top": L("Cihaz üstten taşar", "Device bleeds off top"),
  "text-overlay": L("Metin cihaz üstünde", "Text over device"),
  "badge-hero": L("Rozet + hero", "Badge + hero"),
  "split-diagonal": L("Diyagonal", "Diagonal"),
  "split-v": L("Split · kırpılmış sütunlar", "Split · cropped columns"),
  "split-h": L("Split · kırpılmış kareler", "Split · cropped frames"),
  "duo-overlap": L("İkili — bindirmeli", "Duo — overlapping"),
  "duo-depth": L("İkili — derinlikli", "Duo — layered depth"),
  "duo-dutch": L("İkili — karşıt eğim", "Duo — opposing tilt"),
  "duo-hero-aside": L("İkili — kahraman + destek", "Duo — hero + support"),
  "duo-stagger": L("İkili — kaydırmalı, metin solda", "Duo — staggered, text on left"),
  "duo-bleed-sides": L("İkili — yanlardan taşan", "Duo — bleeding off sides"),
  "duo-editorial": L("İkili — editöryel, metin solda", "Duo — editorial, text on left"),
  "duo-pip": L("İkili — inset (resim içinde resim)", "Duo — inset (picture-in-picture)"),
  diptych: L("Çift kare", "Diptych"),
  "screen-card": L("Kart ekran", "Card screen"),
  "pano-left": L("Panorama sol", "Panorama left"),
  "pano-right": L("Panorama sağ", "Panorama right"),
  "wide-left": L("Yatay sol", "Wide left"),
  "wide-right": L("Yatay sağ", "Wide right"),
  "wide-hero": L("Yatay hero", "Wide hero"),
  "trio-arc": L("Üçlü — yay", "Trio — arc"),
  "trio-stack": L("Üçlü — kademeli", "Trio — stepped"),
  "panorama-mid": L("Panorama orta", "Panorama center"),
};

/** Düzen id parçalarının Türkçesi — bilinmeyen id'den etiket türetmek için. */
const LAYOUT_WORDS: Record<string, string> = {
  text: L("metin", "text"),
  device: L("cihaz", "device"),
  screen: L("ekran", "screen"),
  top: L("üst", "top"),
  bottom: L("alt", "bottom"),
  bleed: L("taşan", "bleed"),
  overlay: L("üstte", "overlay"),
  badge: L("rozet", "badge"),
  split: L("bölünmüş", "split"),
  diagonal: L("diyagonal", "diagonal"),
  panorama: L("panorama", "panorama"),
  mid: L("orta", "mid"),
  center: L("orta", "center"),
  v: L("dikey", "vertical"),
  h: L("yatay", "horizontal"),
  vertical: L("dikey", "vertical"),
  horizontal: L("yatay", "horizontal"),
  duo: L("ikili", "duo"),
  pair: L("ikili", "pair"),
  overlap: L("bindirme", "overlap"),
  depth: L("derinlik", "depth"),
  offset: L("kaydırmalı", "offset"),
  trio: L("üçlü", "trio"),
  tri: L("üçlü", "trio"),
  triple: L("üçlü", "trio"),
  three: L("üçlü", "trio"),
  fan: L("yelpaze", "fan"),
  stack: L("derinlik", "stack"),
  cascade: L("şelale", "cascade"),
  stair: L("merdiven", "stair"),
  arc: L("yay", "arc"),
  grid: L("ızgara", "grid"),
  row: L("sıra", "row"),
  col: L("kolon", "column"),
  column: L("kolon", "column"),
  left: L("sol", "left"),
  right: L("sağ", "right"),
  wide: L("geniş", "wide"),
  tall: L("uzun", "tall"),
  small: L("küçük", "small"),
  big: L("büyük", "big"),
};

/** Çipte gösterilecek etiket; sözlükte yoksa id'den Türkçeleştirilmiş başlık. */
function layoutLabel(id: LayoutId): string {
  const known = LAYOUT_LABELS[id];
  if (known) return known;
  const s = String(id)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => LAYOUT_WORDS[w.toLowerCase()] ?? w)
    .join(" ");
  return s ? s.charAt(0).toLocaleUpperCase(L("tr-TR", "en-US")) + s.slice(1) : String(id);
}

/** Yuva başlıkları — kaç cihaz varsa o kadarı gösterilir. */
const SLOT_TITLES: Record<ShotSlot, string> = {
  1: L("1. ekran", "Screen 1"),
  2: L("2. ekran", "Screen 2"),
  3: L("3. ekran", "Screen 3"),
};

function slotTitle(layout: LayoutId, slot: ShotSlot): string {
  if (layout === "split-v" || layout === "split-h") {
    return slot === 1 ? L("1. özellik (giriş)", "Feature 1 (intro)") : slot === 2 ? L("2. özellik (ana ekran)", "Feature 2 (home screen)") : L("3. özellik", "Feature 3");
  }
  return SLOT_TITLES[slot];
}

function formatTag(format: Format): string { return formatLabel(format); }

const CAMERAS: { id: CameraPresetId; label: string }[] = [
  { id: "front", label: L("Karşıdan", "Front") },
  { id: "hero-left", label: L("Hero sol", "Hero left") },
  { id: "hero-right", label: L("Hero sağ", "Hero right") },
  { id: "iso", label: L("İzometrik", "Isometric") },
  { id: "laydown", label: L("Yatık üstten", "Laid-down top") },
  { id: "pair", label: L("İkili", "Pair") },
  { id: "fan3", label: L("Üçlü yelpaze", "Trio fan") },
  // R8/W1: derinlik kademeli üçlü + sinematik açılar (BEAUTY-3D preset'leri).
  { id: "stack3", label: L("Üçlü derinlik", "Trio depth") },
  { id: "dutch", label: L("Dutch açı", "Dutch angle") },
  { id: "low-hero", label: L("Alttan hero", "Low hero") },
  { id: "lean-back", label: L("Yaslanmış", "Leaning back") },
  { id: "three-quarter", label: L("3/4 profil", "3/4 profile") },
  { id: "top-down", label: L("Üstten diyagonal", "Top diagonal") },
  { id: "close-top", label: L("Yakın — üst", "Close — top") },
  { id: "close-bottom", label: L("Yakın — alt", "Close — bottom") },
  { id: "custom", label: L("Serbest", "Free") },
];

/** Işık rigleri — engine/scene3dCore.ts LIGHT_RIGS ile aynı sıra. */
const RIGS: { id: LightRigId; label: string }[] = [
  { id: "studio", label: L("Stüdyo", "Studio") },
  { id: "softbox", label: "Softbox" },
  { id: "rim", label: "Rim" },
  { id: "night", label: L("Gece", "Night") },
  { id: "daylight", label: L("Gün", "Day") },
];

/* R8/W4 (B-7.3) — ham `<input type="color">` kalmadı: her renk girişi
   `Swatches`ten geçiyor, böylece damlalık ve "son 8 renk" satırını
   otomatik miras alıyor. Aşağıdakiler o girişlerin hızlı çipleri. */

/** 3D kasa renkleri — titanyum ailesi + iki cesur seçenek. */
const BODY_COLORS = ["#3a3a3e", "#0e0e12", "#8e8e93", "#c9c4bb", "#1b2a4a", "#b8912f"];
/** R9 — ışık halkası paleti (Klein + tema halkalarının renkleri). */
const GLOW_COLORS = ["#2f6bff", "#0512e8", "#c9a227", "#ff2bd6", "#ff7a3d", "#ffffff"];

/** Senkron kapalıyken tasarım düzenlemesi uyarısı — dakikada en fazla bir kez. */
let lastSyncWarn = 0;
function warnSyncOff(): void {
  const t = Date.now();
  if (t - lastSyncWarn < 60_000) return;
  lastSyncWarn = t;
  pushToast({
    msg: L("SENKRON KAPALI — bu değişiklik yalnız bu dile uygulandı", "SYNC OFF — this change was applied to this locale only"),
    action: { label: L("Senkronu aç", "Turn sync on"), run: () => useStudio.getState().setSyncDesign(true) },
  });
}
/** Grade split-tone gölge çipleri — soğuk uçtan sıcağa. */
const SPLIT_SHADOW_COLORS = ["#0a1a2f", "#123a3a", "#2a1b3d", "#1a1a1a", "#3a2418"];
/** Grade split-tone parlak çipleri — sıcak uçtan soğuğa. */
const SPLIT_HIGH_COLORS = ["#ffd9a8", "#ffe9d0", "#fff4e2", "#e8f0ff", "#d8ffe8"];

/** lightRig yoksa eski env alanından türet (scene3dCore.rigIdOf ile aynı kural). */
function rigOf(d: DeviceStyle3D): LightRigId {
  if (d.lightRig) return d.lightRig;
  if (d.env === "soft") return "softbox";
  if (d.env === "night") return "night";
  return "studio";
}

/* ------------------------------------------------------------------ *
   Sapma bandı — "bu alan diğer dillerden ayrıştı"
 * ------------------------------------------------------------------ */

function DriftBand({
  slide,
  fields,
}: {
  slide: Slide;
  fields: (keyof Slide)[];
}) {
  const applyAll = useStudio((s) => s.applyDesignToAllLocales);
  const locales = useStudio((s) => Object.keys(s.project.sets).length);
  if (locales < 2) return null;
  const hit = fields.filter((f) => fieldDrift(slide, f));
  if (!hit.length) return null;
  return (
    <div className="drift-row" role="status">
      <Icon name="globe" size={11} />
      {L("Dillerden ayrıştı", "Diverged from other locales")}
      <button onClick={() => applyAll(slide.id)} title={L("Bu slaytın tasarımını tüm dillere bas", "Apply this slide's design to all locales")}>
        {L("temele dön", "revert to base")}
      </button>
    </div>
  );
}

/**
 * Sekme durumu dışarıdan verilebilir (Studio kabuğu) ya da bileşen kendi
 * içinde tutar — /test3d/inspector gibi tekil kullanımlar prop vermez.
 */
// v1.0: sekmeler kalktı; eski çağıranlar (test sayfaları) prop geçebilir, yok sayılır.
export default function Inspector(_legacy: { tab?: unknown; setTab?: unknown } = {}) {
  const project = useStudio((s) => s.project);
  const projectFormat = formatOf(project);
  const duoProject = isDuoFormat(projectFormat);
  const tabletProject = isTabletKind(kindOfFormat(projectFormat));
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const updateSlide = useStudio((s) => s.updateSlide);
  const applyDesignToSelected = useStudio((s) => s.applyDesignToSelected);
  const applyDesignToAllSlides = useStudio((s) => s.applyDesignToAllSlides);
  const patchDeviceAllSlides = useStudio((s) => s.patchDeviceAllSlides);
  const selectedIds = useStudio((s) => s.selectedIds);
  const mutate = useStudio((s) => s.mutate);
  const setBusy = useStudio((s) => s.setBusy);
  const assets = useAssets();
  const [wiroPrompt, setWiroPrompt] = useState("");
  const [wiroErr, setWiroErr] = useState("");
  // Havuz ızgarasındaki tıklamanın HANGİ yuvaya yazacağı. Düzen küçülünce
  // (3→2 cihaz) render sırasında kelepçelenir; ayrı bir efekt gerekmez.
  const [shotTargetRaw, setShotTarget] = useState<ShotSlot>(1);
  const setSlideShot = useStudio((s) => s.setSlideShot);
  const fanOutShot = useStudio((s) => s.fanOutShot);
  const swapSlideShots = useStudio((s) => s.swapSlideShots);
  // Tema nesnesi yerinde düzenlenirse (ör. tema editörü) paneli tazele.
  // NOT: bitirici sliderları artık burayı KULLANMIYOR — R8/W4'ten beri
  // gren/vignette `slide.overlay` üzerinden normal store yolundan geçiyor.
  useRenderRev();
  // meta.json geç yüklenince model etiketleri/kalibrasyonu tazelensin
  useSyncExternalStore(subscribeModelRegistry, modelRegistryRev, () => 0);

  const set = project.sets[project.activeLocale];
  const idx = set.slides.findIndex((x) => x.id === activeSlideId);
  const slide: Slide | undefined = set.slides[idx] ?? set.slides[0];
  const theme = slide ? getTheme(slide.themeId) : null;

  const genBackground = async () => {
    if (!wiroPrompt.trim() || !slide) return;
    setWiroErr("");
    setBusy(L("Wiro arka plan üretiyor… (~90 sn)", "Wiro is generating a background… (~90 s)"));
    try {
      const r = await api<{ path: string }>("/api/wiro", {
        action: "background",
        prompt: wiroPrompt,
      });
      updateSlide(slide.id, {
        background: { kind: "image", src: r.path, overlayColor: "#000", overlayAlpha: 0.25 },
      });
    } catch (e) {
      setWiroErr(L(`Üretim hatası: ${e instanceof Error ? e.message : e}`, `Generation error: ${e instanceof Error ? e.message : e}`));
    } finally {
      setBusy(null);
    }
  };

  // Boş inspector — Webflow'un cümlesi (rapor §8): jest anlatılır.
  if (!slide || !theme) {
    return (
      <aside className="inspector scene-panel">
        <div className="insp-empty">
          <b>{L("Seçim yok", "No selection")}</b>
          {L("Film şeridinden bir slayt seç; bu panel onun tasarımını açar.", "Pick a slide from the filmstrip; this panel opens its design.")}
        </div>
      </aside>
    );
  }

  const dev: DeviceStyle = slide.device ?? theme.device;
  /**
   * R9 — ÇOKLU SEÇİM FARKINDA YAMA.
   *
   * ESKİDEN: panel her zaman `updateSlide(slide.id, …)` derdi; film şeridinde
   * 10 slayt seçili olsa bile yalnız aktif slayt değişirdi (kullanıcı 10 kez
   * aynı ayarı yapıyordu). ŞİMDİ seçim >1 iken aynı yama seçimin TAMAMINA
   * gider — tasarım alanları oradan da normal şekilde dillere yayılır.
   *
   * Katlama anahtarı tek slayttakiyle aynı mantıkta üretilir: bir slider'ı
   * sürüklemek TEK ⌘Z adımı kalır, farklı alanlar ayrı adım açar.
   */
  const multi = selectedIds.length > 1;
  const up = (patch: Partial<Slide>) => {
    // R9: senkron KAPALIYKEN tasarım düzenlemesi sessizce tek dilde kalıyordu
    // ("neden diğer dillere geçmedi?"). Dakikada bir hatırlat, açma düğmesiyle.
    if (project.syncDesign === false && Object.keys(splitPatch(patch).design).length) {
      warnSyncOff();
    }
    if (multi) {
      applyDesignToSelected(patch, {
        coalesceKey: `bulk:${selectedIds.length}:${Object.keys(patch).sort().join(",")}`,
      });
    } else {
      updateSlide(slide.id, patch);
    }
  };
  const upDev = (d: DeviceStyle) => up({ device: d });
  const bg: Background = slide.background ?? theme.background;
  // Zemin efektleri (slide.bgFx). Nötr değer yazılmaz → alan boşalınca
  // tamamen `undefined` olur ve renderer efektsiz yola geri döner.
  const fx = slide.bgFx ?? {};
  const fxOn = (fx.blur ?? 0) > 0 || (fx.dim ?? 0) > 0 || (fx.sat ?? 1) !== 1;
  const upFx = (patch: Partial<NonNullable<Slide["bgFx"]>>) => {
    const next = { ...fx, ...patch };
    const live = (next.blur ?? 0) > 0 || (next.dim ?? 0) > 0 || (next.sat ?? 1) !== 1;
    up({ bgFx: live ? next : undefined });
  };

  // R9: eskiden ham `mutate` ile yalnız AKTİF DİLE yazıyordu — diğer 14 dil
  // eski temada kalıyordu. Artık senkronlu yoldan geçiyor.
  const applyThemeAll = () => {
    const brand = BRAND_COLLECTIONS.find(c=>c.id===slide.themeId);
    if (brand) {
      mutate(p => { const active = p.sets[p.activeLocale]; if (active) active.slides = restyleSlides(active.slides, tabletProject && brand.ipadTemplateId ? brand.ipadTemplateId : brand.templateId); return p; });
      if (project.syncDesign !== false) useStudio.getState().applyDesignToAllLocales();
      pushToast({ msg: L(`${brand.app} kurgusu ${set.slides.length} slayta uygulandı`, `${brand.app} layout applied to ${set.slides.length} slides`) });
      return;
    }
    const n = applyDesignToAllSlides(["themeId"], slide.id);
    pushToast({ msg: L(`Tema ${n} slayta uygulandı${project.syncDesign !== false ? " · tüm diller" : ""}`, `Theme applied to ${n} slides${project.syncDesign !== false ? " · all locales" : ""}`) });
  };
  /** Cihaz ayarını (model/kamera/ışık + konum) tüm slaytlara + tüm dillere. */
  const applyDeviceAll = () => {
    const n = applyDesignToAllSlides(["device", "deviceOffset", "device2Offset"], slide.id);
    pushToast({ msg: L(`Cihaz ${n} slayta uygulandı${project.syncDesign !== false ? " · tüm diller" : ""}`, `Device applied to ${n} slides${project.syncDesign !== false ? " · all locales" : ""}`) });
  };

  /* R8/W4 (B-4.2) — SLAYT BAZLI BİTİRİCİ OVERRIDE'I
     ESKİDEN: `theme.overlay = {...}` — modül seviyesindeki tema nesnesini
     YERİNDE değiştiriyordu. Sonuç: geri alma yok, proje JSON'una hiç
     yazılmıyor (yeniden yüklemede kayıp), ve o temayı kullanan BÜTÜN
     slaytlar sessizce değişiyordu.
     ŞİMDİ: `slide.overlay` — normal bir tasarım alanı. Undo, kayıt ve dil
     yayılımı bedavaya gelir; motor tarafında `mergeOverlay` tanımlı olmayan
     alanları temadan miras bırakır. */
  const ovSlide = slide.overlay;
  /** Slaytta GERÇEKTEN basılan bitirici — motorla birebir aynı birleştirici. */
  const ov = mergeOverlay(theme.overlay, ovSlide) || {};
  /**
   * Override yazar. Tema değerine EŞİT olan alan override sayılmaz, silinir:
   * böylece slider etiketine çift tıklamak (SliderRow'un varsayılan jesti)
   * gerçekten "temadan miras al"a döner ve proje JSON'u temiz kalır.
   */
  const setOverlay = (patch: Partial<ThemeOverlay>) => {
    const next: Partial<ThemeOverlay> = { ...(ovSlide || {}), ...patch };
    const base = theme.overlay || {};
    for (const k of Object.keys(next) as (keyof ThemeOverlay)[]) {
      const v = next[k];
      if (v === undefined || JSON.stringify(v) === JSON.stringify(base[k])) delete next[k];
    }
    up({ overlay: Object.keys(next).length ? next : undefined });
  };

  const orbit = isDevice3D(dev) ? dev.orbit ?? presetOrbit(dev.camera) : null;
  const dev2 = dev.mode === "2d" ? (dev as DeviceStyle2D) : null;
  const dev3 = dev.mode === "3d" ? (dev as DeviceStyle3D) : null;
  const deviceModelOptions = listModels({ kind: duoProject ? "foldable" : tabletProject ? "tablet" : ["phone", "prop"] });
  const preferredModelFile = tabletProject ? DEFAULT_TABLET_MODEL_FILE : DEFAULT_MODEL_FILE;
  const selectedModelFile = duoProject ? `apple-iphone-duo-${dev3?.duoPosture ?? (projectFormat.includes("cover") ? "closed" : "open")}.glb` :
    deviceModelOptions.find((m) => m.file === modelFileOf(dev3?.glb))?.file ??
    deviceModelOptions.find((m) => m.file === preferredModelFile)?.file ??
    deviceModelOptions[0]?.file;
  const hasRealGlb = deviceModelOptions.length > 0;
  const resolvedDeviceModel = duoProject ? "real" : tabletProject && !hasRealGlb ? "kontur" : dev3?.model ?? "real";
  const dOff = slide.deviceOffset || { x: 0, y: 0 };
  const d2Off = slide.device2Offset || { x: 0, y: 0 };
  const tOff = slide.textOffset || { x: 0, y: 0 };
  const twoUp = !!LAYOUTS[slide.layout]?.device2;

  /* ---- R10 · EKRAN GÖRÜNTÜSÜ YUVALARI -------------------------------- */
  // Kaç yuva? Düzenin device2/device3 alanlarından okunur (sabit id yok).
  const slotCount = shotSlotCount(slide.layout, projectFormat);
  const shotTitle = (n: ShotSlot) => duoProject && !LAYOUTS[slide.layout].device2 ? n === 1 ? L("İç ekran", "Inner screen") : L("Dış ekran", "Outer screen") : slotTitle(slide.layout,n);
  const shotTarget = (shotTargetRaw > slotCount ? slotCount : shotTargetRaw) as ShotSlot;
  const slotNos = (slotCount === 3 ? [1, 2, 3] : slotCount === 2 ? [1, 2] : [1]) as ShotSlot[];
  const splitFeatureLayout = slide.layout === "split-v" || slide.layout === "split-h";
  const shotOf = (n: ShotSlot): string | undefined =>
    slide[SHOT_FIELD[n]] as string | undefined;
  const shotName = (src?: string) =>
    project.screenshots.find((x) => x.dataUrl === src)?.name ?? "";
  const filledSlots = slotNos.filter((n) => !!shotOf(n)).length;
  // Düzen küçülünce (üçlüden ikiliye) fazla yuvadaki görsel VERİDE KALIR ama
  // panelden erişilemez olurdu — "temizleyemediğim bir şey var" hissi ve
  // düzen geri büyüyünce sürpriz içerik. O yuvaları soluk gösterip yalnız
  // temizleme düğmesi veriyoruz: veri kaybı yok, gizli veri de yok.
  const staleNos = ([1, 2, 3] as ShotSlot[]).filter((n) => n > slotCount && !!shotOf(n));
  // Boş yuvada motor bir alttaki DOLU yuvaya düşer (types.ts sözleşmesi).
  const fallbackFor = (n: ShotSlot): ShotSlot | null => {
    for (let k = n - 1; k >= 1; k--) if (shotOf(k as ShotSlot)) return k as ShotSlot;
    return null;
  };
  const layoutIds = Object.keys(LAYOUTS) as LayoutId[];
  const multiLayoutIds = layoutIds.filter((l) => shotSlotCount(l) > 1);


  return (
    <aside className="inspector scene-panel">
      <SlideStrip idx={idx < 0 ? 0 : idx} slide={slide} tag={theme.name} />
      <div className="insp-body">
            <Section id="d.layout" title={L("Yerleşim", "Layout")} hint={layoutLabel(slide.layout)}>
              <DriftBand slide={slide} fields={["layout"]} />
              <LayoutPicker value={slide.layout} format={projectFormat} onPick={layout=>up({layout})}/>
            </Section>
            {/* ========================= ARKA PLAN ========================= */}
            <Section id="s.bg" title={L("Arka plan", "Background")} hint={slide.background ? L("slayt", "slide") : L("tema", "theme")}>
              <DriftBand slide={slide} fields={["themeId", "background", "bgFx"]} />
              <div className="theme-row">
                <span className="theme-row-dot" style={{ background: theme.accent }} />
                <span className="theme-row-name">
                  <small>{L("Tema", "Theme")}</small>
                  <b>{theme.name}</b>
                </span>
                <button className="btn xs" onClick={() => { setLibraryTab("themes"); focusPanel("library"); }}>
                  {L("Değiştir", "Change")}
                </button>
                <button className="btn xs" title={L("Temayı tüm slaytlara uygula", "Apply theme to all slides")} onClick={applyThemeAll}>
                  <Icon name="copy" size={11} />
                </button>
              </div>

              {(theme.altBackgrounds || []).length > 0 && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>{L("Tema varyantları", "Theme variants")}</label>
                  <div className="chips">
                    <button
                      className={`chip ${!slide.background ? "on" : ""}`}
                      onClick={() => up({ background: undefined })}
                    >
                      {L("Varsayılan", "Default")}
                    </button>
                    {(theme.altBackgrounds || []).map((b, i) => (
                      <button
                        key={i}
                        className={`chip ${
                          JSON.stringify(slide.background) === JSON.stringify(b) ? "on" : ""
                        }`}
                        onClick={() => up({ background: structuredClone(b) })}
                      >
                        {L(`Varyant ${i + 1}`, `Variant ${i + 1}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <hr className="sep" />
              {/* Tam serbest gradient editörü + palet galerisi (WP-F).
                  structuredClone: override yokken `bg` TEMA nesnesidir. */}
              <GradientEditor
                value={bg}
                onChange={(b) => up({ background: structuredClone(b) })}
                onReset={slide.background ? () => up({ background: undefined }) : undefined}
              />

              {/* R8/W4 (B-3.2) — GÖRSEL ZEMİNİN RENK KATMANI
                  Bugüne kadar bu üç alan yalnız hazır zemin seçilirken
                  yazılıyordu, düzenlenemiyordu. `overlayBlend` fotoğraf
                  zeminde marka rengini gerçekten ısırtır (multiply) ya da
                  açar (screen); alan yoksa düz source-over. */}
              {bg.kind === "image" && (
                <>
                  <hr className="sep" />
                  <span className="sub-label">{L("Görsel zemin — renk katmanı", "Image background — color layer")}</span>
                  <div className="field">
                    <label>{L("Renk", "Color")}</label>
                    <Swatches
                      value={bg.overlayColor || "#000000"}
                      colors={["#000000", theme.accent, "#0512e8", "#f4520b", "#f2f1ec"]}
                      onChange={(c) =>
                        up({ background: { ...structuredClone(bg), overlayColor: c } })
                      }
                    />
                  </div>
                  <SliderRow
                    label={L("Opaklık", "Opacity")}
                    defaultValue={0}
                    value={Math.round((bg.overlayAlpha ?? 0) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) =>
                      up({ background: { ...structuredClone(bg), overlayAlpha: v / 100 } })
                    }
                    format={(v) => (v === 0 ? L("kapalı", "off") : `${v}%`)}
                  />
                  {/* R14 — PANO DİLİMİ: aynı görselin komşu dilimleri ardışık
                      karelere; 3 kare = 0/33/66 · en 34. */}
                  <span className="sub-label">{L("Pano dilimi", "Panorama slice")}</span>
                  <Toggle
                    checked={!!bg.crop}
                    onChange={(v) =>
                      up({
                        background: v
                          ? { ...structuredClone(bg), crop: { x: 0, w: 0.34 } }
                          : (() => {
                              const b = structuredClone(bg);
                              delete b.crop;
                              return b;
                            })(),
                      })
                    }
                    label={L("Görselin bir dilimini kullan", "Use a slice of the image")}
                  />
                  {bg.crop && (
                    <>
                      <SliderRow
                        label={L("Başlangıç", "Start")}
                        defaultValue={0}
                        value={Math.round(bg.crop.x * 100)}
                        min={0}
                        max={100}
                        onChange={(v) =>
                          up({ background: { ...structuredClone(bg), crop: { x: v / 100, w: bg.crop!.w } } })
                        }
                        format={(v) => L(`%${v}`, `${v}%`)}
                      />
                      <SliderRow
                        label={L("Dilim eni", "Slice width")}
                        defaultValue={34}
                        value={Math.round(bg.crop.w * 100)}
                        min={10}
                        max={100}
                        onChange={(v) =>
                          up({ background: { ...structuredClone(bg), crop: { x: bg.crop!.x, w: v / 100 } } })
                        }
                        format={(v) => L(`%${v}`, `${v}%`)}
                      />
                    </>
                  )}
                  <div className="field">
                    <label>{L("Harman", "Blend")}</label>
                    <select
                      value={bg.overlayBlend ?? ""}
                      onChange={(e) =>
                        up({
                          background: {
                            ...structuredClone(bg),
                            overlayBlend:
                              (e.target.value as GlobalCompositeOperation) || undefined,
                          },
                        })
                      }
                    >
                      {BLEND_LABELS.map((b) => (
                        <option key={b.value || "normal"} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {bg.overlayBlend && (
                    <p className="note">
                      <b>{L("Çarp", "Multiply")}</b>{L(" zemini renge boyar (koyultur), ", " tints the background with the color (darkens), ")}<b>{L("Ekran", "Screen")}</b>{L(" açar. Gölge/gren gibi bitiriciler bu katmanın ÜSTÜNDE kalır — sıra değişmez.", " lightens it. Finishers like shadow/grain stay ABOVE this layer — the order does not change.")}
                    </p>
                  )}
                </>
              )}

              {/* Zemin efektleri — arka plan TÜRÜNDEN bağımsız; cihaz ve
                  metin etkilenmez. slide.bgFx (tasarım alanı, dillere yayılır). */}
              <hr className="sep" />
              <span className="sub-label">{L("Efekt", "Effect")}</span>
              <SliderRow
                label={L("Bulanıklık", "Blur")}
                defaultValue={0}
                value={fx.blur ?? 0}
                min={0}
                max={160}
                onChange={(v) => upFx({ blur: v || undefined })}
                format={(v) => `${v}px`}
              />
              <SliderRow
                label={L("Karart", "Dim")}
                defaultValue={0}
                value={Math.round((fx.dim ?? 0) * 100)}
                min={0}
                max={80}
                onChange={(v) => upFx({ dim: v ? v / 100 : undefined })}
                format={(v) => `${v}%`}
              />
              <SliderRow
                label={L("Doygunluk", "Saturation")}
                defaultValue={100}
                value={Math.round((fx.sat ?? 1) * 100)}
                min={0}
                max={300}
                onChange={(v) => upFx({ sat: v === 100 ? undefined : v / 100 })}
                format={(v) => `${v}%`}
              />
              {fxOn && (
                <button className="btn sm wide" onClick={() => up({ bgFx: undefined })}>
                  <Icon name="reset" size={11} />
                  {L("Efekti sıfırla", "Reset effect")}
                </button>
              )}

              <Advanced id="bgassets" label={L("Gelişmiş — hazır zeminler", "Advanced — preset backgrounds")}>
                {assets.bg.length > 0 && (
                  <div className="field">
                    <label>{L("Hazır zeminler", "Preset backgrounds")}</label>
                    <div className="chips scroll">
                      {assets.bg.map((f) => (
                        <button
                          key={f}
                          className={`chip ${
                            bg.kind === "image" && bg.src === `/assets/bg/${f}` ? "on" : ""
                          }`}
                          onClick={() =>
                            up({
                              background: {
                                kind: "image",
                                src: `/assets/bg/${f}`,
                                overlayColor: "#000",
                                overlayAlpha: 0.2,
                              },
                            })
                          }
                        >
                          {f.replace(/\.(jpg|png)$/i, "")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {assets.textures.length > 0 && (
                  <div className="field">
                    <label>{L("Dokular", "Textures")}</label>
                    <div className="chips scroll">
                      {assets.textures.map((f) => (
                        <button
                          key={f}
                          className={`chip ${
                            bg.kind === "image" && bg.src === `/assets/textures/${f}` ? "on" : ""
                          }`}
                          onClick={() =>
                            up({
                              background: {
                                kind: "image",
                                src: `/assets/textures/${f}`,
                                overlayColor: "#000",
                                overlayAlpha: 0.12,
                              },
                            })
                          }
                        >
                          {f.replace(/\.(jpg|png)$/i, "")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {assets.generated.length > 0 && (
                  <div className="field">
                    <label>{L("Wiro üretimleri", "Wiro generations")}</label>
                    <div className="chips scroll">
                      {assets.generated.map((f) => (
                        <button
                          key={f}
                          className={`chip ${
                            bg.kind === "image" && bg.src === `/assets/generated/${f}` ? "on" : ""
                          }`}
                          onClick={() =>
                            up({
                              background: {
                                kind: "image",
                                src: `/assets/generated/${f}`,
                                overlayColor: "#000",
                                overlayAlpha: 0.25,
                              },
                            })
                          }
                        >
                          {f.replace(/\.(jpg|png)$/i, "")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="field">
                  <label>
                    <Icon name="wand" size={11} />
                    {L("Wiro ile üret (gpt-image-2)", "Generate with Wiro (gpt-image-2)")}
                  </label>
                  <div className="row">
                    <input
                      type="text"
                      value={wiroPrompt}
                      placeholder="soft emerald dawn sky, minimal"
                      onChange={(e) => setWiroPrompt(e.target.value)}
                    />
                    <button className="btn sm fix" onClick={genBackground}>
                      {L("Üret", "Generate")}
                    </button>
                  </div>
                  {wiroErr && <p className="inline-err">{wiroErr}</p>}
                </div>
              </Advanced>
            </Section>

            {/* ============================ IŞIK ============================ */}
            <Section
              id="s.isik"
              defaultOpen={false}
              title={L("Işık", "Light")}
              hint={dev3 ? RIGS.find((r) => r.id === rigOf(dev3))?.label : "2D"}
            >
              <DriftBand slide={slide} fields={["device"]} />
              {dev3 ? (
                <>
                  <div className="seg-compact">
                    <Segmented
                      value={rigOf(dev3)}
                      options={RIGS.map((r) => ({ value: r.id, label: r.label }))}
                      // env alanı da yazılır: eski kayıtlarla ve 2D/3D geçişiyle uyum.
                      onChange={(id) =>
                        upDev({
                          ...dev3,
                          lightRig: id,
                          env: id === "night" ? "night" : id === "softbox" ? "soft" : "studio",
                        })
                      }
                    />
                  </div>
                  <SliderRow
                    label={L("Şiddet", "Intensity")}
                    defaultValue={100}
                    value={Math.round((dev3.lightIntensity ?? 1) * 100)}
                    min={50}
                    max={200}
                    onChange={(v) => upDev({ ...dev3, lightIntensity: v / 100 })}
                    format={(v) => L(`%${v}`, `${v}%`)}
                  />
                  <Toggle
                    checked={dev3.shadow !== false}
                    onChange={(v) => upDev({ ...dev3, shadow: v })}
                    label={L("Zemin gölgesi", "Ground shadow")}
                  />
                  <Toggle
                    checked={dev3.reflection === true}
                    onChange={(v) => upDev({ ...dev3, reflection: v || undefined })}
                    label={L("Zemin yansıması", "Ground reflection")}
                  />
                  {/* R8/W1: cihaz havaya kalkar — contact gölge ayrışıp yumuşar,
                      yansıma opaklığı düşer (Rotato "float" görünümü). */}
                  <SliderRow
                    label={L("Süzülme", "Float")}
                    defaultValue={0}
                    value={Math.round((dev3.float ?? 0) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) => upDev({ ...dev3, float: v ? v / 100 : undefined })}
                    format={(v) => (v === 0 ? L("zeminde", "grounded") : L(`%${v}`, `${v}%`))}
                  />
                  <Advanced id="isik3d">
                    <SliderRow
                      label={L("Işık açısı", "Light angle")}
                      defaultValue={0}
                      value={Math.round(dev3.lightAngle ?? 0)}
                      min={-90}
                      max={90}
                      onChange={(v) => upDev({ ...dev3, lightAngle: v })}
                      format={(v) => `${v}°`}
                    />
                    <SliderRow
                      label={L("Sıcaklık", "Warmth")}
                      defaultValue={0}
                      value={Math.round((dev3.lightWarmth ?? 0) * 100)}
                      min={-100}
                      max={100}
                      onChange={(v) => upDev({ ...dev3, lightWarmth: v / 100 })}
                      format={(v) => (v === 0 ? L("nötr", "neutral") : v < 0 ? L(`soğuk ${-v}`, `cool ${-v}`) : L(`sıcak ${v}`, `warm ${v}`))}
                    />
                    {/* R9: eskiden yalnız night riginde görünüyor VE varsayılan
                        açıktı → ekranda kapatılamayan hale. Artık her rigde
                        görünür ve varsayılan KAPALI. */}
                    <Toggle
                      checked={dev3.bloom === true}
                      onChange={(v) => upDev({ ...dev3, bloom: v || undefined })}
                      label={L("Parlama (bloom)", "Glow (bloom)")}
                    />
                    {/* R8/W1: bloom kitine ikinci hedef — yalnız YATAY yayılan
                        mavi çizgi. night/rim riglerinde varsayılan açık. */}
                    <Toggle
                      checked={dev3.streak === true}
                      onChange={(v) => upDev({ ...dev3, streak: v || undefined })}
                      label={L("Anamorfik parıltı", "Anamorphic streak")}
                    />
                    {/* R9: ekran camındaki diyagonal yansıma şeridi. Riglere
                        gömülüydü, kapatılamıyordu → artık slider, vars. 0. */}
                    <SliderRow
                      label={L("Cam parlaması", "Glass glare")}
                      defaultValue={0}
                      value={Math.round((dev3.glare ?? 0) * 100)}
                      min={0}
                      max={100}
                      onChange={(v) => upDev({ ...dev3, glare: v ? v / 100 : undefined })}
                      format={(v) => (v === 0 ? L("kapalı", "off") : L(`%${v}`, `${v}%`))}
                    />
                    {(dev3.lightIntensity !== undefined ||
                      dev3.lightAngle !== undefined ||
                      dev3.lightWarmth !== undefined) && (
                      <button
                        className="btn sm wide"
                        onClick={() =>
                          upDev({
                            ...dev3,
                            lightIntensity: undefined,
                            lightAngle: undefined,
                            lightWarmth: undefined,
                          })
                        }
                      >
                        <Icon name="reset" size={11} />
                        {L("Işık ayarlarını sıfırla", "Reset light settings")}
                      </button>
                    )}
                  </Advanced>
                </>
              ) : (
                dev2 && (
                  <>
                    <Toggle
                      checked={dev2.shadow !== false}
                      onChange={(v) => upDev({ ...dev2, shadow: v })}
                      label={L("Gölge", "Shadow")}
                    />
                    {/* R8/W4 (B-5.1/5.2/5.3): 2D gölge editörü. Yalnız gölge
                        AÇIKKEN anlamlı. */}
                    {dev2.shadow !== false && <Shadow2DEditor style={dev2} accent={theme.accent} onChange={sh=>upDev({...dev2,shadow:sh})}/>}
                    <Toggle
                      checked={dev2.reflection === true}
                      onChange={(v) => upDev({ ...dev2, reflection: v || undefined })}
                      label={L("Zemin yansıması", "Ground reflection")}
                    />
                    <p className="note" style={{ marginTop: 8 }}>
                      {L("Işık rigleri (stüdyo, softbox, rim, gece, gün), şiddet/açı/sıcaklık ve bloom yalnızca ", "Light rigs (studio, softbox, rim, night, day), intensity/angle/warmth and bloom only work in ")}<b>{L("3D Sahne", "3D Scene")}</b>{L(" modunda çalışır — Cihaz bölümünden 3D'ye geçebilirsin.", " mode — switch to 3D from the Device section.")}
                    </p>
                  </>
                )
              )}
              {/* ===================== IŞIK HALKASI (R9) =====================
                  Eskiden yalnız `theme.glowRing` vardı: koyu temalarda cihazın
                  arkasında ZORLA yanıyordu ve kapatacak bir kontrol yoktu.
                  Artık slaytın alanı, VARSAYILAN KAPALI, dillere yayılıyor. */}
              <hr className="sep" />
              <span className="sub-label">{L("Işık halkası", "Light ring")}</span>
              <Toggle
                label={L("Cihazın arkasında halka", "Ring behind the device")}
                checked={!!slide.glow?.on}
                onChange={(on) =>
                  up({
                    glow: on
                      ? {
                          on: true,
                          color: slide.glow?.color ?? theme.glowRing?.color ?? "#2f6bff",
                          alpha: slide.glow?.alpha ?? theme.glowRing?.alpha ?? 0.3,
                        }
                      : undefined,
                  })
                }
              />
              {slide.glow?.on && (
                <>
                  <div className="field">
                    <label>{L("Halka rengi", "Ring color")}</label>
                    <Swatches
                      value={slide.glow.color ?? theme.glowRing?.color ?? "#2f6bff"}
                      colors={GLOW_COLORS}
                      onChange={(c) => up({ glow: { ...slide.glow!, color: c } })}
                    />
                  </div>
                  <SliderRow
                    label={L("Halka şiddeti", "Ring intensity")}
                    defaultValue={Math.round((theme.glowRing?.alpha ?? 0.3) * 100)}
                    value={Math.round((slide.glow.alpha ?? 0.3) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) => up({ glow: { ...slide.glow!, alpha: v / 100 } })}
                    format={(v) => `${v}%`}
                  />
                </>
              )}
            </Section>

            {/* =========================== KAMERA =========================== */}
            <Section
              id="s.kamera"
              title={L("Kamera", "Camera")}
              hint={dev3 ? CAMERAS.find((c) => c.id === dev3.camera)?.label : "2D"}
            >
              {dev3 ? (
                <>
                  {/* R8/W3: `<select>` → çip ızgarası. Tek sebebi C11: bir
                      `<option>` üstüne gelmek hover olayı üretmez, yani kamera
                      preset'i "dene-gör" olamazdı. Çip dili Kadraj (yerleşim)
                      alanıyla zaten aynı. */}
                  <div className="field">
                    <label>{L("Kadraj", "Framing")}</label>
                    <CameraPicker cameras={CAMERAS} value={dev3.camera} onPick={camera=>upDev({...dev3,camera,orbit:undefined})}/>
                  </div>
                  {orbit && (
                    <>
                      <SliderRow
                        label={L("Açı (yatay)", "Angle (horizontal)")}
                        value={Math.round((orbit.theta * 180) / Math.PI)}
                        min={-180}
                        max={180}
                        onChange={(v) =>
                          upDev({ ...dev3, orbit: { ...orbit, theta: (v * Math.PI) / 180 } })
                        }
                        format={(v) => `${v}°`}
                      />
                      <SliderRow
                        label={L("Açı (dikey)", "Angle (vertical)")}
                        value={Math.round((orbit.phi * 180) / Math.PI)}
                        min={10}
                        max={110}
                        onChange={(v) =>
                          upDev({
                            ...dev3,
                            orbit: { ...orbit, phi: clamp((v * Math.PI) / 180, 0.15, 2) },
                          })
                        }
                        format={(v) => `${v}°`}
                      />
                      <SliderRow
                        label={L("Mesafe", "Distance")}
                        value={Math.round(orbit.distance * 10) / 10}
                        min={3.5}
                        max={24}
                        step={0.1}
                        onChange={(v) => upDev({ ...dev3, orbit: { ...orbit, distance: v } })}
                      />
                    </>
                  )}
                  {/* R8/W1: premultiplied CoC-gather bokeh (engine/scene3dCore).
                      focus === undefined → OTO: en öndeki cihaz odakta kalır
                      (stack3/pair/fan3 için doğru varsayılan). Sayı yazınca elle. */}
                  <Advanced id="dof" label={L("Gelişmiş — alan derinliği", "Advanced — depth of field")}>
                    <Toggle
                      label={L("Oto odak", "Auto focus")}
                      checked={dev3.dof?.focus === undefined}
                      onChange={(on) =>
                        upDev({
                          ...dev3,
                          dof: on
                            ? { ...(dev3.dof || {}), focus: undefined }
                            : { ...(dev3.dof || {}), focus: 0.5 },
                        })
                      }
                    />
                    {dev3.dof?.focus !== undefined && (
                      <SliderRow
                        label={L("Odak", "Focus")}
                        defaultValue={50}
                        value={Math.round((dev3.dof?.focus ?? 0.5) * 100)}
                        min={0}
                        max={100}
                        onChange={(v) =>
                          upDev({ ...dev3, dof: { ...(dev3.dof || {}), focus: v / 100 } })
                        }
                        format={(v) => (v < 34 ? L(`ön ${v}`, `front ${v}`) : v > 66 ? L(`arka ${v}`, `back ${v}`) : L(`orta ${v}`, `mid ${v}`))}
                      />
                    )}
                    <SliderRow
                      label={L("Miktar", "Amount")}
                      defaultValue={0}
                      value={Math.round((dev3.dof?.amount ?? 0) * 100)}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        upDev({ ...dev3, dof: { ...(dev3.dof || {}), amount: v / 100 } })
                      }
                      format={(v) => (v === 0 ? L("kapalı", "off") : L(`%${v}`, `${v}%`))}
                    />
                    {dev3.dof && (
                      <button
                        className="btn sm wide"
                        onClick={() => upDev({ ...dev3, dof: undefined })}
                      >
                        <Icon name="reset" size={11} />
                        {L("Alan derinliğini sıfırla", "Reset depth of field")}
                      </button>
                    )}
                    <p className="note">
                      {L("Miktar 0 iken pass hiç çalışmaz. ", "When Amount is 0 the pass does not run at all. ")}<b>{L("Üçlü derinlik", "Trio depth")}</b>{L(" kadrajında öndeki cihaz keskin, arkadakiler erir.", " framing keeps the front device sharp while the ones behind blur.")}
                    </p>
                  </Advanced>

                  <p className="note">{L("Model, kasa rengi ve cihaz başına dönüş: Cihaz paneli.", "Model, body color and per-device rotation: Device panel.")}</p>
                </>
              ) : (
                <p className="note">
                  {L("Kamera, orbit ve model seçimleri ", "Camera, orbit and model options unlock in ")}<b>{L("3D Sahne", "3D Scene")}</b>{L(" modunda açılır. 2D slaytta kadraj Cihaz bölümündeki düzen listesinden gelir.", " mode. On a 2D slide the framing comes from the layout list in the Device section.")}
                </p>
              )}
            </Section>

            {/* =========================== GRADE =========================== */}
            <GradeSection value={slide.grade} slide={slide} onChange={(g) => up({ grade: g })} />

            {/* ============================ EFEKT ============================
                R8/W4 (B-4.1/4.2): gren/vignette/doku artık SLAYDIN alanı
                (`slide.overlay`), tema nesnesinin yerinde mutasyonu değil.
                Dokunulmamış alan temadan miras kalır; ⌘Z ve proje kaydı
                diğer tüm tasarım alanlarıyla aynı yoldan geçer. */}
            <Section
              id="s.fx"
              title={L("Efekt", "Effect")}
              hint={ovSlide ? L("slayt", "slide") : L("tema", "theme")}
              defaultOpen={false}
            >
              <DriftBand slide={slide} fields={["overlay", "ornament"]} />
              <SliderRow
                label={L("Film greni", "Film grain")}
                defaultValue={Math.round((theme.overlay?.grain ?? 0) * 100)}
                value={Math.round((ov.grain ?? 0) * 100)}
                min={0}
                max={40}
                onChange={(v) => setOverlay({ grain: v / 100 })}
                format={(v) => `${v}%`}
              />
              <SliderRow
                label="Vignette"
                defaultValue={Math.round((theme.overlay?.vignette ?? 0) * 100)}
                value={Math.round((ov.vignette ?? 0) * 100)}
                min={0}
                max={70}
                onChange={(v) => setOverlay({ vignette: v / 100 })}
                format={(v) => `${v}%`}
              />
              {/* B-3.3: ThemeOverlay.texture.blend tipte vardı, hiçbir kontrol
                  bağlı değildi. Doku yalnız temada tanımlıysa görünür. */}
              {ov.texture && (
                <>
                  <SliderRow
                    label={L("Doku", "Texture")}
                    defaultValue={Math.round((theme.overlay?.texture?.alpha ?? 0) * 100)}
                    value={Math.round((ov.texture.alpha ?? 0) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) =>
                      setOverlay({ texture: { ...ov.texture!, alpha: v / 100 } })
                    }
                    format={(v) => (v === 0 ? L("kapalı", "off") : `${v}%`)}
                  />
                  <div className="field">
                    <label>{L("Doku harmanı", "Texture blend")}</label>
                    <select
                      value={ov.texture.blend}
                      onChange={(e) =>
                        setOverlay({
                          texture: {
                            ...ov.texture!,
                            blend: e.target.value as GlobalCompositeOperation,
                          },
                        })
                      }
                    >
                      {BLEND_LABELS.filter((b) => b.value !== "").map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {ovSlide ? (
                <>
                  <button className="btn sm wide" onClick={() => up({ overlay: undefined })}>
                    <Icon name="reset" size={11} />
                    {L("Temanın bitiricisine dön", "Revert to theme finish")}
                  </button>
                  <p className="note">
                    {L("Bu slayt ", "This slide overrides the finish of the ")}<b>&quot;{theme.name}&quot;</b>{L(" temasının bitiricisini eziyor — aynı temayı kullanan diğer slaytlar etkilenmez. Değişiklik projeye kaydedilir, ⌘Z ile geri alınır.", " theme — other slides using the same theme are not affected. The change is saved to the project and can be undone with ⌘Z.")}
                  </p>
                </>
              ) : (
                <p className="note">
                  {L("Şu an ", "Currently rendering the values of the ")}<b>&quot;{theme.name}&quot;</b>{L(" temasının değerleri basılıyor. Slider'a dokunmak yalnız BU slayt için override yazar; etiketi çift tıklamak temadan mirasa geri döner.", " theme. Touching a slider writes an override for THIS slide only; double-clicking its label returns to the theme value.")}
                </p>
              )}
              <hr className="sep" />
              <Toggle
                checked={!!slide.ornament}
                onChange={(v) =>
                  up({ ornament: v ? { kind: "laurel", text: slide.badge || L("Ödül", "Award") } : undefined })
                }
                label={L("Defne çelengi", "Laurel wreath")}
              />
              {slide.ornament && (
                <div className="field" style={{ marginTop: 6 }}>
                  <label>{L("Çelenk metni", "Wreath text")}</label>
                  <input
                    type="text"
                    value={slide.ornament.text}
                    onChange={(e) => up({ ornament: { kind: "laurel", text: e.target.value } })}
                  />
                </div>
              )}
            </Section>
      </div>
    </aside>
  );
}

/* ================================================================== *
   2D CİHAZ GÖLGESİ — editör (R8/W4 · B-5.1/5.2/5.3)

   `DeviceStyle2D.shadow` üç değer taşır:
     false  → gölge yok
     true   → hazır gölge (motorun literal'leri; eski projelerin hali)
     nesne  → elle ayar; verilmeyen her alan yine literal'e düşer
   Bu yüzden "hepsini varsayılana çek" = alanları TEK TEK silmek, ve
   nesne boşalınca `true`'ya dönmek. Böylece kayıt da temiz kalır.

   Varsayılan tablosu YANSIMAYA göre değişir (yansıma varken gölge daha
   hafif): editör hangi kolondaysa onun sayılarını gösterir.
 * ================================================================== */

function Shadow2DEditor({
  style,
  accent,
  onChange,
}: {
  style: DeviceStyle2D;
  accent: string;
  onChange: (sh: DeviceStyle2D["shadow"]) => void;
}) {
  const soft = style.reflection === true;
  const D = shadowDefaults(soft);
  const cfg = shadowCfgOf(style.shadow) ?? {};
  const custom = Object.keys(cfg).length > 0;

  /** Varsayılana eşitlenen alanı siler; nesne boşalırsa `true`'ya döner. */
  const patch = (p: Partial<Device2DShadow>) => {
    const next: Device2DShadow = { ...cfg, ...p };
    for (const k of Object.keys(next) as (keyof Device2DShadow)[]) {
      const v = next[k];
      const d = D[k];
      const eq =
        typeof v === "string" && typeof d === "string"
          ? v.toLowerCase() === d.toLowerCase()
          : v === d;
      if (v === undefined || eq) delete next[k];
    }
    onChange(Object.keys(next).length ? next : true);
  };

  return (
    <Advanced id="golge2d" label={L(`Gelişmiş — gölge${custom ? " (elle)" : ""}`, `Advanced — shadow${custom ? " (manual)" : ""}`)}>
      <SliderRow
        label={L("X ofset", "X offset")}
        defaultValue={D.dx}
        value={Math.round(cfg.dx ?? D.dx)}
        min={-240}
        max={240}
        onChange={(v) => patch({ dx: v })}
        format={(v) => `${v}px`}
      />
      <SliderRow
        label={L("Y ofset", "Y offset")}
        defaultValue={D.dy}
        value={Math.round(cfg.dy ?? D.dy)}
        min={-160}
        max={320}
        onChange={(v) => patch({ dy: v })}
        format={(v) => `${v}px`}
      />
      <SliderRow
        label={L("Bulanıklık", "Blur")}
        defaultValue={D.blur}
        value={Math.round(cfg.blur ?? D.blur)}
        min={0}
        max={320}
        onChange={(v) => patch({ blur: v })}
        format={(v) => `${v}px`}
      />
      <SliderRow
        label={L("Opaklık", "Opacity")}
        defaultValue={Math.round(D.opacity * 100)}
        value={Math.round((cfg.opacity ?? D.opacity) * 100)}
        min={0}
        max={100}
        onChange={(v) => patch({ opacity: v / 100 })}
        format={(v) => L(`%${v}`, `${v}%`)}
      />
      <div className="field">
        <label>{L("Gölge rengi", "Shadow color")}</label>
        <Swatches
          value={cfg.color ?? D.color}
          colors={[D.color, accent, "#0512e8", "#f4520b", "#1b2a4a"]}
          onChange={(c) => patch({ color: c })}
        />
      </div>
      {custom && (
        <button className="btn sm wide" onClick={() => onChange(true)}>
          <Icon name="reset" size={11} />
          {L("Hazır gölgeye dön", "Revert to preset shadow")}
        </button>
      )}
      <p className="note">
        {L("Ölçüler ", "Values are based on ")}<b>1320px</b>{L(" tabanındadır, renderer ölçekler — %24 önizlemede de 1320px export'ta da gölge aynı oranda durur. Renk paletindeki ikinci çip temanın ", ", the renderer scales them — the shadow keeps the same proportion in the 24% preview and in the 1320px export. The second chip in the palette is the theme's ")}<b>{L("vurgu rengi", "accent color")}</b>{L(": tek tıkla renkli gölge.", ": a colored shadow in one click.")}
      </p>
    </Advanced>
  );
}

/* ================================================================== *
   GRADE — kompozit renk bölümü (R8/W1)

   Grade slaydın SON adımıdır: zemin, cihaz ve metin tek ton eğrisinde
   buluşur (engine/grade.ts). Varsayılan KAPALI; "Neutral+" karaktersiz
   birleştiricidir, diğerleri karakter katar.

   Çipler preset'in GERÇEK gölge→parlak rampasını gösterir: renkler
   gradeRamp() ile shader'ın tonal adımlarından geçirilmiş nötr grilerdir.
 * ================================================================== */

const GRADE_CHIP: React.CSSProperties = {
  position: "relative",
  padding: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: 0,
  minWidth: 64,
};

const GRADE_STRIP: React.CSSProperties = {
  display: "block",
  height: 14,
  width: "100%",
};

function GradeSection({
  value,
  slide,
  onChange,
}: {
  value: GradeSpec | undefined;
  slide: Slide;
  onChange: (g: GradeSpec | undefined) => void;
}) {
  const g = value;
  const r = resolveGrade(g);
  const on = !!g;
  const activeId = g?.preset;
  // Ölçüm/etiket: preset adı ya da "elle".
  const hint = on ? (activeId ? GRADE_PRESETS[activeId]?.label || activeId : L("elle", "manual")) : L("yok", "none");
  // İnce ayar yazımı: preset varsa üstüne biner, yoksa kimlik üstüne.
  const patch = (p: Partial<GradeSpec>) => onChange({ ...(g || {}), ...p });

  return (
    <Section id="s.grade" title="Grade" hint={hint} defaultOpen={false}>
      <DriftBand slide={slide} fields={["grade"]} />
      <div className="chips">
        <button
          className={`chip ${!on ? "on" : ""}`}
          style={GRADE_CHIP}
          onClick={() => onChange(undefined)}
          title={L("Grade kapalı — kompozit ham çıkar", "Grade off — composite is output raw")}
        >
          <span
            style={{
              ...GRADE_STRIP,
              background:
                "repeating-linear-gradient(45deg, var(--fill-1) 0 4px, transparent 4px 8px)",
            }}
          />
          <span style={{ padding: "3px 8px 4px" }}>{L("Yok", "None")}</span>
        </button>
        {GRADE_PRESET_IDS.map((id) => {
          const ramp = gradeRamp({ preset: id }, 5);
          return (
            <button
              key={id}
              className={`chip ${activeId === id ? "on" : ""}`}
              style={GRADE_CHIP}
              // Preset değişince ELLE ayarlar korunmaz: preset'in kendi
              // karakteri gelsin, üstünde eski bir aberasyon kalmasın.
              onClick={() => onChange({ preset: id })}
              title={GRADE_PRESETS[id]?.label || id}
            >
              <span
                style={{
                  ...GRADE_STRIP,
                  background: `linear-gradient(90deg, ${ramp.join(", ")})`,
                }}
              />
              <span style={{ padding: "3px 8px 4px" }}>
                {GRADE_PRESETS[id]?.label || id}
              </span>
            </button>
          );
        })}
      </div>

      {on ? (
        <>
          <p className="note" style={{ marginTop: 8 }}>
            {L("Grade EN SON uygulanır — cihaz ve zemin aynı eğriden geçer. Gren ve vignette grade'in üstünde kalır (film sırası). Export birebir aynı.", "Grade is applied LAST — the device and background go through the same curve. Grain and vignette stay on top of the grade (film order). Export is identical.")}
          </p>
          <Advanced id="grade" label={L("Gelişmiş — ince ayar", "Advanced — fine tuning")}>
            <SliderRow
              label={L("Doygunluk", "Saturation")}
              defaultValue={100}
              value={Math.round(r.sat * 100)}
              min={50}
              max={150}
              onChange={(v) => patch({ sat: v / 100 })}
              format={(v) => L(`%${v}`, `${v}%`)}
            />
            <SliderRow
              label={L("Aberasyon", "Aberration")}
              defaultValue={0}
              value={Math.round(r.aberration * 100)}
              min={0}
              max={100}
              onChange={(v) => patch({ aberration: v / 100 })}
              format={(v) => (v === 0 ? L("yok", "none") : L(`%${v}`, `${v}%`))}
            />
            <SliderRow
              label="Halation"
              defaultValue={0}
              value={Math.round(r.halation * 100)}
              min={0}
              max={100}
              onChange={(v) => patch({ halation: v / 100 })}
              format={(v) => (v === 0 ? L("yok", "none") : L(`%${v}`, `${v}%`))}
            />
            <SliderRow
              label={L("Split miktarı", "Split amount")}
              defaultValue={0}
              value={Math.round(r.splitAmount * 100)}
              min={0}
              max={100}
              onChange={(v) => patch({ splitAmount: v / 100 })}
              format={(v) => (v === 0 ? L("yok", "none") : L(`%${v}`, `${v}%`))}
            />
            <div className="field">
              <label>{L("Gölge tonu", "Shadow tone")}</label>
              <Swatches
                value={rgbHex(r.splitShadow)}
                colors={SPLIT_SHADOW_COLORS}
                onChange={(c) => patch({ splitShadow: c })}
              />
            </div>
            <div className="field">
              <label>{L("Parlak tonu", "Highlight tone")}</label>
              <Swatches
                value={rgbHex(r.splitHighlight)}
                colors={SPLIT_HIGH_COLORS}
                onChange={(c) => patch({ splitHighlight: c })}
              />
            </div>
            <button
              className="btn sm wide"
              onClick={() => onChange(activeId ? { preset: activeId } : undefined)}
            >
              <Icon name="reset" size={11} />
              {activeId ? L("Preset değerlerine dön", "Revert to preset values") : L("Grade'i kapat", "Turn grade off")}
            </button>
          </Advanced>
        </>
      ) : (
        <p className="note" style={{ marginTop: 8 }}>
          {L("Kapalı. ", "Off. ")}<b>Neutral+</b>{L(" karakter katmaz; yalnız 3D cihazın ACES eğrisiyle 2D zeminin eğrisini tek çatıda buluşturur — \"yapıştırılmış\" hissi kalkar.", " adds no character; it only brings the 3D device's ACES curve and the 2D background's curve together — the \"pasted on\" look disappears.")}
        </p>
      )}
    </Section>
  );
}

/** 0..1 RGB üçlüsü → "#rrggbb" (input[type=color] ancak bunu kabul eder). */
function rgbHex(v: [number, number, number]): string {
  return (
    "#" +
    v
      .map((x) =>
        Math.round(Math.min(1, Math.max(0, x)) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function toHex(c: string): string {
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  if (/^#([0-9a-f]{3})$/i.test(c))
    return "#" + c.slice(1).split("").map((ch) => ch + ch).join("");
  return "#ffffff";
}

/* ================================================================== *
   Tema galerisi — gerçek render önizleme kartları (R7-W1)
 * ================================================================== */

const THEME_CATEGORIES = [
  { id: "all", label: L("Tümü", "All") },
  { id: "cinematic", label: L("Sinematik", "Cinematic") },
  { id: "collection", label: L("Yeni koleksiyon", "New collection") },
  { id: "minimal", label: "Minimal" },
  { id: "material", label: L("Malzeme / 3D", "Material / 3D") },
  { id: "ipad", label: "iPad" },
  { id: "other", label: L("Diğer", "Other") },
] as const;
type ThemeCategoryId = (typeof THEME_CATEGORIES)[number]["id"];

const THEME_CATEGORY_IDS: Record<Exclude<ThemeCategoryId, "all" | "ipad" | "other"> | "editorial", Set<string>> = {
  cinematic: new Set([
    "obsidian", "aurora-mesh", "neon-3d", "glass-aurora", "ink-neon",
    "mesh-film", "liquid-chrome", "warm-film", "panorama-sweep", "sunset-dune",
    "aurora-cam", "gece-altin", "midnight-graphite",
  ]),
  collection: new Set(["solstice", "tidal", "bloom", "orbit", "play"]),
  editorial: new Set([
    "editorial", "riso", "brut-mono", "paper-editorial", "duotone-press", "mono-red",
    "editorial-colour", "brut-paper", "note-marker", "mono-numerals", "diptik", "isvicre",
    "warm-editorial",
  ]),
  minimal: new Set(["clean-light", "nordic-frost", "bento-grid", "sage-calm", "mono-red", "mono-numerals"]),
  material: new Set([
    "bold-block", "playful-3d", "granular", "clay-soft", "clay-toy", "terracotta",
    "sivi-cam", "buz-cam", "klein-blur", "glacier-studio",
    "midnight-graphite", "warm-editorial",
  ]),
};

for (const [category, ids] of Object.entries(PRIVATE_THEME_CATEGORIES)) ids.forEach(id => THEME_CATEGORY_IDS[category as keyof typeof THEME_CATEGORY_IDS]?.add(id));

function hasThemeCategory(themeId: string, category: ThemeCategoryId): boolean {
  if (category === "all") return true;
  if (category === "ipad") return themeId.startsWith("ipad-");
  if (category === "other") {
    return (
      !themeId.startsWith("ipad-") &&
      !Object.values(THEME_CATEGORY_IDS).some((ids) => ids.has(themeId))
    );
  }
  return THEME_CATEGORY_IDS[category].has(themeId);
}

function themeCategoryLabels(themeId: string): string[] {
  return THEME_CATEGORIES.filter((c) => c.id !== "all" && hasThemeCategory(themeId, c.id)).map(
    (c) => c.label
  );
}

export function ThemeCards({
  sample,
  value,
  format,
  onPick,
}: {
  sample?: Slide;
  value: string;
  format: Format;
  onPick: (id: string) => void;
}) {
  const [category, setCategory] = useState<ThemeCategoryId>("all");
  const [query, setQuery] = useState("");
  const tabletFormat = isTabletKind(kindOfFormat(format));
  const aspect = thumbAspectOf(format);
  // renderRev köprüsü: tema nesnesi yerinde düzenlenince (overlay şiddeti vb.)
  // kareler düşsün. Render gövdesinde çağrılır ki ÇOCUK efektlerinden ÖNCE
  // çalışsın — aksi halde kartlar bayat kareyi yeniden okurdu.
  const rev = useRenderRev();
  syncThumbRev(rev);
  const eligible = useMemo(
    () => THEMES.filter((t) => (tabletFormat || !t.id.startsWith("ipad-")) && (format === "iphone" || tabletFormat && BRAND_COLLECTIONS.some(c=>c.id===t.id && c.ipadTemplateId) || !BRAND_COLLECTIONS.some(c=>c.id===t.id))),
    [tabletFormat, format]
  );
  const categoryCounts = useMemo(
    () => new Map(THEME_CATEGORIES.map((c) => [c.id, c.id === "all" ? eligible.length : eligible.filter((t) => hasThemeCategory(t.id, c.id)).length])),
    [eligible]
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return eligible.filter((t) => {
      if (!hasThemeCategory(t.id, category)) return false;
      if (!needle) return true;
      const groups = themeCategoryLabels(t.id).join(" ");
      const mode = t.device.mode.toUpperCase();
      return `${t.name} ${t.id} ${groups} ${mode} ${formatTag(format)}`
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .includes(needle);
    });
  }, [eligible, category, query, format]);
  return (
    <>
      <style>{THUMB_CSS}</style>
      <div className="theme-browser">
        <label className="gallery-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L("Tema ara…", "Search themes…")}
            aria-label={L("Tema ara", "Search themes")}
          />
        </label>
        <p className="gallery-format">
          <span>{L("Proje formatı", "Project format")}</span>
          <b>{formatTag(format)}</b>
          <small>{visible.length} {L("tema", "themes")}</small>
        </p>
        <div className="theme-categories" role="tablist" aria-label={L("Tema kategorileri", "Theme categories")}>
          {THEME_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={`chip k ${category === c.id ? "on" : ""}`}
              disabled={c.id !== "all" && categoryCounts.get(c.id) === 0}
              onClick={() => setCategory(c.id)}
            >
              {c.label}<small className="gallery-chip-count">{categoryCounts.get(c.id) ?? 0}</small>
            </button>
          ))}
        </div>
      </div>
      <div className={`vt-cards theme-cards ${format === "ipad-landscape" ? "c1" : "c2"}`}>
        {visible.map((t) => (
          <ThumbCard
            key={t.id}
            kind="theme"
            id={t.id}
            name={t.name}
            format={format}
            aspect={aspect}
            badges={[
              ...themeCategoryLabels(t.id).slice(0, 2),
              sample && isSplitScreen(sample) ? L("Kırpma", "Crop") : t.device.mode === "3d" ? "3D" : "2D",
              formatTag(format),
            ]}
            row={format === "ipad-landscape"}
            sample={sample}
            rev={rev}
            on={t.id === value}
            live
            onClick={() => onPick(t.id)}
          />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="note">
          {category === "ipad" && !tabletFormat
            ? L("iPad temaları yalnız iPad biçimli projelerde gösterilir.", "iPad themes are only shown in iPad-format projects.")
            : L("Aramanla eşleşen tema yok.", "No themes match your search.")}
        </p>
      )}
    </>
  );
}

/** Tek önizleme kartı — görünürlükte render, önbellekte anında. */
const ThumbCard = memo(function ThumbCard({
  kind,
  id,
  name,
  hint,
  format,
  aspect,
  badges,
  sample,
  rev,
  on,
  row,
  live,
  onClick,
}: {
  kind: "theme" | "template";
  id: string;
  name: string;
  hint?: string;
  format: Format;
  aspect: number;
  badges: string[];
  sample?: Slide;
  rev: number;
  on?: boolean;
  row?: boolean;
  /**
   * C11 — hover'da kuyuda canlı önizleme. Patch BURADA türetilir (dışarıdan
   * nesne olarak alınsaydı her Inspector render'ında yeni referans doğar ve
   * `memo` kırılırdı; kartlar her tuş vuruşunda yeniden çizilirdi).
   */
  live?: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  const [url, setUrl] = useState<string | null>(() => peekThumb(kind, id, sample, format));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "40px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cached = peekThumb(kind, id, sample, format);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    if (!seen) return;
    let dead = false;
    thumbFor(kind, id, sample, format)
      .then((u) => {
        if (!dead) setUrl(u);
      })
      .catch(() => {
        /* motor hazır değilse kart iskelet kalır */
      });
    return () => {
      dead = true;
    };
  }, [kind, id, sample, format, seen, rev]);

  return (
    <button
      ref={ref}
      type="button"
      className={`vt-card ${row ? "row" : ""} ${on ? "on" : ""}`}
      onClick={onClick}
      title={`${hint || name} · ${badges.join(" · ")} · ${formatTag(format)}`}
      {...(live && kind === "theme"
        ? previewProps(`theme:${id}`, patchForTheme(sample ?? { id: "preview", themeId: id, layout: "text-top", headline: "" }, id, format))
        : null)}
    >
      <span
        className="vt-shot"
        style={{
          width: Math.round((row ? 108 : THUMB_H) * aspect),
          height: row ? 108 : THUMB_H,
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} />
        ) : (
          <span className="vt-skel" style={{ width: "100%" }} />
        )}
      </span>
      <span className="vt-meta">
        <span className="vt-name">{name}</span>
        <span className="vt-tags">
          {badges.map((badge) => <i key={badge}>{badge}</i>)}
        </span>
        {hint && <span className="vt-hint">{hint}</span>}
      </span>
    </button>
  );
});
