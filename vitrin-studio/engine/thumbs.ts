// Tema / şablon galerileri için GERÇEK render önizleme karesi.
//
// Neden ayrı modül: tema ve şablon seçicileri bugüne kadar "isim + renkli nokta"
// idi — kullanıcı neyi seçtiğini ancak uyguladıktan sonra görüyordu. Burada
// aynı motor (engine/render.ts) minik boyutta çalıştırılır, sonuç dataURL olarak
// önbelleğe alınır ve kartlara basılır. Export ile aynı yoldan geçtiği için kart
// gerçekten çıktının minyatürüdür.
//
// Maliyet kontrolü — üç kural:
//   1) Cihazın gerçek 2D/3D stili korunur. 3D kartlar scene3d'nin paylaşılan
//      renderer'ını ve seri render kuyruğunu kullanır; kart başına bağlam açılmaz.
//   2) EŞZAMANLILIK 1. Kuyruk, ana iş parçacığını kilitlemeden sırayla çizer;
//      IntersectionObserver ile yalnız görünen kartlar kuyruğa girer.
//   3) İKİ KATMANLI ÖNBELLEK. Modül içi Map (oturum) + localStorage aynası
//      (oturumlar arası, ~200KB bütçe, en eskiden başlayarak tahliye).
//
// draft=false bilerek: taslak mod yarı çözünürlükte çizip büyütür ve bitirici
// katmanları (gren/vignette) atlar — 122×264'lük bir karede bu hem bulanık hem
// de "gerçek çıktı gibi" hissettirmeyen bir sonuç verirdi. Bu boyutta tam render
// zaten ucuz (~32k piksel), üstelik temanın greni/vignette'i de görünür.

import { L, LANG } from "@/lib/i18n";
import { LAYOUTS } from "./layouts";
import { sourceFingerprint } from "./assets";
import { COLLECTIONS } from "./collections";
import { BRAND_COLLECTIONS } from "./brandThemes";
import { renderThumb } from "./render";
import { getTemplate } from "./templates";
import { getTheme } from "./themes";
import {
  BASE_H,
  BASE_W,
  baseOf,
  type Format,
  type Slide,
} from "./types";

export type ThumbKind = "theme" | "template";

/** Kartın CSS yüksekliği — ızgaralar bu ölçüye göre kutu ayırır. */
export const THUMB_H = 132;
/** Slayt en/boy oranı — kutu genişliğini hesaplamak için. */
export const THUMB_ASPECT = BASE_W / BASE_H;
/** THUMB_H yüksekliğindeki bir kartın CSS genişliği (yuvarlanmış). */
export const THUMB_W = Math.round(THUMB_H * THUMB_ASPECT);

/** Format-aware card geometry; legacy constants remain the iPhone defaults. */
export function thumbAspectOf(format: Format = "iphone"): number {
  const base = baseOf(format);
  return base.w / base.h;
}

/** Kart görselinin ÜRETİM boyutu için DPR tavanı (retina'da net, 3x'te israf yok). */
const DPR_CAP = 2;

/**
 * Biçim sürümü. Render kuralları (zorlanan cihaz, örnek slayt, kalite…) değişince
 * ELLE artır — eski localStorage aynası böylece kendiliğinden geçersiz olur.
 */
const THUMB_FORMAT_REV = `r14-sample-phone-${LANG}`;

const LS_PREFIX = "vitrin.thumb.";
const LS_BUDGET = 200 * 1024; // ~200KB — kotanın küçük bir dilimi
const MEM_MAX = 96; // modül önbelleğinde tutulacak en fazla kare
const CONCURRENCY = 1;
// 0.75 ölçülerek seçildi: 122×264 karede ~7.5KB, 10 tema + 13 şablon = ~175KB,
// yani 200KB bütçesinin ALTINDA — hepsi aynada kalır, tahliye tetiklenmez.
// (0.82'de kare başına ~9KB ve toplam 208KB idi: son iki kart her açılışta
// yeniden çiziliyordu.)
const JPEG_Q = 0.75;

/** Kart örneği için paketli ekran görüntüsü (proje slaydı verilmediğinde). */
const SAMPLE_SHOT = "/assets/samples/phone/portrait.svg";

