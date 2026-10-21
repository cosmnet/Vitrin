"use client";

/* ---------------------------------------------------------------------------
   /headless-export — Vitrin MCP'nin sürdüğü, kendi kendine çalışan sayfa.

   NEDEN VAR
   renderSlide/exportSet YALNIZ tarayıcıda çalışır (canvas + WebGL + FontFace).
   MCP sunucu tarafında motoru yeniden yazmak yerine (PLAN-R7 §0.6: "sunucu-taraflı
   rewrite RED") headless Chromium'u bu sayfaya sürer; motorun TEK kopyası kalır.

   SÖZLEŞME (MCP bunlara bakar)
     window.__vitrinProgress = { done, total, current }   // her slayttan sonra
     window.__vitrinDone     = true                       // BAŞARIDA DA HATADA DA
     window.__vitrinError    = "…"                        // yalnız hatada
     window.__vitrinResult   = dataURL | dizi | export özeti
     window.__vitrinResults  = her zaman dizi (preview)

   BU SAYFA STORE'A DOKUNMAZ
   Zustand store'u, localStorage'ı, autosave'i hiç import etmez: proje HTTP ile
   okunur, çıktı HTTP ile yazılır. Yani headless sekme kullanıcının açık
   stüdyosunu ASLA bozamaz.

   GİZLİ SEKME NOTU
   Chrome arka plan sekmesinde setTimeout'u ~1 sn'ye kısar; slayt başına 1 sn
   ölü bekleme demek olurdu. Bu yüzden nefes alma noktası MessageChannel ile
   kurulmuş bir makro-görev (yieldToBrowser) — kısılmaz. Görsel yüklemeleri
   engine/assets.ts'te onload ile (decode() değil), 3D katman /test3d'de
   kanıtlandığı gibi gizli sekmede de render ediliyor.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";

import { loadFontsForLocale, prefetchAllScripts } from "@/engine/fonts";
import { ensureModelMeta } from "@/engine/modelRegistry";
import { renderSlide } from "@/engine/render";
import {
  BASE_H,
  BASE_W,
  EXPORT_SIZES,
  FORMATS,
  type ExportSizeId,
  type Project,
  type SetPlan,
  baseOf,
  formatOf,
} from "@/engine/types";

/* ---------------------------------------------------------------- globals */

type Progress = { done: number; total: number; current: string };
type PreviewItem = {
  locale: string;
  slide: number;
  file: string;
  width: number;
  height: number;
  dataUrl: string;
};
type ExportSummary = {
  ok: boolean;
  paths: string[];
  written: number;
  files: string[];
};

declare global {
  interface Window {
    __vitrinProgress?: Progress;
    __vitrinDone?: boolean;
    __vitrinError?: string;
    __vitrinResult?: string | PreviewItem[] | ExportSummary;
    __vitrinResults?: PreviewItem[];
    /** Parametresiz açılış: kullanım kılavuzu gösterildi, iş yapılmadı. */
    __vitrinUsage?: boolean;
    /**
     * WebGL var mı? SESSİZ KALİTE TUZAĞI: scene3d WebGL bulamazsa hata atmaz,
     * ŞEFFAF katman döner — slayt basılır ama CİHAZ YOK. MCP bu bayrağa bakıp
     * Chrome'u swiftshader/GPU ile yeniden başlatabilsin diye ayrıca yayınlanır.
     */
    __vitrinWebgl?: boolean;
  }
}

/** Tek seferlik WebGL yoklaması — bağlam hemen bırakılır. */
function probeWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ parametreler */

type Mode = "export" | "preview";

type Params = {
  project: string;
  locale: string; // ham değer: "", "all" ya da csv
  sizes: ExportSizeId[];
  slides: "all" | number[];
  mode: Mode;
  width: number;
};

const SIZE_IDS = Object.keys(EXPORT_SIZES) as ExportSizeId[];

