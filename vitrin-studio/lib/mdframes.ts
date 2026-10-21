import { LAYOUTS } from "@/engine/layouts";
import type { LayoutId } from "@/engine/types";

// MD kare (frame) ayrıştırıcı + ekran görüntüsü eşleştirici.
//
// Pazarlama tarafı her dil için tek bir .md yazıyor; her kare şu iskelette:
//
//   ## 01 — Opener
//   EYEBROW: MYAPP
//   LAUREL: Tek ihtiyacın olan TV kumandası.
//   HEADLINE: EVDEKİ HER TV.
//   CHARS: 14
//   SUB: Tek uygulama. Tek satın alma. Reklamsız.
//   SCREEN: remote, touchpad mode
//
// Parser bilerek TOLERANSLI:
//   · alan sırası serbest, alan eksik olabilir
//   · `---` ayraçları, başlık bloğu ve `## Notes` bölümü yok sayılır
//   · `**HEADLINE:**` / `- HEADLINE:` gibi markdown süsleri temizlenir
//   · numaradan sonraki ayraç — – - . : ) hepsi kabul
//   · bir alanın devamı alt satıra taşmışsa aynı alana eklenir
//
// Sunucu (app/api/ingest) ve arayüz (components/dialogs) aynı kodu kullanır;
// bu yüzden dosya saf TS — DOM veya node API'si yok.

/* ------------------------------------------------------------------ *
   Tipler
 * ------------------------------------------------------------------ */

export type MdFrame = {
  /** "## 01 — Opener" içindeki 1. */
  no: number;
  /** Kare adı — "Opener". Boş olabilir. */
  title: string;
  /** EYEBROW → Slide.badge */
  eyebrow?: string;
  /** LAUREL → Slide.ornament = { kind: "laurel", text } */
  laurel?: string;
  /** HEADLINE → Slide.headline (zorunlu; yoksa kare atılır) */
  headline: string;
  /** SUB → Slide.sub */
  sub?: string;
  /** SCREEN → ekran görüntüsü eşleşme ipucu (her dilde İngilizce yazılıyor) */
  screenHint?: string;
  /** SCREEN2 → İKİNCİ ekran görüntüsü ipucu; varsa kare split-v olur. */
  screen2Hint?: string;
  /** LAYOUT → MD'nin açıkça istediği düzen ("split-h" gibi). Otomatik split-v'yi ezer. */
  layout?: string;
  /** CHARS → yazarın saydığı karakter sayısı; sadece bilgi amaçlı. */
  chars?: number;
};

export type MdFrames = { frames: MdFrame[] };

/** İçe aktarma sırasında bulunan bir görsel. `name` klasör + dosya adıdır. */
export type ImageRef = { name: string; url: string };

/* ------------------------------------------------------------------ *
   Ayrıştırma
 * ------------------------------------------------------------------ */

// "## 01 — Opener", "### 3. Setup", "## 10 - Closer" …
const HEADING_RE = /^\s*#{2,4}\s*(\d{1,3})\s*(?:[—–\-.:)]+\s*)?(.*)$/;
// Herhangi bir markdown başlığı (kare başlığı olmayanlar bloğu kapatır).
const ANY_HEADING_RE = /^\s*#{1,6}\s/;
// `---`, `***`, `___`
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
// "EYEBROW: …", "- **HEADLINE:** …" — `=` ile yazılan açıklama satırları eşleşmez.
const FIELD_RE =
  /^\s*(?:[-*+]\s+)?\*{0,2}(EYEBROW|OVERLINE|LAUREL|HEADLINE|TITLE|SUB|SUBTITLE|SCREEN2|SCREENSHOT2|SCREEN|SCREENSHOT|LAYOUT|CHARS|BADGE)\*{0,2}\s*:\s*(.*)$/i;

type FieldKey = keyof Pick<
  MdFrame,
  "eyebrow" | "laurel" | "headline" | "sub" | "screenHint" | "screen2Hint" | "layout"
>;

