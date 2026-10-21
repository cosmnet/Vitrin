// Tam çözünürlük export: her slaytı seçili boyutlarda basar, sunucuya yazdırır.
//
// R7 / Wave-5 — MATRİS EKLERİ (hepsi TOPLAMSAL)
// İkinci parametre artık ya eski `ExportSizeId[]` ya da bir seçenek nesnesidir:
//
//   exportSet(plan, ["iphone-69"], onProgress)           // ESKİ çağrı — birebir aynı
//   exportSet(plan, { sizes, indexes, nameFor, subPath, shouldCancel, onProgress })
//
// Yeni alanlar:
//   indexes      — yalnız bu slayt index'leri basılır (numaralandırma ORİJİNAL
//                  index'ten gelir, yani 3. slayt alt kümede de "03" kalır).
//   nameFor      — dosya adı üreticisi (fastlane `NN_slug.png` için).
//   subPath      — `<app>/` altındaki alt yol ("screenshots/tr"). Verilmezse
//                  bugünkü `<app>/<locale>/` düzeni korunur.
//   shouldCancel — her slayttan ÖNCE sorulur; true dönerse iş o slaytta durur,
//                  o ana kadar basılanlar yine de yazılır (emek çöpe gitmez).

import { L } from "@/lib/i18n";
import { renderSlide } from "./render";
import { EXPORT_SIZES, FORMATS, type ExportSizeId, type Format, type SetPlan, type Slide } from "./types";

export type ExportProgress = { done: number; total: number; current: string };

/** Dosya adı üreticisi. `i` = slaytın SET İÇİNDEKİ orijinal index'i (0 tabanlı). */
export type ExportNameFor = (i: number, slide: Slide, sizeId: ExportSizeId) => string;

export type ExportSetOpts = {
  /** Basılacak boyutlar. Yoksa proje formatının varsayılan boyutu. */
  sizes?: ExportSizeId[];
  /** Yalnız bu index'ler. Yoksa setin tamamı. */
  indexes?: number[];
  /** Dosya adı üreticisi. Yoksa bugünkü `NN.png` / `<size>/NN.png`. */
  nameFor?: ExportNameFor;
  /** `~/Desktop/Vitrin/<app>/` altındaki alt yol. Yoksa `<locale>`. */
  subPath?: string;
  /** Her slayttan önce sorulur — true = "bu slayttan sonra dur". */
  shouldCancel?: () => boolean;
  /** İlerleme geri çağrısı (3. parametre verilirse o kazanır). */
  onProgress?: (p: ExportProgress) => void;
  /** Proje formatı — render'ın BASE tabanı ve varsayılan boyut (iPad → ipad-13). */
  format?: Format;
};

export type ExportResult = {
  ok: boolean;
  path?: string;
  error?: string;
  /** Sunucunun gerçekten yazdığı dosya sayısı. */
  written?: number;
  /** Basılan göreli dosya adları — matris özetini kurar. */
  files?: string[];
  /** shouldCancel true döndüğü için erken bitti. */
  cancelled?: boolean;
};


/* ------------------------------------------------------------------ *
   fastlane dosya adı sözlüğü (rakip raporu §2 — birebir uygulanır)

   • Sıra = LEKSİKAL dosya adı sırası ⇒ `NN_` sıfır dolgulu ön ek şart.
   • Cihaz dosya adından DEĞİL piksel boyutundan çıkarılır ⇒ dil klasörü
     düzdür, cihaz alt klasörü YOKTUR.
   • Slug ASCII'dir: Türkçe/Arapça/CJK başlıklar `deliver`'ın okuduğu
     dosya adına taşınmaz, taşınırsa bazı dosya sistemlerinde sıra bozulur.
 * ------------------------------------------------------------------ */

