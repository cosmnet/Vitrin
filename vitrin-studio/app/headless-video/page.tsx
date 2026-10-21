"use client";

/* ---------------------------------------------------------------------------
   /headless-video — app preview VİDEO'nun MCP'ye açılan kapısı (R8/W5).

   /headless-export ile AYNI `window.__vitrin*` sözleşmesini kullanır; tek
   fark çıktının bir PNG yığını değil tek bir `.mp4` olması. Motor (renderSlide
   + WebCodecs) yalnız tarayıcıda koştuğu için MCP sunucu tarafında hiçbir şeyi
   yeniden yazmaz, headless Chromium'u bu sayfaya sürer.

   SÖZLEŞME
     window.__vitrinProgress = { done, total, current }   // done/total = KARE
     window.__vitrinDone     = true                       // BAŞARIDA DA HATADA DA
     window.__vitrinError    = "…"                        // yalnız hatada
     window.__vitrinWebgl    = boolean                    // false ⇒ CİHAZ YOK
     window.__vitrinVideo    = { ok, path, file, bytes, frames, durSec, … }

   MCP BEKLEME REÇETESİ
     page.waitForFunction("window.__vitrinDone === true", { timeout: 900_000 })
     → sonra window.__vitrinError / window.__vitrinVideo okunur.
     Video render'ı 16 sn'lik makarada ~1 dk, 30 sn'lik makarada ~2.5 dk
     sürer; timeout PNG akışındakinden CÖMERT tutulmalı.

   HEADLESS CHROMIUM NOTU
     WebCodecs H.264 kodlayıcısı gerekiyor. `--headless=new` + gerçek GPU ya
     da `--use-gl=angle --use-angle=swiftshader` ile yazılım kodlayıcı gelir;
     eski `--headless` (v1) modunda VideoEncoder YOK. Config desteklenmiyorsa
     sayfa render'a hiç girmez, __vitrinError'da Türkçe tek satır bırakır.

   BU SAYFA STORE'A DOKUNMAZ — proje HTTP ile okunur, çıktı HTTP ile yazılır.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";

import { loadFontsForLocale } from "@/engine/fonts";
import { ensureModelMeta } from "@/engine/modelRegistry";
import {
  buildReel,
  checkVideoSupport,
  reelDuration,
  reelFrames,
  renderReel,
  saveReel,
  validateDuration,
  VIDEO_CODEC,
} from "@/engine/video";
import {
  VIDEO_FPS,
  VIDEO_SIZES,
  type Project,
  type SetPlan,
  type VideoSizeId,
} from "@/engine/types";

/* ---------------------------------------------------------------- globals */

type VideoSummary = {
  ok: boolean;
  path?: string;
  file?: string;
  bytes?: number;
  frames: number;
  durSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  msPerFrame: number;
  cancelled?: boolean;
};