/** MD alan adını MdFrame alanına eşler; CHARS ayrı ele alınır. */
function fieldOf(raw: string): FieldKey | "chars" | null {
  switch (raw.toUpperCase()) {
    case "EYEBROW":
    case "OVERLINE":
    case "BADGE":
      return "eyebrow";
    case "LAUREL":
      return "laurel";
    case "HEADLINE":
    case "TITLE":
      return "headline";
    case "SUB":
    case "SUBTITLE":
      return "sub";
    case "SCREEN":
    case "SCREENSHOT":
      return "screenHint";
    case "SCREEN2":
    case "SCREENSHOT2":
      return "screen2Hint";
    case "LAYOUT":
      return "layout";
    case "CHARS":
      return "chars";
    default:
      return null;
  }
}

/** Markdown süslerini ve sarmalayan tırnakları atar, boşlukları tekler. */
function clean(value: string): string {
  let s = value.trim();
  // **kalın** / *eğik* / `kod` sarmalayıcıları
  s = s.replace(/^\*\*([\s\S]*)\*\*$/, "$1").trim();
  s = s.replace(/^\*([\s\S]*)\*$/, "$1").trim();
  s = s.replace(/^`([\s\S]*)`$/, "$1").trim();
  // Tam sarmalayan tırnaklar
  s = s.replace(/^["'“”«»„]([\s\S]*)["'“”«»„]$/, "$1").trim();
  return s.replace(/\s+/g, " ");
}

type Draft = {
  no: number;
  title: string;
  fields: Partial<Record<FieldKey, string>>;
  chars?: number;
};

function finish(draft: Draft, out: MdFrame[]): void {
  const f = draft.fields;
  // Başlık yoksa alt satırı başlığa terfi ettir; o da yoksa kareyi at.
  const headline = f.headline || f.sub || "";
  if (!headline) return;
  const frame: MdFrame = { no: draft.no, title: draft.title, headline };
  if (f.eyebrow) frame.eyebrow = f.eyebrow;
  if (f.laurel) frame.laurel = f.laurel;
  if (f.headline && f.sub) frame.sub = f.sub;
  if (f.screenHint) frame.screenHint = f.screenHint;
  if (f.screen2Hint) frame.screen2Hint = f.screen2Hint;
  if (f.layout) frame.layout = f.layout.toLowerCase();
  if (draft.chars !== undefined) frame.chars = draft.chars;
  out.push(frame);
}

/**
 * Bir locale MD dosyasını karelere ayırır. Ayrıştırılamayan her şey sessizce
 * atlanır — hatalı tek satır yüzünden içe aktarma çökmez.
 */
export function parseFramesMd(text: string): MdFrames {
  const frames: MdFrame[] = [];
  let draft: Draft | null = null;
  let last: FieldKey | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    // Kırılmaz boşluk (NBSP) → normal boşluk; kopyala-yapıştır MD'lerde sık.
    const line = rawLine.replace(/\u00a0/g, " ");

    if (RULE_RE.test(line)) {
      last = null;
      continue;
    }

    if (ANY_HEADING_RE.test(line)) {
      const m = HEADING_RE.exec(line);
      if (draft) {
        finish(draft, frames);
        draft = null;
      }
      last = null;
      if (m) {
        // "## Notes" gibi numarasız başlıklar buraya düşmez — blok kapanır.
        draft = { no: Number(m[1]), title: clean(m[2] ?? ""), fields: {} };
      }
      continue;
    }

    if (!draft) continue;

    const fm = FIELD_RE.exec(line);
    if (fm) {
      const key = fieldOf(fm[1]);
      const value = clean(fm[2] ?? "");
      if (key === "chars") {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) draft.chars = n;
        last = null;
      } else if (key) {
        // Aynı alan iki kez yazılmışsa ilki kalır (üstteki genelde niyet edilen).
        if (!draft.fields[key]) draft.fields[key] = value;
        last = value ? key : null;
      }
      continue;
    }

    // Alan değeri alt satıra taşmış olabilir.
    const cont = clean(line);
    if (cont && last) draft.fields[last] = `${draft.fields[last]} ${cont}`.trim();
  }

  if (draft) finish(draft, frames);
  if (frames.length) return { frames };

  // Alan biçimi hiç kare vermedi — dosya büyük ihtimalle "insan" MD'si:
  // bir kare tablosu ya da numaralı liste. Aynı MdFrame şeklini üreten
  // TOLERANSLI geçişi dene. Yalnız sıfır kare durumunda çalışır, yani
  // doğru yazılmış bir MD'nin davranışı ZERRE değişmez.
  return { frames: parseLooseFrames(text) };
}