function parseParams(search: string): Params {
  const q = new URLSearchParams(search);

  const rawSizes = (q.get("sizes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = rawSizes.filter((s) => !SIZE_IDS.includes(s as ExportSizeId));
  if (bad.length) {
    throw new Error(
      `Bilinmeyen sizes değeri: ${bad.join(", ")} — geçerliler: ${SIZE_IDS.join(", ")}`
    );
  }

  const rawSlides = (q.get("slides") || "all").trim();
  let slides: "all" | number[] = "all";
  if (rawSlides && rawSlides !== "all") {
    slides = rawSlides.split(",").map((s) => {
      const n = Number(s.trim());
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`slides yalnız 0-tabanlı tamsayı ya da "all" alır: "${s}"`);
      }
      return n;
    });
    if (!slides.length) slides = "all";
  }

  const rawMode = (q.get("mode") || "export").trim();
  if (rawMode !== "export" && rawMode !== "preview") {
    throw new Error(`mode yalnız "export" ya da "preview" olabilir: "${rawMode}"`);
  }

  const rawWidth = Number(q.get("width") || 660);
  const width = Number.isFinite(rawWidth) ? Math.round(rawWidth) : 660;
  if (width < 32 || width > 4096) throw new Error(`width 32..4096 aralığında olmalı: ${width}`);

  return {
    project: (q.get("project") || "").trim(),
    locale: (q.get("locale") || "").trim(),
    sizes: rawSizes as ExportSizeId[],
    slides,
    mode: rawMode,
    width,
  };
}

/* ------------------------------------------------------------- yardımcılar */

/** Arka plan sekmesinde KISILMAYAN makro-görev. setTimeout(…,0) yerine. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = (await res.json()) as { project?: Project; error?: string };
  if (!res.ok || !data.project) throw new Error(data.error || `Proje okunamadı (${res.status})`);
  return data.project;
}

/** locale parametresini projedeki gerçek set anahtarlarına çevirir. */
function resolveLocales(project: Project, raw: string): string[] {
  const have = Object.keys(project.sets || {});
  if (!have.length) throw new Error("Projede hiç dil seti yok");
  if (!raw) return [project.activeLocale && have.includes(project.activeLocale) ? project.activeLocale : have[0]];
  if (raw === "all") return have;
  const want = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const missing = want.filter((l) => !have.includes(l));
  if (missing.length) {
    throw new Error(`Projede olmayan dil: ${missing.join(", ")} — mevcut: ${have.join(", ")}`);
  }
  return want;
}

/** slides parametresini bu set için gerçek indekslere çevirir (0-tabanlı). */
function resolveSlides(plan: SetPlan, want: "all" | number[], locale: string): number[] {
  const n = plan.slides.length;
  if (want === "all") return Array.from({ length: n }, (_, i) => i);
  const bad = want.filter((i) => i >= n);
  if (bad.length) {
    throw new Error(`${locale} setinde ${n} slayt var, istenen indeks yok: ${bad.join(", ")}`);
  }
  return want;
}

/**
 * exportSet ile BİREBİR aynı dosya adı kuralı — tek fark: numara slaytın
 * PROJEDEKİ indeksinden gelir, seçili listedeki sırasından değil. Böylece
 * `slides=2,4` çıktısı 03.png / 05.png olur, 01/02 olmaz.
 */
function fileNameFor(index: number, sizeId: ExportSizeId, multiSize: boolean): string {
  const nn = String(index + 1).padStart(2, "0");
  return multiSize ? `${sizeId}/${nn}.png` : `${nn}.png`;
}

/* ------------------------------------------------------------------- akış */

// StrictMode (dev'de effect iki kez koşar) ve olası remount'lara karşı tek-atış
// kilidi. Modül kapsamında durur, bileşen yeniden kurulsa da sıfırlanmaz.
let started = false;