/** Boyut → dosya adı eki. Zorunlu 6.9" eksizdir; ekstralar bununla ayrılır. */
export const SIZE_SUFFIX: Record<ExportSizeId, string> = {
  "iphone-69": "iphone69",
  "iphone-65": "iphone65",
  "ipad-13": "ipad13",
  "ipad-13-land": "ipad13land",
  "duo-inner": "duoinner", "duo-inner-land": "duoinnerland", "duo-outer": "duoouter", "duo-outer-land": "duoouterland",
};

// toUpperCase/normalize'ın çözemediği harfler (ı/İ NFD'de ayrışmaz).
const SLUG_MAP: Record<string, string> = {
  ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g",
  ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c",
  ß: "ss", æ: "ae", ø: "o", å: "a", ð: "d", þ: "th",
};

/**
 * Başlıktan leksikal-güvenli ASCII slug. Boş kalırsa (Arapça/CJK başlık)
 * `fallback` döner — çağıran genelde `designKey`i ("f01") verir.
 */
export function asciiSlug(text: string, fallback = "screen", maxLen = 32): string {
  const mapped = Array.from(String(text || ""))
    .map((c) => SLUG_MAP[c] ?? c)
    .join("");
  const slug = mapped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // birleşen aksanlar
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || asciiSlug(fallback, "screen", maxLen) || "screen";
}

export async function exportSet(
  plan: SetPlan,
  sizesOrOpts?: ExportSizeId[] | ExportSetOpts,
  onProgress?: (p: ExportProgress) => void
): Promise<ExportResult> {
  const opts: ExportSetOpts = Array.isArray(sizesOrOpts) ? { sizes: sizesOrOpts } : sizesOrOpts ?? {};
  const fmt: Format = opts.format ?? "iphone";
  // Varsayılan boyut formatın zorunlu App Store yuvası: iPhone 6.9″, iPad 13″.
  const sizeIds = opts.sizes?.length ? opts.sizes : [FORMATS[fmt].exportSize];
  const incompatible = sizeIds.filter((id) => fmt === "iphone"
    ? !id.startsWith("iphone-") : id !== FORMATS[fmt].exportSize);
  if (incompatible.length) return { ok: false, error: `Proje formatıyla uyumsuz export boyutu: ${incompatible.join(", ")}` };
  const progress = onProgress ?? opts.onProgress;
  const picked =
    opts.indexes && opts.indexes.length
      ? opts.indexes.filter((i) => i >= 0 && i < plan.slides.length)
      : plan.slides.map((_, i) => i);

  const images: { file: string; dataUrl: string }[] = [];
  const total = picked.length * sizeIds.length;
  let done = 0;
  let cancelled = false;

  for (const sizeId of sizeIds) {
    const size = EXPORT_SIZES[sizeId];
    for (let n = 0; n < picked.length; n++) {
      if (opts.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const i = picked[n];
      const slide = plan.slides[i];
      progress?.({ done, total, current: `${sizeId} · ${n + 1}/${picked.length}` });
      const canvas = await renderSlide(slide, {
        width: size.w,
        height: size.h,
        locale: plan.locale,
        format: fmt,
      });
      const file = opts.nameFor
        ? opts.nameFor(i, slide, sizeId)
        : sizeIds.length > 1
          ? `${sizeId}/${String(i + 1).padStart(2, "0")}.png`
          : `${String(i + 1).padStart(2, "0")}.png`;
      images.push({ file, dataUrl: canvas.toDataURL("image/png") });
      done++;
      // UI nefes alsın
      await new Promise((r) => setTimeout(r, 0));
    }
    if (cancelled) break;
  }

  // İptal ilk slayttan önce geldiyse yazacak bir şey yok — sunucuyu yorma.
  if (!images.length) return { ok: !cancelled, cancelled, written: 0, files: [] };

  progress?.({ done, total, current: L("yazılıyor…", "writing…") });
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: plan.app,
      locale: plan.locale,
      ...(opts.subPath ? { subPath: opts.subPath } : null),
      images,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; path?: string; error?: string; written?: number };
  return {
    ok: !!data.ok,
    path: data.path,
    error: data.error,
    written: data.written,
    files: images.map((im) => im.file),
    cancelled,
  };
}
