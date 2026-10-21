// Zustand store — proje durumu + undo/redo.

import { create } from "zustand";
import {
  backfillDesignKeys,
  ensureDesignKeys,
  fanOutDesign,
  fieldDrift as driftOf,
  isLocked,
  matchIndex,
  pickDesign,
  projectPatch,
  splitPatch,
  summarizeNotes,
  syncOrder,
  type SyncNote,
} from "@/engine/designsync";
import { LAYOUTS } from "@/engine/layouts";
import { nowMs, perfAdd, perfEnabled } from "@/engine/perf";
import { getTheme } from "@/engine/themes";
import { L, LANG } from "@/lib/i18n";
import {
  isDevice3D,
  uid,
  type DeviceStyle3D,
  type Format,
  formatOf,
  isDuoFormat,
  type LayoutId,
  type Project,
  type Screenshot,
  type SetPlan,
  type Slide,
} from "@/engine/types";
import { twinForLocale } from "@/lib/shotkey";

export type DirectorSlide = {
  headline: string;
  sub?: string;
  badge?: string;
  themeId: string;
  layout: Slide["layout"];
  screenshotId?: string;
};

/** İlk açılış demosunun adı — örnek ekranlar + brief hazır gelir. */
const SAMPLE_APP = L("Örnek Uygulama", "Sample App");
const SAMPLE_SCREEN = "/assets/samples/phone/portrait.svg";

function emptyProject(app = L("Yeni Uygulama", "New App"), format: Format = "iphone"): Project {
  const locale = LANG === "en" ? "en" : "tr";
  const sample = app === SAMPLE_APP && format === "iphone";
  const shots: Screenshot[] = sample
    ? [
        { id: uid(), name: "today", dataUrl: SAMPLE_SCREEN },
        { id: uid(), name: "collection", dataUrl: `${SAMPLE_SCREEN}#details` },
      ]
    : [];
  const slides = sample
    ? [
        newSlide({
          headline: L("Her şey bir bakışta", "Everything at a glance"),
          sub: L("Gününü sade bir ekranda planla", "Plan your day on one calm screen"),
          screenshot: shots[0].dataUrl,
        }),
      ]
    : [newSlide(format === "iphone" ? undefined : {
        themeId: isDuoFormat(format) ? "orbit" : "solstice", layout: "text-top",
      })];
  return {
    id: uid(),
    app,
    brief: sample
      ? L("Örnek: günlük planlama uygulaması. Bugün ekranı, odak kartı, yaklaşan işler, not koleksiyonu. Sakin ve sade.", "Sample: a daily planning app. Today screen, focus card, upcoming tasks, note collection. Calm and simple.")
      : undefined,
    createdAt: new Date().toISOString(),
    screenshots: shots,
    sets: { [locale]: { app, locale, slides } },
    activeLocale: locale,
    format,
    syncDesign: true,
    designLocks: {},
  };
}

/* ---------------------------------------------------------------------------
   Geri alma yığını — anlık görüntü (snapshot) tabanlı.
   Her `mutate` bir önceki projeyi `past`'e iter (60 adım). Slider/textarea gibi
   hızlı ardışık değişimler tek adıma KATLANIR: aynı `coalesceKey` ile 550 ms
   içinde gelen ikinci değişim yeni geçmiş kaydı açmaz. Böylece bir slider'ı
   sürüklemek 40 adım değil 1 adım harcar; ⌘Z tek seferde başa döner.
   --------------------------------------------------------------------------- */
const COALESCE_MS = 550;
let lastKey: string | null = null;
let lastAt = 0;

/** Bu mutasyon önceki kayıtla aynı kalemin devamı mı? (yeni kayıt açma) */
function shouldCollapse(key: string | undefined): boolean {
  const now = Date.now();
  if (!key) {
    lastKey = null;
    lastAt = now;
    return false;
  }
  const same = key === lastKey && now - lastAt < COALESCE_MS;
  lastKey = key;
  lastAt = now;
  return same;
}

/** Sonraki mutasyon kesin yeni bir geçmiş adımı açsın (ör. panel/araç değişti). */
export function breakUndoCoalescing(): void {
  lastKey = null;
}

/* ---------------------------------------------------------------------------
   C26 — EKRAN GÖRÜNTÜLERİ KLONUN DIŞINDA

   `mutate` her çağrıda projeyi klonluyor. `Project.screenshots[].dataUrl` ise
   base64 PNG: 6 ekran ≈ 15-25 MB dize. Bu klon HER pointermove'da (sürükleme
   60/sn) ve HER TUŞ VURUŞUNDA koşuyordu → sürüklemenin ve yazmanın gerçek
   maliyeti render değil, klondu.

   Çözüm: klon öncesi diziyi ayır, klondan sonra AYNI referansı geri tak.
   Ekran görüntüsü listesi bundan sonra DEĞİŞMEZ (immutable) kabul edilir:
     · listeyi değiştiren her aksiyon YENİ dizi üretir
       (`addScreenshots`, `removeScreenshot` zaten öyle yapıyor),
     · yerinde `push/splice` YASAK — dizi donduruldu, deneyen TypeError alır.
   Bu sözleşme geri almanın doğruluğunun tek şartıdır: anlık görüntü diziyi
   referansla tutar; dizi değişmediği sürece paylaşım GÜVENLİ, değiştiğinde
   yeni dizi doğduğu için paylaşım kendiliğinden KIRILIR ve eski anlık görüntü
   eski listeyi tutmaya devam eder.
   --------------------------------------------------------------------------- */

/** Klon sırasında dizinin yerine geçen boş liste (klon maliyeti ~0). */
const EMPTY_SHOTS: Screenshot[] = [];

/**
 * Projeyi klonlar — `screenshots` HARİÇ (aynı referans geri takılır).
 * Dışa açık: Stage'in sürükleme anlık görüntüsü gibi çağıranlar da aynı ucuz
 * yoldan geçsin diye (`structuredClone(project)` yerine `cloneProject(...)`).
 */
export function cloneProject(p: Project): Project {
  const shots = p.screenshots;
  // Dondurma: paylaşılan diziyi yerinde değiştiren kod ANINDA patlasın
  // (sessizce geçmişi bozmasın). Yeni dizi üreten aksiyonlar etkilenmez.
  if (Array.isArray(shots) && !Object.isFrozen(shots)) Object.freeze(shots);
  // Clone the JSON object graph without copying multi-megabyte immutable
  // screenshot strings on every pointermove. Arrays and objects stay isolated.
  const clone = <T,>(value: T): T => {
    if (Array.isArray(value)) return value.map(clone) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
    return value;
  };
  const out = clone({ ...p, screenshots: EMPTY_SHOTS }) as Project;
  out.screenshots = shots;
  return out;
}

/* ---------------------------------------------------------------------------
   C20 — JEST (scrub) KATLAMA

   Slider'ı sürüklemek onlarca `updateSlide` üretir. `coalesceKey` bunları 550ms
   penceresinde katlar ama YAVAŞ sürüklemede (duraklamalı) pencere kapanır ve
   tek jest 3-4 geçmiş adımına bölünür. Jest sınırını çağıran BİLİR:
   pointerdown'da `beginUndoGesture()`, pointerup'ta `endUndoGesture()`.
   Arada kaç mutate koşarsa koşsun geçmişe TEK adım yazılır (Stage'in
   `drag.snapshot` deseninin store'a taşınmış hâli).

   Emniyet: jest içindeyken pencere `pointerup/pointercancel/blur` alırsa jest
   kendiliğinden kapanır — bileşen `up` olayını kaçırsa bile geçmiş kilitli
   kalmaz.
   --------------------------------------------------------------------------- */

