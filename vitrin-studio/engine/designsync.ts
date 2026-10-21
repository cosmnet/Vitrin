// Diller arası TASARIM SENKRONU — R7 / Wave-1b.
//
// Model A (bkz. PLAN-R7 §0.4): proje `Record<locale, SetPlan>` olarak KALIR;
// normalize edilmiş ortak bir "DesignPlan" YOK. Bunun yerine burada bir
// yayılım (fan-out) motoru var: bir dilde yapılan TASARIM düzenlemesi diğer
// dillerin AYNI `designKey`li slaytlarına projekte edilir. Metin, ekran
// görüntüsü ve çelenk METNİ asla yayılmaz.
//
// Neden Model A: render.ts / export.ts / thumbs.ts her dil için gerçek bir
// `SetPlan` görmeye devam eder — materialize() katmanı yok, migrasyon yok,
// undo yığını el değmemiş kalır. Bedeli "sapma" (drift): iki dil ayrışabilir.
// Panzehiri `applyDesignToAllLocales` + Inspector'daki turuncu sapma çerçevesi
// (bkz. `fieldDrift`).
//
// SİMETRİK: "ana dil" kavramı yok. HANGİ dilde düzenleme yapılırsa kaynak
// odur, diğer 14'ü hedeftir. Kullanıcı yarın en-US'a bakarken cihazın yanlış
// eğildiğini fark edebilir; o düzeltmenin de yayılması gerekir.
//
// Bu modül BİLEREK bağımlılık-hafiftir: yalnız ./fonts ve ./types. DOM yok,
// store yok, React yok — node altında düz çalışır (birim testi böyle koşuyor).

import { L } from "@/lib/i18n";
import {
  familyForLocale,
  fontCoversLocale,
  isCaselessScript,
  isRtlLocale,
  scriptForLocale,
} from "./fonts";
import type { Project, SetPlan, Slide, SlideElement, TextStyle } from "./types";

/* ------------------------------------------------------------------ *
   1. Alan partisyonu
 * ------------------------------------------------------------------ */

/**
 * YAYILAN alanlar — "slaytın giysisi". engine/templates.ts'teki `SlideStyle`
 * ("metin dışındaki her şey") ile aynı ayrımın genişletilmiş hâli; oradaki
 * `restyleSlides` de tam bu kümeyi türetilmiş sayıp temizler.
 *
 * `ornament` HEM tasarım hem içerik taşır (kind = tasarım, text = içerik),
 * bu yüzden aşağıda MIXED_FIELDS'te de yer alır; projeksiyon yalnız `kind`i
 * geçirir (bkz. projectPatch).
 */
export const DESIGN_FIELDS: ReadonlySet<keyof Slide> = new Set<keyof Slide>([
  "themeId",
  "layout",
  "background",
  "bgFx",
  // R9: ışık halkası (varsayılan kapalı). Saf tasarım — içerik taşımaz.
  "glow",
  "grade",
  "device",
  "hideDevice",
  "deviceOffset",
  "device2Offset",
  "device3Offset",
  "textOffset",
  "textBoxes",
  "layerStates",
  "themeElementOverrides",
  "headlineStyle",
  "subStyle",
  "ornament",
  // R8/W2: serbest öğeler. HAM olarak yayılamaz (alanın tamamı ezilir, çeviri
  // metni uçar) — MIXED_FIELDS'te id-bazlı birleştiriciden geçer.
  "elements",
  // R8/W4: slayt bazlı bitirici override'ı (gren/vignette/doku). Saf tasarım —
  // içerik taşımaz, olduğu gibi yayılır.
  "overlay",
  // R8/W5: app preview video çekimi (süre/hareket/bekleme). Saf tasarım;
  // makara ritmi tek dilde kurulur, 15 dilde aynı olur.
  "videoShot",
]);

/** Hem tasarım hem içerik olan alanlar — kaynağa tam, hedefe süzülmüş gider. */
export const MIXED_FIELDS: ReadonlySet<keyof Slide> = new Set<keyof Slide>([
  "ornament",
  "elements",
]);