declare global {
  interface Window {
    /** Video işinin özeti. PNG akışının __vitrinResult'ından AYRI tutuldu —
     *  iki sayfanın tipleri birbirini kirletmesin. */
    __vitrinVideo?: VideoSummary;
    /**
     * Üretilen mp4'ün blob URL'i. Disk yolu HTTP'den servis edilmiyor;
     * doğrulayıcının (MCP ya da QA koşumu) dosyayı `<video>` elemanına
     * yükleyip süre/boyut/ses kanalı ölçmesi için tek yol bu.
     */
    __vitrinVideoUrl?: string;
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

type Params = {
  project: string;
  locale: string;
  size: VideoSizeId;
  slides: "all" | number[];
  /** Süre bandı (15–30 sn) dışındaysa da bas — QA/test için. */
  force: boolean;
};

const SIZE_IDS = Object.keys(VIDEO_SIZES) as VideoSizeId[];

function parseParams(search: string): Params {
  const q = new URLSearchParams(search);

  const rawMode = (q.get("mode") || "video").trim();
  if (rawMode !== "video") {
    throw new Error(`Bu sayfa yalnız mode=video alır ("${rawMode}" verildi). PNG için /headless-export.`);
  }

  const rawSize = (q.get("size") || "iphone-video").trim();
  if (!SIZE_IDS.includes(rawSize as VideoSizeId)) {
    throw new Error(`Bilinmeyen size: ${rawSize} — geçerliler: ${SIZE_IDS.join(", ")}`);
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

  return {
    project: (q.get("project") || "").trim(),
    locale: (q.get("locale") || "").trim(),
    size: rawSize as VideoSizeId,
    slides,
    force: q.get("force") === "1",
  };
}

async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = (await res.json()) as { project?: Project; error?: string };
  if (!res.ok || !data.project) throw new Error(data.error || `Proje okunamadı (${res.status})`);
  return data.project;
}

/** locale parametresini TEK bir set anahtarına çevirir (video tek dil basar). */
function resolveLocale(project: Project, raw: string): string {
  const have = Object.keys(project.sets || {});
  if (!have.length) throw new Error("Projede hiç dil seti yok");
  if (!raw) return project.activeLocale && have.includes(project.activeLocale) ? project.activeLocale : have[0];
  if (!have.includes(raw)) {
    throw new Error(`Projede olmayan dil: ${raw} — mevcut: ${have.join(", ")}`);
  }
  return raw;
}

function resolveSlides(plan: SetPlan, want: "all" | number[], locale: string): number[] {
  const n = plan.slides.length;
  if (want === "all") return Array.from({ length: n }, (_, i) => i);
  const bad = want.filter((i) => i >= n);
  if (bad.length) {
    throw new Error(`${locale} setinde ${n} slayt var, istenen indeks yok: ${bad.join(", ")}`);
  }
  return want;
}

/* ------------------------------------------------------------------- akış */

// StrictMode + remount'a karşı tek-atış kilidi (headless-export ile aynı).
let started = false;

export default function HeadlessVideo() {
  const [lines, setLines] = useState<string[]>(["hazırlanıyor…"]);
  const [prog, setProg] = useState<{ done: number; total: number; current: string } | null>(null);
  const [state, setState] = useState<"run" | "ok" | "err" | "usage">("run");
  const logRef = useRef<string[]>([]);

  useEffect(() => {
    if (started) return;
    started = true;

    const log = (s: string) => {
      logRef.current = [...logRef.current, s];
      setLines(logRef.current);
    };
    const publish = (p: { done: number; total: number; current: string }) => {
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

    if (!(params instanceof Error) && !params.project) {
      window.__vitrinUsage = true;
      window.__vitrinError = "project parametresi gerekli — kullanım kılavuzu gösterildi";
      window.__vitrinDone = true;
      setState("usage");
      return;
    }

    (async () => {
      if (params instanceof Error) throw params;
      const { project: pid, size, slides, force } = params;

      window.__vitrinProgress = { done: 0, total: 0, current: "başlıyor" };
      log(`mode=video project=${pid} size=${size} slides=${slides === "all" ? "all" : slides.join(",")}`);

      const webgl = probeWebgl();
      window.__vitrinWebgl = webgl;
      if (!webgl) log("UYARI: WebGL yok — 3D cihazlı slaytlar CİHAZSIZ basılacak");

      // Kodlayıcı ön-kontrolü: 2 dakikayı çöpe atmadan öğren.
      const support = await checkVideoSupport(size);
      log(`isConfigSupported(${VIDEO_CODEC}) → video:${support.video} audio:${support.audio}`);
      if (!support.ok) throw new Error(support.error);

      await ensureModelMeta();
      const project = await fetchProject(pid);
      const locale = resolveLocale(project, params.locale);
      const plan = project.sets[locale];
      const idx = resolveSlides(plan, slides, locale);
      await loadFontsForLocale(locale);

      const reel = buildReel(plan, { sizeId: size, indexes: idx });
      const dur = reelDuration(reel);
      const total = reelFrames(reel);
      const warn = validateDuration(dur);
      if (warn && !force) throw new Error(`${warn} (yine de basmak için &force=1)`);
      if (warn) log(`UYARI: ${warn} — force=1 ile devam ediliyor`);

      const dim = VIDEO_SIZES[size];
      log(
        `proje: ${project.app} · dil: ${locale} · ${reel.shots.length} çekim · ${dur.toFixed(1)} sn · ${total} kare · ${dim.w}×${dim.h}@${VIDEO_FPS}`
      );
      publish({ done: 0, total, current: "render başlıyor" });

      const res = await renderReel(reel, {
        locale,
        onProgress: (p) =>
          publish({
            done: p.frame,
            total: p.totalFrames,
            current: `${p.current} · ${p.msPerFrame.toFixed(0)} ms/kare`,
          }),
      });

      if (!res.blob) throw new Error("render iptal edildi ya da boş çıktı");
      log(`render bitti · ${res.frames} kare · ${(res.blob.size / 1048576).toFixed(1)} MB · ${res.msPerFrame.toFixed(0)} ms/kare`);

      publish({ done: res.frames, total, current: "diske yazılıyor…" });
      const saved = await saveReel(res.blob, { app: plan.app, locale, sizeId: size });
      if (!saved.ok) throw new Error(saved.error || "video yazılamadı");

      const summary: VideoSummary = {
        ok: true,
        path: saved.path,
        file: saved.file,
        bytes: saved.bytes,
        frames: res.frames,
        durSec: res.durSec,
        width: res.width,
        height: res.height,
        fps: VIDEO_FPS,
        codec: res.codec,
        msPerFrame: res.msPerFrame,
      };
      window.__vitrinVideo = summary;
      window.__vitrinVideoUrl = URL.createObjectURL(res.blob);
      log(`${saved.path}/${saved.file} · ${saved.bytes} bayt`);
      publish({ done: res.frames, total, current: "bitti" });
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
        window.__vitrinDone = true;
      });
  }, []);

  if (state === "usage") return <Usage />;

  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
  return (
    <main style={SHELL}>
      <div style={{ color: "#C6FF3A" }}>vitrin · headless-video</div>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.startsWith("HATA") ? "#F4520B" : "#F2F1EC" }}>
          {l}
        </div>
      ))}
      {prog && (
        <div style={{ marginTop: 8, color: "#8a8a92" }}>
          {prog.done}/{prog.total} kare · %{pct} · {prog.current}
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
  ["locale", "TEK dil kodu · varsayılan: projenin activeLocale'i"],
  ["size", `${SIZE_IDS.join(" | ")} · varsayılan iphone-video (886×1920)`],
  ["slides", "all | 0-tabanlı virgüllü indeksler · varsayılan all"],
  ["mode", "video (tek geçerli değer)"],
  ["force", "1 · süre 15–30 sn bandı dışında olsa da bas (QA)"],
];

function Usage() {
  return (
    <main style={SHELL}>
      <div style={{ color: "#C6FF3A" }}>vitrin · headless-video · KULLANIM</div>
      <div style={{ marginTop: 10, color: "#8a8a92" }}>
        App preview mp4 (H.264 High 4.0 + sessiz AAC-LC) — kare kare, offline.
        Çıktı: ~/Desktop/Vitrin/&lt;app&gt;/video/&lt;locale&gt;/&lt;size&gt;.mp4
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
      <div style={{ marginTop: 16 }}>ÖRNEK</div>
      <div style={{ color: "#8a8a92" }}>
        {"  /headless-video?project=abc123&locale=tr&size=iphone-video&mode=video\n"}
      </div>
      <div style={{ marginTop: 16 }}>SAYFA GLOBALLERİ (MCP sözleşmesi)</div>
      <div style={{ color: "#8a8a92" }}>
        {"  window.__vitrinProgress = { done, total, current }   // KARE sayacı\n"}
        {"  window.__vitrinDone     = true      // başarıda DA hatada DA\n"}
        {"  window.__vitrinError    = string    // yalnız hatada\n"}
        {"  window.__vitrinWebgl    = boolean   // false ⇒ 3D cihaz basılmaz\n"}
        {"  window.__vitrinVideo    = { ok, path, file, bytes, frames, durSec, width, height, fps, codec, msPerFrame }\n"}
      </div>
      <div style={{ marginTop: 12, color: "#F4520B" }}>project parametresi yok — iş yapılmadı.</div>
    </main>
  );
}
