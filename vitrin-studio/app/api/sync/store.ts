// Vitrin MCP köprüsü — ortak proje deposu erişimi (app/api/sync/** için).
//
// NEDEN AYRI DOSYA: `app/api/projects/route.ts` yol/ID kurallarını dışa
// vermiyor (sadece HTTP). MCP tarafındaki üç sync route'u da aynı dosyaya
// yazıyor; kuralı üç kez kopyalamak yerine burada TEK yerde tutuluyor.
// Yol ve ID deseni /api/projects ile BİREBİR aynıdır — ikisi aynı dosyaları
// görür, tek yazma yolu vardır.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Project } from "@/engine/types";

export const PROJECTS_DIR = path.join(process.cwd(), "data", "projects");
export const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function projectFile(id: string): string {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

/** Projeyi diskten okur. Bulunamaz/bozuksa null. */
export async function readProject(id: string): Promise<Project | null> {
  if (!PROJECT_ID_RE.test(id)) return null;
  try {
    const raw = await readFile(projectFile(id), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Project;
  } catch {
    return null;
  }
}

/** Projeyi diske yazar (POST /api/projects ile aynı biçim: tek satır JSON). */
export async function writeProject(p: Project): Promise<void> {
  if (!p.id || !PROJECT_ID_RE.test(p.id)) throw new Error("Geçersiz proje id");
  await mkdir(PROJECTS_DIR, { recursive: true });
  await writeFile(projectFile(p.id), JSON.stringify(p), "utf8");
}

/** Aynı sunucudaki başka bir route'a çağrı — `req.url` kökünü kullanır. */
export async function selfPost<T>(req: Request, route: string, body: unknown): Promise<T> {
  const res = await fetch(new URL(route, req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `${route} başarısız (${res.status})`);
  return data;
}