/* ------------------------------------------------------------------ *
   Toleranslı geçiş — tablo / numaralı liste
 * ------------------------------------------------------------------ */

// "| R01 | tek | 01-bugun.png | Sıfır reklam |" — ayraç satırları elenir.
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^[\s|:-]+$/;
// Hücre ya da satır başındaki kare numarası: "R01", "01", "#3", "Kare 4".
const NO_RE = /^\s*(?:#|R|K|F|Kare|Frame|Slide|Slayt)?\s*0*(\d{1,3})\s*[).:—–-]?\s*$/i;
// "1. Sıfır reklam, doğru vakit" — numaralı liste maddesi.
const LIST_ITEM_RE = /^\s*0*(\d{1,3})\s*[).:]\s+(.+)$/;
// Bir hücrenin görsel dosyası taşıyıp taşımadığı; "a.png + b.png" ikilisi de olur.
const IMG_CELL_RE = /([\w.\-]+\.(?:png|jpe?g|webp))/gi;

/** Hücreyi metin olarak temizler; markdown süsleri ve tırnaklar düşer. */
function cell(raw: string): string {
  return clean(raw);
}

/**
 * Bir tablo satırını kareye çevirir. Sütun sırası SABİT DEĞİL — sütunlar
 * içeriklerine göre tanınır: numara / görsel adları / en uzun düz metin.
 * Böylece "| # | Düzen | Kare | Alt yazı |" de "| No | Metin | Ekran |" de
 * aynı kodla okunur.
 */
function frameFromCells(cells: string[]): MdFrame | null {
  let no: number | null = null;
  const shots: string[] = [];
  const prose: string[] = [];

  for (const c of cells) {
    if (!c) continue;
    if (no === null) {
      const m = NO_RE.exec(c);
      if (m) {
        no = Number(m[1]);
        continue;
      }
    }
    const imgs = c.match(IMG_CELL_RE);
    if (imgs) {
      // Uzantıyı at: SCREEN ipucu dosya adıyla puanlanıyor, uzantı gürültü.
      for (const f of imgs) shots.push(f.replace(/\.[^.]+$/, ""));
      continue;
    }
    prose.push(c);
  }

  if (no === null) return null;
  // Başlık = en uzun düz metin sütunu ("tek/çift" gibi kısa etiketler elenir.)
  const headline = prose.sort((a, b) => b.length - a.length)[0] ?? "";
  if (!headline) return null;

  const frame: MdFrame = { no, title: "", headline };
  if (shots[0]) frame.screenHint = shots[0];
  if (shots[1]) frame.screen2Hint = shots[1];
  return frame;
}

/**
 * Alan biçimi tutmayan bir MD'den kare çıkarır. Önce tablo satırları,
 * hiç tablo yoksa numaralı liste maddeleri denenir. Aynı numara iki kez
 * geçerse ilki kalır — tablolar genelde altta bir de "kopyalamak için"
 * listesi taşıyor, o liste tabloyu ezmemeli.
 */
