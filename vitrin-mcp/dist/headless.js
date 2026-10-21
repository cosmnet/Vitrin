// /headless-export sayfasını sürme katmanı.
//
// SÖZLEŞME (app/headless-export/page.tsx):
//   window.__vitrinProgress = { done, total, current }
//   window.__vitrinDone     = true      // BAŞARIDA DA HATADA DA
//   window.__vitrinError    = string    // yalnız hatada
//   window.__vitrinResult   = dataURL | PreviewItem[] | export özeti
//   window.__vitrinResults  = PreviewItem[]  // preview modunda her zaman
//   window.__vitrinWebgl    = boolean   // false ⇒ cihaz basılmaz (SESSİZ)
//
// Sayfa MODÜL KAPSAMINDA tek-atış kilitliyor (`let started = false`), yani SPA
// içi gezinme işi TEKRAR TETİKLEMEZ. Bu yüzden her koşu için `page.goto` ile
// TAM sayfa yüklemesi yapılır — sorgu dizisini değiştirip beklemek çalışmaz.
//
// TEK YÜKLEME = TEK DİL: 10 slaytlık bir dil ~70 MB dataURL'i /api/export'a
// POST ediyor. Diller tek sekmede zincirlenirse bellek ve POST gövdesi katlanır;
// bu yüzden export dil dil koşar (aralarda sayfa kapanır, bellek geri gelir).
import { BASE_URL, RENDER_TIMEOUT_MS } from "./config.js";
import { withPage } from "./browser.js";
import { log, VitrinError } from "./log.js";
function buildUrl(p) {
    const q = new URLSearchParams();
    q.set("project", p.project);
    if (p.locale)
        q.set("locale", p.locale);
    if (p.sizes?.length)
        q.set("sizes", p.sizes.join(","));
    q.set("slides", p.slides === undefined || p.slides === "all" ? "all" : p.slides.join(","));
    q.set("mode", p.mode);
    if (p.width)
        q.set("width", String(p.width));
    return `${BASE_URL}/headless-export?${q.toString()}`;
}
/**
 * Sayfayı açar, `__vitrinDone` olana kadar bekler, hata/WebGL kontrolünü yapar
 * ve SAYFA HÂLÂ AÇIKKEN `extract`i çağırır — böylece dev dataURL dizileri
 * Node'a hiç taşınmadan tarayıcı içinde işlenebilir (bkz. contact sheet).
 */
