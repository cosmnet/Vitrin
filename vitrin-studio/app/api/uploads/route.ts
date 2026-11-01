// Sürükle-bırak / yapıştır görsel yükleme — dosyayı public/assets/stickers/yuklenen/
// altına yazar; Sticker çekmecesi ve slayt öğeleri oradan okur.
//
//   POST /api/uploads?name=<dosya adı>
//   gövde = dosyanın BAYTLARI (JSON değil; büyük görselde base64 şişmesi olmasın)
//
// Ad, içerik özetiyle biter: aynı görsel ikinci kez bırakılınca yeni dosya
// açılmaz, aynı yol döner. Yalnız görsel uzantıları kabul edilir.

import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "public", "assets", "stickers", "yuklenen");
const EXT: Record<string, string> = { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp", gif: "gif", svg: "svg" };
const MAX_BYTES = 40 * 1024 * 1024;

/** Dosya adı kökünü URL ve dosya sistemi için güvenli yapar (Türkçe harfler sadeleşir). */
function slug(name: string): string {
  return (
    name
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "gorsel"
  );
}

export async function POST(req: Request): Promise<Response> {
  const name = new URL(req.url).searchParams.get("name") || "gorsel.png";
  const ext = EXT[(name.split(".").pop() || "").toLowerCase()];
  if (!ext) {
    return NextResponse.json({ error: "Yalnız PNG, JPG, WebP, GIF ve SVG eklenebilir." }, { status: 415 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Dosya boş." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Dosya 40 MB'tan büyük." }, { status: 413 });

  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 8);
  const file = `${slug(name.replace(/\.[^.]+$/, ""))}-${hash}.${ext}`;
  const target = path.join(DIR, file);
  try {
    await mkdir(DIR, { recursive: true });
    try {
      await access(target);
    } catch {
      await writeFile(target, bytes);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ path: `yuklenen/${file}`, src: `/assets/stickers/yuklenen/${file}` });
}