/**
 * ASLA yayılmayan alanlar. (Belge amaçlı: splitPatch "DESIGN_FIELDS'te
 * olmayan her şey içeriktir" kuralıyla çalışır, bu liste onun aynası.)
 *   id / designKey → kimlik, dile özel
 *   headline / sub / badge → çeviri
 *   screenshot / screenshot2 → dilin kendi ekran görüntüsü
 *   needsCopy → dile özel "çevrilmedi" bayrağı
 *   ornament.text → çelenk metni de çeviridir
 *   elements[].text / elements[].src → öğe metni çeviri, öğe görseli dile özel
 */
export const CONTENT_FIELDS: ReadonlySet<keyof Slide> = new Set<keyof Slide>([
  "id",
  "designKey",
  "headline",
  "sub",
  "badge",
  "screenshot",
  "screenshot2",
  "screenshot3",
  "needsCopy",
  "ornament",
  "elements",
]);

function put(dst: Partial<Slide>, k: keyof Slide, v: unknown): void {
  (dst as Record<string, unknown>)[k] = v;
}

/**
 * Bir Inspector yamasını tasarım ve içerik parçalarına ayırır.
 * `undefined` DEĞERLİ anahtarlar korunur ("override'ı temizle" demektir),
 * o yüzden `Object.keys` ile dolaşılır, truthy kontrolüyle değil.
 */
export function splitPatch(patch: Partial<Slide>): {
  design: Partial<Slide>;
  content: Partial<Slide>;
} {
  const design: Partial<Slide> = {};
  const content: Partial<Slide> = {};
  for (const k of Object.keys(patch) as (keyof Slide)[]) {
    const v = (patch as Record<string, unknown>)[k];
    const isDesign = DESIGN_FIELDS.has(k);
    if (isDesign) put(design, k, v);
    if (!isDesign || MIXED_FIELDS.has(k)) put(content, k, v);
  }
  return { design, content };
}

/** Slayttan tasarım alanlarını (yalnız VAR OLANLARI) kopyalar. */
export function pickDesign(slide: Slide): Partial<Slide> {
  const out: Partial<Slide> = {};
  for (const k of DESIGN_FIELDS) {
    if (k in slide) put(out, k, (slide as Record<string, unknown>)[k]);
  }
  return structuredClone(out);
}

/* ------------------------------------------------------------------ *
   2. Notlar (toast ham verisi)
 * ------------------------------------------------------------------ */

export type SyncNoteKind = "unmatched" | "locked" | "font" | "uppercase" | "noShot";

export type SyncNote = {
  kind: SyncNoteKind;
  /** Etkilenen HEDEF dil. */
  locale: string;
  /** font: bu dil için önerilen yedek aile. */
  detail?: string;
};

/**
 * Notları tek satırlık Türkçe künyeye indirger — store `lastSyncNote`e yazar,
 * toast'ı W3 basar. Örn: "3 dilde eşleşen slayt yok · ar-SA: font kapsamıyor".
 */
export function summarizeNotes(notes: SyncNote[]): string | null {
  const unmatched = new Set<string>();
  const locked = new Set<string>();
  const font = new Set<string>();
  const upper = new Set<string>();
  const noShot = new Set<string>();
  for (const n of notes) {
    if (n.kind === "unmatched") unmatched.add(n.locale);
    else if (n.kind === "locked") locked.add(n.locale);
    else if (n.kind === "font") font.add(n.locale);
    else if (n.kind === "noShot") noShot.add(n.locale);
    else upper.add(n.locale);
  }
  const parts: string[] = [];
  if (unmatched.size) parts.push(L(`${unmatched.size} dilde eşleşen slayt yok`, `${unmatched.size} languages have no matching slide`));
  if (locked.size) parts.push(L(`${locked.size} dilde tasarım kilitli`, `design locked in ${locked.size} languages`));
  if (font.size) parts.push(L(`${[...font].join(", ")}: font kapsamıyor`, `${[...font].join(", ")}: font lacks coverage`));
  if (upper.size) parts.push(L(`${[...upper].join(", ")}: büyük harf atlandı`, `${[...upper].join(", ")}: uppercase skipped`));
  if (noShot.size) parts.push(L(`${noShot.size} dilde bu ekranın karşılığı yok`, `${noShot.size} languages have no counterpart for this screen`));
  return parts.length ? parts.join(" · ") : null;
}

