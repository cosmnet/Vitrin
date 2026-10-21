// Metin motoru — GPT 5.6 Sol üzerinden brief, slayt metni, çeviri ve toplu lokalizasyon.
// Prompt şablonları wiro_client.py'den birebir portlandı.

import { NextResponse } from "next/server";

import { asRecord, langName, parseJsonBlock, runSol } from "@/lib/wiro";

export const runtime = "nodejs";
export const maxDuration = 300;

type TextPair = { head: string; sub: string };

type Body = {
  action?: string;
  app?: string;
  brief?: string;
  lang?: string;
  targetLang?: string;
  texts?: unknown;
  langs?: unknown;
  n?: number;
};

/** Model cevabındaki slayt listesini {head, sub} çiftlerine indirger. */
function asSlides(data: unknown): TextPair[] {
  const rows = Array.isArray(data) ? data : asRecord(data).slides;
  if (!Array.isArray(rows)) return [];
  const out: TextPair[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    if (Object.keys(item).length === 0) continue;
    out.push({
      head: typeof item.head === "string" ? item.head : String(item.head ?? ""),
      sub: typeof item.sub === "string" ? item.sub : String(item.sub ?? ""),
    });
  }
  return out;
}

/** İstemden gelen metin listesini temizler. */
function readTexts(value: unknown): TextPair[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const item = asRecord(row);
    return {
      head: typeof item.head === "string" ? item.head : String(item.head ?? ""),
      sub: typeof item.sub === "string" ? item.sub : String(item.sub ?? ""),
    };
  });
}

function readLangs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const raw of value) {
    const code = String(raw ?? "").trim().toLowerCase();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  const app = String(body.app ?? "").trim();
  const brief = String(body.brief ?? "").trim();
  const lang = String(body.lang ?? "tr").trim().toLowerCase() || "tr";

  try {
    // --- brief'i yaratıcı brief'e çevir ---
    if (action === "write") {
      const system =
        "App Store screenshot copywriter. Write punchy marketing lines. " +
        `Language: ${langName(lang)}. No hashtags.`;
      const text = await runSol(
        `App: ${app}\nBrief:\n${brief}\n\nRewrite as a tight creative brief (4–8 short lines).`,
        { system }
      );
      return NextResponse.json({ text });
    }

    // --- slayt başlıkları ---
    if (action === "slides") {
      const n = Math.max(1, Math.min(12, Math.round(Number(body.n) || 6)));
      const system =
        "You write App Store screenshot headlines. " +
        'Reply with JSON only: {"slides":[{"head":"...","sub":"..."}]} ' +
        `Exactly ${n} slides. Language: ${langName(lang)}. ` +
        "head ≤ 32 chars, sub ≤ 48 chars.";
      const raw = await runSol(`App: ${app}\nBrief:\n${brief}`, { system, reasoning: "low" });
      const slides = asSlides(parseJsonBlock(raw)).filter((s) => s.head);
      return NextResponse.json({ slides });
    }

    // --- tek dile çeviri ---
    if (action === "translate") {
      const texts = readTexts(body.texts);
      if (texts.length === 0) return NextResponse.json({ error: "texts boş" }, { status: 400 });
      const target = String(body.targetLang ?? "").trim().toLowerCase();
      if (!target) return NextResponse.json({ error: "targetLang gerekli" }, { status: 400 });

      const raw = await runSol(JSON.stringify(texts), {
        system:
          `Translate each head and sub into ${langName(target)}. Keep meaning, keep them short. ` +
          'JSON only: {"slides":[{"head":"","sub":""}]}',
      });
      return NextResponse.json({ slides: asSlides(parseJsonBlock(raw)) });
    }

    // --- tüm dillere tek istekte lokalizasyon ---
    if (action === "localize") {
      const texts = readTexts(body.texts);
      if (texts.length === 0) return NextResponse.json({ error: "texts boş" }, { status: 400 });
      const codes = readLangs(body.langs);
      if (codes.length === 0) return NextResponse.json({ packs: {} });

      const labeled = codes.map((c) => `${c} (${langName(c)})`).join(", ");
      const shape = codes.map((c) => `"${c}":[{"head":"...","sub":"..."}]`).join(", ");
      const raw = await runSol(JSON.stringify(texts), {
        system:
          `Localize each head and sub into ALL of these languages in one reply: ${labeled}. ` +
          "Keep meaning, keep them short, same slide count and order. " +
          `JSON only: {${shape}}`,
      });

      const parsed = parseJsonBlock(raw);
      let data = asRecord(parsed);
      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "Model dil paketleri döndürmedi" }, { status: 502 });
      }
      // Model bazen {"packs": {...}} sarmalıyor
      const wrapped = asRecord(data.packs);
      if (Object.keys(wrapped).length > 0) data = wrapped;

      const packs: Record<string, TextPair[]> = {};
      for (const code of codes) {
        const items =
          data[code] ?? data[code.toUpperCase()] ?? data[langName(code)] ?? data[langName(code).toLowerCase()];
        packs[code] = asSlides(items);
      }
      return NextResponse.json({ packs });
    }

    return NextResponse.json({ error: `Bilinmeyen action: ${action || "(boş)"}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
