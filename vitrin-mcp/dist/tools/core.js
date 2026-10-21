// Durum, proje listesi/oluşturma/açma/silme, stüdyoyu açma.
import { exec } from "node:child_process";
import { z } from "zod";
import { catalog } from "../catalog.js";
import { BASE_URL, VITRIN_DIR, VITRIN_PORT } from "../config.js";
import { browserReady, glMode } from "../browser.js";
import { VitrinError } from "../log.js";
import { assertId, deleteProject, listProjects, loadProject, resolveLocale, saveProject, summarizeList, summarizeProject, uid, } from "../project.js";
import { text, tool, withData } from "../result.js";
import { ensureServer, health } from "../studio.js";
export function registerCore(server) {
    tool(server, "vitrin_status", {
        title: "Vitrin durumu",
        description: "Vitrin Studio dev sunucusunun ayakta olup olmadığını söyler, gerekirse başlatır; " +
            "port, klasör, tarayıcı/WebGL durumu ve proje sayısını döner. Her işin başında çağır.",
        inputSchema: z.object({}),
        readOnly: true,
    }, async () => {
        const before = await health();
        if (!before)
            await ensureServer();
        const rows = await listProjects();
        const cat = await catalog();
        return withData(text(`Dev sunucu: AYAKTA — ${BASE_URL}${before ? "" : " (bu çağrıda başlatıldı)"}`, `Klasör: ${VITRIN_DIR}`, `Tarayıcı: ${browserReady() ? `açık (WebGL: ${glMode()})` : "kapalı (ilk render'da açılır)"}`, `Proje: ${rows.length} · Tema: ${cat.themes.length} · Şablon: ${cat.templates.length} · Yerleşim: ${cat.layouts.length}`, "", summarizeList(rows)), {
            up: true,
            startedNow: !before,
            url: BASE_URL,
            port: VITRIN_PORT,
            dir: VITRIN_DIR,
            browser: browserReady(),
            webgl: glMode(),
            projects: rows.length,
        });
    });
    tool(server, "vitrin_list_projects", {
        title: "Projeleri listele",
        description: "Kayıtlı tüm Vitrin projelerini id, uygulama adı, diller ve tarihle listeler.",
        inputSchema: z.object({}),
        readOnly: true,
    }, async () => {
        const rows = await listProjects();
        return withData(text(summarizeList(rows)), { projects: rows });
    });
    tool(server, "vitrin_create_project", {
        title: "Yeni proje",
        description: "Boş bir Vitrin projesi oluşturur. Slaytlar sonra vitrin_import (MD klasöründen) " +
            "ya da vitrin_art_direct ile doldurulur.",
        inputSchema: z.object({
            app: z.string().min(1).describe("Uygulama adı — export klasörü bu adı alır"),
            brief: z.string().optional().describe("Kısa tanıtım metni; Art Director bunu okur"),
            locale: z.string().optional().describe('Başlangıç dili, varsayılan "tr"'),
            format: z
                .enum(["iphone", "ipad", "ipad-landscape"])
                .optional()
                .describe('Proje formatı, varsayılan "iphone". iPad seti AYRI projedir: tuval 3:4 ' +
                "(2064×2752), cihaz tablet, export ipad-13. iPad arayüzü ayrı çekilmiş " +
                "ekran görüntüleri ister."),
        }),
    }, async ({ app, brief, locale, format }) => {
        const loc = (locale ?? "tr").trim() || "tr";
        const fmt = format ?? "iphone";
        const project = {
            id: uid(),
            app: app.trim(),
            brief: brief?.trim() || undefined,
            createdAt: new Date().toISOString(),
            screenshots: [],
            sets: { [loc]: { app: app.trim(), locale: loc, slides: [] } },
            activeLocale: loc,
            format: fmt,
            syncDesign: true,
            designLocks: {},
        };
        await saveProject(project);
        return withData(text(`Proje oluşturuldu: ${project.app} · id=${project.id} · dil=${loc} · ${fmt} · 0 slayt`), { id: project.id, app: project.app, locale: loc, format: fmt });
    });
    tool(server, "vitrin_open_project", {
        title: "Projeyi aç (özet)",
        description: "Projenin ÖZETİNİ döner: diller, slayt sayıları ve seçili dilin slayt tablosu " +
            "(başlık, tema, yerleşim, ekran var/yok). Ham JSON asla dönmez.",
        inputSchema: z.object({
            projectId: z.string().describe("vitrin_list_projects'ten gelen id"),
            locale: z.string().optional().describe("Tablosu gösterilecek dil; varsayılan aktif dil"),
        }),
        readOnly: true,
    }, async ({ projectId, locale }) => {
        const p = await loadProject(projectId);
        const loc = resolveLocale(p, locale);
        return withData(text(summarizeProject(p, loc)), {
            id: p.id,
            app: p.app,
            locales: Object.keys(p.sets),
            locale: loc,
            slides: p.sets[loc].slides.length,
            screenshots: p.screenshots.length,
            syncDesign: p.syncDesign !== false,
        });
    });
    tool(server, "vitrin_duplicate_project", {
        title: "Projeyi çoğalt",
        description: "Projeyi yeni id ile kopyalar; `format` verilirse o formata geçirir. " +
            "Tipik kullanım: iPhone setinden iPad seti — metin, kurgu, diller ve ekran " +
            "havuzu aynen taşınır, sonra iPad ekran görüntüleri atanır.",
        inputSchema: z.object({
            projectId: z.string(),
            app: z.string().optional().describe("Yeni ad; yoksa '<ad> (kopya)' / '<ad> (iPad)'"),
            format: z.enum(["iphone", "ipad", "ipad-landscape"]).optional(),
        }),
    }, async ({ projectId, app, format }) => {
        const src = await loadProject(projectId);
        const fmt = format ?? src.format ?? "iphone";
        const label = format && format !== (src.format ?? "iphone") ? (fmt === "ipad" ? "iPad" : fmt === "ipad-landscape" ? "iPad yatay" : "iPhone") : "kopya";
        const name = (app?.trim() || `${src.app} (${label})`).trim();
        const copy = structuredClone(src);
        copy.id = uid();
        copy.app = name;
        copy.createdAt = new Date().toISOString();
        copy.format = fmt;
        for (const set of Object.values(copy.sets))
            set.app = name;
        await saveProject(copy);
        return withData(text(`Çoğaltıldı: ${name} · id=${copy.id} · ${fmt}`), {
            id: copy.id,
            app: name,
            format: fmt,
            source: src.id,
        });
    });
    tool(server, "vitrin_delete_project", {
        title: "Projeyi sil",
        description: "Projeyi kalıcı olarak siler. Geri alınamaz — bu yüzden confirm alanına projenin " +
            "uygulama adını AYNEN yazmak zorunludur.",
        inputSchema: z.object({
            projectId: z.string(),
            confirm: z.string().describe("Silinecek projenin app adı — yanlışsa silinmez"),
        }),
    }, async ({ projectId, confirm }) => {
        const id = assertId(projectId);
        const p = await loadProject(id);
        if (confirm.trim() !== p.app.trim()) {
            throw new VitrinError(`Onay eşleşmedi: "${confirm}" ≠ "${p.app}"`, "Silmek için confirm alanına projenin app adını aynen yaz.");
        }
        await deleteProject(id);
        const rows = await listProjects();
        return withData(text(`Silindi: ${p.app} (${id}). Kalan proje: ${rows.length}`), {
            deleted: id,
            remaining: rows.map((r) => r.id),
        });
    });
    tool(server, "vitrin_open_studio", {
        title: "Stüdyoyu tarayıcıda aç",
        description: "Vitrin Studio'yu macOS'ta varsayılan tarayıcıda açar — kullanıcı işi elle " +
            "devralmak istediğinde.",
        inputSchema: z.object({
            projectId: z.string().optional(),
            page: z.enum(["studio", "headless-export"]).optional(),
        }),
    }, async ({ projectId, page }) => {
        const url = page === "headless-export" && projectId
            ? `${BASE_URL}/headless-export?project=${encodeURIComponent(assertId(projectId))}&mode=preview&slides=0`
            : `${BASE_URL}/studio`;
        await new Promise((resolve, reject) => {
            exec(`open ${JSON.stringify(url)}`, (err) => err ? reject(new VitrinError(`Tarayıcı açılamadı: ${err.message}`, url)) : resolve());
        });
        return withData(text(`Açıldı: ${url}`), { url });
    });
}
//# sourceMappingURL=core.js.map