/* ------------------------------------------------------------------ *
   Sürüm / anahtar yönetimi

   Anahtar biçimi audit şartnamesindeki gibi `${kind}:${id}:${THUMB_REV}`.
   THUMB_REV tek bir jeton ama üç parçadan üretilir:
     <biçim sürümü>.<invalidateThumbs sayacı>.<örnek slayt imzası>
   Örnek imzası anahtara girdiği için farklı örnek slaytlar birbirinin karesini
   ASLA okumaz; imza değişince eski kayıtlar kendiliğinden ölü kalır.
 * ------------------------------------------------------------------ */

const bumpCount: Record<ThumbKind, number> = { theme: 0, template: 0 };
const sampleSig: Record<ThumbKind, string> = { theme: "0", template: "0" };

function thumbRev(kind: ThumbKind): string {
  return `${THUMB_FORMAT_REV}.${bumpCount[kind]}.${sampleSig[kind]}`;
}

function keyOf(kind: ThumbKind, id: string): string {
  return `${kind}:${id}:${thumbRev(kind)}`;
}

/** FNV-1a 32-bit — dataURL uzunluğundaki dizeleri anahtara sokmadan özetler. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Örnek slaydın karesi etkileyen parçalarının imzası — türü başına farklı,
 * çünkü tema kartında metin zaten sabitlenir: kullanıcı başlığı düzenleyince
 * 10 tema karesinin boşuna yeniden çizilmesini istemiyoruz.
 */
function sigOf(kind: ThumbKind, s: Slide | undefined): string {
  if (!s) return "canned";
  const parts =
    kind === "theme"
      ? [s.screenshot ?? "", s.screenshot2 ?? "", s.screenshot3 ?? "", s.layout ?? ""]
      : [
          s.screenshot ?? "",
          s.screenshot2 ?? "",
          s.screenshot3 ?? "",
          s.headline ?? "",
          s.sub ?? "",
          s.badge ?? "",
          s.ornament?.text ?? "",
        ];
  return hash(parts.map(p => p.startsWith("data:") ? sourceFingerprint(p) : p).join(""));
}

/**
 * Kareleri geçersiz kılar (tür verilmezse hepsini). Sayaç arttığı için anahtar
 * uzayı değişir: modül önbelleği ve localStorage aynası bir daha okunmaz, eski
 * kayıtlar ilk tahliyede silinir.
 */
export function invalidateThumbs(kind?: ThumbKind): void {
  const kinds: ThumbKind[] = kind ? [kind] : ["theme", "template"];
  for (const k of kinds) {
    bumpCount[k]++;
    for (const key of [...mem.keys()]) if (key.startsWith(`${k}:`)) mem.delete(key);
  }
  sweepLocal();
}

/**
 * components/ui.tsx'teki renderRev köprüsü. Izgara bileşenleri render sırasında
 * `syncThumbRev(useRenderRev())` çağırır; sayı GERÇEKTEN değiştiğinde (tema
 * nesnesi yerinde düzenlendi) kareler düşer. İlk çağrıda sadece taban alınır —
 * her mount'ta önbelleği yakmamak için. Aynı sayıyla tekrar çağrılması zararsız,
 * bu yüzden StrictMode'un çift render'ı güvenlidir.
 *
 * @returns kareler bu çağrıda geçersiz kılındıysa true
 */
let lastRenderRev: number | null = null;
export function syncThumbRev(rev: number): boolean {
  if (lastRenderRev === null || lastRenderRev === rev) {
    lastRenderRev = rev;
    return false;
  }
  lastRenderRev = rev;
  invalidateThumbs();
  return true;
}

/* ------------------------------------------------------------------ *
   Önbellek — modül Map'i + localStorage aynası
 * ------------------------------------------------------------------ */

const mem = new Map<string, string>();

function memPut(key: string, url: string): void {
  mem.delete(key); // yeniden ekleyerek "en yeni" sırasına al (Map ekleme sırası)
  mem.set(key, url);
  while (mem.size > MEM_MAX) {
    const oldest = mem.keys().next();
    if (oldest.done) break;
    mem.delete(oldest.value);
  }
}

function ls(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // özel mod / kapalı depolama
  }
}

function lsGet(key: string): string | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const cut = raw.indexOf("|");
    return cut < 0 ? null : raw.slice(cut + 1);
  } catch {
    return null;
  }
}

