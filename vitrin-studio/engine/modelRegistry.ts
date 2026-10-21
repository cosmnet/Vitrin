// Model kayıt defteri — her GLB için görünen ad, tür, sürüm ve EKRAN
// KALİBRASYONU. Ekran düzlemi artık bbox sezgisiyle değil, model başına
// kalibre edilmiş dörtgenle yerleşir (bkz. /calibrate).
//
// İki katman:
//   1. DEFAULTS — kodda gömülü, meta.json olmasa da her şey çalışır.
//   2. public/assets/models/meta.json — runtime'da fetch edilir (cache-bust),
//      DEFAULTS üzerine PARÇALI olarak bindirilir. /calibrate → POST
//      /api/models-meta bu dosyayı yazar.
//
// canonicalGlbUrl (scene3dCore) sürümü buradan okur; senkron kalabilmesi için
// defter modül düzeyinde MUTABLE tutulur, ensureModelMeta() bir kez doldurur.

import { L } from "@/lib/i18n";
import { PRIVATE_MODELS } from "@private";

export type ModelKind = "phone" | "tablet" | "watch" | "prop" | "foldable";

/**
 * Ekran dörtgeni kalibrasyonu. Tüm değerler "Screen" primitifinin dünya-uzayı
 * bbox'ına ORANLIDIR; böylece model ölçeğinden bağımsızdır.
 *   insetX/insetY        — düzlem boyutu = bbox boyutu × inset (1 = tam bbox).
 *   offsetX/offsetY      — düzlemin ekran yüzeyi üzerinde kaydırılması,
 *                          HAM bbox boyutunun oranı olarak. +X sağ, +Y yukarı
 *                          (ekrana önden bakan gözlemciye göre).
 *   cornerRadiusRatio    — köşe yarıçapı = min(w,h) × oran.
 */
export type ScreenCalib = {
  insetX: number;
  insetY: number;
  offsetX: number;
  offsetY: number;
  cornerRadiusRatio?: number;
};

export type ModelEntry = {
  file: string; // "iphone-15promax.glb" — public/assets/models/ altında
  label: string; // Türkçe görünen ad (Inspector/dropdown)
  kind: ModelKind;
  version: number; // ?v= — dosya yeniden bake/sıkıştırılınca ARTTIR
  screen?: ScreenCalib; // yoksa DEFAULT_SCREEN kullanılır
  hidden?: boolean; // cihaz seçicide gösterilmez
  attribution?: string; // lisans/atıf (MODELS.md ile aynı bilgi)
  /**
   * GLB'nin üçgen sarımı ve normalleri İÇE dönük. Tek yüzlü materyallerle
   * ön yüzeyler elenir, model içi boş bir kutu gibi görünür — yandan
   * bakınca kırık. İşaretliyse prepareGlb sarımı çevirip normalleri
   * yeniden hesaplar (bkz. scene3dCore.prepareGlb).
   */
  invertedNormals?: boolean;
  /** Native orientation of the downloaded geometry (not the project canvas). */
  orientation?: "portrait" | "landscape";
  /** Use the asset's exact active display mesh instead of an estimated rounded rectangle. */
  nativeScreenGeometry?: boolean;
};

/** Kalibre edilmemiş model için taban değerler (eski gömülü 0.985/0.992). */
export const DEFAULT_SCREEN: Required<ScreenCalib> = {
  insetX: 0.985,
  insetY: 0.992,
  offsetX: 0,
  offsetY: 0,
  cornerRadiusRatio: 0.19,
};

/** Silinmiş/yeniden adlandırılmış dosyalar → güncel karşılığı. */
export const MODEL_ALIASES: Record<string, string> = {
  "iphone-real.glb": PRIVATE_MODELS["iphone-17promax.glb"] ? "iphone-17promax.glb" : "iphone-15promax.glb",
};

export const DEFAULT_MODEL_FILE = "iphone-15promax.glb";
export const DEFAULT_TABLET_MODEL_FILE = "ipad-pro.glb";

