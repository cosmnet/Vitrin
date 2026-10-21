// POST /api/sync/import — MD klasörünü PROJEYE aktar (sunucu tarafı doImport).
//
// NEDEN VAR: `components/dialogs.tsx::doImport` MD kareleri ile ekran
// görüntülerini `lib/mdframes.ts`teki dört turlu puanlayıcıyla eşleştiriyor
// (~470 satır: token'lama, TR aksan düşürme, durak kelimeler, tekil/tekrar
// turları). MCP saf Node olduğu için o modülü import edemez; kopyalamak
// "iki eşleştirici, iki davranış" demekti. Bunun yerine akışın TAMAMI burada,
// doImport ile BİREBİR aynı sırayla koşuyor:
//
//   1) /api/ingest      → dil kovaları + ortak havuz
//   2) matchFramesToImages / matchFrames2ToImages  → kare ↔ görsel
//   3) /api/shots       → eşleşen görselleri data/shots'a kalıcı kopyala
//   4) slayt kurulumu   → designKey = "f<kare no>", giysi şablondan
//   5) proje JSON'una yaz
//
// FARK: doImport kullanıcının ızgarada kapattığı kartları atlar (`chosen`).
// Burada arayüz yok — bir kareye DÜŞEN her görsel kullanılır, yani "hiçbir
// kartı kapatmadan İçe Aktar'a basmak" ile aynı sonuç çıkar.

import { NextResponse } from "next/server";

import { getTemplate } from "@/engine/templates";
import { uid, type Project, type Screenshot, type Slide } from "@/engine/types";
import {
  frameScreenPatch,
  matchFrames2ToImages,
  matchFramesToImages,
  type ImageRef,
  type MdFrame,
} from "@/lib/mdframes";
import { asRecord } from "@/lib/wiro";

import { readProject, selfPost, writeProject } from "../store";

export const runtime = "nodejs";
export const maxDuration = 300;

const pad2 = (n: number): string => String(n).padStart(2, "0");

type ScanResult = {
  folder: string;
  shotsRoot: string;
  pickedLocale?: string;
  locales: { code: string; frames: MdFrame[] }[];
  images: ImageRef[];
  localeImages?: Record<string, ImageRef[]>;
};

