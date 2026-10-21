// Art Director — ekran görüntülerine bakıp App Store seti planlar.
// ANTHROPIC_API_KEY varsa vision'lı Claude, yoksa Wiro GPT 5.6 Sol (metin tabanlı) kullanılır.

import { NextResponse } from "next/server";

import { asRecord, langName, parseJsonBlock, runSol } from "@/lib/wiro";
import { formatOf, FORMATS, type Format } from "@/engine/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type ShotIn = { id?: string; name?: string; dataUrl?: string };
type Shot = { id: string; name: string; dataUrl: string };

type Body = {
  format?: Format;
  app?: string;
  brief?: string;
  locale?: string;
  n?: number;
  screenshots?: unknown;
  themeIds?: unknown;
  layoutIds?: unknown;
  keywords?: unknown;
};

export type DirectorSlide = {
  headline: string;
  sub: string;
  badge?: string;
  themeId: string;
  layout: string;
  screenshotId: string;
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_VISION_SHOTS = 12; // istek boyutunu makul tut
const ALLOWED_MEDIA = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const s = String(raw ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function readShots(value: unknown): Shot[] {
  if (!Array.isArray(value)) return [];
  const out: Shot[] = [];
  value.forEach((raw, i) => {
    const item = asRecord(raw) as ShotIn;
    const id = String(item.id ?? "").trim();
    if (!id) return;
    out.push({
      id,
      name: String(item.name ?? "").trim() || `Ekran ${i + 1}`,
      dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : "",
    });
  });
  return out;
}

/** data:image/png;base64,xxx -> { mediaType, data } */
function splitDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!ALLOWED_MEDIA.has(mediaType)) return null;
  const data = m[2].replace(/\s+/g, "");
  if (!data) return null;
  return { mediaType, data };
}

/** İki yolda da aynı görev tanımı kullanılır. */
function buildSystemPrompt(args: {
  format: Format;
  n: number;
  locale: string;
  themeIds: string[];
  layoutIds: string[];
  shotIds: string[];
}): string {
  const { n, locale, themeIds, layoutIds, shotIds } = args;
  return [
    "Sen deneyimli bir App Store kreatif direktörüsün.",
    `Hedef: ${FORMATS[args.format].label}.`,
    args.format.startsWith("iphone-duo") ? "Bu cihaz menteşeli tek bir katlanabilir iPhone Duo'dur. İki ayrı iPhone değildir. İç ekran geniş alanında kısa metin ve açık/kitap pozunda tek cihaz kullan. Kapak ekranı için dış ekran görüntüsünü seç." : "Ekran formatına uygun tek cihazlı kompozisyonları önceliklendir.",
    "Verilen ekran görüntülerine bakıp uygulamanın ne yaptığını anla, sonra satış odaklı bir anlatı kur.",
    `Tam olarak ${n} slayt planla.`,
    "İlk 3 slayt kancadır: sonuç odaklı, en fazla 5 kelimelik başlıklar.",
    "Akış: problem → çözüm → özellik → güven (sosyal kanıt / güvenlik / hız).",
    "Her slayt için en uygun ekranı, temayı ve layout'u sen seç; aynı ekranı gereksiz tekrar etme.",
    `Başlık ve alt metinler ${langName(locale)} (${locale}) dilinde olacak.`,
    "headline ≤ 32 karakter, sub ≤ 48 karakter. badge sadece gerçekten anlamlıysa (kısa, ≤ 12 karakter).",
    "SADECE JSON döndür, başka hiçbir metin yazma:",
    '{"slides":[{"headline":"...","sub":"...","badge":"...","themeId":"...","layout":"...","screenshotId":"..."}]}',
    `themeId SADECE şunlardan biri olabilir: ${themeIds.join(", ")}`,
    `layout SADECE şunlardan biri olabilir: ${layoutIds.join(", ")}`,
    `screenshotId SADECE şunlardan biri olabilir: ${shotIds.join(", ")}`,
  ].join("\n");
}

function buildUserBrief(args: {
  app: string;
  brief: string;
  keywords: string[];
  shots: Shot[];
  n: number;
}): string {
  const { app, brief, keywords, shots, n } = args;
  const lines = [`Uygulama: ${app}`];
  if (brief) lines.push(`Brief:\n${brief}`);
  if (keywords.length > 0) lines.push(`Anahtar kelimeler: ${keywords.join(", ")}`);
  lines.push(
    "Ekranlar:\n" + shots.map((s, i) => `${i + 1}. id=${s.id} — ${s.name}`).join("\n")
  );
  lines.push(`${n} slaytlık seti planla ve sadece JSON döndür.`);
  return lines.join("\n\n");
}