function lsPut(key: string, url: string): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(LS_PREFIX + key, `${Date.now()}|${url}`);
  } catch {
    // kota doldu — bir tur tahliye edip bir kez daha dene, olmazsa sessiz geç
    sweepLocal(true);
    try {
      s.setItem(LS_PREFIX + key, `${Date.now()}|${url}`);
    } catch {
      /* aynasız devam */
    }
  }
  sweepLocal();
}

type LsEntry = { key: string; ts: number; size: number; stale: boolean };

/**
 * Bütçeyi uygular: YALNIZCA sınır aşıldığında siler. Sıralama önce ölü sürümdeki
 * kayıtları (anahtardaki rev artık geçerli değil), sonra en eskileri atar.
 * `force` bütçenin yarısına kadar iner — kota istisnasından sonra yer açmak için.
 *
 * Bütçe altındayken ölü kayıtları da AYIKLAMIYORUZ: "ölü" kararı `thumbRev()`
 * gibi değişken modül durumuna dayanır ve bir tür için imza henüz yazılmamışsa
 * yanlış çıkabilir. Sadece bütçede silmek, o yanlışın en kötü sonucunu "tahliye
 * sırası biraz kötü" seviyesine indirir — canlı kayıtlar asla süpürülmez.
 * (Erken sürümde bu süpürme, şablon kartları yazarken 10 tema karesini birden
 * siliyordu; gözlemlenmiş hata.)
 */
function sweepLocal(force = false): void {
  const s = ls();
  if (!s) return;
  const entries: LsEntry[] = [];
  let total = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      const full = s.key(i);
      if (!full || !full.startsWith(LS_PREFIX)) continue;
      const raw = s.getItem(full) ?? "";
      const key = full.slice(LS_PREFIX.length);
      const [kind, , rev] = key.split(":");
      const live =
        (kind === "theme" || kind === "template") && rev === thumbRev(kind as ThumbKind);
      const ts = Number(raw.slice(0, Math.max(0, raw.indexOf("|")))) || 0;
      const size = full.length + raw.length;
      total += size;
      entries.push({ key: full, ts, size, stale: !live });
    }
  } catch {
    return;
  }
  const budget = force ? LS_BUDGET / 2 : LS_BUDGET;
  if (total <= budget) return;
  entries.sort((a, b) => (a.stale === b.stale ? a.ts - b.ts : a.stale ? -1 : 1));
  for (const e of entries) {
    if (total <= budget) break;
    try {
      s.removeItem(e.key);
      total -= e.size;
    } catch {
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
   Render kuyruğu — aynı anda en fazla 2 kare
 * ------------------------------------------------------------------ */

const queue: (() => void)[] = [];
let running = 0;

/** Kuyruk derinliği (bekleyen + koşan) — C34 ölçümü için. */
export function thumbQueueDepth(): number {
  return queue.length + running;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    if (job) job();
  }
}

/**
 * Kuyruğa iş bırakır (en fazla CONCURRENCY eşzamanlı, aralarda makro-görev).
 * Dışa açık: film şeridi de (Timeline) aynı kuyruğu kullanır — 15 dil × N
 * slaytlık şerit kartları tema/şablon kartlarıyla AYNI 2'lik bütçeyi paylaşır,
 * yoksa iki ızgara birbirini boğuyordu (C29).
 */
export function enqueue<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      running++;
      work()
        .then(resolve, reject)
        .finally(() => {
          running--;
          // Mikro-görev yerine makro-göreve bırak: 13 kare peş peşe çizilirken
          // arayüz nefes alsın (scroll akıcı kalsın).
          // requestAnimationFrame KULLANILMAZ — arka plandaki/gizli sekmede
          // kısılır ve kuyruk ilk 2 karede donup kalır (gözlemlenmiş hata).
          setTimeout(pump, 0);
        });
    });
    pump();
  });
}

/* ------------------------------------------------------------------ *
   Örnek slayt ve kare tarifleri
 * ------------------------------------------------------------------ */

/** Çağıran slayt vermediğinde kullanılan paketli örnek. */
function cannedSample(format: Format): Slide {
  const tabletShot = format === "iphone" ? undefined
    : `/assets/samples/tablet/${format === "ipad" ? "portrait" : "landscape"}.svg`;
  return {
    id: "thumb-sample",
    screenshot: tabletShot ?? SAMPLE_SHOT,
    screenshot2: `${tabletShot ?? SAMPLE_SHOT}#details`,
    headline: L("Aa Başlık", "Aa Headline"),
    sub: L("Alt yazı", "Subtitle"),
    themeId: "solstice",
    layout: "device-bleed-bottom",
  };
}