let gestureSnap: Project | null = null;

function safetyEnd(): void {
  endUndoGesture();
}

function armSafety(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("pointerup", safetyEnd);
  window.addEventListener("pointercancel", safetyEnd);
  window.addEventListener("blur", safetyEnd);
}

function disarmSafety(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("pointerup", safetyEnd);
  window.removeEventListener("pointercancel", safetyEnd);
  window.removeEventListener("blur", safetyEnd);
}

/** Jest başlat: şu anki proje anlık görüntüsü kenara alınır. İç içe çağrı zararsız. */
export function beginUndoGesture(): void {
  if (gestureSnap) return; // zaten bir jest sürüyor — sınır ilk başlangıçta
  breakUndoCoalescing();
  gestureSnap = useStudio.getState().project;
  armSafety();
}

/** Jest bitir: proje gerçekten değiştiyse geçmişe TEK adım yazılır. */
export function endUndoGesture(): void {
  const snap = gestureSnap;
  if (!snap) return;
  gestureSnap = null;
  disarmSafety();
  breakUndoCoalescing();
  useStudio.setState((st) =>
    st.project === snap ? {} : { past: [...st.past.slice(-59), snap], future: [] }
  );
}

/** Şu an bir scrub/sürükleme jesti sürüyor mu? (test ve tanılama için) */
export function inUndoGesture(): boolean {
  return gestureSnap !== null;
}

/* ---------------------------------------------------------------------------
   C23 — SLAYT PANOSU (diller arası kopyala-yapıştır)

   `components/styleClip.ts` deseninin birebir eşi: pano bir OTURUM aracıdır.
   Store DURUMUNA girmez (abonelik gürültüsü yaratmasın), projeye girmez,
   kaydedilmez, undo yığınına yazılmaz. Modül düzeyinde yaşar; kopyalanan
   slaytlar DERİN kopyadır — panodaki kayıt, kaynak slayt sonradan
   düzenlense/silinse bile bozulmaz.
   --------------------------------------------------------------------------- */

type SlideClip = { locale: string; slides: Slide[]; at: number };

let slideClip: SlideClip | null = null;
const clipSubs = new Set<() => void>();

/** Seçili slaytları panoya al (derin kopya). Dönüş: kopyalanan adet. */
export function copySlidesToClip(slides: Slide[], locale: string): number {
  if (!slides.length) return 0;
  slideClip = { locale, slides: structuredClone(slides), at: Date.now() };
  for (const f of clipSubs) f();
  return slideClip.slides.length;
}

/** Panonun künyesi (adet + kaynak dil) ya da null. */
export function slideClipInfo(): { count: number; locale: string } | null {
  return slideClip ? { count: slideClip.slides.length, locale: slideClip.locale } : null;
}

export function subscribeSlideClip(cb: () => void): () => void {
  clipSubs.add(cb);
  return () => clipSubs.delete(cb);
}

/** Yapıştırma sonucu — toast künyesi bu üç sayıdan kurulur. */
export type PasteResult = {
  /** Eklenen slayt adedi. */
  inserted: number;
  /** Çakışma yüzünden YENİ designKey alan slayt adedi. */
  fresh: number;
  /** Kaynak dil ≠ hedef dil (needsCopy bayrağı yalnız bu durumda basılır). */
  cross: boolean;
};

/* ---------------------------------------------------------------------------
   C21 — ÇOKLU SEÇİM: aktif ≠ seçili

   `activeSlideId` Inspector'ın GÖSTERDİĞİ slayttır — her zaman tektir.
   `selectedIds` TOPLU İŞLEMİN HEDEFİDİR — boş olabilir, çok olabilir.
   İkisi de UI DURUMUDUR: projeye girmez, undo'ya yazılmaz, autosave
   `project` referansına bakar (seçim değişimi kaydı TETİKLEMEZ).

   Hedef kuralı: seçim boşsa toplu işlem AKTİF slayta uygulanır. Böylece
   bağlam menüsündeki tek kalem hem "1 slayt" hem "N slayt" hâlini karşılar
   ve kullanıcı "hiçbir şey seçmedim, hiçbir şey olmadı" durumuna düşmez.
   --------------------------------------------------------------------------- */

/** Toplu işlemin hedefi: seçim (şerit sırasında, ölü id'ler ayıklanmış) ya da aktif slayt. */
export function bulkTargetIds(st?: {
  project: Project;
  activeSlideId: string | null;
  selectedIds: string[];
}): string[] {
  const s = st ?? useStudio.getState();
  const list = s.project.sets[s.project.activeLocale]?.slides ?? [];
  const sel = new Set(s.selectedIds);
  const out = list.filter((x) => sel.has(x.id)).map((x) => x.id);
  if (out.length) return out;
  const a = s.activeSlideId ?? list[0]?.id;
  return a && list.some((x) => x.id === a) ? [a] : [];
}

/**
 * Seçimi temizle — MODÜL DÜZEYİNDE dışa açık.
 * Şerit boşluğuna tıklamak burayı çağırır; Stage de tuval boşluğuna
 * tıklandığında AYNI fonksiyonu import edip çağırabilir (bkz. kablolama notu).
 */
export function clearSlideSelection(): void {
  useStudio.getState().clearSelection();
}

export function newSlide(partial?: Partial<Slide>): Slide {
  return {
    id: uid(),
    // Diller arası eşleştirme anahtarı. MD içe aktarmada "f01"… gelir; editörde
    // üretilen her slayt YENİ bir anahtar alır (kopya = yeni tasarım satırı,
    // takma ad değil). partial ile ezilebilir.
    designKey: uid(),
    headline: L("Başlık buraya", "Headline here"),
    sub: L("Kısa açıklama satırı", "Short description line"),
    themeId: "solstice",
    layout: "device-bleed-bottom",
    ...partial,
  };
}

/** A theme selection starts from that theme's device defaults. Explicit
 * device choices in the same patch win; ordinary edits and project loading
 * never normalize devices, so saved user customization remains intact. */
function themeSelectionPatch(patch: Partial<Slide>): Partial<Slide> {
  return patch.themeId !== undefined && !("device" in patch)
    ? { ...patch, device: undefined }
    : patch;
}

/* ---------------------------------------------------------------------------
   R10 — EKRAN GÖRÜNTÜSÜ YUVALARI

   Bir slaytta artık üç yuva var: `screenshot` (1), `screenshot2` (2),
   `screenshot3` (3). Düzenin kaç cihaz istediğini `LAYOUTS[id].device2/3`
   söyler; yuvayı YAZAN tek yol burasıdır (`setSlideShot`) — Inspector ve
   medya çekmecesi ikisi de buradan geçer, alan adını hiçbir UI elle yazmaz.

   Neden ayrı bir eylem: alan adı üçe çıkınca `updateSlide(id, {screenshot2})`
   çağrıları UI'ye dağılıyordu; yeni bir yuva eklendiğinde (ya da alan adı
   değiştiğinde) her çağrı yerini bulmak gerekiyordu.
   --------------------------------------------------------------------------- */

export type ShotSlot = 1 | 2 | 3;

