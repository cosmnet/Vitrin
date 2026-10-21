// Vitrin Studio dev sunucusuyla konuşma katmanı.
//
// ensureServer(): her araç çağrısından ÖNCE koşar. Sunucu ayaktaysa 800 ms'lik
// yoklama anında döner; değilse VITRIN_DIR'de `npm run dev` DETACHED başlatılır
// ve unref() edilir — MCP kapansa bile stüdyo ayakta kalır, insan da kullanabilir.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BASE_URL, BOOT_TIMEOUT_MS, HEALTH_TIMEOUT_MS, LLM_TIMEOUT_MS, VITRIN_DIR, VITRIN_PORT, } from "./config.js";
import { log, VitrinError, warn } from "./log.js";
let booting = null;
let spawnedPid = null;
/** GET /api/assets — en ucuz "ayakta mı" sorusu (disk listesi, LLM yok). */
export async function health(timeoutMs = HEALTH_TIMEOUT_MS) {
    try {
        const res = await fetch(`${BASE_URL}/api/assets`, {
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
function startDev() {
    if (!existsSync(path.join(VITRIN_DIR, "package.json"))) {
        throw new VitrinError(`Vitrin Studio klasörü bulunamadı: ${VITRIN_DIR}`, "VITRIN_DIR ortam değişkenini doğru klasöre ayarla.");
    }
    log(`dev sunucu yok — başlatılıyor: npm run dev (${VITRIN_DIR})`);
    const child = spawn("npm", ["run", "dev"], {
        cwd: VITRIN_DIR,
        detached: true,
        stdio: "ignore",
        // Kurulum betiğinin taşınabilir Node'u PATH'te olmayabilir: npm'i bu
        // süreci çalıştıran node'un yanından bul.
        env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    spawnedPid = child.pid ?? null;
    child.unref();
}
/** Sunucuyu hazır hale getirir; gerekirse başlatır ve 60 s bekler. */
export async function ensureServer() {
    if (await health())
        return;
    if (booting)
        return booting;
    booting = (async () => {
        startDev();
        const deadline = Date.now() + BOOT_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
            if (await health()) {
                log(`dev sunucu hazır → ${BASE_URL}`);
                return;
            }
        }
        throw new VitrinError(`Vitrin dev sunucusu ${BOOT_TIMEOUT_MS / 1000} sn içinde ${VITRIN_PORT} portunda açılmadı`, `${VITRIN_DIR} klasöründe "npm run dev" komutunu elle çalıştırıp çıktısına bak.`);
    })().finally(() => {
        booting = null;
    });
    return booting;
}
/** Stüdyo REST çağrısı. Hata gövdesindeki Türkçe `error` alanı aynen taşınır. */
export async function api(route, body, opts = {}) {
    if (opts.ensure !== false)
        await ensureServer();
    const method = opts.method ?? (body === undefined ? "GET" : "POST");
    const timeoutMs = opts.timeoutMs ?? 120_000;
    let res;
    try {
        res = await fetch(`${BASE_URL}${route}`, {
            method,
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new VitrinError(`Stüdyoya ulaşılamadı (${method} ${route}): ${why}`, "vitrin_status ile sunucunun ayakta olduğunu doğrula.");
    }
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        /* JSON değil — aşağıda ham metin gösterilir */
    }
    if (!res.ok) {
        const rec = (data ?? {});
        throw new VitrinError(rec.error || `${route} isteği başarısız (${res.status})`, res.status === 404 ? "Kimlik/ad doğru mu? vitrin_list_projects ile bak." : "");
    }
    return data;
}
/** Claude API'ye çıkan uçlar (director / copy) — uzun timeout. */
export function apiLlm(route, body) {
    return api(route, body, { timeoutMs: LLM_TIMEOUT_MS });
}
export function serverInfo() {
    return { dir: VITRIN_DIR, port: VITRIN_PORT, url: BASE_URL, spawnedPid };
}
export { warn };
//# sourceMappingURL=studio.js.map