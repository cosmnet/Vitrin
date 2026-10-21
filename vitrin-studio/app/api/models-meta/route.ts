// Model meta — public/assets/models/meta.json okur/yazar.
// SADECE GELİŞTİRME: /calibrate sayfasının kaydet düğmesi buraya POST eder.
// Üretimde 403 döner (dosya sistemine yazan bir uç prod'da açık kalmamalı).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "public", "assets", "models");
const FILE = path.join(DIR, "meta.json");

const isDev = process.env.NODE_ENV !== "production";

type ScreenCalib = {
  insetX: number;
  insetY: number;
  offsetX: number;
  offsetY: number;
  cornerRadiusRatio?: number;
};

type EntryPatch = {
  label?: string;
  kind?: string;
  version?: number;
  screen?: Partial<ScreenCalib>;
  hidden?: boolean;
  attribution?: string;
};

type MetaFile = { schema?: number; models?: Record<string, EntryPatch> };

type PostBody = {
  /** "iphone-15promax.glb" — zorunlu */
  file?: string;
  screen?: Partial<ScreenCalib>;
  /** verilmezse mevcut sürüm +1 (kalibrasyon değiştiyse önbellek kırılmalı) */
  version?: number;
  /** true → sürüm artırma (sadece kalibrasyon tazeliyorum) */
  keepVersion?: boolean;
  label?: string;
  kind?: string;
  hidden?: boolean;
  attribution?: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

async function readMeta(): Promise<MetaFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as MetaFile;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* yok / bozuk → boş */
  }
  return { schema: 1, models: {} };
}

export async function GET(): Promise<Response> {
  const meta = await readMeta();
  return NextResponse.json(meta, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isDev) {
    return NextResponse.json({ error: "Sadece geliştirme modunda" }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const file = String(body.file ?? "").trim();
  // Path traversal / şema koruması: sadece düz .glb dosya adı.
  if (!/^[A-Za-z0-9._-]+\.glb$/i.test(file)) {
    return NextResponse.json({ error: "Geçersiz model dosya adı" }, { status: 400 });
  }

  const meta = await readMeta();
  if (!meta.models || typeof meta.models !== "object") meta.models = {};
  const prev: EntryPatch = meta.models[file] ?? {};
  const next: EntryPatch = { ...prev };

  if (body.screen && typeof body.screen === "object") {
    const s = body.screen;
    const base: Partial<ScreenCalib> = prev.screen ?? {};
    const ix = num(s.insetX) ?? num(base.insetX) ?? 0.985;
    const iy = num(s.insetY) ?? num(base.insetY) ?? 0.992;
    const ox = num(s.offsetX) ?? num(base.offsetX) ?? 0;
    const oy = num(s.offsetY) ?? num(base.offsetY) ?? 0;
    const cr = num(s.cornerRadiusRatio) ?? num(base.cornerRadiusRatio) ?? 0.19;
    next.screen = {
      insetX: Number(clamp(ix, 0.5, 1.5).toFixed(5)),
      insetY: Number(clamp(iy, 0.5, 1.5).toFixed(5)),
      offsetX: Number(clamp(ox, -0.5, 0.5).toFixed(5)),
      offsetY: Number(clamp(oy, -0.5, 0.5).toFixed(5)),
      cornerRadiusRatio: Number(clamp(cr, 0, 0.5).toFixed(5)),
    };
  }

  if (typeof body.label === "string" && body.label.trim()) next.label = body.label.trim();
  if (body.kind === "phone" || body.kind === "tablet" || body.kind === "watch" || body.kind === "prop") next.kind = body.kind;
  if (typeof body.hidden === "boolean") next.hidden = body.hidden;
  if (typeof body.attribution === "string") next.attribution = body.attribution;

  const explicit = num(body.version);
  if (explicit !== null && explicit >= 1) {
    next.version = Math.floor(explicit);
  } else if (body.keepVersion === true) {
    if (prev.version) next.version = prev.version;
  } else {
    // Kalibrasyon değişti → ?v= artır ki tarayıcı + _glbCache tazelensin.
    next.version = Math.floor(num(prev.version) ?? 2) + 1;
  }

  meta.schema = 1;
  meta.models[file] = next;

  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(meta, null, 2) + "\n", "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, file, entry: next, path: FILE });
}