/** Örnekten elle yapılmış ince ayarları söker — kartlar birbiriyle kıyaslanabilsin. */
function cleanSample(s: Slide): Slide {
  const out: Slide = { ...s };
  delete out.hideDevice;
  delete out.frameLabel;
  out.elements = out.elements?.filter(e => !e.id.startsWith("brand:"));
  delete out.headlineStyle;
  delete out.subStyle;
  delete out.textOffset;
  delete out.deviceOffset;
  delete out.device2Offset;
  return out;
}

/** Tema kartının slaydı — metin sabit, zemin ve cihaz temanın kendisi. */
function themeSlide(id: string, sample: Slide): Slide {
  const theme = getTheme(id);
  const base = cleanSample(sample);
  const s: Slide = {
    ...base,
    themeId: id,
    background: undefined, // temanın kendi zemini görünsün
    device: theme.device,
    headline: L("Aa Başlık", "Aa Headline"),
    sub: L("Alt yazı", "Subtitle"),
  };
  delete s.badge;
  delete s.ornament;
  // Çoklu cihaz düzeni ikinci ekran ister; kart tek ekranla çizilir → güvenli
  // düzene düş. R10: id listesi SABİT YAZILMIYOR (yeni duo-*/trio-* düzenleri
  // de kapsansın diye) — düzenin kendi `device2` alanına bakılıyor.
  if (!s.screenshot2 && LAYOUTS[s.layout]?.device2) {
    s.layout = theme.defaultLayout;
  }
  return s;
}

/** Şablon kartının slaydı — şablonun 0. adım giysisi, kullanıcının kendi ekranı. */
function templateSlide(id: string, sample: Slide): Slide {
  const tpl = getTemplate(id);
  const base = cleanSample(sample);
  const st = tpl.style(0); // themeId + layout + background + device (hepsi yazılır)
  // Şablonun kendi 0. karesi: rozet ve defne çelengi gibi "ödül" ailesini ayıran
  // süsler örnekte yoksa buradan tamamlanır — yoksa 5 ödül şablonu boş görünür.
  const own = tpl.build(1)[0];
  const s: Slide = {
    ...base,
    ...st,
    device: st.device,
    headline: base.headline || own?.headline || L("Aa Başlık", "Aa Headline"),
    sub: base.sub || own?.sub,
    badge: base.badge ?? own?.badge,
    ornament: base.ornament ?? own?.ornament,
  };
  if (!s.screenshot2 && LAYOUTS[s.layout]?.device2) {
    s.layout = "device-bleed-bottom";
  }
  return s;
}

/* ------------------------------------------------------------------ *
   Genel API
 * ------------------------------------------------------------------ */

/** Örnek imzasını türe yazar (anahtar uzayını belirler) ve anahtarı verir. */
function prepare(kind: ThumbKind, id: string, sample?: Slide, format: Format = "iphone"): string {
  const sig = `${format}.${sigOf(kind, sample)}`;
  if (sampleSig[kind] !== sig) sampleSig[kind] = sig;
  return keyOf(kind, id);
}

/**
 * Önbellekte hazır kare varsa SENKRON döner (kart yeniden mount olurken
 * titremesin), yoksa null. localStorage aynası da okunur.
 */
export function peekThumb(kind: ThumbKind, id: string, sample?: Slide, format: Format = "iphone"): string | null {
  const brand = BRAND_COLLECTIONS.find(c => id === c.id || id === c.templateId);
  const ipadBrand = BRAND_COLLECTIONS.find(c => c.ipadTemplateId && (id === c.id || id === c.ipadTemplateId));
  if (ipadBrand && format === "ipad") return `/assets/template-previews/${ipadBrand.ipadTemplateId}.webp`;
  if (brand && format === "iphone") return `/assets/template-previews/${brand.id}-iphone.webp`;
  const collection = COLLECTIONS.find(c => id === c.id || id.startsWith(c.id + "-"));
  if (collection && format.startsWith("ipad")) return `/assets/template-previews/${collection.id}-${format}.webp`;
  const key = prepare(kind, id, sample, format);
  const hit = mem.get(key);
  if (hit) return hit;
  const mirrored = lsGet(key);
  if (mirrored) {
    memPut(key, mirrored);
    return mirrored;
  }
  return null;
}

