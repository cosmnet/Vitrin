// Ayarlar — hepsi ortam değişkeniyle ezilebilir.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function envStr(name: string, fallback: string): string {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
}

function envNum(name: string, fallback: number): number {
  const n = Number((process.env[name] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Tek depoda MCP'nin kardeş klasörü: <depo>/vitrin-mcp/dist → <depo>/vitrin-studio.
 *  Eklenti önbelleğinden çalışırken kurulum betiğinin varsayılanı ~/Vitrin denenir. */
const SIBLING_STUDIO = fileURLToPath(new URL("../../vitrin-studio", import.meta.url));

/** Vitrin Studio deposunun kökü (`npm run dev` burada koşar). */
export const VITRIN_DIR = envStr(
  "VITRIN_DIR",
  [SIBLING_STUDIO, path.join(os.homedir(), "Vitrin", "vitrin-studio")].find(existsSync)
    ?? path.join(os.homedir(), "Desktop", "vitrin-studio")
);

export const VITRIN_PORT = envNum("VITRIN_PORT", 4780);
export const BASE_URL = `http://127.0.0.1:${VITRIN_PORT}`;

/** Export varsayılan kökü — /api/export'un yazdığı yerle aynı. */
export const EXPORT_ROOT = path.join(os.homedir(), "Desktop", "Vitrin");

/** Sağlık yoklaması (ms) — kısa: sunucu ayaktaysa anında döner. */
export const HEALTH_TIMEOUT_MS = envNum("VITRIN_HEALTH_TIMEOUT", 800);
/** `npm run dev` sonrası beklenen en uzun açılış süresi. */
export const BOOT_TIMEOUT_MS = envNum("VITRIN_BOOT_TIMEOUT", 60_000);
/** Bir headless işin (10 slayt × 15 dil bile olsa) üst sınırı. */
export const RENDER_TIMEOUT_MS = envNum("VITRIN_RENDER_TIMEOUT", 600_000);
/** Tarayıcı bu kadar boş kalınca kapanır. */
export const BROWSER_IDLE_MS = envNum("VITRIN_BROWSER_IDLE", 5 * 60_000);
/** Claude API'ye çıkan uçlar (director/copy) için istek üst sınırı. */
export const LLM_TIMEOUT_MS = envNum("VITRIN_LLM_TIMEOUT", 300_000);

/** Chrome kanalı — sistemdeki Chrome kullanılır, Playwright indirme yapmaz. */
export const CHROME_CHANNEL = envStr("VITRIN_CHROME_CHANNEL", "chrome");