/** Claude Messages API — görselleri image block olarak yollar. */
async function askClaude(args: {
  apiKey: string;
  system: string;
  userBrief: string;
  shots: Shot[];
}): Promise<string> {
  const content: unknown[] = [];
  let sent = 0;
  for (const shot of args.shots) {
    if (sent >= MAX_VISION_SHOTS || !shot.dataUrl) continue;
    const parsed = splitDataUrl(shot.dataUrl);
    if (!parsed) continue;
    content.push({ type: "text", text: `Ekran id=${shot.id} — ${shot.name}` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    });
    sent += 1;
  }
  content.push({ type: "text", text: args.userBrief });

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model: process.env.DIRECTOR_MODEL || "claude-opus-5",
      max_tokens: 4000,
      system: args.system,
      messages: [{ role: "user", content }],
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic reddetti (${res.status}): ${text.slice(0, 300)}`);

  const payload = asRecord(JSON.parse(text) as unknown);
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const out = blocks
    .map((b) => {
      const block = asRecord(b);
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!out) throw new Error("Anthropic boş cevap döndürdü");
  return out;
}

/** Modelden geleni sertleştir: geçersiz id'leri düzelt, slayt sayısını n'e sabitle. */
function normalize(
  raw: unknown,
  ctx: { n: number; themeIds: string[]; layoutIds: string[]; shots: Shot[]; app: string }
): DirectorSlide[] {
  const rows0 = Array.isArray(raw) ? raw : asRecord(raw).slides;
  const rows = Array.isArray(rows0) ? rows0 : [];
  const shotIds = ctx.shots.map((s) => s.id);

  const pick = (value: unknown, allowed: string[], index: number): string => {
    const v = String(value ?? "").trim();
    if (allowed.includes(v)) return v;
    return allowed[index % allowed.length] ?? "";
  };

  const out: DirectorSlide[] = [];
  rows.forEach((row, i) => {
    const item = asRecord(row);
    const headline = String(item.headline ?? item.head ?? item.title ?? "").trim();
    const sub = String(item.sub ?? item.subtitle ?? item.subhead ?? "").trim();
    const badge = String(item.badge ?? "").trim();
    const slide: DirectorSlide = {
      headline: headline || ctx.app,
      sub,
      themeId: pick(item.themeId, ctx.themeIds, 0),
      layout: pick(item.layout, ctx.layoutIds, 0),
      screenshotId: pick(item.screenshotId ?? item.screenshot, shotIds, i),
    };
    if (badge) slide.badge = badge;
    out.push(slide);
  });

  // Fazlaysa kırp
  if (out.length > ctx.n) out.length = ctx.n;

  // Eksikse doldur (mevcut slaytları sırayla tohum alarak)
  const baseCount = out.length;
  while (out.length < ctx.n) {
    const i = out.length;
    const seed: DirectorSlide | null = baseCount > 0 ? out[i % baseCount] : null;
    out.push({
      headline: seed ? seed.headline : ctx.app,
      sub: seed ? seed.sub : "",
      themeId: ctx.themeIds[i % Math.max(1, ctx.themeIds.length)] ?? "",
      layout: ctx.layoutIds[i % Math.max(1, ctx.layoutIds.length)] ?? "",
      screenshotId: shotIds.length > 0 ? shotIds[i % shotIds.length] : "",
    });
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const app = String(body.app ?? "").trim();
  if (!app) return NextResponse.json({ error: "app gerekli" }, { status: 400 });

  const brief = String(body.brief ?? "").trim();
  const locale = String(body.locale ?? "tr").trim().toLowerCase() || "tr";
  const n = Math.max(1, Math.min(12, Math.round(Number(body.n) || 6)));
  const shots = readShots(body.screenshots);
  const themeIds = readStrings(body.themeIds);
  const layoutIds = readStrings(body.layoutIds);
  const keywords = readStrings(body.keywords);

  if (shots.length === 0) return NextResponse.json({ error: "screenshots boş" }, { status: 400 });
  if (themeIds.length === 0) return NextResponse.json({ error: "themeIds boş" }, { status: 400 });
  if (layoutIds.length === 0) return NextResponse.json({ error: "layoutIds boş" }, { status: 400 });

  const system = buildSystemPrompt({
    format: formatOf(body),
    n,
    locale,
    themeIds,
    layoutIds,
    shotIds: shots.map((s) => s.id),
  });
  const userBrief = buildUserBrief({ app, brief, keywords, shots, n });
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();

  try {
    const raw = apiKey
      ? await askClaude({ apiKey, system, userBrief, shots })
      : await runSol(userBrief, { system, reasoning: "medium" });

    const slides = normalize(parseJsonBlock(raw), { n, themeIds, layoutIds, shots, app });
    return NextResponse.json({ slides });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