const inflight = new Map<string, Promise<string>>();

/**
 * Tema ya da şablon için gerçek-render önizleme karesi (dataURL).
 *
 * @param kind    "theme" → temanın zemini/tipografisi; "template" → şablonun
 *                0. adım kurgusu (yerleşim + kamera + zemin varyantı)
 * @param id      tema ya da şablon id'si
 * @param sample  projenin ilk slaydı — verilmezse paketli örnek ekran
 */
export async function thumbFor(
  kind: ThumbKind,
  id: string,
  sample?: Slide,
  format: Format = "iphone"
): Promise<string> {
  const cached = peekThumb(kind, id, sample, format);
  if (cached) return cached;

  const key = keyOf(kind, id);
  const pending = inflight.get(key);
  if (pending) return pending;

  const fallback = cannedSample(format);
  const src = sample ? {
    ...sample,
    screenshot: sample.screenshot || fallback.screenshot,
    screenshot2: sample.screenshot2 || fallback.screenshot2,
  } : fallback;
  const slide = kind === "theme" ? themeSlide(id, src) : templateSlide(id, src);

  const p = enqueue(async () => {
    const h = Math.round(
      THUMB_H * Math.min(DPR_CAP, (typeof window !== "undefined" && window.devicePixelRatio) || 1)
    );
    // draft=false: bu boyutta tam render ucuz ve gren/vignette dahil olduğu için
    // kart gerçekten çıktının minyatürü olur.
    const canvas = await renderThumb(slide, h, false, undefined, format);
    // JPEG: zemin her zaman opak, alfa gerekmiyor; PNG'nin ~1/4'ü kadar yer tutar
    // ve 200KB'lık ayna bütçesine 20+ kare sığar.
    return canvas.toDataURL("image/jpeg", JPEG_Q);
  })
    .then((url) => {
      memPut(key, url);
      lsPut(key, url);
      return url;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ *
   Kart CSS'i — globals.css'e dokunmadan, ızgaraların yanında taşınır.
   Bileşenler <style>{THUMB_CSS}</style> basar; aynı kurallar iki kez
   yazılsa da idempotent olduğu için zararsız.
 * ------------------------------------------------------------------ */

export const THUMB_CSS = `
.vt-cards { display: grid; gap: 6px; }
.vt-cards.c2 { grid-template-columns: 1fr 1fr; }
.vt-cards.c1 { grid-template-columns: 1fr; }
.vt-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px; margin: 0;
  background: rgba(255,255,255,.045);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  cursor: pointer; text-align: left; color: var(--text);
  min-width: 0;
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
}
.vt-card.row { flex-direction: row; align-items: center; gap: 9px; }
.vt-card:hover { border-color: var(--hairline-2); background: var(--glass-2); }
.vt-card.on {
  border-color: transparent;
  background: linear-gradient(rgba(20,18,30,.92), rgba(20,18,30,.92)) padding-box,
    var(--acc-grad) border-box;
  box-shadow: 0 2px 14px rgba(139,92,246,.28);
}
.vt-shot {
  display: flex; align-items: center; justify-content: center;
  height: ${THUMB_H}px; border-radius: 6px; overflow: hidden;
  background: #0b0b10;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.05);
  flex: none;
}
.vt-card.row .vt-shot { height: 108px; width: ${Math.round(108 * THUMB_ASPECT)}px; }
.vt-shot img { height: 100%; width: auto; display: block; }
.vt-shot .vt-skel {
  width: ${THUMB_W}px; height: 100%;
  background: linear-gradient(100deg, rgba(255,255,255,.03) 30%, rgba(255,255,255,.09) 50%, rgba(255,255,255,.03) 70%);
  background-size: 220% 100%;
  animation: vt-shimmer 1.1s linear infinite;
}
.vt-card.row .vt-shot .vt-skel { width: 100%; }
@keyframes vt-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@media (prefers-reduced-motion: reduce) { .vt-shot .vt-skel { animation: none; } }
.vt-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vt-name {
  font: 600 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .06em; text-transform: uppercase;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vt-hint {
  font-size: 10.5px; color: var(--faint); line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;