/* ------------------------------------------------------------------ *
   3. Projeksiyon — kaynak dilden hedef dile dönüşümler
 * ------------------------------------------------------------------ */

export type ProjectResult = {
  /** Hedef slayta uygulanacak yama. */
  patch: Partial<Slide>;
  notes: SyncNote[];
};

const MIRROR_ALIGN: Record<string, TextStyle["align"]> = {
  left: "right",
  right: "left",
  center: "center",
};

/**
 * Metin stili projeksiyonu.
 *
 * DİKKAT — yama semantiği: Inspector `up({ headlineStyle: s })` ile TÜM nesneyi
 * değiştirir (`{...slide, ...patch}`), yani hedefin mevcut `headlineStyle`ı
 * tamamen ezilir. Bu yüzden korunacak alanlar hedefin MEVCUT değerinden geri
 * yazılır; yoksa "koruma" alanı silmek anlamına gelirdi.
 */
function projectTextStyle(
  src: Partial<TextStyle> | undefined,
  cur: Partial<TextStyle> | undefined,
  to: string,
  mirror: boolean,
  notes: SyncNote[]
): Partial<TextStyle> | undefined {
  // undefined = "override'ı temizle" — aynen yayılır.
  if (!src) return src;
  const out: Partial<TextStyle> = { ...src };

  // --- Font: script koruması (rapor §Ambiguous 1) ---
  const keep = cur?.fontFamily;
  if (out.fontFamily !== undefined) {
    // familyForLocale aileyi kapsıyorsa AYNEN, kapsamıyorsa yedek döndürür;
    // farklı dönmesi "bu aile bu dili kapsamıyor" demektir.
    const safe = familyForLocale(out.fontFamily, to);
    if (safe !== out.fontFamily) {
      // Hedefin ailesine DOKUNMA (rapor: "leave the target's family alone").
      if (keep !== undefined) out.fontFamily = keep;
      else delete out.fontFamily;
      notes.push({ kind: "font", locale: to, detail: safe });
    }
  } else if (
    keep !== undefined &&
    scriptForLocale(to) !== "latin" &&
    fontCoversLocale(keep, to)
  ) {
    // Kaynakta aile override'ı YOK ama hedefte var ve hedefin yazısını
    // GERÇEKTEN kapsıyor. Ham kopya onu silip tema fontuna düşürür = tofu.
    // Senkron bir dili okunamaz hâle ASLA getirmemeli → koru + not düş.
    out.fontFamily = keep;
    notes.push({ kind: "font", locale: to, detail: keep });
  }

  // --- Büyük harf: kasasız yazılarda anlamsız, atlanır (rapor §Ambiguous 4) ---
  if (out.transform === "uppercase" && isCaselessScript(scriptForLocale(to))) {
    if (cur?.transform !== undefined) out.transform = cur.transform;
    else delete out.transform;
    notes.push({ kind: "uppercase", locale: to });
  }

  // --- RTL: hizalama aynası (rapor §Ambiguous 3) ---
  if (mirror && out.align) out.align = MIRROR_ALIGN[out.align] ?? out.align;

  return out;
}

