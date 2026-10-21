// Önizleme, kontak sayfası ve export.
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { catalog } from "../catalog.js";
import { EXPORT_ROOT } from "../config.js";
import { renderContactSheet, renderPreview, runExport } from "../headless.js";
import { VitrinError } from "../log.js";
import { loadProject, resolveLocale, resolveLocales, resolveSlides } from "../project.js";
import { image, progressSender, text, tool, withData } from "../result.js";
/** `~/…` ve göreli yolları çözer. */
function expand(p) {
    const s = p.trim();
    if (s === "~")
        return os.homedir();
    if (s.startsWith("~/"))
        return path.join(os.homedir(), s.slice(2));
    return path.resolve(s);
}
/**
 * /api/export ÇIKTIYI HEP `~/Desktop/Vitrin/<app>/<locale>` altına yazar (yol
 * parametresi almıyor ve o route bu dalganın sahipliğinde değil). Kullanıcı
 * başka bir klasör istediğinde dosyalar yazıldıktan SONRA taşınır — render
 * boru hattı bire bir aynı kalır, yalnız varış yeri değişir.
 */
async function moveTree(from, to) {
    await mkdir(to, { recursive: true });
    const moved = [];
    for (const e of await readdir(from, { withFileTypes: true })) {
        const src = path.join(from, e.name);
        const dst = path.join(to, e.name);
        if (e.isDirectory()) {
            moved.push(...(await moveTree(src, dst)));
            await rm(src, { recursive: true, force: true });
        }
        else {
            await rm(dst, { force: true });
            await rename(src, dst).catch(async () => {
                // Farklı disk: rename çalışmaz, kopyala-sil.
                const { copyFile } = await import("node:fs/promises");
                await copyFile(src, dst);
                await rm(src, { force: true });
            });
            moved.push(dst);
        }
    }
    return moved;
}
async function isEmptyDir(dir) {
    try {
        return (await readdir(dir)).length === 0;
    }
    catch {
        return false;
    }
}
export function registerRender(server) {
    tool(server, "vitrin_render_preview", {
        title: "Slayt önizleme",
        description: "Tek slaydı GERÇEK motorla (canvas + WebGL) basar ve görsel olarak döner. " +
            "Export ile aynı kod yolu, sadece daha küçük. Metin taşması, tema ve kadraj " +
            "kontrolü için kullan.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            slide: z.number().int().min(0).describe("0-tabanlı slayt indeksi"),
            width: z
                .number()
                .int()
                .min(200)
                .max(1320)
                .optional()
                .describe("Piksel eni, vars. 660; yükseklik projenin iPhone/iPad oranından hesaplanır"),
        }),
        readOnly: true,
    }, async ({ projectId, locale, slide, width }, ctx) => {
        const p = await loadProject(projectId);
        const loc = resolveLocale(p, locale);
        const [i] = resolveSlides(p.sets[loc], [slide]);
        const progress = progressSender(ctx);
        const out = await renderPreview(projectId, loc, i, width ?? 660, {
            onProgress: (pr) => progress(pr.done, pr.total, pr.current),
        });
        const s = p.sets[loc].slides[i];
        return image(out.base64, `${p.app} · ${loc} · slayt ${i} · ${out.width}×${out.height}\n` +
            `"${s.headline}"${s.sub ? ` / "${s.sub}"` : ""} · tema ${s.themeId} · ${s.layout}`);
    });
    tool(server, "vitrin_render_contact_sheet", {
        title: "Kontak sayfası",
        description: "Bir dilin TÜM slaytlarını TEK ızgara görselinde basar — 10 ayrı görsel yerine 1. " +
            "Kurgu bittiğinde kullanıcıya bunu göster, sonra düzeltmeleri konuş.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            slides: z.union([z.literal("all"), z.array(z.number().int().min(0))]).optional(),
            cellWidth: z.number().int().min(100).max(600).optional().describe("Hücre eni, vars. 220"),
            columns: z.number().int().min(1).max(8).optional().describe("Sütun sayısı, vars. 5"),
        }),
        readOnly: true,
    }, async ({ projectId, locale, slides, cellWidth, columns }, ctx) => {
        const p = await loadProject(projectId);
        const loc = resolveLocale(p, locale);
        const idx = resolveSlides(p.sets[loc], slides === "all" ? "all" : slides);
        if (!idx.length)
            throw new VitrinError(`${loc} setinde slayt yok`, "Önce içe aktar.");
        const progress = progressSender(ctx);
        const sheet = await renderContactSheet(projectId, loc, slides === undefined || slides === "all" ? "all" : idx, cellWidth ?? 220, columns ?? 5, { onProgress: (pr) => progress(pr.done, pr.total, pr.current) });
        const list = p.sets[loc].slides
            .map((s, i) => (idx.includes(i) ? `${i}: ${s.headline}` : null))
            .filter(Boolean)
            .join("  ·  ");
        return image(sheet.base64, `${p.app} · ${loc} · ${sheet.count} slayt · ${sheet.width}×${sheet.height}\n${list}`);
    });
    tool(server, "vitrin_export", {
        title: "Export al",
        description: "App Store PNG'lerini basar. Varsayılan hedef ~/Desktop/Vitrin/<app>/<dil>/ " +
            "(fastlane düzeni: dil başına klasör, 01.png…). Her dil AYRI sayfa yüklemesinde " +
            "koşar — 10 slaytlık bir dil ~70 MB dataURL üretir. Uzun iş: 10 slayt × 1 dil ~1-2 dk.",
        inputSchema: z.object({
            projectId: z.string(),
            locales: z
                .union([z.literal("all"), z.array(z.string())])
                .optional()
                .describe('Diller, varsayılan "all"'),
            sizes: z
                .array(z.string())
                .optional()
                .describe('Boyutlar; varsayılan proje formatına göre iphone-69, ipad-13 veya ipad-13-land'),
            slides: z.union([z.literal("all"), z.array(z.number().int().min(0))]).optional(),
            outDir: z
                .string()
                .optional()
                .describe("Hedef klasör; verilirse PNG'ler yazıldıktan sonra buraya TAŞINIR"),
        }),
    }, async ({ projectId, locales, sizes, slides, outDir }, ctx) => {
        const p = await loadProject(projectId);
        const locs = resolveLocales(p, locales ?? "all");
        const cat = await catalog();
        const valid = cat.sizes.map((s) => s.id);
        const defaultSize = p.format === "ipad" ? "ipad-13" : p.format === "ipad-landscape" ? "ipad-13-land" : "iphone-69";
        const useSizes = sizes?.length ? sizes : [defaultSize];
        const bad = useSizes.filter((s) => !valid.includes(s));
        if (bad.length) {
            throw new VitrinError(`Bilinmeyen boyut: ${bad.join(", ")}`, `Geçerliler: ${valid.join(", ")}`);
        }
        for (const l of locs)
            resolveSlides(p.sets[l], slides === "all" ? "all" : slides);
        const progress = progressSender(ctx);
        const perLocale = useSizes.length * (slides && slides !== "all" ? slides.length : 0);
        const grandTotal = perLocale > 0
            ? perLocale * locs.length
            : locs.reduce((n, l) => n + p.sets[l].slides.length * useSizes.length, 0);
        const rows = [];
        const written = [];
        let base = 0;
        for (const locale of locs) {
            // TEK YÜKLEME = TEK DİL (bkz. headless.ts başlığı).
            const summary = await runExport(projectId, locale, useSizes, slides === undefined || slides === "all" ? "all" : slides, {
                onProgress: (pr) => progress(base + pr.done, grandTotal, `${locale} · ${pr.current}`),
            });
            base += summary.written;
            let dir = summary.paths[0] ?? path.join(EXPORT_ROOT, p.app, locale);
            if (outDir) {
                const target = path.join(expand(outDir), locale);
                const moved = await moveTree(dir, target);
                written.push(...moved);
                // Kaynak app klasörü boş kaldıysa arkamızı topla.
                await rm(dir, { recursive: true, force: true }).catch(() => undefined);
                const appDir = path.dirname(dir);
                if (await isEmptyDir(appDir))
                    await rm(appDir, { recursive: true, force: true });
                dir = target;
            }
            else {
                for (const f of summary.files)
                    written.push(path.join(EXPORT_ROOT, p.app, f));
            }
            rows.push({ locale, written: summary.written, dir });
        }
        // Doğrulama: gerçekten kaç dosya var?
        const counts = {};
        for (const r of rows) {
            try {
                const st = await stat(r.dir);
                counts[r.locale] = st.isDirectory()
                    ? (await readdir(r.dir)).filter((f) => f.endsWith(".png")).length
                    : 0;
            }
            catch {
                counts[r.locale] = 0;
            }
        }
        const total = rows.reduce((n, r) => n + r.written, 0);
        return withData(text(`${p.app} · ${total} PNG yazıldı · boyut: ${useSizes.join(", ")}`, "", ...rows.map((r) => `${r.locale.padEnd(8)} ${r.written} dosya → ${r.dir} (klasörde ${counts[r.locale]} png)`)), { app: p.app, total, sizes: useSizes, locales: rows, files: written.slice(0, 200) });
    });
}
//# sourceMappingURL=render.js.map