export async function runHeadless(params, opts, extract) {
    const url = buildUrl(params);
    const timeout = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
    return withPage(async (page) => {
        log(`headless → ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
        let last = "";
        const poll = setInterval(() => {
            void page
                .evaluate(() => window.__vitrinProgress ?? null)
                .then((p) => {
                if (!p)
                    return;
                const key = `${p.done}/${p.total}/${p.current}`;
                if (key === last)
                    return;
                last = key;
                opts.onProgress?.(p);
            })
                .catch(() => undefined);
        }, 700);
        poll.unref?.();
        try {
            await page.waitForFunction("window.__vitrinDone === true", null, { timeout });
        }
        catch {
            const p = await page.evaluate(() => window.__vitrinProgress ?? null).catch(() => null);
            throw new VitrinError(`Render ${Math.round(timeout / 1000)} sn içinde bitmedi` +
                (p ? ` (son durum: ${p.done}/${p.total} · ${p.current})` : ""), "Daha az slayt/dil ile dene ya da VITRIN_RENDER_TIMEOUT değerini artır.");
        }
        finally {
            clearInterval(poll);
        }
        const state = await page.evaluate(() => ({
            error: window.__vitrinError ?? null,
            webgl: window.__vitrinWebgl ?? null,
            usage: window.__vitrinUsage === true,
        }));
        if (state.usage) {
            throw new VitrinError("headless-export sayfası proje parametresi almadı", "projectId doğru mu? vitrin_list_projects ile bak.");
        }
        if (state.error) {
            throw new VitrinError(String(state.error), "Proje/dil/slayt seçimini kontrol et.");
        }
        // SESSİZ TUZAK: WebGL yoksa slayt basılır ama telefon çizilmez.
        if (state.webgl === false) {
            throw new VitrinError("Tarayıcıda WebGL yok — cihazsız (bozuk) slayt basılacaktı, iş durduruldu", "Chrome'u güncelle; MCP zaten SwiftShader'a düşmeyi deniyor.");
        }
        return extract(page);
    });
}
/* ------------------------------------------------------------------ *
   Hazır koşular
 * ------------------------------------------------------------------ */
/** Tek slayt önizlemesi → PNG base64 (data: öneki olmadan). */
export async function renderPreview(projectId, locale, slide, width, opts = {}) {
    return runHeadless({ project: projectId, locale, slides: [slide], mode: "preview", width }, opts, async (page) => {
        const item = await page.evaluate(() => {
            const list = window.__vitrinResults ?? [];
            const first = list[0];
            return first
                ? { dataUrl: first.dataUrl, width: first.width, height: first.height }
                : null;
        });
        if (!item)
            throw new VitrinError("Önizleme üretilmedi", "Slayt indeksi doğru mu?");
        return {
            base64: item.dataUrl.slice(item.dataUrl.indexOf(",") + 1),
            width: item.width,
            height: item.height,
        };
    });
}
/**
 * Kontak sayfası — N slayt TEK görselde.
 *
 * Izgara TARAYICI İÇİNDE kurulur: `__vitrinResults`teki dataURL'ler Node'a hiç
 * geçmez (10 slayt × ~300 KB base64 = token cehennemi), yerine tek bir birleşik
 * PNG döner. Ek bağımlılık (sharp/canvas) gerekmez — sayfada zaten canvas var.
 */
export async function renderContactSheet(projectId, locale, slides, cellWidth, columns, opts = {}) {
    return runHeadless({ project: projectId, locale, slides, mode: "preview", width: cellWidth }, opts, async (page) => {
        const out = await page.evaluate(async (cols) => {
            const items = window.__vitrinResults ?? [];
            if (!items.length)
                return null;
            const GAP = 14;
            const PAD = 14;
            const LABEL = 26;
            const cw = items[0].width;
            const ch = items[0].height;
            const n = items.length;
            const c = Math.max(1, Math.min(cols, n));
            const rows = Math.ceil(n / c);
            const canvas = document.createElement("canvas");
            canvas.width = PAD * 2 + c * cw + (c - 1) * GAP;
            canvas.height = PAD * 2 + rows * (ch + LABEL) + (rows - 1) * GAP;
            const ctx = canvas.getContext("2d");
            if (!ctx)
                return null;
            ctx.fillStyle = "#141416";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < n; i++) {
                const it = items[i];
                const col = i % c;
                const row = Math.floor(i / c);
                const x = PAD + col * (cw + GAP);
                const y = PAD + row * (ch + LABEL + GAP);
                const img = await new Promise((resolve) => {
                    const im = new Image();
                    im.onload = () => resolve(im);
                    im.onerror = () => resolve(null);
                    im.src = it.dataUrl;
                });
                if (img)
                    ctx.drawImage(img, x, y, cw, ch);
                ctx.fillStyle = "#F2F1EC";
                ctx.font = "600 15px ui-monospace, SFMono-Regular, Menlo, monospace";
                ctx.textBaseline = "middle";
                ctx.fillText(`${it.slide + 1}  ·  ${it.locale}`, x + 2, y + ch + LABEL / 2 + 2);
            }
            return {
                dataUrl: canvas.toDataURL("image/png"),
                count: n,
                width: canvas.width,
                height: canvas.height,
            };
        }, columns);
        if (!out)
            throw new VitrinError("Kontak sayfası üretilmedi", "Projede slayt var mı?");
        return {
            base64: out.dataUrl.slice(out.dataUrl.indexOf(",") + 1),
            count: out.count,
            width: out.width,
            height: out.height,
        };
    });
}
/**
 * Art Director'ın vision payload'u için ekran görüntülerini küçültür.
 *
 * Projedeki `Screenshot.dataUrl` artık çoğunlukla `/api/shots/<sha1>.png` gibi
 * bir YOL (dataURL değil). Node'da o dosyayı ham okuyup yollamak 12 × ~1,5 MB
 * base64 demekti; stüdyo tarafı `lib/client.ts::downscaleDataUrl` ile 760 px'e
 * indirip JPEG'e çeviriyor. Aynı işi burada da TARAYICI yapar (sharp gibi ek
 * bağımlılık yok): boş bir /headless-export sekmesi aynı origin'de açılır,
 * görseller canvas'ta küçültülür.
 */
export async function prepareVisionShots(shots, maxH = 760, limit = 12) {
    const take = shots.slice(0, limit);
    if (!take.length)
        return [];
    return withPage(async (page) => {
        // Parametresiz açılış = "kullanım kılavuzu": sayfa hiçbir iş yapmaz.
        await page.goto(`${BASE_URL}/headless-export`, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
        });
        return page.evaluate(async (input) => {
            const out = [];
            for (const row of input.rows) {
                const img = await new Promise((resolve) => {
                    const im = new Image();
                    im.onload = () => resolve(im);
                    im.onerror = () => resolve(null);
                    im.src = row.src;
                });
                if (!img || !img.width || !img.height)
                    continue;
                const scale = Math.min(1, input.maxH / img.height);
                const c = document.createElement("canvas");
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
                out.push({ id: row.id, name: row.name, dataUrl: c.toDataURL("image/jpeg", 0.82) });
            }
            return out;
        }, { rows: take.map((s) => ({ id: s.id, name: s.name, src: s.dataUrl })), maxH });
    });
}
/** Tek dilin export'u — /api/export diske yazar, özet döner. */
export async function runExport(projectId, locale, sizes, slides, opts = {}) {
    return runHeadless({ project: projectId, locale, sizes, slides, mode: "export" }, opts, async (page) => {
        const summary = await page.evaluate(() => window.__vitrinResult ?? null);
        if (!summary || typeof summary !== "object" || !("written" in summary)) {
            throw new VitrinError("Export özeti okunamadı", "Stüdyo loglarına bak.");
        }
        return summary;
    });
}
//# sourceMappingURL=headless.js.map