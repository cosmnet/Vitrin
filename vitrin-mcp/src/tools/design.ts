// Tema / şablon / yerleşim katalogları, uygulama araçları ve tasarım senkronu.

import { z } from "zod";

import { catalog, type SlideStyle } from "../catalog.js";
import { renderContactSheet } from "../headless.js";
import { VitrinError } from "../log.js";
import {
  deleteProject,
  loadProject,
  mutateProject,
  resolveLocale,
  resolveSlides,
  saveProject,
  summarizeSet,
  uid,
  type Project,
  type Slide,
} from "../project.js";
import { image, progressSender, text, tool, withData, type Server } from "../result.js";
import { api } from "../studio.js";

/* ------------------------------------------------------------------ *
   Tasarım senkronu — /api/sync (engine/designsync.ts sunucuda koşar)
 * ------------------------------------------------------------------ */

export type SyncResult = {
  from: string;
  targets: string[];
  slides: number;
  touched: number;
  note: string | null;
};

export async function syncDesign(
  projectId: string,
  from: string,
  to: "all" | string[] = "all",
  slides: "all" | number[] = "all",
  order = false
): Promise<SyncResult> {
  return api<SyncResult>("/api/sync", { projectId, from, to, slides, order }, { timeoutMs: 180_000 });
}

/* ------------------------------------------------------------------ *
   Önizlemeli katalog — GEÇİCİ PROJE YOLU
 * ------------------------------------------------------------------ */

/**
 * withPreview neden geçici proje kurar?
 *
 * Motor yalnız bir `Slide` çizebiliyor ve `renderSlide` yalnız tarayıcıda
 * koşuyor. Her tema için ayrı sayfa yüklemek yerine, TEK geçici projede
 * her tema/şablon/yerleşim için bir slayt kurulur, /headless-export bir kez
 * `mode=preview&slides=all` ile açılır ve ızgara TARAYICI İÇİNDE birleşir.
 * Sonuç: N katalog girdisi için 1 sayfa yüklemesi + 1 görsel. Geçici proje
 * her durumda (hata dahil) silinir.
 */
const SAMPLE_SHOT = "/assets/samples/phone/portrait.svg";
const SAMPLE_SHOT_2 = "/assets/samples/phone/portrait.svg#details";

async function withTempProject<T>(
  app: string,
  slides: Slide[],
  format: NonNullable<Project["format"]>,
  fn: (id: string) => Promise<T>
): Promise<T> {
  const sample = format === "iphone" ? SAMPLE_SHOT
    : `/assets/samples/tablet/${format === "ipad" ? "portrait" : "landscape"}.svg`;
  const sample2 = format === "iphone" ? SAMPLE_SHOT_2 : `${sample}#details`;
  const previewSlides = slides.map((s) => ({ ...s,
    screenshot: s.screenshot === SAMPLE_SHOT ? sample : s.screenshot,
    screenshot2: s.screenshot2 === SAMPLE_SHOT_2 ? sample2 : s.screenshot2,
  }));
  const p: Project = {
    id: `mcpprev${uid().slice(0, 6)}`,
    app,
    createdAt: new Date().toISOString(),
    screenshots: [
      { id: uid(), name: "örnek ekran 1", dataUrl: sample },
      { id: uid(), name: "örnek ekran 2", dataUrl: sample2 },
    ],
    sets: { tr: { app, locale: "tr", slides: previewSlides } },
    activeLocale: "tr",
    format,
    syncDesign: false,
  };
  await saveProject(p);
  try {
    return await fn(p.id);
  } finally {
    await deleteProject(p.id).catch(() => undefined);
  }
}

function previewSlide(partial: Partial<Slide> & { themeId: string; layout: string }): Slide {
  return {
    id: uid(),
    designKey: uid(),
    headline: partial.headline ?? "",
    sub: partial.sub ?? "",
    screenshot: SAMPLE_SHOT,
    // Single-device layouts ignore this; paired themes/templates must not
    // silently fall back to text-top because their second slot is missing.
    screenshot2: SAMPLE_SHOT_2,
    ...partial,
  };
}