const DEFAULTS: Record<string, ModelEntry> = {
  ...Object.fromEntries(["open", "closed"].map(posture => [`apple-iphone-duo-${posture}.glb`, {
    file: `apple-iphone-duo-${posture}.glb`, label: `Apple iPhone Duo · ${posture === "open" ? L("Açık", "Open") : L("Kapalı", "Closed")}`, kind: "foldable" as const, version: 1,
    orientation: posture === "closed" ? "portrait" as const : "landscape" as const,
    attribution: "Apple iPhone Duo by zhe_kan · CC-BY-NC-SA-4.0 · bkz. APPLE-DUO-LICENSE.txt",
  }])),
  ...Object.fromEntries(["open", "book", "closed"].map(posture => [`iphone-duo-${posture}.glb`, {
    file: `iphone-duo-${posture}.glb`, label: `Vitrin Duo · ${posture}`, kind: "foldable" as const,
    version: 2, hidden: true, orientation: posture === "closed" ? "portrait" as const : "landscape" as const,
    attribution: "Vitrin özgün parametrik model; Apple kasa ölçüleri, yaklaşık köşe/menteşe/kamera ayrıntıları. https://www.apple.com/iphone-duo/specs/",
  }])),
  "ipad-pro.glb": {
    file: "ipad-pro.glb", label: "iPad Pro 13″", kind: "tablet", version: 1,
    orientation: "landscape", nativeScreenGeometry: true,
    screen: { insetX: 1, insetY: 1, offsetX: 0, offsetY: 0, cornerRadiusRatio: 0.045 },
    attribution: "Motion Studio contributors — Apache-2.0 (bkz. MODELS.md)",
  },
  "iphone-15promax.glb": {
    file: "iphone-15promax.glb",
    label: "iPhone 15 Pro Max",
    kind: "phone",
    version: 2,
    attribution: "polyman — CC-BY (bkz. MODELS.md)",
  },
  "iphone-15promax-hd.glb": {
    file: "iphone-15promax-hd.glb",
    label: "iPhone 15 Pro Max (HD doku)",
    kind: "phone",
    version: 2,
    attribution: "polyman — CC-BY (bkz. MODELS.md)",
  },
  "iphone-16plus.glb": {
    file: "iphone-16plus.glb",
    label: "iPhone 16 Plus",
    kind: "phone",
    version: 2,
    attribution: "bkz. MODELS.md",
  },
  // Lisansı yeniden dağıtıma izin vermeyen modeller private/ içinden gelir.
  ...PRIVATE_MODELS,
};

/** Yaşayan defter — meta.json yüklenince DEFAULTS üzerine bindirilir. */
const registry: Record<string, ModelEntry> = structuredCloneish(DEFAULTS);

function structuredCloneish<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ------------------------------------------------------------------ *
   Abonelik — /calibrate ve Inspector defter değişince tazelenebilsin
 * ------------------------------------------------------------------ */

let rev = 0;
const subs = new Set<() => void>();

export function modelRegistryRev(): number {
  return rev;
}

