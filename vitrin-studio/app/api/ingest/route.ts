// MD içe aktarma köprüsü — diskteki bir pazarlama klasörünü stüdyoya bağlar.
//
//   POST { folder }            → klasördeki *.md dosyalarını locale'lere ayrıştırır,
//                                görselleri DİL KOVALARINA ayırır,
//                                { locales, images, localeImages } döner.
//   POST { path: "…/tr.md" }   → tek dosya: klasör = dosyanın klasörü, pickedLocale = "tr".
//   POST { …, shotsRoot }      → görseller MD klasöründe değil bu klasörde aranır.
//   GET  ?browse=<mutlak dizin> → salt readdir dizin listesi (Gözat ağacı).
//   GET  ?file=…               → bulunan görselleri servis eder.
//
// DİL KOVALARI (R7/W1): `frames-v13/tr/01-remote.png` ve `frames-v13/ar-SA/01-remote.png`
// aynı numarayı taşıyor. Eski sürüm hepsini tek 60'lık havuza atıyordu; alfabetik
// sırada ar-SA öne düştüğü için TÜM diller ar-SA görselleriyle eşleşiyordu. Artık
// her `<klasör>/<locale>/` kendi kovasına (kova başına 40) girer, kök havuz da bu
// klasörleri atlar. İstemci dil havuzunu "kendi kovası + kök havuz" olarak kurar.
//
// Güvenlik: GET keyfi dosya okuyamaz. POST her taramada kök klasörleri
// (istenen klasör + bir üstü, varsa shotsRoot + bir üstü) bir izin listesine
// yazar; GET sadece bu ağaçların içindeki ve görsel uzantılı dosyaları verir.
// Sembolik bağ oyunlarına karşı hem istenen yol hem izinli kök realpath'e
// indirgenir. `?browse=` hiçbir dosya İÇERİĞİ okumaz ve ev klasörü dışına çıkamaz.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  addRoots,
  expandPath,
  homeRoot,
  IMG_RE,
  isAllowedFile,
  isInside,
  MD_RE,
  MIME,
  realOr,
  SKIP_DIRS,
} from "@/lib/fsroots";
import { asRecord } from "@/lib/wiro";
import { localeFromFilename, parseFramesMd, type ImageRef, type MdFrame } from "@/lib/mdframes";

export const runtime = "nodejs";

/** Kullanıcıya dönen ORTAK (dil klasörü dışı) görsel üst sınırı. */
const MAX_IMAGES = 60;
/** Dil kovası başına üst sınır — 10 kare için fazlasıyla yeter. */
const MAX_LOCALE_IMAGES = 40;
/** Tarama sırasında bellekte tutulan ham üst sınır (sınıra göre seçim yapılır). */
const SCAN_CAP = 600;
/**
 * Klasörün KENDİ içinde derine inilir (kullanıcı oraya işaret etti);
 * bir üst klasörde sadece bir kat — yoksa kardeş bir arşiv klasörü tüm
 * kotayı yer ve asıl ekran görüntüleri listeye hiç giremez.
 */
const DEPTH_SELF = 3;
const DEPTH_PARENT = 1;
/** Dil klasörünün içinde de alt klasör olabilir (ör. tr/light/…). */
const DEPTH_LOCALE = 3;
/** `?browse=` tek seferde bu kadar alt klasör döner. */
const BROWSE_DIR_CAP = 300;

/* ------------------------------------------------------------------ *
   Tarama
 * ------------------------------------------------------------------ */

type Found = { abs: string; name: string };
/** Klasör yolu → o klasörün görselleri. Ekleme sırası taramanın sırasıdır. */
type Buckets = Map<string, Found[]>;

type WalkCtx = {
  /** Ad üretiminde temel alınan kök — "tr/01-remote.png" bu köke göre bağıldır. */
  base: string;
  seen: Set<string>;
  buckets: Buckets;
  counter: { n: number };
  cap: number;
  /** Atlanacak MUTLAK klasörler — kök havuz dil klasörlerine girmez. */
  skip?: Set<string>;
};

/** `root` altında görselleri klasör klasör toplar; `ctx.seen` tekrarı engeller. */
async function walkImages(root: string, depth: number, ctx: WalkCtx): Promise<void> {
  if (ctx.counter.n >= ctx.cap || depth < 0) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const dirs: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !ctx.skip?.has(abs)) dirs.push(abs);
      continue;
    }
    if (!e.isFile() || !IMG_RE.test(e.name)) continue;
    if (ctx.seen.has(abs)) continue;
    if (ctx.counter.n >= ctx.cap) return;
    ctx.seen.add(abs);
    ctx.counter.n++;
    let list = ctx.buckets.get(root);
    if (!list) {
      list = [];
      ctx.buckets.set(root, list);
    }
    // Ad = kök klasöre göre bağıl yol; eşleştirici klasör adını da okuyor.
    list.push({ abs, name: path.relative(ctx.base, abs) || e.name });
  }

  for (const d of dirs) {
    if (ctx.counter.n >= ctx.cap) return;
    await walkImages(d, depth - 1, ctx);
  }
}

