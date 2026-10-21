// POST /api/sync — diller arası TASARIM SENKRONU (sunucu tarafı).
//
// NEDEN VAR: Vitrin MCP saf Node'da koşuyor; `engine/designsync.ts`i oradan
// import edemez (TS + `@/` alias + Next transpile). Ama designsync BİLEREK
// bağımlılık-hafif: yalnız `./fonts` ve `./types` import ediyor, `./fonts`ta
// da `document`/`FontFace` sadece FONKSİYON İÇİNDE geçiyor (modül tepesinde
// DOM erişimi YOK — `loadFonts()` zaten `typeof document === "undefined"`
// kontrolüyle başlıyor). Yani bu route motoru sunucuda güvenle çağırır ve
// DESIGN_FIELDS listesi MCP'ye kopyalanmak zorunda kalmaz: tek kaynak.
//
//   POST { projectId, from, to?: "all" | string[], slides?: "all" | number[],
//          order?: boolean }
//     → { ok, from, targets, touched, note }
//
//   from      kaynak dil (bu dilin tasarımı yayılır)
//   to        hedef diller · varsayılan "all" (kaynak hariç tüm diller)
//   slides    yalnız bu 0-tabanlı kaynak slaytlar yayılsın · varsayılan "all"
//   order     true ise slayt SIRASI da kaynağa göre hizalanır (syncOrder)
//
// Metin, ekran görüntüsü ve çelenk METNİ asla yayılmaz (bkz. designsync.ts).

import { NextResponse } from "next/server";

import {
  backfillDesignKeys,
  fanOutDesign,
  pickDesign,
  summarizeNotes,
  syncOrder,
  type SyncNote,
} from "@/engine/designsync";
import type { Project } from "@/engine/types";
import { asRecord } from "@/lib/wiro";

import { readProject, writeProject } from "./store";

export const runtime = "nodejs";
export const maxDuration = 300;

function readLocales(value: unknown): string[] | "all" {
  if (value === undefined || value === null || value === "all") return "all";
  if (typeof value === "string") return value === "all" ? "all" : [value];
  if (!Array.isArray(value)) return "all";
  const out: string[] = [];
  for (const raw of value) {
    const s = String(raw ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out : "all";
}

function readIndexes(value: unknown): "all" | number[] {
  if (value === undefined || value === null || value === "all") return "all";
  if (!Array.isArray(value)) return "all";
  const out: number[] = [];
  for (const raw of value) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n);
  }
  return out.length ? out : "all";
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const rec = asRecord(body);
  const projectId = String(rec.projectId ?? rec.id ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "projectId gerekli" }, { status: 400 });

  const from = String(rec.from ?? "").trim();
  const want = readLocales(rec.to);
  const slides = readIndexes(rec.slides);
  const order = rec.order === true;

  const p = await readProject(projectId);
  if (!p) return NextResponse.json({ error: "Proje bulunamadı" }, { status: 404 });

  backfillDesignKeys(p);

  const have = Object.keys(p.sets ?? {});
  const source = from || p.activeLocale;
  if (!have.includes(source)) {
    return NextResponse.json(
      { error: `Projede olmayan kaynak dil: ${source} — mevcut: ${have.join(", ")}` },
      { status: 400 }
    );
  }

  const targets = (want === "all" ? have : want).filter((l) => l !== source);
  const missing = targets.filter((l) => !have.includes(l));
  if (missing.length) {
    return NextResponse.json(
      { error: `Projede olmayan hedef dil: ${missing.join(", ")} — mevcut: ${have.join(", ")}` },
      { status: 400 }
    );
  }
  if (!targets.length) {
    return NextResponse.json({ ok: true, from: source, targets: [], touched: 0, note: null });
  }

  // fanOutDesign KAYNAK DIŞINDAKİ TÜM setlere yayar. Hedefi daraltmak için
  // aynı SetPlan NESNELERİNE bakan sığ bir görünüm kurulur: motor bu görünümü
  // yerinde değiştirdiğinde asıl proje de değişmiş olur (referans paylaşımı).
  const view: Project = {
    ...p,
    sets: Object.fromEntries([source, ...targets].map((l) => [l, p.sets[l]])),
  };

  const src = p.sets[source];
  const idx =
    slides === "all"
      ? src.slides.map((_, i) => i)
      : slides.filter((i) => i < src.slides.length);

  const notes: SyncNote[] = [];
  let touched = 0;
  for (const i of idx) {
    const s = src.slides[i];
    const r = fanOutDesign(view, source, s, i, pickDesign(s));
    notes.push(...r.notes);
    touched += r.touched;
  }
  if (order) syncOrder(view, source);

  try {
    await writeProject(p);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    from: source,
    targets,
    slides: idx.length,
    touched,
    ordered: order,
    note: summarizeNotes(notes),
  });
}
