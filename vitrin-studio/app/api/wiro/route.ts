// Görsel üretimi — arka plan (gpt-image-2) ve şeffaf prop (gpt-image-1-5).
// 60-120 sn sürebilir; maxDuration 300.

import { NextResponse } from "next/server";

import { generateImage } from "@/lib/wiro";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { action?: string; prompt?: string; quality?: string };

const QUALITIES = new Set(["low", "medium", "high"]);

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt gerekli" }, { status: 400 });

  const requested = String(body.quality ?? "").trim().toLowerCase();
  const quality = QUALITIES.has(requested) ? requested : "high";

  try {
    if (action === "background") {
      // Tam kanvas arka plan — alfa gerekmez
      const filePath = await generateImage({
        model: "gpt-image-2",
        prompt,
        size: "9:16", // dikey App Store kadrajına en yakın oran (gpt-image-2 "ratio")
        quality,
        background: "opaque",
      });
      return NextResponse.json({ ok: true, path: filePath });
    }

    if (action === "prop") {
      // Katmanlanacak nesne — şeffaf arka plan şart
      const filePath = await generateImage({
        model: "gpt-image-1-5",
        prompt,
        size: "1:1",
        quality,
        background: "transparent",
      });
      return NextResponse.json({ ok: true, path: filePath });
    }

    return NextResponse.json({ error: `Bilinmeyen action: ${action || "(boş)"}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
