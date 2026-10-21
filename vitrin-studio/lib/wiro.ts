// Wiro Run API istemcisi — GPT 5.6 Sol (metin) + gpt-image-2 / gpt-image-1-5 (görsel).
// Anahtarlar yalnızca process.env'den okunur, asla response'a sızmaz.
//
// Auth kontratı (doğrulanmış):
//   x-api-key:   WIRO_API_KEY
//   x-nonce:     unix SANİYE (milisaniye 403 döndürür)
//   x-signature: hex HMAC-SHA256(key = WIRO_API_KEY, msg = WIRO_API_SECRET + nonce)

import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = (process.env.WIRO_API_BASE_URL || "https://api.wiro.ai/v1").replace(/\/+$/, "");
const USER_AGENT = "VitrinStudio/1.0";
const MAX_BUFFER = 32 * 1024 * 1024;

// Poll ayarları: metin 40 deneme, görsel 90 deneme, 1.2 sn arayla.
const POLL_INTERVAL_MS = 1200;
const TEXT_TRIES = 40;
const IMAGE_TRIES = 90;

export class WiroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WiroError";
  }
}

// ---------- küçük yardımcılar ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** unknown -> düz nesne (dizi ve null hariç). */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------- imza ve HTTP ----------

function wiroHeaders(): Record<string, string> {
  const key = (process.env.WIRO_API_KEY || "").trim();
  const secret = (process.env.WIRO_API_SECRET || "").trim();
  if (!key) throw new WiroError("Wiro anahtarı girilmemiş; Ayarlar'dan ekle. / No Wiro key set; add it in Settings.");

  const nonce = String(Math.floor(Date.now() / 1000)); // SANİYE — ms 403 verir
  const headers: Record<string, string> = {
    "x-api-key": key,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (secret) {
    headers["x-nonce"] = nonce;
    headers["x-signature"] = createHmac("sha256", key).update(secret + nonce).digest("hex");
  }
  return headers;
}

/** curl config dosyası için değer kaçışı. */
function curlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Wiro edge bazı client'ları 403 ile kesiyor; bu durumda curl'e düşüyoruz.
 * Anahtarların `ps` çıktısında görünmemesi için header'lar curl config dosyasına yazılıyor.
 */
async function curlPost(
  url: string,
  headers: Record<string, string>,
  bodyJson: string
): Promise<{ status: number; text: string }> {
  const tag = randomBytes(8).toString("hex");
  const bodyPath = path.join(os.tmpdir(), `vitrin-wiro-${tag}.json`);
  const cfgPath = path.join(os.tmpdir(), `vitrin-wiro-${tag}.cfg`);
  const lines = [
    `url = ${curlQuote(url)}`,
    `request = "POST"`,
    ...Object.entries(headers).map(([k, v]) => `header = ${curlQuote(`${k}: ${v}`)}`),
    `data-binary = ${curlQuote(`@${bodyPath}`)}`,
    `write-out = "\\n%{http_code}"`,
    "silent",
    "show-error",
    `max-time = 180`,
  ];
  try {
    await writeFile(bodyPath, bodyJson, "utf8");
    await writeFile(cfgPath, lines.join("\n"), "utf8");
    const { stdout } = await execFileAsync("curl", ["--config", cfgPath], { maxBuffer: MAX_BUFFER });
    const cut = stdout.lastIndexOf("\n");
    const status = Number.parseInt(cut >= 0 ? stdout.slice(cut + 1) : stdout, 10);
    return { status: Number.isFinite(status) ? status : 0, text: cut >= 0 ? stdout.slice(0, cut) : "" };
  } catch (err) {
    throw new WiroError(`curl başarısız: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await rm(bodyPath, { force: true }).catch(() => {});
    await rm(cfgPath, { force: true }).catch(() => {});
  }
}

/** POST + JSON parse; fetch 403 ya da ağ hatası verirse curl fallback. */
async function postJson(endpoint: string, body: unknown): Promise<unknown> {
  const url = `${BASE}${endpoint}`;
  const headers = wiroHeaders();
  const payload = JSON.stringify(body);

  let status = 0;
  let text = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    status = res.status;
    text = await res.text();
  } catch {
    status = 0; // ağ hatası → curl dene
  }

  if (status === 0 || status === 403) {
    const viaCurl = await curlPost(url, headers, payload);
    status = viaCurl.status;
    text = viaCurl.text;
  }

  if (status === 0) throw new WiroError(`Wiro'ya ulaşılamadı: ${endpoint}`);
  if (status >= 400) throw new WiroError(`Wiro reddetti (${status}): ${text.slice(0, 400)}`);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WiroError(`Wiro geçersiz JSON döndürdü: ${text.slice(0, 200)}`);
  }
}

// ---------- task poll ----------

/** Wiro cevabı taskı farklı şekillerde sarmalıyor; satırı normalize et. */
function taskRow(detail: unknown): Record<string, unknown> {
  const last = asRecord(detail);
  const list = last.tasklist;
  if (Array.isArray(list) && list.length > 0) return asRecord(list[0]);
  if (last.task !== undefined) {
    const inner = asRecord(last.task);
    if (Object.keys(inner).length > 0) return inner;
  }
  return last;
}

/** pick null döndürdüğü sürece pollamaya devam eder. */
async function pollTask<T>(
  token: string,
  taskid: string,
  tries: number,
  pick: (row: Record<string, unknown>) => T | null
): Promise<T> {
  let last: unknown = {};
  for (let i = 0; i < tries; i += 1) {
    const query = token ? { tasktoken: token } : { taskid };
    try {
      last = await postJson("/Task/Detail", query);
    } catch {
      last = {};
    }
    const row = taskRow(last);
    const status = str(row.status);
    const pexit = row.pexit === null || row.pexit === undefined ? "" : String(row.pexit);

    if (pexit === "0" || status === "task_postprocess_end" || status.endsWith("end")) {
      const value = pick(row);
      if (value !== null) return value;
    }
    if (pexit !== "" && pexit !== "0") {
      throw new WiroError(str(row.debugerror) || `Wiro pexit=${pexit}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new WiroError(`Wiro zaman aşımı. Son: ${JSON.stringify(last).slice(0, 240)}`);
}

// ---------- metin ----------

/** Python _extract_text portu. */
function extractText(row: Record<string, unknown>): string {
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  for (const entry of outputs) {
    const item = asRecord(entry);
    if (Object.keys(item).length === 0) continue;

    const raw = [item.content, item.text, item.url].find((v) => Boolean(v));
    if (raw !== undefined && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const nested = raw as Record<string, unknown>;
      for (const k of ["answer", "raw", "text"]) {
        if (nested[k]) return str(nested[k]).trim();
      }
    }
    if (typeof raw === "string" && raw.trim() && !raw.startsWith("http")) return raw.trim();

    if (item.contenttype === "raw" && typeof item.content === "string") {
      try {
        const parsed: unknown = JSON.parse(item.content);
        const obj = asRecord(parsed);
        if (Object.keys(obj).length > 0) return str(obj.answer ?? obj.raw ?? "").trim();
      } catch {
        return item.content.trim();
      }
    }
  }
  return str(row.debugoutput).trim();
}

export type Reasoning = "low" | "medium" | "high";

/** GPT 5.6 Sol'u çalıştırır, düz metin döndürür. */
export async function runSol(
  prompt: string,
  opts: { system?: string; reasoning?: Reasoning } = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt,
    reasoning: opts.reasoning ?? "low",
    verbosity: "low",
  };
  if (opts.system) body.systemInstructions = opts.system;

  const payload = asRecord(await postJson("/Run/openai/gpt-5-6-sol", body));
  if (!payload.result) {
    const errs = payload.errors ?? payload;
    throw new WiroError(`Wiro: ${JSON.stringify(errs).slice(0, 400)}`);
  }
  const token = str(payload.socketaccesstoken);
  const taskid = str(payload.taskid);

  return pollTask(token, taskid, TEXT_TRIES, (row) => {
    const text = extractText(row);
    return text ? text : null;
  });
}

/** Python _parse_json_block portu — fence temizler, gerekirse ilk/son parantezi kırpar. */
export function parseJsonBlock(text: string): unknown {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]+?)```/.exec(t);
  if (fence) t = fence[1].trim();

  const tryParse = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(t);
  if (direct !== undefined) return direct;

  const objStart = t.indexOf("{");
  const objEnd = t.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    const parsed = tryParse(t.slice(objStart, objEnd + 1));
    if (parsed !== undefined) return parsed;
  }
  const arrStart = t.indexOf("[");
  const arrEnd = t.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const parsed = tryParse(t.slice(arrStart, arrEnd + 1));
    if (parsed !== undefined) return parsed;
  }
  throw new WiroError("Model JSON döndürmedi");
}

// ---------- görsel ----------

export type ImageModel = "gpt-image-2" | "gpt-image-1-5";

function extractUrl(row: Record<string, unknown>): string {
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  for (const entry of outputs) {
    const item = asRecord(entry);
    const url = item.url;
    if (typeof url === "string" && url.startsWith("http")) return url;
  }
  return "";
}

async function downloadTo(url: string, file: string): Promise<void> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(180_000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 0) {
        await writeFile(file, buf);
        return;
      }
    }
  } catch {
    // curl'e düş
  }
  await execFileAsync("curl", ["-sSL", "--max-time", "180", "-o", file, url], {
    maxBuffer: MAX_BUFFER,
  });
  const info = await stat(file).catch(() => null);
  if (!info || info.size === 0) throw new WiroError(`Görsel indirilemedi: ${url.slice(0, 120)}`);
}

