// Ekran görüntüsü — DİLLER ARASI MANTIKSAL ANAHTAR.
//
// Bir slaytın `screenshot` alanı yalnız bir URL taşır (`/api/shots/<sha1>.png`);
// hash yol+boyut+mtime'dan üretildiği için içinden dil ya da dosya adı geri
// okunamaz. Kökeni saklayan tek yer proje havuzudur:
//
//   Project.screenshots[] = { id, name, dataUrl }
//   name = "<dil>/<dosya>"   ör. "tr/11-camiler.png", "de-DE/11-camiler.png"
//
// (Ad ingest yürüyüşünde `path.relative(imgRoot, abs)` ile kuruluyor, yani dil
// kovasındaki her görselin başında kendi dil klasörü var.)
//
// Buradaki iş: URL → mantıksal ad → BAŞKA bir dildeki karşılığı. Böylece
// kullanıcı Türkçe slaytta harita ekranını değiştirdiğinde diğer 25 dile
// o dilin KENDİ harita görseli gider, Türkçe dosya değil.
//
// NEDEN AYRI DOSYA: aynı mantık içe aktarma sihirbazında da yaşıyor
// (components/wizard/types.ts — kare override'ları). Store ve sihirbaz aynı
// kaynağı kullansın diye ortak yere alındı; wizard oradan yeniden ihraç eder.

import type { Screenshot } from "@/engine/types";

/** Ters bölüyü düzleştirir — adlar her yerde tek biçim olsun. */
export const slash = (s: string): string => s.replace(/\\/g, "/");

/**
 * `"tr/01-remote.png"` + `"tr"` → `"01-remote.png"`.
 * Ad o dilin kovasına ait değilse null (ortak havuz görseli).
 * Karşılaştırma büyük/küçük harf duyarsız: `ar-sa/` klasörü `ar-SA` dilini karşılar.
 */
export function bucketRelName(name: string, locale: string): string | null {
  const norm = slash(name);
  const i = norm.indexOf("/");
  if (i <= 0) return null;
  if (norm.slice(0, i).toLowerCase() !== locale.toLowerCase()) return null;
  const rest = norm.slice(i + 1);
  return rest || null;
}

/** Kullanıcıya gösterilecek kısa dosya adı. */
export const shortName = (name: string): string => slash(name).split("/").pop() || name;

/* ------------------------------------------------------------------ *
   Havuz sorguları
 * ------------------------------------------------------------------ */

/** URL → havuz kaydı. Bulunamazsa null (elle yapıştırılmış data: URL olabilir). */
export function poolEntry(pool: Screenshot[], url: string | undefined): Screenshot | null {
  if (!url) return null;
  return pool.find((s) => s.dataUrl === url) ?? null;
}

/**
 * Bir görselin BİR BAŞKA dildeki karşılığını bulur.
 *
 * Dönüş:
 *   { url }        → hedef dilde karşılığı var, bunu kullan
 *   { url, shared:true } → görsel bir dil kovasına ait değil (ortak havuz ya da
 *                    sürükle-bırak); aynı dosya her dil için doğru, aynen geçer
 *   null           → kovaya ait ama hedef dilde eşi yok; çağıran karar verir
 *                    (yerinde bırak + künyeye not düş)
 */
export function twinForLocale(
  pool: Screenshot[],
  url: string | undefined,
  fromLocale: string,
  toLocale: string
): { url: string; shared?: boolean } | null {
  if (!url) return null;
  const entry = poolEntry(pool, url);
  // Havuzda yoksa kökeni bilinmiyor — dile özel olduğunu varsayamayız, aynen geçir.
  if (!entry) return { url, shared: true };

  const rel = bucketRelName(entry.name, fromLocale);
  if (rel === null) return { url, shared: true }; // kovasız görsel: her dilde aynı

  const want = `${toLocale}/${rel}`.toLowerCase();
  const twin = pool.find((s) => slash(s.name).toLowerCase() === want);
  return twin ? { url: twin.dataUrl } : null;
}
