// Headless Chromium yaşam döngüsü.
//
// TEK örnek, tembel açılır, 5 dk boşta kalınca kapanır; her render YENİ sayfa.
// Tarayıcı İNDİRİLMEZ: sistemdeki Chrome `channel: "chrome"` ile kullanılır
// (playwright-core zaten indirme yapmaz).
//
// WEBGL — SESSİZ KALİTE TUZAĞI
// engine/scene3d.ts WebGL bulamazsa HATA ATMAZ, şeffaf katman döner: slayt
// basılır ama CİHAZ YOKTUR. Bu yüzden tarayıcı açılır açılmaz boş bir sayfada
// WebGL yoklanır. GPU yolu WebGL vermiyorsa tarayıcı SwiftShader argümanlarıyla
// yeniden başlatılır; o da vermiyorsa render HİÇ denenmez — sessiz bozuk çıktı
// yerine açık hata.
import { chromium } from "playwright-core";
import { BROWSER_IDLE_MS, CHROME_CHANNEL } from "./config.js";
import { log, VitrinError, warn } from "./log.js";
/** GPU yolu — Chrome'un kendi kararına bırakılır, engelleme listesi yok sayılır. */
const GPU_ARGS = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
/** Yazılım yolu — GPU'suz ortamda ANGLE/SwiftShader ile WebGL2. */
const SWIFT_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--use-gl=angle",
];
let browser = null;
let mode = null;
let idleTimer = null;
let opening = null;
let inFlight = 0;
function armIdle() {
    if (idleTimer)
        clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (inFlight > 0)
            return armIdle();
        void closeBrowser("boşta kalma");
    }, BROWSER_IDLE_MS);
    idleTimer.unref?.();
}
export async function closeBrowser(why = "istek") {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    const b = browser;
    browser = null;
    mode = null;
    if (!b)
        return;
    log(`tarayıcı kapatılıyor (${why})`);
    await b.close().catch(() => undefined);
}
async function launch(args) {
    return chromium.launch({
        channel: CHROME_CHANNEL,
        headless: true,
        args,
    });
}
/** Boş sayfada tek seferlik WebGL yoklaması — bağlam hemen bırakılır. */
async function probeWebgl(b) {
    const page = await b.newPage();
    try {
        await page.goto("about:blank");
        return await page.evaluate(() => {
            try {
                const c = document.createElement("canvas");
                return !!(c.getContext("webgl2") || c.getContext("webgl"));
            }
            catch {
                return false;
            }
        });
    }
    catch {
        return false;
    }
    finally {
        await page.close().catch(() => undefined);
    }
}
async function open() {
    let b;
    try {
        b = await launch(GPU_ARGS);
    }
    catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new VitrinError(`Chrome başlatılamadı: ${why}`, "Google Chrome kurulu mu? Değilse VITRIN_CHROME_CHANNEL=msedge dene ya da Chrome kur.");
    }
    if (await probeWebgl(b)) {
        mode = "gpu";
        log("tarayıcı açıldı · WebGL: GPU");
        return b;
    }
    warn("GPU yolunda WebGL yok — SwiftShader ile yeniden başlatılıyor");
    await b.close().catch(() => undefined);
    b = await launch(SWIFT_ARGS);
    if (await probeWebgl(b)) {
        mode = "swiftshader";
        log("tarayıcı açıldı · WebGL: SwiftShader (yazılım)");
        return b;
    }
    await b.close().catch(() => undefined);
    throw new VitrinError("Headless Chrome'da WebGL açılmadı — 3D cihazlar CİHAZSIZ basılırdı, render iptal edildi", "Chrome'u güncelle ya da VITRIN_CHROME_CHANNEL ile başka bir kanal dene.");
}
export async function ensureBrowser() {
    if (browser && browser.isConnected()) {
        armIdle();
        return browser;
    }
    if (opening)
        return opening;
    opening = open()
        .then((b) => {
        browser = b;
        b.on("disconnected", () => {
            browser = null;
            mode = null;
        });
        armIdle();
        return b;
    })
        .finally(() => {
        opening = null;
    });
    return opening;
}
export function glMode() {
    return mode;
}
export function browserReady() {
    return !!browser && browser.isConnected();
}
/** Yeni sayfa aç, işi yap, sayfayı kapat. Boşta sayacı iş boyunca durur. */
export async function withPage(fn) {
    const b = await ensureBrowser();
    inFlight += 1;
    const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
    page.on("pageerror", (e) => warn("sayfa hatası:", e.message));
    try {
        return await fn(page);
    }
    finally {
        inFlight -= 1;
        await page.close().catch(() => undefined);
        armIdle();
    }
}
//# sourceMappingURL=browser.js.map