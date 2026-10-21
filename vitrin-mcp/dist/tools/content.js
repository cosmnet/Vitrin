// Tarama, içe aktarma, Art Director, çeviri ve slayt düzenleme.
import { z } from "zod";
import { catalog } from "../catalog.js";
import { prepareVisionShots } from "../headless.js";
import { VitrinError } from "../log.js";
import { loadProject, mutateProject, resolveLocale, resolveSlides, saveProject, slideLine, summarizeSet, uid, } from "../project.js";
import { progressSender, text, tool, withData } from "../result.js";
import { api, apiLlm } from "../studio.js";
import { syncDesign } from "./design.js";
/* ------------------------------------------------------------------ *
   Slayt yaması
 * ------------------------------------------------------------------ */
const patchSchema = z.object({
    headline: z.string().optional(),
    sub: z.string().optional(),
    badge: z.string().optional(),
    layout: z.string().optional(),
    themeId: z.string().optional(),
    ornamentText: z.string().optional().describe("Defne çelengi metni; boş string çelengi kaldırır"),
    textOffset: z.object({ x: z.number(), y: z.number() }).optional(),
    deviceOffset: z
        .object({ x: z.number(), y: z.number(), scale: z.number().optional() })
        .optional(),
    screenshotId: z
        .string()
        .optional()
        .describe("Projedeki Screenshot.id — slaydın ekran görüntüsünü değiştirir"),
    clearBackground: z.boolean().optional().describe("Slayt zemin override'ını sil (tema kazansın)"),
    clearDevice: z.boolean().optional().describe("Slayt cihaz override'ını sil (tema kazansın)"),
});
const DESIGN_KEYS = new Set([
    "layout",
    "themeId",
    "textOffset",
    "deviceOffset",
    "clearBackground",
    "clearDevice",
]);
function applyPatch(slide, patch, shotById) {
    if (patch.headline !== undefined) {
        slide.headline = patch.headline;
        delete slide.needsCopy;
    }
    if (patch.sub !== undefined) {
        slide.sub = patch.sub;
        delete slide.needsCopy;
    }
    if (patch.badge !== undefined)
        slide.badge = patch.badge || undefined;
    if (patch.layout !== undefined)
        slide.layout = patch.layout;
    if (patch.themeId !== undefined) {
        // Stüdyodaki Inspector ile aynı: tema değişince slayt override'ları düşer.
        slide.themeId = patch.themeId;
        delete slide.background;
        delete slide.device;
    }
    if (patch.ornamentText !== undefined) {
        if (patch.ornamentText)
            slide.ornament = { kind: "laurel", text: patch.ornamentText };
        else
            delete slide.ornament;
    }
    if (patch.textOffset !== undefined)
        slide.textOffset = patch.textOffset;
    if (patch.deviceOffset !== undefined)
        slide.deviceOffset = patch.deviceOffset;
    if (patch.screenshotId !== undefined) {
        const url = shotById.get(patch.screenshotId);
        if (!url) {
            throw new VitrinError(`Projede böyle bir ekran görüntüsü yok: ${patch.screenshotId}`, "vitrin_open_project ile mevcut ekranları gör.");
        }
        slide.screenshot = url;
    }
    if (patch.clearBackground)
        delete slide.background;
    if (patch.clearDevice)
        delete slide.device;
}
/* ------------------------------------------------------------------ *
   Kayıt
 * ------------------------------------------------------------------ */
