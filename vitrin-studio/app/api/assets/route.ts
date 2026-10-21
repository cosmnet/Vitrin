// Asset envanteri — public/assets altındaki dosya adlarını listeler.

import { readdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ROOT = path.join(process.cwd(), "public", "assets");
const FOLDERS = [
  "fonts",
  "bg",
  "textures",
  "models",
  "stickers",
  "generated",
  "brand",
] as const;
type Folder = (typeof FOLDERS)[number];

// R8/W2: sticker çekmecesi `stickers/pale/` altındaki 30 gradyanı da listeler.
// Alt klasör adları YOLA katılır ("pale/x.png"), böylece istemci `/assets/
// stickers/${ad}` kalıbını değiştirmeden kullanabilir. Yalnız bu klasör için:
// diğerleri düz kalır, mevcut tüketiciler etkilenmez.
// R14: `brand/<uygulama>/` marka varlıkları (logo, maskot, pano) da iç içe.
const NESTED: ReadonlySet<Folder> = new Set<Folder>(["stickers", "brand"]);

/** Klasördeki dosya adları; klasör yoksa boş dizi. Gizli dosyalar atlanır. */
async function listFolder(name: Folder): Promise<string[]> {
  try {
    const entries = await readdir(path.join(ROOT, name), { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name);
    if (NESTED.has(name)) {
      for (const d of entries.filter((e) => e.isDirectory() && !e.name.startsWith("."))) {
        try {
          const sub = await readdir(path.join(ROOT, name, d.name), { withFileTypes: true });
          for (const f of sub) {
            if (f.isFile() && !f.name.startsWith(".")) files.push(`${d.name}/${f.name}`);
          }
        } catch {
          /* alt klasör okunamadı — yok say */
        }
      }
    }
    return files.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function GET(): Promise<Response> {
  try {
    const lists = await Promise.all(FOLDERS.map((f) => listFolder(f)));
    const out = {} as Record<Folder, string[]>;
    FOLDERS.forEach((folder, i) => {
      out[folder] = lists[i];
    });
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