export function parseLooseFrames(text: string): MdFrame[] {
  const lines = text.replace(/ /g, " ").split(/\r?\n/);
  const byNo = new Map<number, MdFrame>();

  for (const line of lines) {
    const m = TABLE_ROW_RE.exec(line);
    if (!m) continue;
    const inner = m[1];
    if (TABLE_SEP_RE.test(inner)) continue;
    const frame = frameFromCells(inner.split("|").map(cell));
    if (frame && !byNo.has(frame.no)) byNo.set(frame.no, frame);
  }

  if (!byNo.size) {
    for (const line of lines) {
      const m = LIST_ITEM_RE.exec(line);
      if (!m) continue;
      const no = Number(m[1]);
      const headline = clean(m[2]);
      // Salt görsel adı taşıyan madde başlık değildir.
      if (!headline || /^[\w.\-]+\.(png|jpe?g|webp)$/i.test(headline)) continue;
      if (!byNo.has(no)) byNo.set(no, { no, title: "", headline });
    }
  }

  return [...byNo.values()].sort((a, b) => a.no - b.no);
}

/* ------------------------------------------------------------------ *
   Kare → slayt yaması
 * ------------------------------------------------------------------ */

/** frameScreenPatch çıktısı — Slide'ın ekran + düzen alanlarının yaması. */
export type FrameScreenPatch = {
  screenshot?: string;
  screenshot2?: string;
  /** MD LAYOUT yazmadıysa ikinci ekran gelince "split-v". */
  layout?: LayoutId;
};

/**
 * Bir karenin eşleşen görsellerini slayt alanlarına çevirir.
 * Kural: SCREEN2 eşleştiyse kare otomatik "split-v" olur — ama MD kendi
 * LAYOUT'unu yazdıysa (ör. `LAYOUT: split-h`) o kazanır, otomatik geçiş yapılmaz.
 */
export function frameScreenPatch(
  frame: MdFrame,
  screen?: ImageRef | null,
  screen2?: ImageRef | null
): FrameScreenPatch {
  const patch: FrameScreenPatch = {};
  if (screen) patch.screenshot = screen.url;
  if (screen2) patch.screenshot2 = screen2.url;
  // MD'deki LAYOUT serbest metin — yalnız bilinen id'ler kabul edilir.
  if (frame.layout && frame.layout in LAYOUTS) patch.layout = frame.layout as LayoutId;
  else if (screen2) patch.layout = "split-v";
  return patch;
}

/** "en-US.md" → "en-US". Locale kodu olduğu gibi korunur (büyük/küçük harf dahil). */
export function localeFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim();
}

/* ------------------------------------------------------------------ *
   Ekran görüntüsü eşleştirme
 * ------------------------------------------------------------------ */

// SCREEN ipuçlarında ve dosya adlarında sinyal taşımayan kelimeler.
const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "mode", "page", "screen", "screens", "screenshot", "screenshots", "view",
  "sheet", "section", "entry", "tab", "app", "shot", "shots", "img", "image",
  "images", "final", "src", "copy", "new", "png", "jpg", "jpeg", "webp",
]);

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
};

/** Küçült, aksanı düşür, alfanümerik olmayanı ayraç yap, boş parçaları at. */
function tokens(input: string): string[] {
  const flat = input
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return flat ? flat.split(" ") : [];
}