export function registerContent(server) {
    tool(server, "vitrin_scan_folder", {
        title: "Klasörü tara",
        description: "Bir pazarlama klasöründeki .md kare dosyalarını ve ekran görüntülerini tarar. " +
            "Her .md bir dildir (tr.md → tr). Dilin kendi alt klasörü varsa (tr/, ar-SA/) " +
            "ekranlar oradan alınır — bu DİL KOVALARI raporlanır. Hiçbir şey değiştirmez.",
        inputSchema: z.object({
            folder: z
                .string()
                .describe("Mutlak klasör yolu ya da tek bir .md dosyası (o zaman dili ön-seçilir)"),
            shotsRoot: z
                .string()
                .optional()
                .describe("Ekran görüntüleri MD klasöründe değilse buradan aranır"),
        }),
        readOnly: true,
    }, async ({ folder, shotsRoot }) => {
        const r = await api("/api/ingest", { path: folder, shotsRoot: shotsRoot || undefined });
        const buckets = r.localeImages ?? {};
        const lines = [
            `Klasör: ${r.folder}`,
            r.shotsRoot !== r.folder ? `Ekran kökü: ${r.shotsRoot}` : "",
            r.pickedLocale ? `Tek .md işaret edildi → dil: ${r.pickedLocale}` : "",
            `Diller (${r.locales.length}): ` +
                r.locales
                    .map((l) => `${l.code}(${l.frames.length} kare${buckets[l.code] ? `, ${buckets[l.code].length} görsel` : ""})`)
                    .join("  "),
            `Ortak havuz: ${r.images.length} görsel`,
            Object.keys(buckets).length
                ? `Dil kovaları: ${Object.entries(buckets).map(([c, l]) => `${c}=${l.length}`).join(", ")}`
                : "Dil kovası YOK — tüm diller ortak havuzu kullanır",
        ];
        return withData(text(...lines), {
            folder: r.folder,
            shotsRoot: r.shotsRoot,
            locales: r.locales.map((l) => ({ code: l.code, frames: l.frames.length })),
            sharedImages: r.images.length,
            localeBuckets: Object.fromEntries(Object.entries(buckets).map(([c, l]) => [c, l.length])),
        });
    });
    tool(server, "vitrin_import", {
        title: "MD klasörünü projeye aktar",
        description: "Taranan klasörü projeye yazar: kareler slayta, EYEBROW rozete, LAUREL çelenge, " +
            "SCREEN ipuçları ekran görüntülerine eşleşir. Ekranlar data/shots'a KOPYALANIR " +
            "(proje kaynak klasöre bağımlı kalmaz). Slaytlar designKey=f01… ile damgalanır; " +
            "diller arası tasarım senkronu bu anahtarla çalışır. Seçili dillerin ESKİ slaytları " +
            "bu işlemle DEĞİŞTİRİLİR.",
        inputSchema: z.object({
            projectId: z.string(),
            folder: z.string().describe("vitrin_scan_folder'a verdiğin klasör"),
            shotsRoot: z.string().optional(),
            locales: z
                .array(z.string())
                .optional()
                .describe("Aktarılacak diller; verilmezse klasörde bulunan TÜM diller"),
            templateId: z
                .string()
                .optional()
                .describe('Başlangıç giysisi (vitrin_list_templates); varsayılan "clean-apple"'),
            byNumber: z
                .boolean()
                .optional()
                .describe("Eşleşme bulunamazsa kare numarasıyla eşleştir (varsayılan açık)"),
        }),
    }, async (args) => {
        const r = await api("/api/sync/import", args, { timeoutMs: 300_000 });
        const lines = [
            `${r.app} · ${r.folder}`,
            `Şablon: ${r.templateId} · aktif dil: ${r.activeLocale}`,
            `Ekran görüntüsü: +${r.screenshotsAdded} (toplam ${r.screenshotsTotal})`,
            "",
            ...r.locales.map((l) => `${l.code.padEnd(8)} ${l.slides} slayt · ekran eşleşen ${l.matched}/${l.slides}` +
                (l.matched2 ? ` · 2. ekran ${l.matched2}` : "") +
                (l.unmatched.length ? ` · EŞLEŞMEYEN kare: ${l.unmatched.join(", ")}` : "")),
            "",
            `Klasörde bulunan diller: ${r.available.map((a) => `${a.code}(${a.frames})`).join(", ")}`,
        ];
        return withData(text(...lines), r);
    });
    /* ---------------------------------------------------------------- *
       Art Director
     * ---------------------------------------------------------------- */
    tool(server, "vitrin_art_direct", {
        title: "Art Director ile kurgula",
        description: "Projedeki ekran görüntülerine BAKARAK n slaytlık anlatı kurar (başlık, alt satır, " +
            "rozet, tema, yerleşim, hangi ekran). Seçili dilin slaytlarını DEĞİŞTİRİR. " +
            "Claude API'ye çıkar — 1-3 dakika sürebilir.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional().describe("Kurgulanacak dil; varsayılan aktif dil"),
            n: z.number().int().min(1).max(12).optional().describe("Slayt sayısı, varsayılan 8"),
            keywords: z.array(z.string()).optional().describe("ASO anahtar kelimeleri"),
            brief: z.string().optional().describe("Verilirse projenin brief'i güncellenir"),
            themeIds: z
                .array(z.string())
                .optional()
                .describe("Director'ın seçebileceği temaları daralt"),
        }),
    }, async ({ projectId, locale, n, keywords, brief, themeIds }, ctx) => {
        const progress = progressSender(ctx);
        const p = await loadProject(projectId);
        const loc = resolveLocale(p, locale);
        if (!p.screenshots.length) {
            throw new VitrinError("Projede hiç ekran görüntüsü yok", "Önce vitrin_import ile ekranları içeri al.");
        }
        if (brief !== undefined)
            p.brief = brief;
        const cat = await catalog();
        const allThemes = cat.themes.map((t) => t.id);
        const useThemes = themeIds?.length ? themeIds.filter((t) => allThemes.includes(t)) : allThemes;
        if (!useThemes.length) {
            throw new VitrinError(`Geçersiz themeIds`, `Geçerliler: ${allThemes.join(", ")}`);
        }
        // split-v / split-h ikinci ekran ister — Director'ın eline verilmez.
        const useLayouts = cat.layouts.map((l) => l.id).filter((l) => l !== "split-v" && l !== "split-h");
        progress(1, 3, "ekranlar küçültülüyor");
        const shots = await prepareVisionShots(p.screenshots);
        progress(2, 3, "Art Director planlıyor");
        const r = await apiLlm("/api/director", {
            app: p.app,
            brief: p.brief || "",
            locale: loc,
            n: n ?? 8,
            screenshots: shots,
            themeIds: useThemes,
            layoutIds: useLayouts,
            keywords: keywords ?? [],
        });
        const byId = new Map(p.screenshots.map((s) => [s.id, s.dataUrl]));
        const old = p.sets[loc].slides;
        p.sets[loc] = {
            app: p.app,
            locale: loc,
            slides: r.slides.map((d, i) => {
                const slide = {
                    id: uid(),
                    // MD'den gelen f01… anahtarları KORUNUR (stüdyonun applyPlan'ı yeni
                    // rastgele anahtar üretir; burada korumak diller arası senkronun
                    // içe aktarmadan sonra da çalışmasını sağlar).
                    designKey: old[i]?.designKey ?? uid(),
                    headline: d.headline,
                    sub: d.sub,
                    themeId: d.themeId,
                    layout: d.layout,
                };
                if (d.badge)
                    slide.badge = d.badge;
                const url = byId.get(d.screenshotId);
                if (url)
                    slide.screenshot = url;
                return slide;
            }),
        };
        p.activeLocale = loc;
        progress(3, 3, "kaydediliyor");
        await saveProject(p);
        return withData(text(`${loc} · ${r.slides.length} slayt kurgulandı`, "", summarizeSet(p.sets[loc])), { locale: loc, slides: r.slides.length });
    });
    /* ---------------------------------------------------------------- *
       Çeviri
     * ---------------------------------------------------------------- */
    tool(server, "vitrin_translate", {
        title: "Dillere çevir",
        description: "Kaynak dilin başlık/alt satırlarını TEK istekte hedef dillere çevirir (/api/copy " +
            "packs). Dil yoksa kaynak setin TASARIMI kopyalanır ve metin çevrilir; dil zaten " +
            "varsa yalnız METİN güncellenir (tasarım korunur).",
        inputSchema: z.object({
            projectId: z.string(),
            fromLocale: z.string().optional().describe("Kaynak dil; varsayılan aktif dil"),
            langs: z.array(z.string()).min(1).describe('Hedef diller, ör. ["en-US","de-DE"]'),
        }),
    }, async ({ projectId, fromLocale, langs }, ctx) => {
        const progress = progressSender(ctx);
        const p = await loadProject(projectId);
        const from = resolveLocale(p, fromLocale);
        const src = p.sets[from];
        if (!src.slides.length)
            throw new VitrinError(`${from} setinde slayt yok`, "Önce içe aktar.");
        const targets = langs.map((l) => l.trim()).filter((l) => l && l !== from);
        if (!targets.length)
            throw new VitrinError("Hedef dil listesi boş", "Kaynak dille aynı olamaz.");
        progress(0, targets.length, "çeviri isteniyor");
        const texts = src.slides.map((s) => ({ head: s.headline, sub: s.sub ?? "" }));
        const r = await apiLlm("/api/copy", { action: "localize", texts, langs: targets });
        const done = [];
        const partial = [];
        targets.forEach((code, i) => {
            // /api/copy dil kodlarını küçük harfe indirir; her iki yazımı da dene.
            const pack = r.packs[code] ?? r.packs[code.toLowerCase()] ?? [];
            if (!pack.length)
                return;
            if (pack.length < src.slides.length)
                partial.push(code);
            const existing = p.sets[code];
            if (existing) {
                existing.slides.forEach((s, j) => {
                    const t = pack[j];
                    if (!t)
                        return;
                    s.headline = t.head || s.headline;
                    s.sub = t.sub ?? s.sub;
                    delete s.needsCopy;
                });
            }
            else {
                p.sets[code] = {
                    app: p.app,
                    locale: code,
                    slides: src.slides.map((s, j) => {
                        const copy = structuredClone(s);
                        copy.id = uid();
                        const t = pack[j];
                        if (t) {
                            copy.headline = t.head || s.headline;
                            copy.sub = t.sub ?? s.sub;
                            delete copy.needsCopy;
                        }
                        else {
                            copy.needsCopy = true;
                        }
                        return copy;
                    }),
                };
            }
            done.push(code);
            progress(i + 1, targets.length, code);
        });
        if (!done.length) {
            throw new VitrinError("Model hiçbir dil paketi döndürmedi", "Daha az dille tekrar dene.");
        }
        await saveProject(p);
        return withData(text(`${from} → ${done.join(", ")} · ${src.slides.length} slayt`, partial.length ? `EKSİK paket gelen diller: ${partial.join(", ")} (kalan slaytlar çevrilmedi işaretli)` : "", `Projedeki diller: ${Object.keys(p.sets).join(", ")}`, "", "Tasarımı da hizalamak istersen: vitrin_sync_design"), { from, translated: done, partial, locales: Object.keys(p.sets) });
    });
    /* ---------------------------------------------------------------- *
       Slayt düzenleme
     * ---------------------------------------------------------------- */
    tool(server, "vitrin_edit_slide", {
        title: "Slaytı düzenle",
        description: "Tek bir slaytın metnini/tasarımını değiştirir. Projede tasarım senkronu açıksa " +
            "TASARIM alanları (tema, yerleşim, nudge) diğer dillere de yayılır; metin yayılmaz.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            index: z.number().int().min(0).describe("0-tabanlı slayt indeksi"),
            patch: patchSchema,
        }),
    }, async ({ projectId, locale, index, patch }) => {
        let loc = "";
        let line = "";
        let fan = false;
        await mutateProject(projectId, (p) => {
            loc = resolveLocale(p, locale);
            const plan = p.sets[loc];
            const [i] = resolveSlides(plan, [index]);
            const shotById = new Map(p.screenshots.map((s) => [s.id, s.dataUrl]));
            applyPatch(plan.slides[i], patch, shotById);
            line = slideLine(plan.slides[i], i);
            fan =
                p.syncDesign !== false &&
                    Object.keys(patch).some((k) => DESIGN_KEYS.has(k)) &&
                    Object.keys(p.sets).length > 1;
        });
        let note = "";
        if (fan) {
            const s = await syncDesign(projectId, loc, "all", [index]);
            note = `tasarım ${s.targets.length} dile yayıldı${s.note ? ` · ${s.note}` : ""}`;
        }
        return withData(text(`${loc} · slayt ${index} güncellendi`, line, note), {
            locale: loc,
            index,
            fannedOut: fan,
        });
    });
    tool(server, "vitrin_reorder_slides", {
        title: "Slaytları sırala",
        description: "Seçili dildeki slaytları verilen sıraya dizer. order, TÜM indeksleri bir kez " +
            "içermelidir. syncOrder ile diğer diller de aynı sıraya çekilebilir.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            order: z.array(z.number().int().min(0)).describe("Yeni sıra, 0-tabanlı eski indeksler"),
            syncOtherLocales: z
                .boolean()
                .optional()
                .describe("true ise diğer diller de designKey'e göre aynı sıraya çekilir"),
        }),
    }, async ({ projectId, locale, order, syncOtherLocales }) => {
        let loc = "";
        await mutateProject(projectId, (p) => {
            loc = resolveLocale(p, locale);
            const plan = p.sets[loc];
            const n = plan.slides.length;
            const ok = order.length === n && new Set(order).size === n && order.every((i) => i < n);
            if (!ok) {
                throw new VitrinError(`order ${n} slaytın hepsini bir kez içermeli (gelen: ${order.join(",")})`, "Örn. 5 slayt için [0,2,1,4,3].");
            }
            plan.slides = order.map((i) => plan.slides[i]);
        });
        let note = "";
        if (syncOtherLocales) {
            const s = await syncDesign(projectId, loc, "all", "all", true);
            note = `sıra ${s.targets.length} dile yansıtıldı`;
        }
        const p = await loadProject(projectId);
        return withData(text(`${loc} · sıra güncellendi`, note, "", summarizeSet(p.sets[loc])), {
            locale: loc,
            order,
        });
    });
    tool(server, "vitrin_add_slide", {
        title: "Slayt ekle",
        description: "Seçili dile yeni slayt ekler. Kaynak verilmezse son slaydın tasarımı kopyalanır " +
            "(metin sıfırlanır). Yeni slayt YENİ bir designKey alır — yani bu dile özeldir.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            at: z.number().int().min(0).optional().describe("Ekleme yeri; verilmezse sona"),
            copyFrom: z.number().int().min(0).optional().describe("Tasarımı kopyalanacak slayt"),
            headline: z.string().optional(),
            sub: z.string().optional(),
            screenshotId: z.string().optional(),
        }),
    }, async ({ projectId, locale, at, copyFrom, headline, sub, screenshotId }) => {
        let loc = "";
        let pos = 0;
        let line = "";
        await mutateProject(projectId, (p) => {
            loc = resolveLocale(p, locale);
            const plan = p.sets[loc];
            const base = copyFrom !== undefined
                ? plan.slides[resolveSlides(plan, [copyFrom])[0]]
                : plan.slides[plan.slides.length - 1];
            const slide = base
                ? { ...structuredClone(base), id: uid(), designKey: uid() }
                : {
                    id: uid(),
                    designKey: uid(),
                    headline: "Başlık",
                    sub: "",
                    themeId: "solstice",
                    layout: "device-bleed-bottom",
                };
            slide.headline = headline ?? "Başlık";
            slide.sub = sub ?? "";
            delete slide.needsCopy;
            if (screenshotId) {
                const url = p.screenshots.find((s) => s.id === screenshotId)?.dataUrl;
                if (!url)
                    throw new VitrinError(`Ekran görüntüsü yok: ${screenshotId}`, "");
                slide.screenshot = url;
            }
            pos = at === undefined ? plan.slides.length : Math.min(at, plan.slides.length);
            plan.slides.splice(pos, 0, slide);
            line = slideLine(slide, pos);
        });
        return withData(text(`${loc} · slayt eklendi (${pos})`, line), { locale: loc, index: pos });
    });
    tool(server, "vitrin_remove_slide", {
        title: "Slayt sil",
        description: "Seçili dilden bir slayt siler. Diğer diller etkilenmez.",
        inputSchema: z.object({
            projectId: z.string(),
            locale: z.string().optional(),
            index: z.number().int().min(0),
        }),
    }, async ({ projectId, locale, index }) => {
        let loc = "";
        let left = 0;
        await mutateProject(projectId, (p) => {
            loc = resolveLocale(p, locale);
            const plan = p.sets[loc];
            const [i] = resolveSlides(plan, [index]);
            if (plan.slides.length <= 1) {
                throw new VitrinError("Son slayt silinemez", "Önce yeni slayt ekle.");
            }
            plan.slides.splice(i, 1);
            left = plan.slides.length;
        });
        return withData(text(`${loc} · slayt ${index} silindi · kalan ${left}`), {
            locale: loc,
            remaining: left,
        });
    });
}
//# sourceMappingURL=content.js.map