/**
 * Kotayı klasörler arasında sırayla paylaştırır: önce her klasörden bir tane,
 * sonra ikinci turu… Böylece 200 dosyalık tek bir arşiv klasörü listeyi ele
 * geçiremez, 12 dosyalık asıl ekran klasörü de temsil edilir.
 */
function pickBalanced(buckets: Buckets, limit: number): Found[] {
  const lists = [...buckets.values()];
  const out: Found[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const list of lists) {
      if (round >= list.length) continue;
      out.push(list[round]);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  // Görüntülemede klasörler bir arada dursun.
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function toRefs(found: Found[]): ImageRef[] {
  return found.map((f) => ({
    name: f.name,
    url: `/api/ingest?file=${encodeURIComponent(f.abs)}`,
  }));
}

type LocaleOut = { code: string; frames: MdFrame[] };

/** Klasördeki (yalnız üst seviye) .md dosyalarını ayrıştırır. */
async function readLocales(folder: string): Promise<LocaleOut[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith(".") && MD_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const out: LocaleOut[] = [];
  for (const name of files) {
    let text: string;
    try {
      text = await readFile(path.join(folder, name), "utf8");
    } catch {
      continue;
    }
    const { frames } = parseFramesMd(text);
    // Kare çıkmayan dosya (README, notlar) listeye girmez.
    if (frames.length) out.push({ code: localeFromFilename(name), frames });
  }
  return out;
}

/**
 * `root` altında locale kodlarıyla eşleşen klasörleri bulur ("tr", "ar-SA"…).
 * Eşleşme büyük/küçük harf duyarsız — `ar-sa/` klasörü `ar-SA.md`'ye bağlanır.
 */
async function findLocaleDirs(root: string, codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const byLower = new Map<string, string>();
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    byLower.set(e.name.toLowerCase(), e.name);
  }
  for (const code of codes) {
    const hit = byLower.get(code.toLowerCase());
    if (hit) out.set(code, path.join(root, hit));
  }
  return out;
}

/* ------------------------------------------------------------------ *
   POST — tara
 * ------------------------------------------------------------------ */

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const rec = asRecord(body);
  // `folder` eski ad, `path` yeni: klasör de olabilir tek bir .md dosyası da.
  const rawTarget = String(rec.folder ?? rec.path ?? "").trim();
  if (!rawTarget) return NextResponse.json({ error: "folder gerekli" }, { status: 400 });
  const rawShots = String(rec.shotsRoot ?? "").trim();

  let folder = await realOr(expandPath(rawTarget));
  let pickedLocale: string | undefined;

  try {
    const st = await stat(folder);
    if (!st.isDirectory()) {
      // Tek dosya işaret edildi: .md ise klasörünü tara, dilini ön-seç.
      if (!MD_RE.test(folder)) {
        return NextResponse.json({ error: "Bu bir klasör ya da .md dosyası değil" }, { status: 400 });
      }
      pickedLocale = localeFromFilename(path.basename(folder));
      folder = path.dirname(folder);
    }
  } catch {
    return NextResponse.json({ error: `Klasör bulunamadı: ${folder}` }, { status: 404 });
  }

  // Ekran görüntüleri ayrı bir klasörde olabilir (kullanıcının "Değiştir"i).
  let imgRoot = folder;
  if (rawShots) {
    imgRoot = await realOr(expandPath(rawShots));
    try {
      const st = await stat(imgRoot);
      if (!st.isDirectory()) {
        return NextResponse.json({ error: "shotsRoot bir klasör değil" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: `Ekran klasörü bulunamadı: ${imgRoot}` }, { status: 404 });
    }
  }

  try {
    const locales = await readLocales(folder);

    // 1) Dil kovaları — her `<imgRoot>/<code>/` kendi listesine.
    const localeDirs = await findLocaleDirs(imgRoot, locales.map((l) => l.code));
    const skip = new Set(localeDirs.values());
    const seen = new Set<string>();
    const localeImages: Record<string, ImageRef[]> = {};
    for (const [code, dir] of localeDirs) {
      const buckets: Buckets = new Map();
      await walkImages(dir, DEPTH_LOCALE, {
        base: imgRoot,
        seen,
        buckets,
        counter: { n: 0 },
        cap: SCAN_CAP,
      });
      const picked = pickBalanced(buckets, MAX_LOCALE_IMAGES);
      if (picked.length) localeImages[code] = toRefs(picked);
    }

    // 2) Ortak havuz — dil klasörleri HARİÇ: önce kökün kendisi, sonra bir üstü.
    //    (Dil klasörü yoksa bu tarama eskisiyle birebir aynı sonucu verir.)
    const parent = path.dirname(imgRoot);
    const shared: Buckets = new Map();
    const counter = { n: 0 };
    await walkImages(imgRoot, DEPTH_SELF, { base: imgRoot, seen, buckets: shared, counter, cap: SCAN_CAP, skip });
    if (parent !== imgRoot) {
      await walkImages(parent, DEPTH_PARENT, { base: parent, seen, buckets: shared, counter, cap: SCAN_CAP, skip });
    }
    const images = toRefs(pickBalanced(shared, MAX_IMAGES));

    // GET'in dosyayı verebilmesi için kökleri izin listesine yaz.
    const allow = [folder, path.dirname(folder), imgRoot, parent].filter(
      (p, i, a) => p && a.indexOf(p) === i
    );
    await addRoots(allow);

    return NextResponse.json({
      folder,
      shotsRoot: imgRoot,
      pickedLocale,
      locales,
      images,
      localeImages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
   GET ?browse= — Gözat dizin listesi (salt readdir, ev klasörü köklü)
 * ------------------------------------------------------------------ */

type BrowseDir = {
  name: string;
  /** Klasörde kare içerebilecek bir .md var mı — ağaçta "burada MD var" işareti. */
  hasMd: boolean;
  /** Klasörün DOĞRUDAN içindeki görsel sayısı (alt klasörler sayılmaz). */
  imgCount: number;
  /** Açılabilir mi — ağaç UI'ının ok göstermesi için. */
  hasChildren: boolean;
};

/** Tek seviyelik sayım — dosya içeriği asla okunmaz. */
async function probeDir(abs: string): Promise<Omit<BrowseDir, "name">> {
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return { hasMd: false, imgCount: 0, hasChildren: false };
  }
  let hasMd = false;
  let imgCount = 0;
  let hasChildren = false;
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) hasChildren = true;
      continue;
    }
    if (!e.isFile()) continue;
    if (MD_RE.test(e.name)) hasMd = true;
    else if (IMG_RE.test(e.name)) imgCount++;
  }
  return { hasMd, imgCount, hasChildren };
}

async function browseDir(raw: string): Promise<Response> {
  const home = await homeRoot();
  const target = await realOr(expandPath(raw.trim() || home));

  if (!isInside(home, target)) {
    return NextResponse.json({ error: "Sadece ev klasörünün altı gezilebilir" }, { status: 403 });
  }

  let entries;
  try {
    const st = await stat(target);
    if (!st.isDirectory()) {
      return NextResponse.json({ error: "Bu bir klasör değil" }, { status: 400 });
    }
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: `Klasör bulunamadı: ${target}` }, { status: 404 });
  }

  const dirNames: string[] = [];
  const mdFiles: string[] = [];
  let imgCount = 0;
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) dirNames.push(e.name);
      continue;
    }
    if (!e.isFile()) continue;
    if (MD_RE.test(e.name)) mdFiles.push(e.name);
    else if (IMG_RE.test(e.name)) imgCount++;
  }
  dirNames.sort((a, b) => a.localeCompare(b));
  mdFiles.sort((a, b) => a.localeCompare(b));

  const truncated = dirNames.length > BROWSE_DIR_CAP;
  const shown = truncated ? dirNames.slice(0, BROWSE_DIR_CAP) : dirNames;
  const dirs: BrowseDir[] = await Promise.all(
    shown.map(async (name) => ({ name, ...(await probeDir(path.join(target, name))) }))
  );

  return NextResponse.json({
    path: target,
    // Ev klasöründeyken yukarı çıkılmaz.
    parent: target === home ? null : path.dirname(target),
    home,
    dirs,
    mdFiles,
    imgCount,
    truncated,
  });
}

/* ------------------------------------------------------------------ *
   GET — taranan ağaçtaki bir görseli servis et
 * ------------------------------------------------------------------ */

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;

  const browse = sp.get("browse");
  if (browse !== null) return browseDir(browse);

  const file = sp.get("file");
  if (!file) return NextResponse.json({ error: "file gerekli" }, { status: 400 });

  const target = await realOr(path.resolve(file));
  if (!IMG_RE.test(target)) {
    return NextResponse.json({ error: "Sadece görsel servis edilir" }, { status: 403 });
  }

  if (!(await isAllowedFile(target))) {
    return NextResponse.json({ error: "Bu dosya taranan klasör ağacında değil" }, { status: 403 });
  }

  try {
    const st = await stat(target);
    if (!st.isFile()) return NextResponse.json({ error: "Dosya değil" }, { status: 404 });
    const buf = await readFile(target);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(st.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Okunamadı" }, { status: 404 });
  }
}
