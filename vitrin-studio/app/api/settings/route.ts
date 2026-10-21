// Ayarlar — API anahtarlarını .env'e yazar ve çalışan sürece hemen uygular
// (wiro/director anahtarı her istekte process.env'den okur; yeniden başlatma gerekmez).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import pkg from "@/package.json";

export const runtime = "nodejs";

const ENV_FILE = path.join(process.cwd(), ".env");
const KEYS = ["WIRO_API_KEY", "WIRO_API_SECRET", "ANTHROPIC_API_KEY"] as const;
type Key = (typeof KEYS)[number];

/** Anahtarın kendisi tarayıcıya hiç gitmez; yalnız son 4 hanesi. */
const mask = (v: string) => (v ? `••••${v.slice(-4)}` : "");

/** Başka bir siteden gelen isteği reddet: yalnız stüdyonun kendi sayfası yazabilir. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function assetsVersion(): Promise<string> {
  try {
    return (await readFile(path.join(process.cwd(), "public", "assets", ".version"), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function GET() {
  const keys = Object.fromEntries(KEYS.map((k) => [k, mask((process.env[k] || "").trim())])) as Record<Key, string>;
  return NextResponse.json({ keys, version: pkg.version, assets: await assetsVersion(), dir: process.cwd() });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "İzin yok." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Partial<Record<Key, unknown>>;
  const updates = KEYS.filter((k) => typeof body[k] === "string").map((k) => [k, String(body[k]).trim()] as const);
  if (updates.some(([, v]) => /[\r\n]/.test(v))) return NextResponse.json({ error: "Geçersiz değer." }, { status: 400 });

  let lines: string[] = [];
  try {
    lines = (await readFile(ENV_FILE, "utf8")).split("\n");
  } catch {}
  for (const [k, v] of updates) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.splice(lines.length && lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${k}=${v}`);
    process.env[k] = v;
  }
  await writeFile(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  return GET();
}
