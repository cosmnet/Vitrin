// Export — PNG'leri ~/Desktop/Vitrin/<uygulama>/<locale>/ altına yazar.
//
// R7 / Wave-5 — TOPLAMSAL EK: gövde opsiyonel `subPath` alabilir. Verilirse
// `<locale>` yerine o alt yol kullanılır (fastlane: "screenshots/tr"). Her
// parça ayrı ayrı safeSegment'ten geçer, ".." hiçbir zaman hayatta kalmaz ve
// yazma öncesi kök-içinde-mi kontrolü zaten var. subPath YOKSA sözleşme
// bugünküyle birebir aynıdır.
//
// R8 / Wave-5 — TOPLAMSAL EK: `?bin=1` HAM İKİLİ dalı (app preview video).
//   POST /api/export?bin=1&app=..&locale=..&subPath=..&file=..
//   gövde = dosyanın BAYTLARI (JSON değil)
// Neden ayrı dal: 30 sn'lik mp4 ~45 MB. base64 bunu ~60 MB string yapar,
// JSON.parse bir kopya daha, Buffer.from(b64) bir daha — 180 MB tepe ve
// saniyelerce blok. (Yukarıdaki "dev gövdelerde regex patlıyor" notu aynı
// yaranın izi.) Parçalı base64 ise sunucuda oturum durumu + geçici dosya
// birleştirme gerektirirdi. Ham gövde: tek arrayBuffer, tek writeFile.
// GÜVENLİK AYNI: segment temizliği ve kök-içinde-mi kontrolü ORTAK
// yardımcılardan gelir (resolveRoot / safeTarget), JSON dalıyla tek kod.
// bin parametresi YOKSA sözleşme bugünküyle birebir aynıdır.

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { asRecord } from "@/lib/wiro";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { app?: string; locale?: string; subPath?: unknown; images?: unknown };

/** Klasör adı olarak güvenli hale getirir (Türkçe karakterler korunur). */
function safeSegment(value: string, fallback: string): string {
  const cleaned = (value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "") // kontrol karakterleri
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 64)
    .trim();
  return cleaned || fallback;
}

/** dataURL veya çıplak base64 → Buffer.
 * Dev (40MB+) gövdelerde regex V8'de "Maximum call stack" patlatıyor —
 * bu yüzden ayrıştırma indexOf ile yapılır, regex kullanılmaz. */
function decodeDataUrl(dataUrl: string): Buffer | null {
  let b64 = dataUrl;
  if (b64.startsWith("data:")) {
    const comma = b64.indexOf(",");
    if (comma < 0) return null;
    b64 = b64.slice(comma + 1);
  }
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
   Ortak yol çözümü — JSON dalı da ikili dal da BURADAN geçer.
 * ------------------------------------------------------------------ */

/** `~/Desktop/Vitrin/<app>/<subPath ya da locale>` — her parça temizlenmiş. */
function resolveRoot(rawApp: string, rawLocale: string, rawSub: string): string {
  const app = safeSegment(rawApp, "Vitrin");
  const locale = safeSegment(rawLocale, "tr");
  const segments = rawSub
    ? rawSub
        .split(/[\\/]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s, i) => safeSegment(s, `bolum${i + 1}`))
        .slice(0, 4)
    : [];
  const rel = segments.length ? segments : [locale];
  return path.join(os.homedir(), "Desktop", "Vitrin", app, ...rel);
}

/** Kök İÇİNDE kalan mutlak hedef, yoksa null (path traversal koruması). */
function safeTarget(root: string, file: string): string | null {
  if (!file) return null;
  const target = path.resolve(root, file);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/* ------------------------------------------------------------------ *
   İKİLİ dal — tek dosya, ham gövde (video export). `?bin=1`
 * ------------------------------------------------------------------ */

async function writeBinary(req: Request, q: URLSearchParams): Promise<Response> {
  const file = String(q.get("file") ?? "").trim();
  if (!file) return NextResponse.json({ error: "file parametresi gerekli" }, { status: 400 });

  const root = resolveRoot(String(q.get("app") ?? ""), String(q.get("locale") ?? ""), String(q.get("subPath") ?? ""));
  const target = safeTarget(root, file);
  if (!target) return NextResponse.json({ error: "geçersiz dosya yolu" }, { status: 400 });

  let buf: Buffer;
  try {
    buf = Buffer.from(await req.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `gövde okunamadı: ${message}` }, { status: 400 });
  }
  if (!buf.length) return NextResponse.json({ error: "gövde boş" }, { status: 400 });

  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buf);
    return NextResponse.json({ ok: true, path: root, file, bytes: buf.length, written: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  // İkili dal gövdeyi JSON olarak OKUMADAN önce ayrılmalı.
  const q = new URL(req.url).searchParams;
  if (q.get("bin") === "1") return writeBinary(req, q);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövde" }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) return NextResponse.json({ error: "images boş" }, { status: 400 });

  // `<app>/` altındaki klasör zinciri: subPath verilmezse tek parça `<locale>`.
  const root = resolveRoot(
    String(body.app ?? ""),
    String(body.locale ?? ""),
    typeof body.subPath === "string" ? body.subPath : ""
  );

  try {
    await mkdir(root, { recursive: true });

    let written = 0;
    const skipped: string[] = [];

    for (const raw of images) {
      const item = asRecord(raw);
      const file = String(item.file ?? "").trim();
      const dataUrl = typeof item.dataUrl === "string" ? item.dataUrl : "";
      if (!file || !dataUrl) {
        skipped.push(file || "(adsız)");
        continue;
      }

      // Path traversal koruması: hedef kökün içinde kalmalı
      const target = safeTarget(root, file);
      if (!target) {
        skipped.push(file);
        continue;
      }

      const buf = decodeDataUrl(dataUrl);
      if (!buf) {
        skipped.push(file);
        continue;
      }

      await mkdir(path.dirname(target), { recursive: true }); // alt klasörler
      // App Store forbids an alpha channel, even when every pixel is opaque.
      const output = file.toLowerCase().endsWith(".png")
        ? await sharp(buf).flatten({ background: "#ffffff" }).removeAlpha().png({ compressionLevel: 6 }).toBuffer()
        : buf;
      await writeFile(target, output);
      written += 1;
    }

    return NextResponse.json({ ok: true, path: root, written, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