export function subscribeModelRegistry(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function bump(): void {
  rev++;
  for (const f of subs) f();
}

/* ------------------------------------------------------------------ *
   Okuma
 * ------------------------------------------------------------------ */

/** "/assets/models/x.glb?v=3" · "x.glb" → alias çözülmüş dosya adı. */
export function modelFileOf(urlOrFile: string | null | undefined): string {
  if (!urlOrFile) return DEFAULT_MODEL_FILE;
  const m = urlOrFile.match(/([^/?#]+\.glb)/i);
  const raw = m ? m[1] : urlOrFile;
  return MODEL_ALIASES[raw] ?? raw;
}

export function getModel(urlOrFile: string | null | undefined): ModelEntry | null {
  return registry[modelFileOf(urlOrFile)] ?? null;
}

export function modelLabel(urlOrFile: string | null | undefined): string {
  const file = modelFileOf(urlOrFile);
  return registry[file]?.label ?? file.replace(/\.glb$/i, "");
}

/** ?v= değeri. Bilinmeyen dosyalarda 1. */
export function modelVersion(urlOrFile: string | null | undefined): number {
  const e = registry[modelFileOf(urlOrFile)];
  return e && Number.isFinite(e.version) ? e.version : 1;
}

export function listModels(opts?: {
  kind?: ModelKind | ModelKind[];
  includeHidden?: boolean;
}): ModelEntry[] {
  const kinds = opts?.kind
    ? Array.isArray(opts.kind)
      ? opts.kind
      : [opts.kind]
    : null;
  return Object.values(registry)
    .filter((e) => (opts?.includeHidden ? true : !e.hidden))
    .filter((e) => (kinds ? kinds.includes(e.kind) : true))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/* ------------------------------------------------------------------ *
   Kalibrasyon okuma (+ /calibrate canlı override'ı)
 * ------------------------------------------------------------------ */

const runtimeOverrides = new Map<string, ScreenCalib>();

/**
 * /calibrate sayfası her ok tuşunda meta.json'a yazmak yerine burayı doldurur;
 * prepareGlb bir sonraki render'da yeni değerleri görür. null → temizler.
 */
export function setScreenOverride(urlOrFile: string, screen: ScreenCalib | null): void {
  const file = modelFileOf(urlOrFile);
  if (screen) runtimeOverrides.set(file, screen);
  else runtimeOverrides.delete(file);
  // Bilerek bump YOK: her kare çağrılıyor, abone tazelemesi çağıranın işi.
}

export function screenCalib(urlOrFile: string | null | undefined): Required<ScreenCalib> {
  const file = modelFileOf(urlOrFile);
  const over = runtimeOverrides.get(file);
  const base = registry[file]?.screen;
  return { ...DEFAULT_SCREEN, ...(base ?? {}), ...(over ?? {}) };
}

/** Bu modelin üçgen sarımı/normalleri içe mi dönük (prepareGlb düzeltir)? */
export function hasInvertedNormals(urlOrFile: string | null | undefined): boolean {
  return registry[modelFileOf(urlOrFile)]?.invertedNormals === true;
}

/** Canlı override'ı YOK SAYAN kayıtlı değer — "kaydedilmemiş değişiklik var mı?" için. */
export function registryScreen(urlOrFile: string | null | undefined): Required<ScreenCalib> {
  const base = registry[modelFileOf(urlOrFile)]?.screen;
  return { ...DEFAULT_SCREEN, ...(base ?? {}) };
}

/* ------------------------------------------------------------------ *
   meta.json — runtime yükleme + parçalı bindirme
 * ------------------------------------------------------------------ */

export type ModelMetaFile = {
  /** dosya formatı sürümü — ileride şema değişirse */
  schema?: number;
  models?: Record<string, Partial<ModelEntry>>;
};

const NUM = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function mergeEntry(file: string, patch: Partial<ModelEntry>): void {
  // Yalnız bilinen modeller: bu kurulumda olmayan (ör. lisanslı, yayımlanmayan)
  // bir modelin meta kaydı seçicide boş bir seçenek açmasın.
  if (!registry[file] && !patch.label) return;
  const cur: ModelEntry = registry[file] ?? {
    file,
    label: file.replace(/\.glb$/i, ""),
    kind: "prop",
    version: 1,
  };
  const next: ModelEntry = { ...cur };
  if (typeof patch.label === "string" && patch.label) next.label = patch.label;
  if (
      patch.kind === "phone" ||
      patch.kind === "tablet" ||
      patch.kind === "watch" ||
      patch.kind === "prop" ||
      patch.kind === "foldable"
    )
      next.kind = patch.kind;
  const v = NUM(patch.version);
  if (v !== null && v >= 1) next.version = Math.floor(v);
  if (typeof patch.hidden === "boolean") next.hidden = patch.hidden;
  if (typeof patch.attribution === "string") next.attribution = patch.attribution;
  if (patch.screen && typeof patch.screen === "object") {
    const s = patch.screen as Partial<ScreenCalib>;
    const merged: ScreenCalib = { ...DEFAULT_SCREEN, ...(cur.screen ?? {}) };
    const ix = NUM(s.insetX);
    const iy = NUM(s.insetY);
    const ox = NUM(s.offsetX);
    const oy = NUM(s.offsetY);
    const cr = NUM(s.cornerRadiusRatio);
    if (ix !== null) merged.insetX = clamp01x(ix, 0.5, 1.5);
    if (iy !== null) merged.insetY = clamp01x(iy, 0.5, 1.5);
    if (ox !== null) merged.offsetX = clamp01x(ox, -0.5, 0.5);
    if (oy !== null) merged.offsetY = clamp01x(oy, -0.5, 0.5);
    if (cr !== null) merged.cornerRadiusRatio = clamp01x(cr, 0, 0.5);
    next.screen = merged;
  }
  registry[file] = next;
}

function clamp01x(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** meta.json gövdesini deftere uygular (fetch edilmiş ya da elde kurulmuş). */
export function applyModelMeta(meta: ModelMetaFile | null | undefined): void {
  const models = meta?.models;
  if (!models || typeof models !== "object") return;
  for (const [rawFile, patch] of Object.entries(models)) {
    if (!patch || typeof patch !== "object") continue;
    const file = MODEL_ALIASES[rawFile] ?? rawFile;
    if (!/\.glb$/i.test(file)) continue;
    mergeEntry(file, patch as Partial<ModelEntry>);
  }
  bump();
}

let metaPromise: Promise<void> | null = null;
let metaLoaded = false;

export function isModelMetaLoaded(): boolean {
  return metaLoaded;
}

/**
 * meta.json'ı BİR KEZ yükler (cache-bust'lı). Dosya yoksa/bozuksa sessizce
 * DEFAULTS ile devam eder. Tarayıcı dışında (SSR) hemen çözülür.
 */
export function ensureModelMeta(): Promise<void> {
  if (metaPromise) return metaPromise;
  if (typeof fetch === "undefined" || typeof window === "undefined") {
    metaLoaded = true;
    metaPromise = Promise.resolve();
    return metaPromise;
  }
  metaPromise = (async () => {
    try {
      const res = await fetch(`/assets/models/meta.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) applyModelMeta((await res.json()) as ModelMetaFile);
    } catch {
      /* meta.json yok — gömülü varsayılanlar geçerli */
    } finally {
      metaLoaded = true;
    }
  })();
  return metaPromise;
}

/** Kayıt tazeleme (kalibrasyon kaydedildikten sonra). */
export async function reloadModelMeta(): Promise<void> {
  metaPromise = null;
  metaLoaded = false;
  await ensureModelMeta();
}

/** Defterin tamamı — /api/models-meta'ya tam gövde göndermek için. */
export function snapshotRegistry(): Record<string, ModelEntry> {
  return structuredCloneish(registry);
}

// Tarayıcıda modül yüklenir yüklenmez başlat — loadGlb ayrıca await ediyor,
// bu sadece ilk render'da bekleme olmaması için.
if (typeof window !== "undefined") void ensureModelMeta();