export default function HeadlessExport() {
  const [lines, setLines] = useState<string[]>(["hazırlanıyor…"]);
  const [prog, setProg] = useState<Progress | null>(null);
  const [state, setState] = useState<"run" | "ok" | "err" | "usage">("run");
  const logRef = useRef<string[]>([]);

  useEffect(() => {
    if (started) return;
    started = true;

    const log = (s: string) => {
      logRef.current = [...logRef.current, s];
      setLines(logRef.current);
    };
    const publish = (p: Progress) => {
      window.__vitrinProgress = p;
      setProg(p);
    };

    const params = (() => {
      try {
        return parseParams(window.location.search);
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    })();

    // Parametresiz açılış: hata değil, kullanım kılavuzu.
    if (!(params instanceof Error) && !params.project) {
      window.__vitrinUsage = true;
      window.__vitrinError = "project parametresi gerekli — kullanım kılavuzu gösterildi";
      window.__vitrinDone = true;
      setState("usage");
      return;
    }

    (async () => {
      if (params instanceof Error) throw params;
      const { project: pid, slides, mode, width } = params;

      window.__vitrinProgress = { done: 0, total: 0, current: "başlıyor" };
      log(`mode=${mode} project=${pid} sizes=${params.sizes.join(",") || "auto"} slides=${slides === "all" ? "all" : slides.join(",")}`);

      const webgl = probeWebgl();
      window.__vitrinWebgl = webgl;
      if (!webgl) log("UYARI: WebGL yok — 3D cihazlı slaytlar CİHAZSIZ basılacak");

      await ensureModelMeta(); // 3D ekran kalibrasyonu — render'dan önce hazır olsun
      const project = await fetchProject(pid);
      const format = formatOf(project);
      const sizes = params.sizes.length ? params.sizes : [FORMATS[format].exportSize];
      const incompatible = sizes.filter((id) => format === "iphone"
        ? !id.startsWith("iphone-")
        : id !== FORMATS[format].exportSize);
      if (incompatible.length && mode === "export") {
        throw new Error(`Bu proje ${FORMATS[format].label}; uyumsuz export boyutu: ${incompatible.join(", ")}. Cihaz formatını ayrı projede seçin.`);
      }
      const locales = resolveLocales(project, params.locale);
      log(`proje: ${project.app} · diller: ${locales.join(", ")} · webgl: ${webgl ? "var" : "YOK"}`);

      // Çok dilli işte CJK dahil her yüzü tek seferde al; tek dilde yalnız
      // gerekli yazıyı yükle (16 MB'lık CJK setini boşuna indirme).
      if (locales.length > 1) await prefetchAllScripts();

      // Toplam: export'ta dil × boyut × slayt, preview'da dil × slayt.
      let total = 0;
      for (const loc of locales) {
        const n = resolveSlides(project.sets[loc], slides, loc).length;
        total += mode === "export" ? n * sizes.length : n;
      }
      publish({ done: 0, total, current: "başlıyor" });

      const previews: PreviewItem[] = [];
      const summary: ExportSummary = { ok: true, paths: [], written: 0, files: [] };
      let done = 0;

      for (const locale of locales) {
        const plan = project.sets[locale];
        const idx = resolveSlides(plan, slides, locale);
        // Export/preview AYNI ön koşuldan geçer: dilin fontları önce.
        await loadFontsForLocale(locale);

        // --- ORTAK RENDER DÖNGÜSÜ: iki mod da buradan geçer, fark yalnız
        //     hedef boyut ve sonucun nereye gittiği.
        // Proje formatı: BASE tabanı ve varsayılan önizleme oranı buradan.
        const fmt = formatOf(project);
        const targets =
          mode === "export"
            ? sizes.map((id) => ({ id, w: EXPORT_SIZES[id].w, h: EXPORT_SIZES[id].h }))
            : [
                {
                  id: sizes[0],
                  w: width,
                  h: Math.max(1, Math.round((width * baseOf(fmt).h) / baseOf(fmt).w)),
                },
              ];

        const images: { file: string; dataUrl: string }[] = [];

        // A missing screen texture can otherwise produce a valid PNG with a
        // blank device. Check local native assets before committing any output.
        const nativeSources = new Set(idx.flatMap(i => {
          const s = plan.slides[i];
          return s.hideDevice ? [] : [s.screenshot, s.screenshot2, s.screenshot3]
            .filter((src): src is string => !!src && src.startsWith('/assets/'));
        }));
        await Promise.all([...nativeSources].map(async src => {
          const response = await fetch(src, { method: 'HEAD', cache: 'no-store' });
          if (!response.ok) throw new Error(`Ekran görseli yüklenemedi (${response.status}): ${src}`);
        }));

        for (const t of targets) {
          for (const i of idx) {
            publish({ done, total, current: `${locale} · ${t.id} · slayt ${i + 1}/${plan.slides.length}` });
            // draft YOK — export kalitesi; locale geçiliyor (büyük harf/RTL/CJK).
            const canvas = await renderSlide(plan.slides[i], {
              width: t.w,
              height: t.h,
              locale,
              format: fmt,
            });
            const dataUrl = canvas.toDataURL("image/png");
            const file = fileNameFor(i, t.id, mode === "export" && sizes.length > 1);
            if (mode === "export") {
              images.push({ file, dataUrl });
              summary.files.push(`${locale}/${file}`);
            } else {
              previews.push({ locale, slide: i, file, width: t.w, height: t.h, dataUrl });
            }
            done += 1;
            publish({ done, total, current: `${locale} · ${t.id} · slayt ${i + 1}/${plan.slides.length}` });
            await yieldToBrowser();
          }
        }

        if (mode === "export") {
          publish({ done, total, current: `${locale} · yazılıyor…` });
          // engine/export.ts'in POST'uyla BİREBİR aynı gövde.
          const res = await fetch("/api/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app: plan.app, locale: plan.locale, images }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            path?: string;
            written?: number;
            error?: string;
          };
          if (!res.ok || !data.ok) throw new Error(data.error || `export yazılamadı (${res.status})`);
          if (data.path) summary.paths.push(data.path);
          summary.written += data.written ?? images.length;
          log(`${locale}: ${data.written ?? images.length} PNG → ${data.path}`);
        } else {
          log(`${locale}: ${idx.length} önizleme (${targets[0].w}×${targets[0].h})`);
        }
      }

      if (mode === "preview") {
        window.__vitrinResults = previews;
        window.__vitrinResult = previews.length === 1 ? previews[0].dataUrl : previews;
      } else {
        window.__vitrinResult = summary;
      }
      publish({ done, total, current: "bitti" });
      log("BİTTİ");
      setState("ok");
    })()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        window.__vitrinError = String(msg);
        log(`HATA: ${msg}`);
        setState("err");
      })
      .finally(() => {
        // Sözleşme: hata olsa da __vitrinDone HER ZAMAN set edilir.
        window.__vitrinDone = true;
      });
  }, []);

  if (state === "usage") return <Usage />;

  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
  return (
    <main style={SHELL}>
      <div style={{ color: "#C6FF3A" }}>vitrin · headless-export</div>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.startsWith("HATA") ? "#F4520B" : "#F2F1EC" }}>
          {l}
        </div>
      ))}
      {prog && (
        <div style={{ marginTop: 8, color: "#8a8a92" }}>
          {prog.done}/{prog.total} · %{pct} · {prog.current}
        </div>
      )}
      <div style={{ marginTop: 12, color: state === "err" ? "#F4520B" : "#C6FF3A" }}>
        {state === "run" ? "ÇALIŞIYOR" : state === "ok" ? "DONE" : "ERROR"}
      </div>
    </main>
  );
}