/**
 * Düzenin KAÇ ekran görüntüsü istediği (1..3) — `LAYOUTS[id].device2/device3`
 * varlığından okunur, düzen id'si SABİT YAZILMAZ. Motor tarafı yeni bir çoklu
 * cihaz düzeni eklediğinde UI kendiliğinden o kadar yuva gösterir.
 */
export function shotSlotCount(layout: LayoutId, format?: Format): ShotSlot {
  const spec = LAYOUTS[layout];
  if (spec?.device3) return 3;
  if (spec?.device2) return 2;
  return format && isDuoFormat(format) ? 2 : 1;
}

/** Yuva no → Slide alanı. Yuva sırası motorun geri düşme sırasıdır (3→2→1). */
export const SHOT_FIELD = {
  1: "screenshot",
  2: "screenshot2",
  3: "screenshot3",
} as const satisfies Record<ShotSlot, keyof Slide>;

/** updateSlide seçenekleri — mevcut çağıranlar hiçbirini vermez. */
export type UpdateSlideOpts = {
  /** true = tasarım alanları bile YALNIZ aktif dile yazılır (yayılım yok). */
  localOnly?: boolean;
  /**
   * Katlama anahtarını ELLE ver (R8/W2). Öğe sürüklemesi/nudge'ı `elements`
   * dizisinin tamamını yazar; varsayılan anahtar (`slide:<id>:elements`) iki
   * FARKLI öğenin ardışık nudge'ını da tek adıma katlardı. `el:<elId>:xy`
   * demek jesti öğe başına ayırır.
   */
  coalesceKey?: string;
};

type StudioState = {
  project: Project;
  activeSlideId: string | null;
  /**
   * Tuvalde seçili serbest öğe (R8/W2). UI DURUMUDUR: projeye girmez,
   * undo yığınına yazılmaz, kaydedilmez — `activeSlideId` ile aynı sınıf.
   * Stage seçer, Inspector "ÖĞELER" bölümü okur.
   */
  selectedElementId: string | null;
  selectedLayerId: string | null;
  layerPanelOpen: boolean;
  layerPanelTab: "edit" | "layers";
  cropEditing: boolean;
  setSelectedLayer: (id: string | null) => void;
  setLayerPanelOpen: (open: boolean) => void;
  setLayerPanelTab: (tab: "edit" | "layers") => void;
  setCropEditing: (editing: boolean) => void;
  /**
   * Şeritte SEÇİLİ slaytlar (C21) — aktif dile ait id'ler. UI DURUMU:
   * projeye girmez, undo'ya yazılmaz, kaydedilmez. Dil değişince temizlenir
   * (id'ler dile özeldir). Ölü id'ler `selectionIds()` ile ayıklanır.
   */
  selectedIds: string[];
  busy: string | null;
  savedAt: string | null;
  past: Project[];
  future: Project[];
  /**
   * Son yayılımın tek satırlık künyesi ("3 dilde eşleşen slayt yok · ar-SA:
   * font kapsamıyor") ya da null. Toast'ı W3 basar; burası yalnız kayıt yeri.
   */
  lastSyncNote: string | null;

  // seçiciler
  activeSet: () => SetPlan;
  activeSlide: () => Slide | null;
  /** Seçim — şerit sırasında, aktif sette OLMAYAN id'ler ayıklanmış. */
  selectionIds: () => string[];

  // mutasyonlar
  /**
   * @param undoable geçmişe kaydedilsin mi (sürükleme sırasında false)
   * @param coalesceKey aynı anahtarla art arda gelen değişimler tek adıma katlanır
   */
  mutate: (fn: (p: Project) => Project, undoable?: boolean, coalesceKey?: string) => void;
  setBusy: (b: string | null) => void;
  setActiveSlide: (id: string | null) => void;
  /** Tuval seçimi (R8/W2) — UI durumu, undo dışı. */
  setSelectedElement: (id: string | null) => void;
  newProject: (app?: string, format?: Format) => void;
  loadProject: (p: Project) => void;
  setApp: (app: string) => void;
  setBrief: (brief: string) => void;
  addScreenshots: (shots: Screenshot[]) => void;
  removeScreenshot: (id: string) => void;
  setLocale: (locale: string) => void;
  addLocale: (locale: string, slides?: Slide[]) => void;
  removeLocale: (locale: string) => void;
  addSlide: () => void;
  duplicateSlide: (id: string) => void;
  removeSlide: (id: string) => void;
  moveSlide: (id: string, dir: -1 | 1) => void;
  updateSlide: (id: string, patch: Partial<Slide>, opts?: UpdateSlideOpts) => void;
  /**
   * R10 — EKRAN GÖRÜNTÜSÜ YUVASI YAZ. `src` yoksa yuva temizlenir.
   *
   * TEK SLAYTA yazar; çoklu seçimde bile yayılmaz. Ekran görüntüsü İÇERİK
   * alanıdır ve slayt başına FARKLI bir özelliği anlatır — 10 seçili slayda
   * aynı görseli basmak, geri alınabilir olsa da istenmeyen veri kaybıdır
   * (Inspector bunu panelde açıkça yazar). Aynı sebeple dillere de yayılmaz:
   * `splitPatch` screenshot* alanlarını İÇERİK sayar (designsync).
   */
  setSlideShot: (id: string, slot: ShotSlot, src?: string) => void;
  /**
   * Bir yuvanın ekranını diğer dillere yayar — her dile KENDİ kovasındaki eşi.
   * `setSlideShot` bunu kendiliğinden çağırır; ayrıca elle de tetiklenebilir.
   */
  fanOutShot: (id: string, slot: ShotSlot) => void;
  /** İki yuvanın içeriğini takas eder (ör. "1 ile 2 yer değiştir"). Tek ⌘Z. */
  swapSlideShots: (id: string, a: ShotSlot, b: ShotSlot) => void;
  applyPlan: (slides: DirectorSlide[], screenshotsById: Record<string, string>) => void;
  undo: () => void;
  redo: () => void;

  // ---- Tasarım senkronu (R7 / W1b) ----
  setSyncDesign: (on: boolean) => void;
  /** Aktif dilin tasarımını tüm dillere basar. Arg yoksa TÜM aktif set. */
  applyDesignToAllLocales: (slideId?: string) => void;
  /**
   * R9 — TEK SLAYTTAN TÜM SLAYTLARA. Aktif (ya da verilen) slaytın seçili
   * tasarım ALANLARINI aktif dildeki bütün slaytlara yazar, sonra senkron
   * açıksa hepsini diğer dillere yayar. Hepsi TEK mutate → TEK ⌘Z.
   * `fields` verilmezse slaytın TÜM tasarım alanları (pickDesign) gider.
   * Dönüş: etkilenen slayt sayısı (aktif dilde).
   */
  applyDesignToAllSlides: (fields?: (keyof Slide)[], slideId?: string) => number;
  /**
   * R9 — 3D CİHAZ ALANLARINI TÜM SLAYTLARA/DİLLERE YAMALA.
   * `applyDesignToAllSlides(["device"])` cihaz nesnesinin TAMAMINI (kamera,
   * orbit, ışık) kopyalar; burada yalnız verilen alanlar (ör. model/glb)
   * her 3D slayda işlenir, geri kalan ayarlar SLAYTTA KALIR. Tek ⌘Z.
   * Dönüş: dokunulan slayt sayısı (tüm diller toplamı).
   */
  patchDeviceAllSlides: (patch: Partial<DeviceStyle3D>) => number;
  toggleDesignLock: (locale: string, designKey: string) => void;
  /** Yeni slaytı TÜM dillere ekler (aynı designKey, metin kopya + needsCopy). */
  addSlideAllLocales: (afterDesignKey?: string) => void;
  removeSlideAllLocales: (designKey: string) => void;
  clearSyncNote: () => void;

  // ---- Çoklu seçim + toplu işlem + pano (R8 / W3 · C21-C23) ----
  /** Seçimi topluca kur (ölü id'ler yazılmaz). */
  setSelection: (ids: string[]) => void;
  /** ⌘+tık — seçime ekle/çıkar. Eklerken aktif slayt da o kart olur. */
  toggleSelected: (id: string) => void;
  /**
   * ⇧+tık / ⇧+ok — ÇAPADAN tıklanana kadar aralık. Aktif = tıklanan.
   * `fromId` verilmezse çapa aktif slayttır; şeritteki ⇧+ok bunu AÇIKÇA
   * verir, yoksa her adımda çapa da kayar ve aralık büyümez, KAYAR.
   */
  selectRange: (toId: string, fromId?: string) => void;
  /** ⌘A — aktif dildeki tüm slaytlar. */
  selectAllSlides: () => void;
  clearSelection: () => void;
  /**
   * C22 — TASARIM YAMASINI SEÇİLİYE UYGULA. Tek `mutate`: N slayt × 15 dil
   * tek geçmiş adımı, tek ⌘Z. Yama `pickDesign`/`styleClip` çıktısıdır.
   * Dönüş: dokunulan slayt adedi.
   */
  applyDesignToSelected: (patch: Partial<Slide>, opts?: UpdateSlideOpts) => number;
  /** C22 — seçiliyi çoğalt (tek mutate). Kopyalar YENİ seçim olur. */
  duplicateSelected: () => number;
  /** C22 — seçiliyi sil (tek mutate). Dil boşalacaksa hiç koşmaz (0 döner). */
  removeSelected: () => number;
  /** C23 — panodaki slaytları AKTİF dile ekle. Tek mutate. */
  pasteSlides: () => PasteResult;
};

