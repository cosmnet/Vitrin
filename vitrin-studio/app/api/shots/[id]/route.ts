// Kalıcı ekran görüntüsü servisi — data/shots altındaki kopyaları verir.
//
//   GET /api/shots/<sha1>.<png|jpg|jpeg|webp>
//
// Ad içerik-adresli olduğu için (bkz. ../route.ts) dosya asla değişmez:
// `immutable` cache ile tarayıcı bir daha sormaz. İsim deseni katı — yol
// kaçışı (`..`, alt klasör) daha regex'te elenir, ayrıca sonuç yine de
// depo klasörünün içinde mi diye kontrol edilir.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { isInside, MIME, SHOTS_DIR } from "@/lib/fsroots";

export const runtime = "nodejs";

const ID_RE = /^[a-f0-9]{40}\.(png|jpe?g|webp)$/i;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Geçersiz ekran adı" }, { status: 400 });
  }

  const target = path.join(SHOTS_DIR, id);
  if (!isInside(SHOTS_DIR, target)) {
    return NextResponse.json({ error: "Depo dışında" }, { status: 403 });
  }

  try {
    const st = await stat(target);
    if (!st.isFile()) return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
    const buf = await readFile(target);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }
}