/** Studio `restyleSlides` ile aynı içerik/tasarım ayrımı. */
function applyTemplateStyle(slide: Slide, style: SlideStyle): void {
  const userElements = (slide.elements ?? []).filter((e) => !e.id.startsWith("brand:"));

  delete slide.headlineStyle;
  delete slide.subStyle;
  delete slide.textOffset;
  delete slide.deviceOffset;
  delete slide.device2Offset;
  delete slide.hideDevice;
  delete slide.frameLabel;

  Object.assign(slide, structuredClone(style));
  const elements = [...(style.elements ? structuredClone(style.elements) : []), ...userElements];
  slide.elements = elements.length ? elements : undefined;
}

/* ------------------------------------------------------------------ *
   Kayıt
 * ------------------------------------------------------------------ */

const previewInput = z.object({
  format: z.enum(["iphone", "ipad", "ipad-landscape"]).optional()
    .describe("Önizleme proje formatı, vars. iphone"),
  withPreview: z
    .boolean()
    .optional()
    .describe("true ise hepsini TEK kontak görselinde çizer (yaklaşık 1-2 dk sürer)"),
  cellWidth: z.number().int().min(80).max(600).optional().describe("Önizleme hücre eni, vars. 200"),
});

export function registerDesign(server: Server): void {
  tool(
    server,
    "vitrin_list_themes",
    {
      title: "Temalar",
      description:
        "Sanat yönlerini listeler (id, ad, vurgu rengi, varsayılan yerleşim, cihaz modu). " +
        "withPreview=true ise hepsi TEK ızgara görselinde çizilir.",
      inputSchema: previewInput,
      readOnly: true,
    },
    async ({ withPreview, cellWidth, format }, ctx) => {
      const cat = await catalog();
      const lines = cat.themes.map(
        (t) =>
          `${t.id.padEnd(13)} ${t.name.padEnd(16)} ${t.accent}  ${t.deviceMode}  ${t.defaultLayout.padEnd(21)} ${t.headlineFont}`
      );
      if (!withPreview) {
        return withData(text(`${cat.themes.length} tema:`, ...lines), { themes: cat.themes });
      }
      const progress = progressSender(ctx);
      const slides = cat.themes.map((t) =>
        previewSlide({ themeId: t.id, layout: t.defaultLayout, headline: t.name, sub: t.id })
      );
      const sheet = await withTempProject("Tema önizleme", slides, format ?? "iphone", (id) =>
        renderContactSheet(id, "tr", "all", cellWidth ?? 200, 5, {
          onProgress: (p) => progress(p.done, p.total, p.current),
        })
      );
      return image(sheet.base64, [`${cat.themes.length} tema (soldan sağa):`, ...lines].join("\n"));
    }
  );

  tool(
    server,
    "vitrin_list_templates",
    {
      title: "Şablonlar",
      description:
        "Hazır set kurguları (hero / ödül / minimal / panorama / iPad / iki özellik). Şablon 'giysidir': " +
        "tema + yerleşim + kamera adımları. withPreview=true ise ilk adımları TEK ızgarada çizer.",
      inputSchema: previewInput.extend({
        kategori: z.enum(["all", "hero", "award", "minimal", "panorama", "ipad", "split", "duo"]).optional(),
      }),
      readOnly: true,
    },
    async ({ withPreview, cellWidth, kategori, format }, ctx) => {
      const cat = await catalog();
      const rows =
        !kategori || kategori === "all"
          ? cat.templates
          : cat.templates.filter((t) => t.kategori === kategori);
      const lines = rows.map(
        (t) => `${t.id.padEnd(22)} ${t.name.padEnd(26)} ${t.kategori.padEnd(9)} tema:${t.themeId.padEnd(13)} ${t.hint}`
      );
      if (!withPreview) {
        return withData(text(`${rows.length} şablon:`, ...lines), { templates: rows });
      }
      const progress = progressSender(ctx);
      const slides = rows.map((t) =>
        previewSlide({ ...(t.styles[0] as Partial<Slide>), themeId: t.styles[0].themeId, layout: t.styles[0].layout, headline: t.name, sub: t.hint })
      );
      const sheet = await withTempProject("Şablon önizleme", slides, format ?? "iphone", (id) =>
        renderContactSheet(id, "tr", "all", cellWidth ?? 200, 5, {
          onProgress: (p) => progress(p.done, p.total, p.current),
        })
      );
      return image(sheet.base64, [`${rows.length} şablon (soldan sağa):`, ...lines].join("\n"));
    }
  );

  tool(
    server,
    "vitrin_list_layouts",
    {
      title: "Yerleşimler",
      description:
        "Kompozisyonları listeler (metin/cihaz oranlı koordinatlarıyla). split-v ve split-h İKİ ekran " +
        "görüntüsü ister. withPreview=true ise hepsi TEK ızgarada çizilir.",
      inputSchema: previewInput.extend({
        themeId: z.string().optional().describe("Önizlemede kullanılacak tema, vars. obsidian"),
      }),
      readOnly: true,
    },
    async ({ withPreview, cellWidth, themeId, format }, ctx) => {
      const cat = await catalog();
      const lines = cat.layouts.map(
        (l) =>
          `${l.id.padEnd(21)} metin(${l.text.x},${l.text.y},${l.text.w},${l.text.align})  cihaz(${l.device.cx},${l.device.cy},×${l.device.scale})${l.device2 ? "  +2.cihaz" : ""}`
      );
      if (!withPreview) {
        return withData(text(`${cat.layouts.length} yerleşim:`, ...lines), { layouts: cat.layouts });
      }
      const theme = themeId && cat.themes.some((t) => t.id === themeId) ? themeId : "obsidian";
      const progress = progressSender(ctx);
      const slides = cat.layouts.map((l) => {
        const s = previewSlide({
          themeId: theme,
          layout: l.id,
          headline: l.id,
          sub: "örnek alt satır",
        });
        return s;
      });
      const sheet = await withTempProject("Yerleşim önizleme", slides, format ?? "iphone", (id) =>
        renderContactSheet(id, "tr", "all", cellWidth ?? 200, 5, {
          onProgress: (p) => progress(p.done, p.total, p.current),
        })
      );
      return image(sheet.base64, [`${cat.layouts.length} yerleşim · tema ${theme}:`, ...lines].join("\n"));
    }
  );

  /* ---------------------------------------------------------------- *
     Uygulama
   * ---------------------------------------------------------------- */

  tool(
    server,
    "vitrin_apply_theme",
    {
      title: "Tema uygula",
      description:
        "Seçili slaytlara (varsayılan hepsi) temayı uygular ve slayt seviyesindeki zemin/cihaz " +
        "override'larını temizler — stüdyodaki tema seçiciyle birebir aynı davranış.",
      inputSchema: z.object({
        projectId: z.string(),
        locale: z.string().optional(),
        themeId: z.string(),
        slides: z.union([z.literal("all"), z.array(z.number().int().min(0))]).optional(),
        syncOtherLocales: z.boolean().optional().describe("Diğer dillere de yay (vars. true)"),
      }),
    },
    async ({ projectId, locale, themeId, slides, syncOtherLocales }) => {
      const cat = await catalog();
      if (!cat.themes.some((t) => t.id === themeId)) {
        throw new VitrinError(
          `Bilinmeyen tema: ${themeId}`,
          `Geçerliler: ${cat.themes.map((t) => t.id).join(", ")}`
        );
      }
      let loc = "";
      let idx: number[] = [];
      await mutateProject(projectId, (p) => {
        loc = resolveLocale(p, locale);
        const plan = p.sets[loc];
        idx = resolveSlides(plan, slides === "all" ? "all" : slides);
        for (const i of idx) {
          plan.slides[i].themeId = themeId;
          delete plan.slides[i].background;
          delete plan.slides[i].device;
        }
      });
      let note = "";
      if (syncOtherLocales !== false) {
        const s = await syncDesign(projectId, loc, "all", idx);
        if (s.targets.length) note = `${s.targets.length} dile yayıldı${s.note ? ` · ${s.note}` : ""}`;
      }
      return withData(text(`${loc} · ${idx.length} slayt → tema ${themeId}`, note), {
        locale: loc,
        themeId,
        slides: idx.length,
      });
    }
  );

  tool(
    server,
    "vitrin_apply_template",
    {
      title: "Şablon uygula",
      description:
        "Slaytları şablonun giysisiyle yeniden kurar: tema, yerleşim, zemin çeşitlemesi ve " +
        "cihaz adım adım uygulanır. Metin, rozet, süs ve ekran görüntüsü KORUNUR; elle " +
        "yapılmış nudge'lar ve stil override'ları temizlenir (restyleSlides ile aynı).",
      inputSchema: z.object({
        projectId: z.string(),
        locale: z.string().optional(),
        templateId: z.string(),
        slideIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Yalnız bu slayt; verilmezse tüm set"),
        syncOtherLocales: z.boolean().optional(),
      }),
    },
    async ({ projectId, locale, templateId, slideIndex, syncOtherLocales }) => {
      const cat = await catalog();
      const tpl = cat.templates.find((t) => t.id === templateId);
      if (!tpl) {
        throw new VitrinError(
          `Bilinmeyen şablon: ${templateId}`,
          `Geçerliler: ${cat.templates.map((t) => t.id).join(", ")}`
        );
      }
      let loc = "";
      let idx: number[] = [];
      await mutateProject(projectId, (p) => {
        loc = resolveLocale(p, locale);
        const plan = p.sets[loc];
        idx = resolveSlides(plan, slideIndex === undefined ? "all" : [slideIndex]);
        for (const i of idx) {
          const style = tpl.styles[i % tpl.styles.length];
          applyTemplateStyle(plan.slides[i], style);
        }
      });
      let note = "";
      if (syncOtherLocales !== false) {
        const s = await syncDesign(projectId, loc, "all", idx);
        if (s.targets.length) note = `${s.targets.length} dile yayıldı${s.note ? ` · ${s.note}` : ""}`;
      }
      const p = await loadProject(projectId);
      return withData(
        text(`${loc} · ${idx.length} slayt → şablon ${tpl.name}`, note, "", summarizeSet(p.sets[loc])),
        { locale: loc, templateId, slides: idx.length }
      );
    }
  );

  tool(
    server,
    "vitrin_sync_design",
    {
      title: "Tasarımı dillere yay",
      description:
        "Kaynak dilin TASARIMINI (tema, yerleşim, zemin, cihaz, nudge, metin stilleri) hedef " +
        "dillere kopyalar; başlık/alt satır/ekran görüntüsü YERİNDE kalır. Eşleşme designKey " +
        "iledir. RTL dillerde hizalama aynalanır, kasasız yazılarda BÜYÜK HARF atlanır, " +
        "hedefin yazısını kapsamayan font hedefe yazılmaz.",
      inputSchema: z.object({
        projectId: z.string(),
        from: z.string().optional().describe("Kaynak dil; varsayılan aktif dil"),
        to: z
          .union([z.literal("all"), z.array(z.string())])
          .optional()
          .describe('Hedef diller, varsayılan "all"'),
        slides: z
          .union([z.literal("all"), z.array(z.number().int().min(0))])
          .optional()
          .describe("Yalnız bu kaynak slaytlar"),
        order: z.boolean().optional().describe("Slayt SIRASINI da kaynağa göre hizala"),
      }),
    },
    async ({ projectId, from, to, slides, order }) => {
      const p = await loadProject(projectId);
      const src = resolveLocale(p, from);
      const r = await syncDesign(projectId, src, to ?? "all", slides ?? "all", order === true);
      return withData(
        text(
          r.targets.length
            ? `${r.from} → ${r.targets.join(", ")} · ${r.slides} kaynak slayt · ${r.touched} slayt güncellendi`
            : `${r.from} dışında hedef dil yok — yayılacak bir şey bulunamadı`,
          r.note ? `Not: ${r.note}` : "",
          order ? "Sıra da hizalandı." : ""
        ),
        r as unknown as Record<string, unknown>
      );
    }
  );
}
