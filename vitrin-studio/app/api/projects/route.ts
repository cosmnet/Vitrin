// Proje deposu — data/projects/<id>.json
//
// v1.0 ekleri (hepsi TOPLAMSAL, eski çağrılar aynen çalışır):
//   GET  /api/projects              → özetler + updatedAt, slayt sayısı, küçük resim var mı
//                                     (özet mtime'a göre önbellekte — 300 MB'lık proje her
//                                     açılışta yeniden ayrıştırılmaz)
//   GET  /api/projects?trash=1      → çöp kutusundaki projeler
//   GET  /api/projects?thumb=<id>   → küçük resim (webp)
//   POST /api/projects?thumb=<id>   → küçük resim yaz (gövde = görsel baytları)
//   POST /api/projects?restore=<id> → çöpten geri al
//   DELETE /api/projects?id=a,b,c   → ÇÖPE taşı (eskiden kalıcı siliyordu)
//   DELETE /api/projects?purge=1[&id=..] → çöpten kalıcı sil (yalnız kullanıcının açık isteğiyle)

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { asRecord } from "@/lib/wiro";
import { FORMATS } from "@/engine/types";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "data", "projects");
const TRASH = path.join(DIR, ".trash");
const THUMBS = path.join(DIR, ".thumbs");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Summary = {
  id: string;
  app: string;
  createdAt: string;
  updatedAt: string;
  locales: string[];
  format?: string;
  slides: number;
  shots: number;
  bytes: number;
  thumb: boolean;
};

function fileFor(id: string, dir = DIR): string {
  return path.join(dir, `${id}.json`);
}

async function readProject(id: string, dir = DIR): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(fileFor(id, dir), "utf8");
    const parsed = asRecord(JSON.parse(raw) as unknown);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function summarize(id: string, project: Record<string, unknown>): Omit<Summary, "updatedAt" | "bytes" | "thumb"> {
  const sets = asRecord(project.sets);
  const active = asRecord(sets[String(project.activeLocale ?? "")] ?? Object.values(sets)[0]);
  return {
    id: String(project.id ?? id),
    app: String(project.app ?? ""),
    createdAt: String(project.createdAt ?? ""),
    locales: Object.keys(sets),
    format: typeof project.format === "string" && project.format in FORMATS ? project.format : "iphone",
    slides: Array.isArray(active.slides) ? active.slides.length : 0,
    shots: Array.isArray(project.screenshots) ? project.screenshots.length : 0,
  };
}

/** mtime+boyut anahtarlı özet önbelleği (süreç ömrü boyunca). */
const cache = new Map<string, { key: string; s: Omit<Summary, "updatedAt" | "bytes" | "thumb"> }>();

async function listDir(dir: string): Promise<Summary[]> {
  await mkdir(dir, { recursive: true });
  const names = await readdir(dir);
  const thumbs = new Set(await readdir(THUMBS).catch(() => [] as string[]));
  const out: Summary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const pid = name.slice(0, -5);
    const st = await stat(path.join(dir, name)).catch(() => null);
    if (!st) continue;
    const key = `${dir}|${st.mtimeMs}|${st.size}`;
    let hit = cache.get(`${dir}/${pid}`);
    if (!hit || hit.key !== key) {
      const project = await readProject(pid, dir);
      if (!project) continue;
      hit = { key, s: summarize(pid, project) };
      cache.set(`${dir}/${pid}`, hit);
    }
    out.push({ ...hit.s, updatedAt: new Date(st.mtimeMs).toISOString(), bytes: st.size, thumb: thumbs.has(`${pid}.webp`) });
  }
  // En son düzenlenen önce
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  const thumb = q.get("thumb");

  try {
    if (thumb) {
      if (!ID_RE.test(thumb)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });
      const buf = await readFile(path.join(THUMBS, `${thumb}.webp`)).catch(() => null);
      if (!buf) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "no-cache" } });
    }
    if (id) {
      if (!ID_RE.test(id)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });
      const project = await readProject(id);
      if (!project) return NextResponse.json({ error: "Proje bulunamadı" }, { status: 404 });
      return NextResponse.json({ project });
    }
    if (q.get("trash") === "1") return NextResponse.json({ projects: await listDir(TRASH) });
    return NextResponse.json({ projects: await listDir(DIR) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const writeQueue = new Map<string, Promise<void>>();

export async function POST(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;

  // --- küçük resim ---
  const thumb = q.get("thumb");
  if (thumb) {
    if (!ID_RE.test(thumb)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length || buf.length > 4 * 1024 * 1024) return NextResponse.json({ error: "Geçersiz görsel" }, { status: 400 });
    await mkdir(THUMBS, { recursive: true });
    await writeFile(path.join(THUMBS, `${thumb}.webp`), buf);
    return NextResponse.json({ ok: true });
  }

  // --- çöpten geri al ---
  const restore = q.get("restore");
  if (restore) {
    const ids = restore.split(",").filter((x) => ID_RE.test(x));
    for (const rid of ids) {
      await rename(fileFor(rid, TRASH), fileFor(rid)).catch(() => {});
    }
    return NextResponse.json({ ok: true, restored: ids.length });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const project = asRecord(asRecord(body).project);
  const id = String(project.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "project.id gerekli" }, { status: 400 });
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });

  try {
    await mkdir(DIR, { recursive: true });
    // Atomik ve sıralı yazım: büyük projede (yüzlerce MB) üst üste binen iki
    // otomatik kayıt dosyayı bozuyordu (sonuna fazladan bayt). Her kayıt
    // önce geçici dosyaya yazılır, sonra tek hamlede yerine taşınır; aynı
    // projenin kayıtları bir kuyrukta sırayla işlenir.
    const json = JSON.stringify(project);
    const prev = writeQueue.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const tmp = `${fileFor(id)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, json, "utf8");
      await rename(tmp, fileFor(id));
    });
    writeQueue.set(id, next);
    await next;
    if (writeQueue.get(id) === next) writeQueue.delete(id);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const raw = q.get("id");
  const ids = (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.some((x) => !ID_RE.test(x))) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });

  try {
    // Çöpten KALICI silme — yalnız kullanıcı "Çöpü boşalt" dediğinde.
    if (q.get("purge") === "1") {
      const targets = ids.length ? ids : (await readdir(TRASH).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
      for (const tid of targets) {
        await rm(fileFor(tid, TRASH), { force: true });
        await rm(path.join(THUMBS, `${tid}.webp`), { force: true });
      }
      return NextResponse.json({ ok: true, purged: targets.length });
    }
    if (!ids.length) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
    await mkdir(TRASH, { recursive: true });
    let moved = 0;
    for (const did of ids) {
      try {
        await rename(fileFor(did), fileFor(did, TRASH));
        moved++;
      } catch {
        /* zaten yok */
      }
    }
    return NextResponse.json({ ok: true, trashed: moved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