/** Sadece anlamlı kelimeler: stopword, tek harf ve saf rakam blokları dışarıda. */
function keyTokens(raw: string[]): string[] {
  return raw.filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Tireyle bölünmüş yazımları geri yapıştırır: "D-pad" → "dpad",
 * "Add a TV" → "addtv"… Sadece komşu ikililer; sadece tam ad eşleşmesinde
 * kullanılır, o yüzden yanlış pozitif riski düşük.
 */
function gluedPairs(raw: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i++) {
    const g = raw[i] + raw[i + 1];
    if (g.length >= 4 && g.length <= 20 && !/^\d+$/.test(g) && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Bir SCREEN ipucunun bir görsel adına ne kadar uyduğunu puanlar.
 * Dosya adı klasör adından ağır basar; birebir kelime > parça eşleşmesi.
 * 0 = hiç alakası yok.
 */
export function scoreImageMatch(hint: string, imageName: string): number {
  const rawHint = tokens(hint);
  const hintTokens = keyTokens(rawHint);
  if (!hintTokens.length) return 0;

  const parts = imageName.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? imageName;
  const nameTokens = tokens(base.replace(/\.[^.]+$/, ""));
  const dirTokens = parts.slice(0, -1).flatMap((p) => tokens(p));

  let score = 0;
  for (const t of hintTokens) {
    if (nameTokens.includes(t)) score += 2;
    else if (dirTokens.includes(t)) score += 1;
    else if (t.length >= 4 && nameTokens.some((n) => n.includes(t))) score += 1;
    else if (t.length >= 3 && nameTokens.some((n) => n.includes(t))) score += 0.5;
  }

  // "D-pad" ↔ "02-dpad-dark"
  for (const g of gluedPairs(rawHint)) {
    if (!hintTokens.includes(g) && nameTokens.includes(g)) score += 2;
  }

  // "Add a TV, brand lineup" ↔ "04-addtv-dark": ipucunu tek bloğa çevirip bak.
  const blob = hintTokens.join("");
  for (const n of nameTokens) {
    if (n.length >= 4 && blob.includes(n)) score += 1.5;
  }

  return score;
}

/** Dosya adındaki ilk 1-3 haneli sayı — "04-addtv-dark.png" → 4. */
function numberInName(imageName: string): number | null {
  const base = imageName.split(/[\\/]/).pop() ?? imageName;
  const m = /(\d{1,3})/.exec(base);
  return m ? Number(m[1]) : null;
}

/** Bu eşiğin altındaki puanlar gürültü sayılır. */
const MIN_SCORE = 1.5;

/**
 * Kareleri görsellere bağlar. Dört tur, sırayla:
 *   1) Güçlü + tekil — en yüksek puanlı çiftten başlar, her görsel bir kez
 *      kullanılır. Aynı ipucunu paylaşan iki kare farklı dosya alır.
 *   2) Güçlü + tekrar — boşta kalan kareye, zaten kullanılmış olsa bile eşik
 *      üstü en iyi görsel. (Konusu doğru bir tekrar, alakasız bir dosyadan iyi.)
 *   3) Zayıf + tekil — kalanlara sıfırdan büyük her ipucu.
 *   4) İstenirse numara: kare 04 ↔ adında 4 geçen dosya.
 * Hiçbiri tutmazsa kare `null` döner ve slaytta ekran boş kalır.
 */
export function matchFramesToImages(
  frames: MdFrame[],
  images: ImageRef[],
  opts?: { byNumber?: boolean }
): (ImageRef | null)[] {
  return matchByHint(frames, images, (f) => f.screenHint, opts);
}

/**
 * SCREEN2 ipuçlarını aynı dört turlu eşleştiriciden geçirir.
 * `avoid` verilirse (genelde birinci geçişin sonucu) bir kare, kendi 1. ekranıyla
 * aynı dosyayı ikinci ekran olarak almaz — split slaytta iki aynı görsel olmasın.
 */
export function matchFrames2ToImages(
  frames: MdFrame[],
  images: ImageRef[],
  opts?: { byNumber?: boolean; avoid?: (ImageRef | null)[] }
): (ImageRef | null)[] {
  return matchByHint(frames, images, (f) => f.screen2Hint, { ...opts, numberNeedsHint: true });
}

type MatchOpts = { byNumber?: boolean; avoid?: (ImageRef | null)[]; numberNeedsHint?: boolean };

function matchByHint(
  frames: MdFrame[],
  images: ImageRef[],
  hintOf: (f: MdFrame) => string | undefined,
  opts?: MatchOpts
): (ImageRef | null)[] {
  const out: (ImageRef | null)[] = frames.map(() => null);
  if (!images.length) return out;
  const avoid = opts?.avoid;
  const blocked = (f: number, im: ImageRef): boolean => avoid?.[f]?.url === im.url;

  type Pair = { f: number; i: number; s: number };
  const pairs: Pair[] = [];
  for (let f = 0; f < frames.length; f++) {
    const hint = hintOf(frames[f]);
    if (!hint) continue;
    for (let i = 0; i < images.length; i++) {
      const s = scoreImageMatch(hint, images[i].name);
      if (s > 0) pairs.push({ f, i, s });
    }
  }
  // Eşit puanda belge sırası korunsun diye kararlı sıralama.
  pairs.sort((a, b) => b.s - a.s || a.f - b.f || a.i - b.i);

  const usedImage = new Set<number>();

  // 1) Güçlü + tekil
  for (const p of pairs) {
    if (p.s < MIN_SCORE || out[p.f] || usedImage.has(p.i)) continue;
    if (blocked(p.f, images[p.i])) continue;
    out[p.f] = images[p.i];
    usedImage.add(p.i);
  }

  // 2) Güçlü + tekrar kullanım serbest
  for (const p of pairs) {
    if (p.s < MIN_SCORE || out[p.f]) continue;
    if (blocked(p.f, images[p.i])) continue;
    out[p.f] = images[p.i];
  }

  // 3) Zayıf + tekil
  for (const p of pairs) {
    if (out[p.f] || usedImage.has(p.i)) continue;
    if (blocked(p.f, images[p.i])) continue;
    out[p.f] = images[p.i];
    usedImage.add(p.i);
  }

  // 4) Son çare: kare numarası ↔ dosya adındaki numara.
  if (opts?.byNumber) {
    for (let f = 0; f < frames.length; f++) {
      // 1. ekranda ipucu olmayan kare de numaradan eşleşebilir (eski davranış);
      // 2. ekranda eşleşme SADECE SCREEN2 yazan karelere verilir, yoksa her kare
      // istenmeden split olurdu.
      if (out[f] || (opts?.numberNeedsHint && !hintOf(frames[f]))) continue;
      const hit = images.find(
        (im) => numberInName(im.name) === frames[f].no && !blocked(f, im)
      );
      if (hit) out[f] = hit;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
   Adaylar — "bu kareye başka hangi ekran uyar?" (yeniden atama popover'ı)
 * ------------------------------------------------------------------ */

/** Tek bir kare için puanlanmış aday. */
export type MatchCandidate = { image: ImageRef; score: number };

/** Bu puanın altındaki aday "zayıf" sayılır — UI ayrımı bunu kullanabilir. */
export const MATCH_MIN_SCORE = MIN_SCORE;

/** Sadece numara tuttuğunda verilen puan; eşiği ancak yakalar (son çare mantığı). */
const NUMBER_SCORE = MIN_SCORE;

/**
 * Bir karenin adaylarını puanlarına göre sıralar — otomatik eşleşme yanlışsa
 * kullanıcıya sunulacak liste. Aynı puanda HAVUZ SIRASI korunur; içe aktarma
 * havuzu "önce kendi dilinin görselleri" diye kurulduğu için beraberlikte dilin
 * kendi dosyası kazanır.
 *
 * Mevcut `matchFramesToImages` davranışına dokunmaz; aynı `scoreImageMatch`
 * defterini kullanır, bu yüzden liste otomatik eşleşmeyle tutarlıdır.
 *
 * @param opts.which  "screen" (vars.) veya "screen2" ipucu
 * @param opts.limit  en fazla kaç aday (vars. 8)
 * @param opts.all    puansızları da döndür — boş ipuçlu karede tüm havuzu göstermek için
 */
export function matchCandidates(
  frame: MdFrame,
  images: ImageRef[],
  opts?: { which?: "screen" | "screen2"; byNumber?: boolean; limit?: number; all?: boolean }
): MatchCandidate[] {
  const hint = opts?.which === "screen2" ? frame.screen2Hint : frame.screenHint;
  const byNumber = opts?.byNumber ?? true;
  const limit = Math.max(1, opts?.limit ?? 8);

  const scored: { image: ImageRef; score: number; i: number }[] = [];
  images.forEach((image, i) => {
    let score = hint ? scoreImageMatch(hint, image.name) : 0;
    // "04-addtv.png" ↔ kare 04: ipucu tutmadıysa numara yine de aday yapar.
    if (byNumber && numberInName(image.name) === frame.no) score = Math.max(score, NUMBER_SCORE);
    if (score > 0 || opts?.all) scored.push({ image, score, i });
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map(({ image, score }) => ({ image, score }));
}
