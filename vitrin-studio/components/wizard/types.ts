// İçe Aktarma Sihirbazı v3 — paylaşılan tipler ve saf yardımcılar.
//
// Buradaki her şey DOM'suz ve React'siz: adım bileşenleri de içe aktarma
// yürütücüsü de aynı defteri kullansın, davranış tek yerde tanımlı olsun.
//
// EŞLEŞME OVERRIDE MODELİ (denetim raporu risk #4)
// -----------------------------------------------
// Kullanıcı 3. adımda bir karenin görselini elle değiştirdiğinde bunu URL
// olarak saklamak yanlış olur: `tr/03-add-tv.png` URL'si Japonca sete de
// girerdi. Bu yüzden override KARE NUMARASINA (`f03`) ve görselin DİL KOVASINA
// GÖRE BAĞIL adına (`03-add-tv.png`) yazılır; kurulum anında her dil aynı bağıl
// adı KENDİ kovasında arar. Ortak havuzdan seçilen görsel (dil klasörü dışı)
// bağıl değil birebir addır — o zaten tüm diller için aynı dosyadır.
//
// Kapsam (`scope`): "all" varsayılan ("bu eşleşmeyi tüm dillere uygula"),
// ya da tek bir dil kodu ("sadece bu dil"). Çözümleme önce dile özel, sonra
// genel kaydı arar.

import type { ImageRef, MdFrame } from "@/lib/mdframes";

/* ------------------------------------------------------------------ *
   Sunucu yanıtları
 * ------------------------------------------------------------------ */

export type IngestLocale = { code: string; frames: MdFrame[] };

/** POST /api/ingest yanıtı. */
export type ScanResult = {
  folder: string;
  /** Görsellerin tarandığı kök — shotsRoot verilmediyse folder ile aynı. */
  shotsRoot?: string;
  /** Tek bir .md dosyası işaret edildiyse o dil; sadece o ön-seçilir. */
  pickedLocale?: string;
  locales: IngestLocale[];
  /** ORTAK havuz — dil klasörlerinin DIŞINDA kalan görseller. */
  images: ImageRef[];
  /** locale → o dilin KENDİ klasöründeki görseller (tr/, ar-SA/…). */
  localeImages?: Record<string, ImageRef[]>;
};

export type BrowseDir = {
  name: string;
  hasMd: boolean;
  imgCount: number;
  hasChildren: boolean;
};

/** GET /api/ingest?browse=<dir> yanıtı. */
export type BrowseResult = {
  path: string;
  parent: string | null;
  home: string;
  dirs: BrowseDir[];
  mdFiles: string[];
  imgCount: number;
  truncated?: boolean;
};

/* ------------------------------------------------------------------ *
   Küçük yardımcılar
 * ------------------------------------------------------------------ */

/** İki haneli kare etiketi — "01", "07". */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** MD kare numarası → diller arası eşleştirme anahtarı. */
export const designKeyOf = (no: number): string => `f${pad2(no)}`;

// slash / bucketRelName / shortName ARTIK lib/shotkey.ts'te yaşıyor: aynı
// mantığı store da (diller arası ekran yayılımı) kullanıyor, iki kopya
// tutulursa kaçınılmaz olarak ayrışırlar.
import { bucketRelName, shortName, slash } from "@/lib/shotkey";

export { bucketRelName, shortName, slash };

/* ------------------------------------------------------------------ *
   Override defteri
 * ------------------------------------------------------------------ */

export type FrameOverride = {
  /** Bağıl (ya da ortak) ad. `null` = kullanıcı bu kareyi bilerek BOŞALTTI. */
  rel: string | null;
  /** true → `rel` bir dil kovasına göre bağıl; false → ortak havuz adı. */
  bucketRel: boolean;
  /** Kullanıcının gerçekten tıkladığı dosya — hedef dilde karşılığı yoksa buna düşülür. */
  srcUrl?: string;
  srcName?: string;
};

/** Anahtar: `${scope}:${designKey}` — scope "all" ya da dil kodu. */
export type OverrideMap = Record<string, FrameOverride>;

export const ovKey = (scope: string, designKey: string): string => `${scope}:${designKey}`;

/** Bu dil + kare için yürürlükteki override: önce dile özel, sonra genel. */
export function overrideFor(
  map: OverrideMap,
  locale: string,
  designKey: string
): { ov: FrameOverride; scope: "all" | string } | null {
  const own = map[ovKey(locale, designKey)];
  if (own) return { ov: own, scope: locale };
  const all = map[ovKey("all", designKey)];
  if (all) return { ov: all, scope: "all" };
  return null;
}

/**
 * Override'ı bir dilde gerçek görsele çevirir.
 *   · `rel === null`            → null (kare bilerek boş)
 *   · bağıl ad + dil kovası     → o dilin KENDİ dosyası
 *   · ortak ad                  → havuzda birebir ad
 *   · hiçbiri tutmazsa          → kullanıcının tıkladığı dosyanın kendisi
 *     (dilin kovasında o dosya yoksa bile görsel boş kalmasın; kullanıcı 3.
 *      adımda dili değiştirince ne olduğunu görür)
 */
export function resolveOverride(
  ov: FrameOverride,
  locale: string,
  res: ScanResult
): ImageRef | null {
  if (ov.rel === null) return null;

  if (ov.bucketRel) {
    for (const im of res.localeImages?.[locale] ?? []) {
      if (bucketRelName(im.name, locale) === ov.rel) return im;
    }
  } else {
    for (const im of res.images) if (slash(im.name) === ov.rel) return im;
    for (const list of Object.values(res.localeImages ?? {})) {
      for (const im of list) if (slash(im.name) === ov.rel) return im;
    }
  }

  return ov.srcUrl ? { name: ov.srcName ?? ov.srcUrl, url: ov.srcUrl } : null;
}

/** Bir görselden override kaydı üretir (dil kovasındaysa bağıl, değilse birebir). */
export function overrideFromImage(image: ImageRef, locale: string): FrameOverride {
  const rel = bucketRelName(image.name, locale);
  return rel
    ? { rel, bucketRel: true, srcUrl: image.url, srcName: image.name }
    : { rel: slash(image.name), bucketRel: false, srcUrl: image.url, srcName: image.name };
}

/* ------------------------------------------------------------------ *
   Son kullanılanlar (localStorage)
 * ------------------------------------------------------------------ */

export const FOLDER_KEY = "vitrin.ingest.folder";
export const SHOTS_KEY = "vitrin.ingest.shotsRoot";
export const RECENTS_KEY = "vitrin.ingest.recents";
const RECENTS_MAX = 5;

export type Recent = { path: string; shotsRoot?: string; at: number };

export function readRecents(): Recent[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is Recent => !!r && typeof (r as Recent).path === "string")
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function pushRecent(path: string, shotsRoot?: string): Recent[] {
  const next: Recent[] = [
    { path, shotsRoot: shotsRoot || undefined, at: Date.now() },
    ...readRecents().filter((r) => r.path !== path),
  ].slice(0, RECENTS_MAX);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage kapalı olabilir — sorun değil */
  }
  return next;
}
