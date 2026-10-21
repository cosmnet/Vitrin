// İçe aktarmanın YÜRÜTME yarısı — sihirbazın 4 adımından bağımsız.
//
// Eski `IngestDialog.doImport` buradan taşındı; semantiği birebir korunur:
//   1) eşleşen görseller `/api/shots` ile `data/shots/<sha1>.<ext>` altına
//      kopyalanır (proje JSON'u kaynak klasöre bağımlı kalmasın),
//   2) her dil KENDİ eşleşmesiyle kurulur,
//   3) her slayta `designKey: f<no>` damgası basılır (diller arası eşleştirme
//      anahtarı — index DEĞİL),
//   4) yalnız bir kareye DÜŞEN görseller projeye girer,
//   5) hepsi TEK `mutate` içinde yazılır → tek adımlık geri alma.
//
// Sihirbaz "Otomatik kur" da normal 4. adım da aynı fonksiyonu çağırır.

import { getTemplate } from "@/engine/templates";
import { uid, type Project, type Screenshot, type Slide } from "@/engine/types";
import { api } from "@/lib/client";
import { frameScreenPatch, type ImageRef, type MdFrame } from "@/lib/mdframes";

import { designKeyOf } from "./types";

/** Bir dilin kurulacak hâli — kareler ve kare başına eşleşen görseller. */
export type LocalePlan = {
  code: string;
  frames: MdFrame[];
  /** frames ile aynı uzunlukta; eşleşmeyen kare `null`. */
  matches: (ImageRef | null)[];
  /** SCREEN2 eşleşmeleri; split slaytlar için. */
  matches2: (ImageRef | null)[];
};

export type ImportDeps = {
  mutate: (fn: (p: Project) => Project, undoable?: boolean, coalesceKey?: string) => void;
  setActiveSlide: (id: string | null) => void;
  setBusy: (b: string | null) => void;
};

/** `/api/ingest?file=<abs>` → `<abs>`; başka biçimdeki URL'de null. */
export function ingestSource(url: string): string | null {
  if (!url.startsWith("/api/ingest?")) return null;
  const m = /[?&]file=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Eşleşen görselleri sunucuda `data/shots/<sha1>.<ext>` altına kopyalatır ve
 * "tarama URL'si → kalıcı URL" haritasını döner. Kopyalanamayan görsel eski
 * URL'siyle devam eder — içe aktarma yarıda kalmaz.
 * Neden: `/api/ingest?file=…` yalnız kaynak klasör izin listesinde durdukça
 * çalışır; proje JSON'u artık ondan bağımsız.
 */
export async function materializeShots(images: ImageRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const im of images) {
    const abs = ingestSource(im.url);
    if (!abs) out.set(im.url, im.url); // /assets, data: … zaten kalıcı
    else if (!byPath.has(abs)) byPath.set(abs, im.url);
  }
  if (!byPath.size) return out;
  try {
    const r = await api<{ shots: { source: string; url?: string }[] }>("/api/shots", {
      sourceAbsPaths: [...byPath.keys()],
    });
    for (const s of r.shots) {
      const orig = byPath.get(s.source);
      if (orig && s.url) out.set(orig, s.url);
    }
  } catch {
    /* kopyalama başarısız — taranan URL'lerle devam edilir */
  }
  for (const orig of byPath.values()) if (!out.has(orig)) out.set(orig, orig);
  return out;
}

/** Kurulacak slayt sayısı — CTA metni ("10 kare × 15 dil = 150 slayt"). */
export function slideCount(plan: LocalePlan[]): number {
  return plan.reduce((n, p) => n + p.frames.length, 0);
}

/**
 * Planı projeye yazar. Diyalog kapanışı ve hata gösterimi ÇAĞIRANIN işi;
 * burada iş mantığı var, UI yok.
 * @returns kurulan ilk dilin kodu ve slayt sayısı
 */
export async function runImport(
  plan: LocalePlan[],
  templateId: string,
  deps: ImportDeps
): Promise<{ locale: string; slides: number }> {
  if (!plan.length) throw new Error("İçe aktarılacak dil seçilmedi.");
  const tpl = getTemplate(templateId);

  // 1) Projeye girecek görseller — yalnız bir kareye düşenler.
  const used = new Map<string, ImageRef>();
  for (const p of plan) {
    for (const im of [...p.matches, ...p.matches2]) if (im) used.set(im.url, im);
  }

  // 2) Kalıcı kopya: proje JSON'u artık kaynak klasöre bağımlı değil.
  deps.setBusy("Ekran görüntüleri projeye kopyalanıyor…");
  let stable: Map<string, string>;
  try {
    stable = await materializeShots([...used.values()]);
  } finally {
    deps.setBusy(null);
  }
  const at = (im: ImageRef | null): ImageRef | null =>
    im ? { name: im.name, url: stable.get(im.url) ?? im.url } : null;

  // 3) Her dil kendi kare listesini KENDİ eşleşmesiyle kurar.
  const built: Record<string, Slide[]> = {};
  for (const p of plan) {
    built[p.code] = p.frames.map((f, i) => {
      const slide: Slide = {
        id: uid(),
        ...tpl.style(i),
        // Diller arası eşleştirme anahtarı — MD kare no'su, index DEĞİL.
        designKey: designKeyOf(f.no),
        headline: f.headline,
        sub: f.sub,
        badge: f.eyebrow,
        ...frameScreenPatch(f, at(p.matches[i]), at(p.matches2[i])),
      };
      // LAUREL → defne çelengi süsü (render tarafı /assets/stickers/laurel-gold.png okur)
      if (f.laurel) slide.ornament = { kind: "laurel", text: f.laurel };
      return slide;
    });
  }

  const firstCode = plan[0].code;
  // Ekranlar + tüm diller tek mutate'te yazılır: tek adımlık geri alma.
  deps.mutate((p) => {
    // C26: `screenshots` klonun DIŞINDA tutulur ve anlık görüntülerle referans
    // paylaşır → yerinde push YASAK (dizi donmuş, TypeError atar). Yeni dizi
    // üret: paylaşım burada kırılır, geri alma eski listeyi geri getirir.
    const added: Screenshot[] = [];
    const seen = new Set(p.screenshots.map((s) => s.dataUrl));
    for (const im of used.values()) {
      const url = stable.get(im.url) ?? im.url;
      if (seen.has(url)) continue;
      seen.add(url);
      added.push({ id: uid(), name: im.name, dataUrl: url });
    }
    if (added.length) p.screenshots = [...p.screenshots, ...added];
    for (const [code, slides] of Object.entries(built)) {
      p.sets[code] = { app: p.app, locale: code, slides };
    }
    p.activeLocale = firstCode;
    return p;
  });
  deps.setActiveSlide(built[firstCode][0]?.id ?? null);

  return { locale: firstCode, slides: slideCount(plan) };
}