/** `/api/ingest?file=<abs>` → `<abs>`; başka biçimdeki URL'de null. */
function ingestSource(url: string): string | null {
  if (!url.startsWith("/api/ingest?")) return null;
  const m = /[?&]file=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Eşleşen görselleri `data/shots/` altına kopyalatır: tarama URL'si → kalıcı URL. */
async function materializeShots(req: Request, images: ImageRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const im of images) {
    const abs = ingestSource(im.url);
    if (!abs) out.set(im.url, im.url); // /assets, data: … zaten kalıcı
    else if (!byPath.has(abs)) byPath.set(abs, im.url);
  }
  if (!byPath.size) return out;
  try {
    const r = await selfPost<{ shots: { source: string; url?: string }[] }>(req, "/api/shots", {
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

function readCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    const s = String(raw ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out : null;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const rec = asRecord(body);
  const projectId = String(rec.projectId ?? "").trim();
  const folder = String(rec.folder ?? rec.path ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "projectId gerekli" }, { status: 400 });
  if (!folder) return NextResponse.json({ error: "folder gerekli" }, { status: 400 });

  const shotsRoot = String(rec.shotsRoot ?? "").trim();
  const templateId = String(rec.templateId ?? "clean-apple").trim();
  const byNumber = rec.byNumber !== false; // varsayılan: numara eşlemesi AÇIK
  const wanted = readCodes(rec.locales);

  const p: Project | null = await readProject(projectId);
  if (!p) return NextResponse.json({ error: "Proje bulunamadı" }, { status: 404 });

  let scan: ScanResult;
  try {
    scan = await selfPost<ScanResult>(req, "/api/ingest", {
      path: folder,
      shotsRoot: shotsRoot || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!scan.locales.length) {
    return NextResponse.json(
      { error: "Bu klasörde kare içeren .md dosyası bulunamadı" },
      { status: 400 }
    );
  }

  const picked = wanted
    ? scan.locales.filter((l) => wanted.includes(l.code))
    : scan.locales;
  if (!picked.length) {
    return NextResponse.json(
      {
        error: `İstenen dil bulunamadı — klasörde olanlar: ${scan.locales
          .map((l) => l.code)
          .join(", ")}`,
      },
      { status: 400 }
    );
  }

  // --- Eşleştirme: her dilin havuzu ÖNCE kendi klasörü, sonra ortak havuz ---
  const used = new Map<string, ImageRef>();
  const take = (im: ImageRef | null | undefined): ImageRef | null => {
    if (!im) return null;
    used.set(im.url, im);
    return im;
  };
  const plan = picked.map((loc) => {
    const pool = [...(scan.localeImages?.[loc.code] ?? []), ...scan.images];
    const m1 = matchFramesToImages(loc.frames, pool, { byNumber });
    const m2 = matchFrames2ToImages(loc.frames, pool, { byNumber, avoid: m1 });
    return {
      code: loc.code,
      frames: loc.frames,
      matches: loc.frames.map((_, i) => take(m1[i])),
      matches2: loc.frames.map((_, i) => take(m2[i])),
    };
  });

  // --- Kalıcı kopya: proje JSON'u kaynak klasöre bağımlı kalmasın ---
  const stable = await materializeShots(req, [...used.values()]);
  const at = (im: ImageRef | null): ImageRef | null =>
    im ? { name: im.name, url: stable.get(im.url) ?? im.url } : null;

  // --- Slayt kurulumu (doImport ile birebir) ---
  const tpl = getTemplate(templateId);
  const built: Record<string, Slide[]> = {};
  for (const row of plan) {
    built[row.code] = row.frames.map((f, i) => {
      const slide: Slide = {
        id: uid(),
        ...tpl.style(i),
        // Diller arası eşleştirme anahtarı — MD kare no'su, index DEĞİL.
        designKey: `f${pad2(f.no)}`,
        headline: f.headline,
        sub: f.sub,
        badge: f.eyebrow,
        ...frameScreenPatch(f, at(row.matches[i]), at(row.matches2[i])),
      };
      if (f.laurel) slide.ornament = { kind: "laurel", text: f.laurel };
      return slide;
    });
  }

  // --- Projeye yaz ---
  p.screenshots ??= [];
  p.sets ??= {};
  const added: Screenshot[] = [];
  for (const im of used.values()) {
    const url = stable.get(im.url) ?? im.url;
    if (p.screenshots.some((s) => s.dataUrl === url)) continue;
    const shot: Screenshot = { id: uid(), name: im.name, dataUrl: url };
    p.screenshots.push(shot);
    added.push(shot);
  }
  for (const [code, slides] of Object.entries(built)) {
    p.sets[code] = { app: p.app, locale: code, slides };
  }
  const firstCode = plan[0].code;
  p.activeLocale = firstCode;

  try {
    await writeProject(p);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    app: p.app,
    folder: scan.folder,
    shotsRoot: scan.shotsRoot,
    templateId: tpl.id,
    activeLocale: firstCode,
    screenshotsAdded: added.length,
    screenshotsTotal: p.screenshots.length,
    available: scan.locales.map((l) => ({ code: l.code, frames: l.frames.length })),
    locales: plan.map((row) => ({
      code: row.code,
      slides: built[row.code].length,
      matched: row.matches.filter(Boolean).length,
      matched2: row.matches2.filter(Boolean).length,
      unmatched: row.frames
        .map((f, i) => (row.matches[i] ? null : pad2(f.no)))
        .filter((x): x is string => x !== null),
    })),
  });
}
