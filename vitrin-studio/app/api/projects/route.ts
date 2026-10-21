// Proje deposu — data/projects/<id>.json

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { asRecord } from "@/lib/wiro";
import { FORMATS } from "@/engine/types";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "data", "projects");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Summary = { id: string; app: string; createdAt: string; locales: string[]; format?: string };

function fileFor(id: string): string {
  return path.join(DIR, `${id}.json`);
}

async function readProject(id: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(fileFor(id), "utf8");
    const parsed = asRecord(JSON.parse(raw) as unknown);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function summarize(id: string, project: Record<string, unknown>): Summary {
  const sets = asRecord(project.sets);
  return {
    id: String(project.id ?? id),
    app: String(project.app ?? ""),
    createdAt: String(project.createdAt ?? ""),
    locales: Object.keys(sets),
    format: typeof project.format === "string" && project.format in FORMATS ? project.format : "iphone",
  };
}

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");

  try {
    if (id) {
      if (!ID_RE.test(id)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });
      const project = await readProject(id);
      if (!project) return NextResponse.json({ error: "Proje bulunamadı" }, { status: 404 });
      return NextResponse.json({ project });
    }

    await mkdir(DIR, { recursive: true });
    const names = await readdir(DIR);
    const projects: Summary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const pid = name.slice(0, -5);
      const project = await readProject(pid);
      if (project) projects.push(summarize(pid, project));
    }
    // En yeni önce
    projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
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
    await writeFile(fileFor(id), JSON.stringify(project), "utf8");
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Geçersiz id" }, { status: 400 });

  try {
    await rm(fileFor(id), { force: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