/**
 * Görsel üretir, public/assets/generated/<sha1>.png olarak kaydeder ve
 * "/assets/generated/<sha1>.png" yolunu döndürür. Aynı istem daha önce
 * üretildiyse ağa çıkmadan cache'ten döner.
 */
export async function generateImage(opts: {
  model: ImageModel;
  prompt: string;
  size?: string;
  quality?: string;
  background?: string;
}): Promise<string> {
  const prompt = (opts.prompt || "").trim();
  if (!prompt) throw new WiroError("Görsel istemi boş.");

  const size = opts.size ?? "1:1";
  const quality = opts.quality ?? "high";
  const background = opts.background ?? "auto";

  const hash = createHash("sha1")
    .update([opts.model, size, quality, background, prompt].join("|"))
    .digest("hex")
    .slice(0, 20);

  const dir = path.join(process.cwd(), "public", "assets", "generated");
  const file = path.join(dir, `${hash}.png`);
  const publicPath = `/assets/generated/${hash}.png`;

  if (await fileExists(file)) return publicPath; // cache

  // Modellerin parametre şemaları farklı (Tool/List ile doğrulandı, 2026-08-28):
  //  - gpt-image-1-5: size ("auto"|"1:1"|"3:2"|"2:3") + background ("transparent" var)
  //  - gpt-image-2:   resolution ("1k"|"2k"|"4k") + ratio ("2:3","9:16"...; transparent yok)
  const body: Record<string, unknown> = {
    prompt,
    quality,
    outputFormat: "png",
    samples: 1,
    moderation: "low",
  };
  if (opts.model === "gpt-image-2") {
    const RATIOS = new Set(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]);
    body.ratio = RATIOS.has(size) ? size : "9:16";
    body.resolution = "2k";
    if (background === "opaque") body.background = "opaque";
  } else {
    body.size = ["auto", "1:1", "3:2", "2:3"].includes(size) ? size : "auto";
    body.background = background;
  }

  const payload = asRecord(await postJson(`/Run/openai/${opts.model}`, body));
  if (!payload.result) {
    const errs = payload.errors ?? payload;
    throw new WiroError(`Wiro: ${JSON.stringify(errs).slice(0, 400)}`);
  }

  const token = str(payload.socketaccesstoken);
  const taskid = str(payload.taskid);

  const url = await pollTask(token, taskid, IMAGE_TRIES, (row) => {
    const pexit = row.pexit === null || row.pexit === undefined ? "" : String(row.pexit);
    if (pexit !== "" && pexit !== "0") return null; // dış döngü hatayı fırlatır
    const found = extractUrl(row);
    return found ? found : null;
  });

  await mkdir(dir, { recursive: true });
  await downloadTo(url, file);
  return publicPath;
}

// ---------- dil adları ----------

export const LANG_NAMES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  ar: "Arabic",
  de: "German",
  fr: "French",
  ja: "Japanese",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  ko: "Korean",
  zh: "Chinese",
  hi: "Hindi",
  id: "Indonesian",
  pl: "Polish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
};

export function langName(code: string): string {
  const key = (code || "").trim().toLowerCase();
  return LANG_NAMES[key] || code || "English";
}