/* --------------------------------------------------------------- kılavuz */

const SHELL: React.CSSProperties = {
  minHeight: "100vh",
  background: "#141416",
  color: "#F2F1EC",
  font: "13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
  padding: 32,
  whiteSpace: "pre-wrap",
};

const ROWS: [string, string][] = [
  ["project", "ZORUNLU · data/projects/<id>.json içindeki proje id'si"],
  ["locale", "dil kodu | virgüllü liste | all · varsayılan: projenin activeLocale'i"],
  ["sizes", `virgüllü ExportSizeId · varsayılan proje biçimi · geçerli: ${SIZE_IDS.join(", ")}`],
  ["slides", "all | 0-tabanlı virgüllü indeksler · varsayılan all"],
  ["mode", "export (diske yazar) | preview (dataURL döner) · varsayılan export"],
  ["width", "yalnız preview · px genişlik, yükseklik 1320×2868 oranından · varsayılan 660"],
];

function Usage() {
  return (
    <main style={SHELL}>
      <div style={{ color: "#C6FF3A" }}>vitrin · headless-export · KULLANIM</div>
      <div style={{ marginTop: 10, color: "#8a8a92" }}>
        MCP bu sayfayı headless Chromium'da açar; gerçek motor (renderSlide/exportSet) burada koşar.
      </div>
      <div style={{ marginTop: 16 }}>PARAMETRELER</div>
      {ROWS.map(([k, v]) => (
        <div key={k}>
          {"  "}
          <span style={{ color: "#0512E8", background: "#F2F1EC", padding: "0 3px" }}>{k}</span>
          {"  "}
          {v}
        </div>
      ))}
      <div style={{ marginTop: 16 }}>ÖRNEKLER</div>
      <div style={{ color: "#8a8a92" }}>
        {"  /headless-export?project=abc123&locale=tr&sizes=iphone-69\n"}
        {"  /headless-export?project=ipad123&locale=all&sizes=ipad-13\n"}
        {"  /headless-export?project=abc123&locale=tr&mode=preview&slides=0&width=660\n"}
      </div>
      <div style={{ marginTop: 16 }}>SAYFA GLOBALLERİ (MCP sözleşmesi)</div>
      <div style={{ color: "#8a8a92" }}>
        {"  window.__vitrinProgress = { done, total, current }\n"}
        {"  window.__vitrinDone     = true      // başarıda DA hatada DA\n"}
        {"  window.__vitrinError    = string    // yalnız hatada\n"}
        {"  window.__vitrinResult   = dataURL (tek preview) | PreviewItem[] | export özeti\n"}
        {"  window.__vitrinResults  = PreviewItem[]  // preview modunda her zaman\n"}
        {"  window.__vitrinWebgl    = boolean   // false ⇒ 3D cihaz basılmaz (sessiz)\n"}
      </div>
      <div style={{ marginTop: 12, color: "#F4520B" }}>project parametresi yok — iş yapılmadı.</div>
    </main>
  );
}

/* NOT (W4 / MCP dalgası için) — neden exportSet çağrılmıyor?

   exportSet plan.slides'ın TAMAMINI basar
   ve dosya numarasını listedeki sıradan üretir; `slides=2,4` istendiğinde çıktı
   01.png/02.png olurdu (yanlış kare numarası). Döngü bu yüzden burada birebir
   çoğaltıldı — dosya adı kuralı ve POST gövdesi exportSet ile AYNI, tek fark
   numaranın slaytın projedeki indeksinden gelmesi.

   engine/export.ts'e dokunmadım (dosya sahipliği). İleride tek kaynak istenirse
   exportSet'e şu opsiyonel parametre yeter:

     export async function exportSet(
       plan: SetPlan,
       sizeIds: ExportSizeId[],
       onProgress?: (p: ExportProgress) => void,
       opts?: { indexes?: number[] }        // ← 0-tabanlı; yoksa hepsi
     )
     …
     const idx = opts?.indexes ?? plan.slides.map((_, i) => i);
     for (const i of idx) { … `${String(i + 1).padStart(2, "0")}.png` … }

   O eklendiği gün bu dosyadaki döngü exportSet çağrısıyla değiştirilebilir. */