export const useStudio = create<StudioState>((set, get) => ({
  project: emptyProject(SAMPLE_APP),
  activeSlideId: null,
  selectedElementId: null,
  selectedLayerId: null,
  layerPanelOpen: false,
  layerPanelTab: "layers",
  cropEditing: false,
  selectedIds: [],
  busy: null,
  savedAt: null,
  past: [],
  future: [],
  lastSyncNote: null,

  activeSet: () => {
    const p = get().project;
    return p.sets[p.activeLocale];
  },
  activeSlide: () => {
    const s = get().activeSet();
    const id = get().activeSlideId;
    return s.slides.find((x) => x.id === id) || s.slides[0] || null;
  },
  selectionIds: () => {
    const st = get();
    const list = st.project.sets[st.project.activeLocale]?.slides ?? [];
    const sel = new Set(st.selectedIds);
    return list.filter((x) => sel.has(x.id)).map((x) => x.id);
  },

  mutate: (fn, undoable = true, coalesceKey) =>
    set((st) => {
      // Jest sürüyorsa geçmiş adımı AÇILMAZ: anlık görüntü pointerdown'da
      // alındı, pointerup'ta yazılacak (C20). `undoable` yine de anlamlı:
      // false diyen çağıran zaten geçmiş istemiyor.
      const gesture = gestureSnap !== null;
      const collapse = undoable && !gesture && shouldCollapse(coalesceKey);
      const measure = perfEnabled();
      const t0 = measure ? nowMs() : 0;
      const draft = cloneProject(st.project);
      const t1 = measure ? nowMs() : 0;
      const project = fn(draft);
      if (measure) {
        const t2 = nowMs();
        perfAdd("mutate.clone", t1 - t0);
        perfAdd("mutate", t2 - t0);
      }
      return {
        project,
        past: undoable && !gesture && !collapse ? [...st.past.slice(-59), st.project] : st.past,
        future: undoable && !gesture ? [] : st.future,
      };
    }),
  setBusy: (busy) => set({ busy }),
  // Slayt değişince tuval seçimi düşer: seçili öğe id'si o slayda aitti.
  setActiveSlide: (activeSlideId) => set({ activeSlideId, selectedElementId: null, selectedLayerId: null, cropEditing: false }),
  setSelectedElement: (selectedElementId) => set({ selectedElementId, selectedLayerId: selectedElementId ? `element:${selectedElementId}` : null, layerPanelOpen: selectedElementId ? true : get().layerPanelOpen, layerPanelTab: selectedElementId ? "edit" : "layers", cropEditing: false }),
  setSelectedLayer: (selectedLayerId) => set({ selectedLayerId, selectedElementId: selectedLayerId?.startsWith("element:") ? selectedLayerId.slice(8) : null, layerPanelOpen: selectedLayerId ? true : get().layerPanelOpen, layerPanelTab: selectedLayerId ? "edit" : "layers", cropEditing: false }),
  setLayerPanelOpen: (layerPanelOpen) => set({ layerPanelOpen }),
  setLayerPanelTab: (layerPanelTab) => set({ layerPanelTab }),
  setCropEditing: (cropEditing) => set({ cropEditing }),

  newProject: (app, format) => {
    breakUndoCoalescing();
    set({
      project: emptyProject(app, format),
      activeSlideId: null,
      selectedElementId: null,
      selectedLayerId: null,
      cropEditing: false,
      selectedIds: [],
      past: [],
      future: [],
      lastSyncNote: null,
    });
  },
  loadProject: (p) => {
    breakUndoCoalescing();
    // GÖRÜNMEZ GÖÇ: dosya taşıma yok, sunucu değişikliği yok. Üç alan da
    // opsiyonel olduğu için eski build yeni JSON'u yok sayar, yeni build eski
    // JSON'u tamamlar. `designKey ??= i<index>` her SET İÇİN BAĞIMSIZ atanır,
    // yani eski proje tam olarak index eşleşmesiyle çalışmaya devam eder.
    // Format da aynı görünmez göçle tamamlanır: alan yoksa iPhone.
    const withFormat: Project = { ...p, format: formatOf(p) };
    set({
      project: backfillDesignKeys(withFormat),
      activeSlideId: null,
      selectedElementId: null,
      selectedLayerId: null,
      cropEditing: false,
      selectedIds: [],
      past: [],
      future: [],
      lastSyncNote: null,
    });
  },
  setApp: (app) =>
    get().mutate((p) => {
      p.app = app;
      for (const s of Object.values(p.sets)) s.app = app;
      return p;
    }),
  setBrief: (brief) => get().mutate((p) => ((p.brief = brief), p), false),
  // C26 sözleşmesi: ikisi de YENİ dizi üretir (spread / filter). Paylaşım tam
  // burada kırılır — eski anlık görüntü eski diziyi tutmaya devam eder, yani
  // "ekran görüntüsü sil → ⌘Z" listeyi eksiksiz geri getirir.
  // Yerinde `p.screenshots.push(...)` YAZMAYIN: dizi donmuştur, TypeError atar.
  addScreenshots: (shots) => get().mutate((p) => ((p.screenshots = [...p.screenshots, ...shots]), p)),
  removeScreenshot: (id) =>
    get().mutate((p) => ((p.screenshots = p.screenshots.filter((s) => s.id !== id)), p)),

  setLocale: (locale) => {
    // Dil değişimi kalem değiştirmektir: sonraki düzenleme kesin YENİ bir
    // geçmiş adımı açsın (iki dilin aynı katlama penceresine düşmesi imkânsız).
    breakUndoCoalescing();
    // Seçim DİLE ÖZELDİR (id'ler dilden dile taşınmaz) → dil değişince düşer.
    // Pano düşmez: diller arası yapıştırmanın tüm anlamı bu.
    set({ selectedIds: [], selectedElementId: null, selectedLayerId: null, cropEditing: false });
    get().mutate((p) => {
      if (p.sets[locale]) p.activeLocale = locale;
      return p;
    }, false);
  },
  addLocale: (locale, slides) =>
    get().mutate((p) => {
      if (!p.sets[locale]) {
        const base = p.sets[p.activeLocale];
        // Taban setin anahtarları önce tamamlanır, sonra yeni dile AYNEN
        // taşınır: yeni dil doğduğu anda senkron grafiğine katılır.
        ensureDesignKeys(base.slides);
        const src = slides ?? structuredClone(base.slides).map((s) => ({ ...s, id: uid() }));
        p.sets[locale] = {
          app: p.app,
          locale,
          slides: src.map((s, i) => ({
            ...s,
            designKey: s.designKey ?? base.slides[i]?.designKey ?? `i${i}`,
          })),
        };
      }
      p.activeLocale = locale;
      return p;
    }),
  removeLocale: (locale) =>
    get().mutate((p) => {
      if (Object.keys(p.sets).length <= 1) return p;
      delete p.sets[locale];
      if (p.activeLocale === locale) p.activeLocale = Object.keys(p.sets)[0];
      return p;
    }),

  addSlide: () => {
    // Son slaytın TAM kopyası (cihaz, ölçek/pozisyon, arka plan, stiller,
    // screenshot dahil) — sadece metinler sıfırlanır. Yeni slayt aktif olur.
    const newId = uid();
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      const last = s.slides[s.slides.length - 1];
      // Yeni slayt YENİ bir designKey alır: bu dile özel, diğer dillerde
      // karşılığı yok. "Bu slaytı tüm dillere ekle" (addSlideAllLocales) onu
      // aynı anahtarla her dile taşır.
      const sl: Slide = last
        ? {
            ...structuredClone(last),
            id: newId,
            designKey: uid(),
            headline: L("Başlık", "Headline"),
            sub: "",
            badge: undefined,
            needsCopy: undefined,
          }
        : { ...newSlide(), id: newId };
      s.slides.push(sl);
      return p;
    });
    set({ activeSlideId: newId, selectedElementId: null, selectedLayerId: null, cropEditing: false });
  },
  duplicateSlide: (id) => {
    const newId = uid();
    let inserted = false;
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      const i = s.slides.findIndex((x) => x.id === id);
      if (i >= 0) {
        // Kopya = YENİ tasarım satırı, takma ad değil → yeni designKey.
        s.slides.splice(i + 1, 0, {
          ...structuredClone(s.slides[i]),
          id: newId,
          designKey: uid(),
        });
        inserted = true;
      }
      return p;
    });
    if (inserted) set({ activeSlideId: newId, selectedElementId: null, selectedLayerId: null, cropEditing: false }); // kopya aktif slayt olur
  },
  removeSlide: (id) =>
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (s.slides.length > 1) s.slides = s.slides.filter((x) => x.id !== id);
      return p;
    }),
  moveSlide: (id, dir) =>
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      const i = s.slides.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i >= 0 && j >= 0 && j < s.slides.length) {
        const [sl] = s.slides.splice(i, 1);
        s.slides.splice(j, 0, sl);
        // Sıra TASARIMDIR: senkron açıkken her dil kaynağın anahtar sırasına
        // göre yeniden dizilir (aynı mutate → tek ⌘Z hepsini geri alır).
        if (p.syncDesign !== false) syncOrder(p, p.activeLocale);
      }
      return p;
    }),

  /**
   * Slayt yaması. Tasarım alanları (DESIGN_FIELDS) senkron açıkken TÜM dillere
   * yayılır; metin/ekran/çelenk metni yalnız aktif dilde kalır.
   *
   * Katlama (undo) anahtarları:
   *   içerik → `slide:<id>:<alanlar>`      (id dile özel — bugünkü davranış)
   *   tasarım → `design:<designKey>:<alanlar>`  (id'ler dilden dile değişir;
   *             yayılımdan sonra "aynı slider" kimliği anahtarla sürer)
   * KARIŞIK yama (nadir — Inspector alanları ya biri ya diğeri): önce içerik
   * (undoable), sonra tasarım (`undoable: false`) → İKİSİ TEK geçmiş adımında.
   */
  updateSlide: (id, patch, opts) => {
    patch = themeSelectionPatch(patch);
    const p0 = get().project;
    const loc = p0.activeLocale;
    const set0 = p0.sets[loc];
    const src = set0?.slides.find((x) => x.id === id) ?? null;
    const { design, content } = splitPatch(patch);
    // Bu dilde metin düzenlenince "çevrilmedi" bayrağı kendiliğinden düşer.
    // Yamaya EKLENMEZ — katlama anahtarı bugünküyle birebir aynı kalsın diye
    // (yoksa bayrağın düştüğü tuş vuruşu tek başına yeni bir adım açardı).
    const clearsNeedsCopy = "headline" in content || "sub" in content;

    const dKeys = Object.keys(design).sort();
    const cKeys = Object.keys(content).sort();
    const fan =
      !opts?.localOnly &&
      p0.syncDesign !== false &&
      dKeys.length > 0 &&
      !!src &&
      Object.keys(p0.sets).length > 1;

    const applyLocal = (p: Project, part: Partial<Slide>): number => {
      const s = p.sets[p.activeLocale];
      const i = s ? s.slides.findIndex((x) => x.id === id) : -1;
      if (i >= 0) s.slides[i] = { ...s.slides[i], ...structuredClone(part) };
      return i;
    };

    const out: { notes: SyncNote[] } = { notes: [] };
    const runDesign = (p: Project): Project => {
      const i = applyLocal(p, design);
      if (fan && i >= 0) {
        const s = p.sets[p.activeLocale];
        out.notes = fanOutDesign(p, p.activeLocale, s.slides[i], i, design).notes;
      }
      return p;
    };
    const runContent = (p: Project): Project => {
      const i = applyLocal(p, content);
      if (clearsNeedsCopy && i >= 0) delete p.sets[p.activeLocale].slides[i].needsCopy;
      return p;
    };

    const ck = opts?.coalesceKey;
    if (dKeys.length && cKeys.length) {
      get().mutate(runContent, true, ck ?? `slide:${id}:${cKeys.join(",")}`);
      get().mutate(runDesign, false);
    } else if (dKeys.length) {
      get().mutate(runDesign, true, ck ?? `design:${src?.designKey ?? id}:${dKeys.join(",")}`);
    } else {
      get().mutate(runContent, true, ck ?? `slide:${id}:${cKeys.join(",")}`);
    }

    // Künye yalnız yayılım koştuğunda tazelenir — salt metin düzenlemesi
    // ekrandaki notu silmez.
    if (fan) set({ lastSyncNote: summarizeNotes(out.notes) });
  },

  setSlideShot: (id, slot, src) => {
    // Katlama anahtarı yuva + KAYNAK içerir: aynı karoya iki kez tıklamak
    // (fikir değiştirip geri dönmek) tek adım kalır, FARKLI iki görsel seçmek
    // ayrı adımlar açar. Varsayılan anahtar (`slide:<id>:screenshot2`) 550ms
    // içindeki iki farklı seçimi tek adıma katlar ve ⌘Z ilkini de silerdi.
    get().updateSlide(id, { [SHOT_FIELD[slot]]: src } as Partial<Slide>, {
      coalesceKey: `shot:${id}:${slot}:${src ?? "-"}`,
    });
    // Ekran DİLE ÖZELDİR, ama SEÇİM değildir: kullanıcı Türkçe slaytta
    // "harita" karesini düzeltince diğer 25 dilde de o karenin yerine
    // O DİLİN harita görseli geçmeli. URL'yi olduğu gibi yaymak yanlış
    // olurdu (Türkçe arayüz Almanca vitrine düşerdi), o yüzden havuzdaki
    // mantıksal ad üzerinden her dilin kendi eşi bulunur.
    get().fanOutShot(id, slot);
  },

  /**
   * Bir yuvanın ekranını diğer dillere YAYAR — her dile kendi kovasındaki eşi.
   *
   * Tek `mutate` içinde koşar: 26 dil tek ⌘Z ile geri alınır.
   * Kilitli diller (designLocks) atlanır; eşi olmayan dil "noShot" notu
   * düşer ve OLDUĞU GİBİ bırakılır — yanlış dilde görsel basmaktansa
   * eski hâli kalsın.
   */
  fanOutShot: (id, slot) => {
    const st = get();
    const p0 = st.project;
    if (p0.syncDesign === false) return;
    const from = p0.activeLocale;
    const srcSet = p0.sets[from];
    const srcSlide = srcSet?.slides.find((x) => x.id === id);
    if (!srcSet || !srcSlide) return;
    const others = Object.keys(p0.sets).filter((l) => l !== from);
    if (!others.length) return;

    const field = SHOT_FIELD[slot];
    const url = srcSlide[field] as string | undefined;
    const srcIndex = srcSet.slides.indexOf(srcSlide);
    const notes: SyncNote[] = [];

    get().mutate((p) => {
      for (const loc of others) {
        const set = p.sets[loc];
        if (!set) continue;
        const j = matchIndex(set, srcSlide.designKey, srcIndex);
        if (j < 0) {
          notes.push({ kind: "unmatched", locale: loc });
          continue;
        }
        const target = set.slides[j];
        if (isLocked(p, loc, [srcSlide.designKey, target.designKey])) {
          notes.push({ kind: "locked", locale: loc });
          continue;
        }
        // Ekranı TEMİZLEME de bir karardır ve her dile aynen gider.
        if (!url) {
          delete target[field];
          continue;
        }
        const twin = twinForLocale(p.screenshots, url, from, loc);
        if (!twin) {
          notes.push({ kind: "noShot", locale: loc });
          continue;
        }
        target[field] = twin.url;
      }
      return p;
      // Katlama anahtarı `setSlideShot`ınkiyle AYNI: seçim + 26 dile yayılım
      // TEK ⌘Z adımıdır. Ayrı anahtar verilirse kullanıcı iki kez geri almak
      // zorunda kalır ve arada tutarsız bir ara durum görür.
    }, true, `shot:${id}:${slot}:${url ?? "-"}`);

    if (notes.length) set({ lastSyncNote: summarizeNotes(notes) });
  },

  swapSlideShots: (id, a, b) => {
    if (a === b) return;
    const s = get().project.sets[get().project.activeLocale];
    const cur = s?.slides.find((x) => x.id === id);
    if (!cur) return;
    breakUndoCoalescing(); // takas ayrık bir eylem — komşu seçimlere katlanmasın
    get().updateSlide(id, {
      [SHOT_FIELD[a]]: cur[SHOT_FIELD[b]],
      [SHOT_FIELD[b]]: cur[SHOT_FIELD[a]],
    } as Partial<Slide>);
  },

  applyPlan: (slides, screenshotsById) =>
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      s.slides = slides.map((d) =>
        newSlide({
          headline: d.headline,
          sub: d.sub,
          badge: d.badge,
          themeId: d.themeId,
          layout: d.layout,
          screenshot: d.screenshotId ? screenshotsById[d.screenshotId] : undefined,
        })
      );
      return p;
    }),

  /* ---------------------------------------------------------------- *
     Tasarım senkronu — açık aksiyonlar
     Hepsi TEK `mutate` içinde çalışır: 15 dilin değişimi tek anlık görüntü,
     tek ⌘Z. `mutate` zaten structuredClone(project) yaptığı için buradaki
     fonksiyonlar projeyi YERİNDE değiştirebilir.
   * ---------------------------------------------------------------- */

  setSyncDesign: (on) => {
    breakUndoCoalescing();
    get().mutate((p) => ((p.syncDesign = on), p));
  },

  applyDesignToAllLocales: (slideId) => {
    breakUndoCoalescing();
    const out: { notes: SyncNote[] } = { notes: [] };
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      const list = slideId ? s.slides.filter((x) => x.id === slideId) : s.slides;
      for (const sl of list) {
        const i = s.slides.indexOf(sl);
        // Kilitler burada da geçerli: "elle ayarladım, dokunma" senkron
        // toggle'ından bağımsız bir sözdür.
        out.notes.push(...fanOutDesign(p, p.activeLocale, sl, i, pickDesign(sl)).notes);
      }
      return p;
    });
    set({ lastSyncNote: summarizeNotes(out.notes) });
  },

  applyDesignToAllSlides: (fields, slideId) => {
    breakUndoCoalescing();
    const st = get();
    const p0 = st.project;
    const set0 = p0.sets[p0.activeLocale];
    const srcId = slideId ?? st.activeSlideId;
    // Inspector'ın düşüşüyle aynı: aktif slayt yoksa/eşleşmiyorsa ilk slayt
    // kaynaktır (panel de onu gösteriyor).
    const src0 = set0?.slides.find((x) => x.id === srcId) ?? set0?.slides[0];
    if (!set0 || !src0) return 0;
    const full = pickDesign(src0);
    const design: Partial<Slide> = fields
      ? (Object.fromEntries(
          fields.filter((k) => k in full).map((k) => [k, (full as Record<string, unknown>)[k]])
        ) as Partial<Slide>)
      : full;
    if (!Object.keys(design).length) return 0;
    const appliedDesign = themeSelectionPatch(design);
    const fan = p0.syncDesign !== false && Object.keys(p0.sets).length > 1;
    const notes: SyncNote[] = [];
    let n = 0;
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      s.slides.forEach((sl, i) => {
        s.slides[i] = { ...sl, ...structuredClone(appliedDesign) };
        if (fan) notes.push(...fanOutDesign(p, p.activeLocale, s.slides[i], i, appliedDesign).notes);
        n++;
      });
      return p;
    });
    set({ lastSyncNote: summarizeNotes(notes) });
    return n;
  },

  patchDeviceAllSlides: (patch) => {
    breakUndoCoalescing();
    let n = 0;
    get().mutate((p) => {
      for (const set of Object.values(p.sets)) {
        set.slides.forEach((sl, i) => {
          const dev = sl.device ?? getTheme(sl.themeId).device;
          if (!isDevice3D(dev)) return;
          set.slides[i] = { ...sl, device: { ...dev, ...structuredClone(patch) } };
          n++;
        });
      }
      return p;
    });
    return n;
  },

  toggleDesignLock: (locale, designKey) => {
    breakUndoCoalescing();
    get().mutate((p) => {
      const locks = (p.designLocks ??= {});
      const list = locks[locale] ?? [];
      const next = list.includes(designKey)
        ? list.filter((k) => k !== designKey)
        : [...list, designKey];
      if (next.length) locks[locale] = next;
      else delete locks[locale];
      return p;
    });
  },

  addSlideAllLocales: (afterDesignKey) => {
    breakUndoCoalescing();
    const newId = uid();
    const newKey = uid();
    const out: { notes: SyncNote[] } = { notes: [] };
    get().mutate((p) => {
      const src = p.sets[p.activeLocale];
      if (!src) return p;
      let ai = afterDesignKey ? src.slides.findIndex((s) => s.designKey === afterDesignKey) : -1;
      if (ai < 0) ai = src.slides.length - 1;
      const anchor: Slide | undefined = src.slides[ai];
      // Aktif dilde: çapanın TAM kopyası, metinler sıfır (addSlide semantiği).
      const base: Slide = anchor
        ? {
            ...structuredClone(anchor),
            id: newId,
            designKey: newKey,
            headline: L("Başlık", "Headline"),
            sub: "",
            badge: undefined,
            needsCopy: undefined,
          }
        : { ...newSlide(), id: newId, designKey: newKey };
      src.slides.splice(ai + 1, 0, base);

      const anchorKey = anchor?.designKey;
      const design = pickDesign(base);
      for (const [loc, set] of Object.entries(p.sets)) {
        if (loc === p.activeLocale) continue;
        // Yeni slaytın hedefte karşılığı YOK → projeksiyon hedefsiz koşar
        // (font koruması korunacak değer bulamaz, tema fontuna düşer + not).
        const r = projectPatch(design, p.activeLocale, loc, undefined);
        out.notes.push(...r.notes);
        const copy: Slide = {
          ...structuredClone(base),
          ...structuredClone(r.patch),
          id: uid(),
          designKey: newKey,
          // Metin kaynaktan kopyalandı: film şeridinde amber köşe.
          needsCopy: true,
        };
        const ti = anchorKey ? set.slides.findIndex((s) => s.designKey === anchorKey) : -1;
        if (ti >= 0) set.slides.splice(ti + 1, 0, copy);
        else set.slides.push(copy); // çapa o dilde yoksa sona
      }
      return p;
    });
    set({ activeSlideId: newId, selectedElementId: null, selectedLayerId: null, cropEditing: false, lastSyncNote: summarizeNotes(out.notes) });
  },

  removeSlideAllLocales: (designKey) => {
    breakUndoCoalescing();
    get().mutate((p) => {
      for (const set of Object.values(p.sets)) {
        if (set.slides.length <= 1) continue; // hiçbir dil boş kalmaz
        const i = set.slides.findIndex((s) => s.designKey === designKey);
        if (i >= 0) set.slides.splice(i, 1);
      }
      for (const [loc, list] of Object.entries(p.designLocks ?? {})) {
        const next = list.filter((k) => k !== designKey);
        if (next.length) p.designLocks![loc] = next;
        else delete p.designLocks![loc];
      }
      return p;
    });
  },

  clearSyncNote: () => set({ lastSyncNote: null }),

  /* ---------------------------------------------------------------- *
     C21-C23 — çoklu seçim · toplu işlem · pano
     Toplu işlemlerin HEPSİ tek `mutate` içinde koşar: N slayt × 15 dil
     TEK anlık görüntü, TEK ⌘Z. (`applyDesignToAllLocales` deseninin
     seçime genelleştirilmiş hâli.)
   * ---------------------------------------------------------------- */

  setSelection: (ids) => {
    const st = get();
    const list = st.project.sets[st.project.activeLocale]?.slides ?? [];
    const want = new Set(ids);
    set({ selectedIds: list.filter((x) => want.has(x.id)).map((x) => x.id) });
  },

  toggleSelected: (id) => {
    const st = get();
    const has = st.selectedIds.includes(id);
    const next = has ? st.selectedIds.filter((x) => x !== id) : [...st.selectedIds, id];
    // Seçime EKLERKEN aktif slayt da o kart olur: Inspector kullanıcının en
    // son dokunduğu kartı gösterir. Çıkarırken aktif YERİNDE kalır — aksi
    // hâlde ⌘+tık ile bir kartı seçimden çıkarmak kuyudaki resmi değiştirirdi.
    set(has ? { selectedIds: next } : { selectedIds: next, activeSlideId: id, selectedElementId: null, selectedLayerId: null, cropEditing: false });
  },

  selectRange: (toId, fromId) => {
    const st = get();
    const list = st.project.sets[st.project.activeLocale]?.slides ?? [];
    const to = list.findIndex((x) => x.id === toId);
    if (to < 0) return;
    // Çapa = açık verilen · yoksa aktif slayt · yoksa seçimin ilki · yoksa tıklanan.
    const anchorId = fromId ?? st.activeSlideId ?? st.selectedIds[0] ?? toId;
    let from = list.findIndex((x) => x.id === anchorId);
    if (from < 0) from = to;
    const [a, b] = from <= to ? [from, to] : [to, from];
    set({
      selectedIds: list.slice(a, b + 1).map((x) => x.id),
      activeSlideId: toId,
      selectedElementId: null,
      selectedLayerId: null,
      cropEditing: false,
    });
  },

  selectAllSlides: () => {
    const st = get();
    const list = st.project.sets[st.project.activeLocale]?.slides ?? [];
    set({ selectedIds: list.map((x) => x.id) });
  },

  clearSelection: () => {
    if (!get().selectedIds.length) return; // gereksiz render dalgası yok
    set({ selectedIds: [] });
  },

  applyDesignToSelected: (patch, opts) => {
    patch = themeSelectionPatch(patch);
    const st = get();
    const ids = bulkTargetIds(st);
    if (!ids.length) return 0;
    const { design, content } = splitPatch(patch);
    const dKeys = Object.keys(design);
    const fan =
      !opts?.localOnly &&
      st.project.syncDesign !== false &&
      dKeys.length > 0 &&
      Object.keys(st.project.sets).length > 1;
    // R9: Inspector çoklu seçimde HER kontrolü buradan geçiriyor. Katlama
    // anahtarı verilirse slider sürüklemesi tek adım kalır (tek slayttaki
    // davranışın aynısı); verilmezse eski davranış — her çağrı yeni adım.
    if (!opts?.coalesceKey) breakUndoCoalescing();
    const notes: SyncNote[] = [];
    let n = 0;
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      for (const id of ids) {
        const i = s.slides.findIndex((x) => x.id === id);
        if (i < 0) continue;
        // Sıra `updateSlide` ile aynı: önce içerik, sonra tasarım (KARIŞIK
        // alanlarda — ornament/elements — tasarım değeri kazanır).
        s.slides[i] = {
          ...s.slides[i],
          ...structuredClone(content),
          ...structuredClone(design),
        };
        if ("headline" in content || "sub" in content) delete s.slides[i].needsCopy;
        if (fan) notes.push(...fanOutDesign(p, p.activeLocale, s.slides[i], i, design).notes);
        n++;
      }
      return p;
    }, true, opts?.coalesceKey);
    set({ lastSyncNote: summarizeNotes(notes) });
    return n;
  },

  duplicateSelected: () => {
    const st = get();
    const ids = bulkTargetIds(st);
    if (!ids.length) return 0;
    breakUndoCoalescing();
    const made: string[] = [];
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      const pick = new Set(ids);
      const out: Slide[] = [];
      for (const sl of s.slides) {
        out.push(sl);
        // Kopya = YENİ tasarım satırı (duplicateSlide semantiği): yeni
        // designKey, yani diğer dillerde karşılığı YOK.
        if (pick.has(sl.id)) {
          const c: Slide = { ...structuredClone(sl), id: uid(), designKey: uid() };
          out.push(c);
          made.push(c.id);
        }
      }
      s.slides = out;
      return p;
    });
    // Kopyalar yeni seçim olur — "çoğalt, sonra hepsine tema uygula" akışı.
    set({ selectedIds: made, activeSlideId: made[0] ?? st.activeSlideId, selectedElementId: null, selectedLayerId: null, cropEditing: false });
    return made.length;
  },

  removeSelected: () => {
    const st = get();
    const ids = bulkTargetIds(st);
    const list = st.project.sets[st.project.activeLocale]?.slides ?? [];
    // Hiçbir dil BOŞ kalmaz (removeSlide'ın `length > 1` güvencesinin
    // seçime genelleştirilmiş hâli): tümü seçiliyse işlem hiç koşmaz.
    if (!ids.length || ids.length >= list.length) return 0;
    breakUndoCoalescing();
    const first = Math.min(...ids.map((id) => list.findIndex((x) => x.id === id)).filter((i) => i >= 0));
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      const kill = new Set(ids);
      const keep = s.slides.filter((x) => !kill.has(x.id));
      if (!keep.length) return p;
      s.slides = keep;
      return p;
    });
    // Aktif slayt silinmiş olabilir → silinen bloğun yerine geçen karta düş.
    const after = get().project.sets[get().project.activeLocale]?.slides ?? [];
    set({
      selectedIds: [],
      activeSlideId: after[Math.min(first, after.length - 1)]?.id ?? null,
      selectedElementId: null,
      selectedLayerId: null,
      cropEditing: false,
    });
    return ids.length;
  },

  /* ---------------------------------------------------------------- *
     C23 — YAPIŞTIRMA VE designKey ÇAKIŞMASI

     Panodaki slayt `designKey`ini KORUR: diller arası kimlik budur, tr'de
     düzenlenen tasarım en-US'taki kopyaya bu anahtar üzerinden yayılır
     (`fanOutDesign` → `matchIndex`).

     ÇAKIŞMA KURALI (uygulanan): anahtar hedef dilde ZATEN varsa hedefteki
     slayt EZİLMEZ; yeni slayt TAZE bir anahtarla eklenir.
     Gerekçe — bir sette aynı anahtardan İKİ satır olması sessiz bozulma
     üretir: `matchIndex` (findIndex) hep ilkini bulur, ikinci satır yayılıma
     görünmez olur; `syncOrder` ikisine aynı rütbeyi verir; `removeSlideAllLocales`
     yalnız ilkini siler. "Var olanı değiştir" seçeneği ise yapıştırmayı sessiz
     bir YIKIM hâline getirirdi (hedefin metni + tasarımı gider) — yapıştırma
     EKLEME işlemidir, üzerine yazma değil.

     Aynı toplu yapıştırmada iki kaynak slayt aynı anahtarı taşıyorsa
     (ör. iki kez ⌘V) ikincisi de taze anahtar alır: `used` kümesi hem hedefin
     mevcut anahtarlarını hem bu partide ÜRETİLENLERİ tutar.
   * ---------------------------------------------------------------- */
  pasteSlides: () => {
    const clip = slideClip;
    const st = get();
    const loc = st.project.activeLocale;
    if (!clip || !clip.slides.length || !st.project.sets[loc]) {
      return { inserted: 0, fresh: 0, cross: false };
    }
    const cross = clip.locale !== loc;
    breakUndoCoalescing();
    const ids: string[] = [];
    let fresh = 0;
    get().mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (!s) return p;
      const used = new Set(s.slides.map((x) => x.designKey).filter(Boolean) as string[]);
      let at = st.activeSlideId ? s.slides.findIndex((x) => x.id === st.activeSlideId) : -1;
      if (at < 0) at = s.slides.length - 1; // aktif yoksa sona ekle
      const batch: Slide[] = [];
      for (const src of clip.slides) {
        const copy = structuredClone(src) as Slide;
        copy.id = uid(); // id HER ZAMAN taze: id dile özeldir, asla taşınmaz
        const key = copy.designKey;
        if (!key || used.has(key)) {
          copy.designKey = uid();
          fresh++;
        }
        used.add(copy.designKey!);
        // Metin kaynak DİLDEN geldi → "çevrilmedi" bayrağı (amber köşe).
        // Aynı dile yapıştırma sıradan bir çoğaltmadır, bayrak basılmaz.
        if (cross) copy.needsCopy = true;
        else delete copy.needsCopy;
        batch.push(copy);
        ids.push(copy.id);
      }
      s.slides.splice(at + 1, 0, ...batch);
      // syncOrder BİLEREK koşmuyor: o, KAYNAK dilin sırasını diğer dillere
      // BASAR. Yapıştırma yerel bir ekleme kararıdır; burada çağırmak
      // tr'yi en-US'un sırasına göre yeniden dizerdi. Kullanıcı sırayı
      // önemsiyorsa sürükleyerek taşır — `moveSlide` senkronu zaten koşturur.
      return p;
    });
    set({ selectedIds: ids, activeSlideId: ids[0] ?? st.activeSlideId, selectedElementId: null, selectedLayerId: null, cropEditing: false });
    return { inserted: ids.length, fresh, cross };
  },

  undo: () => {
    breakUndoCoalescing(); // geri aldıktan sonraki düzenleme yeni adım açsın
    set((st) => {
      const prev = st.past[st.past.length - 1];
      if (!prev) return st;
      return { project: prev, past: st.past.slice(0, -1), future: [st.project, ...st.future].slice(0, 60) };
    });
  },
  redo: () => {
    breakUndoCoalescing();
    set((st) => {
      const next = st.future[0];
      if (!next) return st;
      return { project: next, past: [...st.past, st.project].slice(-60), future: st.future.slice(1) };
    });
  },
}));

/* ------------------------------------------------------------------ *
   Sapma göstergesi — Inspector için tek satırlık soru
 * ------------------------------------------------------------------ */

/**
 * Bu tasarım alanı diğer dillerdeki kardeşlerinden AYRIŞMIŞ mı?
 * true → Inspector alanı turuncu çerçeveyle işaretler ve "temele dön"
 * (= `applyDesignToAllLocales(slide.id)`) sunar.
 *
 * Kardeşin değeri karşılaştırmadan önce bu dile PROJEKTE edilir; ar-SA'nın
 * meşru ayna hizası veya ja'nın korunmuş fontu sahte sapma saymaz.
 * Render sırasında değil, alan başına çağrılacak kadar ucuz (15 dil × küçük
 * nesne); yine de her karede değil, Inspector çiziminde çağırın.
 */
export function fieldDrift(slide: Slide, field: keyof Slide): boolean {
  const p = useStudio.getState().project;
  if (Object.keys(p.sets).length < 2) return false;
  return driftOf(p, p.activeLocale, slide, field);
}