/* ------------------------------------------------------------------ *
   Serbest öğeler — id-bazlı birleştirme (r8-a0 §1.2)

   Ham yayılım (`{...t, ...patch}`) öğe dizisini BÜTÜN olarak ezerdi: tr'de
   bir sticker'ı 3px kaydırmak en-US'taki öğe METİNLERİNİ sessizce Türkçeye
   çevirirdi. Bu yüzden `elements` MIXED'tir ve burada id ile birleşir:

     · geometri + stil (x/y/w/h/rotation/opacity/blend/z/style/kind/kilit)
       → TASARIM, hedefe yazılır
     · text / src → İÇERİK, hedefin kendi değeri KORUNUR
     · kaynakta olup hedefte olmayan id → AYNEN eklenir (metniyle birlikte;
       yeni öğenin çevirisi henüz yok, kaynak metin başlangıç noktasıdır)
     · hedefte olup kaynakta olmayan id → SİLİNİR

   Yapısal değişikliğin yayılması `ornament`ten bilerek FARKLIDIR: çelenk
   düzeni etkiler ve açık aksiyon ister; öğe eklemek/silmek ise sıradan bir
   tasarım hamlesidir, 15 dilde elle tekrar edilemez.

   Dizi SIRASI da tasarımdır (z sırası) — kaynağın sırası kazanır.
 * ------------------------------------------------------------------ */

/** Öğenin TASARIM alanları — `text`/`src` bilerek DIŞARIDA. */
const EL_DESIGN_KEYS = [
  "kind",
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "opacity",
  "blend",
  "z",
  "style",
  "hidden",
  "locked",
  "crop",
  "imageFx",
  "name",
] as const;

function elDesign(e: SlideElement): Partial<SlideElement> {
  const out: Record<string, unknown> = {};
  for (const k of EL_DESIGN_KEYS) if (k in e) out[k] = (e as Record<string, unknown>)[k];
  return out as Partial<SlideElement>;
}

/**
 * Kaynak öğe dizisini hedefin diziyle id üzerinden birleştirir.
 * `undefined` (alanı temizle) aynen geçer.
 */
export function mergeElements(
  src: SlideElement[] | undefined,
  cur: SlideElement[] | undefined
): SlideElement[] | undefined {
  if (!src) return src;
  const byId = new Map((cur ?? []).map((e) => [e.id, e]));
  return src.map((e) => {
    const t = byId.get(e.id);
    // Hedefte varsa: hedefin metni/görseli kalır, tasarımı kaynaktan gelir.
    // Yoksa: yeni öğe, tam kopya.
    return t ? { ...t, ...elDesign(e) } : structuredClone(e);
  });
}

/**
 * Tasarım yamasını `from` dilinden `to` diline projekte eder.
 *
 * Dönüşümler:
 *  1. Font script-koruması — kaynak aile hedefin yazısını kapsamıyorsa hedefin
 *     ailesi korunur, not düşülür (asla tofu üretmez).
 *  2. Büyük harf atlama — ar/hi/ja/ko/zh kasasızdır, `transform: "uppercase"`
 *     oraya yazılmaz.
 *  3. RTL aynası — LTR↔RTL sınırı geçilirken `align` left↔right takas edilir ve
 *     `textOffset.x` NEGATİFLENİR. Ayna ekseni METİN KUTUSUNUN merkezidir:
 *     textOffset zaten kutuya GÖRE bir ötelemedir, dolayısıyla kutu merkezine
 *     göre yansıtmak x'in tam olarak işaret değiştirmesi demektir (kutunun
 *     slayt içindeki yeri değişmez — düzenler sabit). y'ye dokunulmaz.
 *     Koşul `isRtlLocale(from) !== isRtlLocale(to)`: tr→ar aynalar, ar→tr geri
 *     aynalar, tr→de dokunmaz. "Hedef RTL ise" kuralı simetrik olmazdı.
 *  4. Çelenk — yalnız `kind`, ve yalnız hedefte ZATEN çelenk varsa. Çelenk
 *     ekleme/kaldırma yapısaldır, açık aksiyonla yapılır (rapor §Ambiguous 6).
 *
 * @param target hedef slayt — koruma/birleştirme için gerekir. Verilmezse
 *        (ör. yeni slayt üretimi) korunacak değer yok sayılır.
 */
export function projectPatch(
  design: Partial<Slide>,
  from: string,
  to: string,
  target?: Slide
): ProjectResult {
  const notes: SyncNote[] = [];
  const patch: Partial<Slide> = structuredClone(design);
  if (from === to) return { patch, notes }; // kimlik — kaynağın kendi seçimi aynen

  const mirror = isRtlLocale(from) !== isRtlLocale(to);

  if (mirror && patch.textOffset) {
    patch.textOffset = { ...patch.textOffset, x: -patch.textOffset.x };
  }

  if ("headlineStyle" in patch) {
    patch.headlineStyle = projectTextStyle(
      patch.headlineStyle,
      target?.headlineStyle,
      to,
      mirror,
      notes
    );
  }
  if ("subStyle" in patch) {
    patch.subStyle = projectTextStyle(patch.subStyle, target?.subStyle, to, mirror, notes);
  }

  if ("ornament" in patch) {
    const src = patch.ornament;
    const cur = target?.ornament;
    if (src && cur) patch.ornament = { ...cur, kind: src.kind }; // yalnız kind
    else delete patch.ornament; // yoktan var etme / varken silme YOK
  }

  if ("elements" in patch) {
    patch.elements = mergeElements(patch.elements, target?.elements);
  }

  return { patch, notes };
}

/* ------------------------------------------------------------------ *
   4. Eşleştirme + yayılım
 * ------------------------------------------------------------------ */

/** Eksik `designKey`leri index'ten tamamlar — ESKİ davranışın birebir aynısı. */
export function ensureDesignKeys(slides: Slide[]): void {
  slides.forEach((s, i) => {
    if (!s.designKey) s.designKey = `i${i}`;
  });
}

/** Projenin tüm setlerinde anahtar tamamlar (loadProject göçü). */
export function backfillDesignKeys(p: Project): Project {
  p.syncDesign ??= true;
  p.designLocks ??= {};
  for (const set of Object.values(p.sets)) ensureDesignKeys(set.slides);
  return p;
}

export function isLocked(p: Project, locale: string, keys: (string | undefined)[]): boolean {
  const list = p.designLocks?.[locale];
  if (!list || !list.length) return false;
  return keys.some((k) => !!k && list.includes(k));
}

/**
 * Hedef sette kaynağın karşılığını bulur.
 * `designKey` varsa ANAHTARLA (index değil — bir dile slayt eklenince eşleşme
 * bozulmasın diye). Anahtar yoksa (editörde üretilmiş, kaydedilmemiş eski
 * proje) index'e düşer — yani bugünkü davranış, hiçbir regresyon yok.
 */
export function matchIndex(set: SetPlan, key: string | undefined, sourceIndex: number): number {
  if (key) return set.slides.findIndex((s) => s.designKey === key);
  return sourceIndex < set.slides.length ? sourceIndex : -1;
}

export type FanOutResult = { notes: SyncNote[]; touched: number };

/**
 * Tasarım yamasını KAYNAK DIŞINDAKİ tüm dillere yayar. `p` YERİNDE değişir —
 * çağıran `mutate` içindedir, yani zaten klonlanmış bir proje üstünde çalışır.
 * Böylece 15 dilin değişimi TEK anlık görüntüye girer: bir ⌘Z hepsini geri alır.
 */
export function fanOutDesign(
  p: Project,
  sourceLocale: string,
  source: Slide,
  sourceIndex: number,
  design: Partial<Slide>
): FanOutResult {
  const notes: SyncNote[] = [];
  let touched = 0;
  if (!Object.keys(design).length) return { notes, touched };

  for (const [loc, set] of Object.entries(p.sets)) {
    if (loc === sourceLocale) continue;
    const i = matchIndex(set, source.designKey, sourceIndex);
    if (i < 0) {
      notes.push({ kind: "unmatched", locale: loc });
      continue;
    }
    const t = set.slides[i];
    if (isLocked(p, loc, [source.designKey, t.designKey])) {
      notes.push({ kind: "locked", locale: loc });
      continue;
    }
    const r = projectPatch(design, sourceLocale, loc, t);
    notes.push(...r.notes);
    // Her hedefe TAZE kopya: structuredClone iç referans paylaşımını korur,
    // aynı `device` nesnesi 15 slayta takılırsa biri değişince hepsi değişir.
    set.slides[i] = { ...t, ...structuredClone(r.patch) };
    touched++;
  }
  return { notes, touched };
}

/**
 * Kaynak dilin sırasını diğer tüm dillere uygular (rapor: "reordered" satırı).
 * Kaynakta bilinmeyen anahtarlar KENDİ göreli sıralarını korur ve bilinen son
 * anahtardan SONRAYA eklenir. Sıralama kararlılığı motora bırakılmaz, index
 * eşitlik-bozucusu ile açıkça garanti edilir.
 */
export function syncOrder(p: Project, sourceLocale: string): void {
  const src = p.sets[sourceLocale];
  if (!src) return;
  const rank = new Map<string, number>();
  src.slides.forEach((s, i) => {
    if (s.designKey && !rank.has(s.designKey)) rank.set(s.designKey, i);
  });
  if (!rank.size) return;
  for (const [loc, set] of Object.entries(p.sets)) {
    if (loc === sourceLocale) continue;
    set.slides = set.slides
      .map((s, i) => ({
        s,
        i,
        r: s.designKey && rank.has(s.designKey) ? rank.get(s.designKey)! : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.s);
  }
}

/* ------------------------------------------------------------------ *
   5. Sapma göstergesi (Inspector — turuncu çerçeve + "temele dön")
 * ------------------------------------------------------------------ */

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = canon(o[k]);
    return out;
  }
  return v;
}

/** Anahtar sırasından bağımsız derin eşitlik (yama nesneleri küçük, ucuz). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** Bu slaytla aynı `designKey`i taşıyan diğer dillerdeki slaytlar. */
export function siblings(
  p: Project,
  locale: string,
  slide: Slide,
  sourceIndex?: number
): { locale: string; slide: Slide }[] {
  const i = sourceIndex ?? p.sets[locale]?.slides.findIndex((s) => s.id === slide.id) ?? -1;
  const out: { locale: string; slide: Slide }[] = [];
  for (const [loc, set] of Object.entries(p.sets)) {
    if (loc === locale) continue;
    const j = matchIndex(set, slide.designKey, i);
    if (j >= 0) out.push({ locale: loc, slide: set.slides[j] });
  }
  return out;
}

/**
 * Bu tasarım alanı kardeş dillerden AYRIŞMIŞ mı? (Inspector turuncu çerçeve)
 *
 * Soru İLERİ yönde sorulur — "şimdi yaysam bir kardeş DEĞİŞİR miydi?" — çünkü
 * yayılımın kendisi kayıplıdır: ar-SA hizayı aynalar, ja fontunu korur, hi
 * kapsanmayan aileyi hiç almaz. Geriye doğru karşılaştırma bu meşru farkları
 * sahte sapma sayardı; ileri karşılaştırma tanım gereği projeksiyonla tutarlı.
 * Yayılmayacak alanlar (ör. kardeşte çelenk yoksa `ornament`) sapma değildir.
 * Kilitli diller kasıtlı ayrıktır, sayılmaz.
 */
export function fieldDrift(
  p: Project,
  locale: string,
  slide: Slide,
  field: keyof Slide
): boolean {
  if (!DESIGN_FIELDS.has(field)) return false;
  if (isLocked(p, locale, [slide.designKey])) return false;
  const one: Partial<Slide> = {};
  put(one, field, (slide as Record<string, unknown>)[field]);
  for (const sib of siblings(p, locale, slide)) {
    if (isLocked(p, sib.locale, [sib.slide.designKey])) continue;
    const { patch } = projectPatch(one, locale, sib.locale, sib.slide);
    if (!(field in patch)) continue; // bu alan o dile hiç yayılmaz
    const want = (patch as Record<string, unknown>)[field];
    if (!sameValue(want, (sib.slide as Record<string, unknown>)[field])) return true;
  }
  return false;
}
