"use client";
import { FormatCards } from "./FormatPicker";

// Diyaloglar — UI v3: BANT SİLME (band wipe) ile açılan yalın sheet'ler.
// Cam/glow katmanı kaldırıldı; açılış hareketi tek motiften geliyor
// (clip-path inset + önden geçen 4px Klein bandı, rapor §3).
// Tüm iş mantığı (API çağrı şekilleri, store kullanımı) olduğu gibi korundu.
//
// Ekran görüntüsü kütüphanesi ve şablon galerisi medya çekmecesinde yaşıyor
// (components/MediaPool.tsx); buradaki eski karşılıkları kaldırıldı.

import { useEffect, useMemo, useRef, useState } from "react";
import { exportSet } from "@/engine/export";
import { LAYOUTS } from "@/engine/layouts";
import { THEMES } from "@/engine/themes";
import {
  EXPORT_SIZES,
  uid,
  VIDEO_FPS,
  VIDEO_MAX_SEC,
  VIDEO_MIN_SEC,
  VIDEO_SIZES,
  type ExportSizeId,
  type Project,
  type Slide,
  type VideoSizeId,
  FORMATS,
  formatOf,
  type Format,
} from "@/engine/types";
import {
  buildReel,
  checkVideoSupport,
  DEFAULT_SHOT_SEC,
  defaultMove,
  deviceOf,
  isMoveId,
  MOVES,
  reelDuration,
  reelFrames,
  renderReel,
  saveReel,
  shotFrames,
  validateDuration,
  VIDEO_BITRATE,
  VIDEO_CODEC,
  type MoveId,
  type VideoProgress,
} from "@/engine/video";
import { api, downscaleDataUrl, readFileAsText } from "@/lib/client";
import { useStudio, type DirectorSlide } from "@/store/studio";
import { confirmUi } from "./ConfirmDialog";
import { Icon, PanelTabs, ProgressGrid, type IconName } from "./ui";
import { L, LANG, setLang } from "@/lib/i18n";

// MD içe aktarma artık 4 adımlı sihirbaz (R7-W2): components/wizard/*.
// TopBar'ın sözleşmesi değişmesin diye eski ad burada takma ad olarak yaşıyor.
export { ImportWizard as IngestDialog } from "./wizard/ImportWizard";

function Overlay({
  children,
  close,
}: {
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog">
        <div className="dialog-inner">{children}</div>
      </div>
    </div>
  );
}

function Title({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <h2>
      <span className="gcard-ic">
        <Icon name={icon} size={14} />
      </span>
      {children}
    </h2>
  );
}

/* ---------- Otomatik plan (Art Director) ---------- */
export function GenerateDialog({ close }: { close: () => void }) {
  const project = useStudio((s) => s.project);
  const setBrief = useStudio((s) => s.setBrief);
  const applyPlan = useStudio((s) => s.applyPlan);
  const setBusy = useStudio((s) => s.setBusy);
  const [n, setN] = useState(8);
  const [keywords, setKeywords] = useState("");
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);
  const mdRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    setErr("");
    setRunning(true);
    setBusy(L("Art Director planlıyor…", "Art Director is planning…"));
    try {
      const shots = await Promise.all(
        project.screenshots.map(async (s) => ({
          id: s.id,
          name: s.name,
          dataUrl: await downscaleDataUrl(s.dataUrl),
        }))
      );
      const r = await api<{ slides: DirectorSlide[] }>("/api/director", {
        app: project.app,
        brief: project.brief || "",
        locale: project.activeLocale,
        n,
        format: formatOf(project),
        screenshots: shots,
        themeIds: THEMES.map((t) => t.id),
        // split-v/h ikinci screenshot ister — Director'ın eline verilmez
        layoutIds: Object.keys(LAYOUTS).filter((l) => l !== "split-v" && l !== "split-h"),
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      });
      const byId: Record<string, string> = {};
      for (const s of project.screenshots) byId[s.id] = s.dataUrl;
      applyPlan(r.slides, byId);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setBusy(null);
    }
  };

  return (
    <Overlay close={close}>
      <Title icon="sparkle">{L("Otomatik plan", "Auto plan")}</Title>
      <p className="note">
        {L(
          `Ekranlara bakar, uygulamayı anlar, ${n} slaytlık seti başlıklarıyla kurar. Sonra her şeyi elle düzeltebilirsin.`,
          `Looks at your screens, understands the app, and builds a ${n}-slide set with headlines. You can then fine-tune everything by hand.`
        )}
      </p>
      <div className="field" style={{ marginTop: 10 }}>
        <label>
          Brief (MD) —{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), mdRef.current?.click())}>
            {L(".md dosyası yükle", "upload .md file")}
          </a>
          <input
            ref={mdRef}
            type="file"
            accept=".md,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setBrief(await readFileAsText(f));
            }}
          />
        </label>
        <textarea
          rows={6}
          value={project.brief || ""}
          placeholder={L("Uygulama ne yapar, kime hitap eder, öne çıkacak özellikler…", "What the app does, who it is for, key features…")}
          onChange={(e) => setBrief(e.target.value)}
        />
      </div>
      <div className="row">
        <div className="field">
          <label>
            {L("Slayt sayısı", "Slide count")}<em className="val">{n}</em>
          </label>
          <input type="range" min={4} max={10} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>{L("ASO anahtar kelimeler (virgülle)", "ASO keywords (comma-separated)")}</label>
          <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
      </div>
      <p className="note">
        {L("Ekran görüntüsü", "Screenshots")}: {project.screenshots.length} {L("yüklü", "loaded")}
        {project.screenshots.length === 0 &&
          L(" — yine de çalışır, ekranları sonra atarsın", " — still works, you can add screens later")}
      </p>
      {err && <p className="inline-err">{err}</p>}
      <div className="foot">
        <button className="btn ghost" onClick={close}>
          {L("Vazgeç", "Cancel")}
        </button>
        <button className="btn primary" onClick={run} disabled={running}>
          <Icon name="sparkle" size={13} />
          {running ? L("Planlanıyor…", "Planning…") : L("Planla", "Plan")}
        </button>
      </div>
    </Overlay>
  );
}

/* ---------- Lokalizasyon ---------- */
const LANGS = ["en", "de", "fr", "es", "it", "pt", "nl", "ru", "ar", "ja", "ko", "zh", "hi", "id", "pl", "sv"];

export function LocalizeDialog({ close }: { close: () => void }) {
  const project = useStudio((s) => s.project);
  const addLocale = useStudio((s) => s.addLocale);
  const setBusy = useStudio((s) => s.setBusy);
  const [sel, setSel] = useState<string[]>(["en"]);
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);

  const toggle = (l: string) =>
    setSel((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]));

  const run = async () => {
    setErr("");
    setRunning(true);
    setBusy(L("Lokalize ediliyor…", "Localizing…"));
    try {
      const src = project.sets[project.activeLocale];
      const texts = src.slides.map((s) => ({ head: s.headline, sub: s.sub || "" }));
      const targets = sel.filter((l) => l !== project.activeLocale);
      const r = await api<{ packs: Record<string, { head: string; sub: string }[]> }>("/api/copy", {
        action: "localize",
        texts,
        langs: targets,
      });
      const sourceLocale = project.activeLocale;
      for (const lang of targets) {
        const pack = r.packs[lang];
        if (!pack || !pack.length) continue;
        const slides: Slide[] = structuredClone(src.slides).map((s, i) => ({
          ...s,
          id: uid(),
          headline: pack[i]?.head || s.headline,
          sub: pack[i]?.sub || s.sub,
        }));
        addLocale(lang, slides);
      }
      // aktif dili geri al
      useStudio.getState().setLocale(sourceLocale);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setBusy(null);
    }
  };

  return (
    <Overlay close={close}>
      <Title icon="globe">{L("Lokalizasyon", "Localization")}</Title>
      <p className="note">
        {L("Kaynak:", "Source:")} <b>{project.activeLocale}</b>{" "}
        {L(
          "setindeki başlıklar. Seçilen dillere tek istekte çevrilir; her dil ayrı sekme olur.",
          "set headlines. Translated into the selected languages in one request; each language becomes its own tab."
        )}
      </p>
      <div className="chips" style={{ margin: "12px 0" }}>
        {LANGS.map((l) => (
          <button key={l} className={`chip ${sel.includes(l) ? "on" : ""}`} onClick={() => toggle(l)}>
            {l}
          </button>
        ))}
      </div>
      {err && <p className="inline-err">{err}</p>}
      <div className="foot">
        <button className="btn ghost" onClick={close}>
          {L("Vazgeç", "Cancel")}
        </button>
        <button className="btn primary" onClick={run} disabled={running || sel.length === 0}>
          {running ? L("Çevriliyor…", "Translating…") : L(`${sel.length} dile çevir`, `Translate to ${sel.length} languages`)}
        </button>
      </div>
    </Overlay>
  );
}

/* ---------- Export ----------
   Bu diyalog "hızlı basım" olarak KALDI (aktif dil ya da tüm diller, aynı
   boyut kümesi, `NN.png`). Dil×boyut seçimi, canlı ilerleme matrisi, fastlane
   klasör/ad düzeni ve iptal MatrisExport'ta (components/MatrixExport.tsx);
   `openMatrix` verilirse buradan tek satırla oraya geçilir. Prop OPSİYONEL —
   eski çağıranlar (varsa) aynen çalışır. */
/* Diyalog AÇILIRKEN hangi sekmede başlansın? ⌘K'daki "Video export…" satırı
   Studio'nun `DialogName` sözleşmesini genişletmeden (o dosya bu dalganın
   sahipliğinde değil) doğru sekmeye düşebilsin diye tek atımlık bayrak. */
let pendingTab: ExportTab | null = null;

/** ⌘K → "Video export…" bunu çağırır, sonra export diyaloğunu açar. */
export function requestVideoTab(): void {
  pendingTab = "video";
}

type ExportTab = "png" | "video";

export function ExportDialog({
  close,
  openMatrix,
}: {
  close: () => void;
  openMatrix?: () => void;
}) {
  const project = useStudio((s) => s.project);
  const [tab, setTab] = useState<ExportTab>(() => {
    const t = pendingTab ?? "png";
    pendingTab = null;
    return t;
  });
  // Varsayılan boyut projenin formatından: iPhone 6.9″, iPad 13″.
  const format = formatOf(project);
  const defaultSize = FORMATS[format].exportSize;
  const allowedSizes: ExportSizeId[] = format === "iphone" ? ["iphone-69", "iphone-65"] : [defaultSize];
  const [sizes, setSizes] = useState<ExportSizeId[]>([defaultSize]);
  useEffect(() => { setSizes([defaultSize]); }, [defaultSize]);
  const [allLocales, setAllLocales] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState("");
  const [err, setErr] = useState("");

  const toggleSize = (s: ExportSizeId) =>
    setSizes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const run = async () => {
    setErr("");
    setResult("");
    const locales = allLocales ? Object.keys(project.sets) : [project.activeLocale];
    try {
      let path = "";
      for (const loc of locales) {
        const r = await exportSet(project.sets[loc], { sizes, format, onProgress: setProg });
        if (!r.ok) throw new Error(r.error || L("export hatası", "export error"));
        path = r.path || "";
      }
      setResult(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProg(null);
    }
  };

  if (tab === "video") {
    return (
      <Overlay close={close}>
        <Title icon="film">Export</Title>
        <PanelTabs
          value={tab}
          tabs={[
            { id: "png" as ExportTab, label: "PNG" },
            { id: "video" as ExportTab, label: L("VİDEO", "VIDEO") },
          ]}
          onChange={setTab}
        />
        <VideoPanel close={close} />
      </Overlay>
    );
  }

  return (
    <Overlay close={close}>
      <Title icon="download">Export</Title>
      <PanelTabs
        value={tab}
        tabs={[
          { id: "png" as ExportTab, label: "PNG" },
          { id: "video" as ExportTab, label: L("VİDEO", "VIDEO") },
        ]}
        onChange={setTab}
      />
      <div className="chips" style={{ margin: "10px 0" }}>
        {allowedSizes.map((s) => (
          <button key={s} className={`chip ${sizes.includes(s) ? "on" : ""}`} onClick={() => toggleSize(s)}>
            {EXPORT_SIZES[s].label} · {EXPORT_SIZES[s].w}×{EXPORT_SIZES[s].h}
          </button>
        ))}
      </div>
      <label className="note" style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input type="checkbox" checked={allLocales} onChange={(e) => setAllLocales(e.target.checked)} />
        {L("Tüm diller", "All languages")} ({Object.keys(project.sets).join(", ")})
      </label>
      {/* R8/W4 (C37): düz bant yerine slayt başına dolan kesikli ızgara —
          her kare bitince hücresi asit'e döner. */}
      {prog && (
        <ProgressGrid
          done={prog.done}
          total={prog.total}
          label={`${prog.done}/${prog.total} · ${prog.current}`}
        />
      )}
      {result && <p className="note ok">{L("Yazıldı", "Written")}: {result}</p>}
      {err && <p className="inline-err">{err}</p>}
      <div className="foot">
        {openMatrix && (
          <button
            className="btn ghost"
            style={{ marginRight: "auto" }}
            onClick={openMatrix}
            title={L("Diller × boyutlar, fastlane düzeni, canlı ilerleme", "Languages × sizes, fastlane layout, live progress")}
          >
            <Icon name="grid" size={13} />
            {L("Matris export…", "Matrix export…")}
          </button>
        )}
        <button className="btn ghost" onClick={close}>
          {L("Kapat", "Close")}
        </button>
        <button className="btn primary" onClick={run} disabled={!!prog || sizes.length === 0}>
          <Icon name="download" size={13} />
          {prog ? L("Basılıyor…", "Exporting…") : L("PNG'leri bas", "Export PNGs")}
        </button>
      </div>
    </Overlay>
  );
}

/* ---------- App preview VİDEO (R8/W5) ----------
   Export diyaloğunun ikinci sekmesi. Neden ayrı bir diyalog değil: kullanıcı
   için ikisi de "bunu store'a yükleyeceğim" işi; Studio'nun `DialogName`
   sözleşmesi de (bu dalganın sahipliğinde olmayan bir dosya) genişlemek
   zorunda kalmıyor.

   İLERLEME: kare başına hücre çizmek 480 hücre demek olurdu — ızgara SLAYT
   başına, kare sayacı künyede. */

type VideoRun = {
  prog: VideoProgress | null;
  /** Bitmiş çekim sayısı — ızgara hücresi. */
  doneShots: number;
};

function VideoPanel({ close }: { close: () => void }) {
  const project = useStudio((s) => s.project);
  const updateSlide = useStudio((s) => s.updateSlide);
  const plan = project.sets[project.activeLocale];
  const slides = plan?.slides ?? [];

  const [sizeId, setSizeId] = useState<VideoSizeId>("iphone-video");
  const [run, setRun] = useState<VideoRun | null>(null);
  const [err, setErr] = useState("");
  const [support, setSupport] = useState<{ ok: boolean; error: string } | null>(null);
  const [out, setOut] = useState<{ path: string; file: string; bytes: number; url: string } | null>(null);
  const cancelRef = useRef(false);
  const urlRef = useRef<string | null>(null);

  // Kodlayıcı ön-kontrolü — düğmeye basmadan ÖNCE öğren.
  useEffect(() => {
    let dead = false;
    checkVideoSupport(sizeId).then((r) => {
      if (!dead) setSupport({ ok: r.ok, error: r.error });
    });
    return () => {
      dead = true;
    };
  }, [sizeId]);

  // Blob URL'i diyalog kapanırken bırak.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const reel = useMemo(
    () => (plan ? buildReel(plan, { sizeId }) : null),
    [plan, sizeId]
  );
  const totalSec = reel ? reelDuration(reel) : 0;
  const totalFrames = reel ? reelFrames(reel) : 0;
  const durWarn = validateDuration(totalSec);

  const setShot = (s: Slide, patch: { durSec?: number; move?: string; hold?: number }) => {
    updateSlide(s.id, { videoShot: { ...(s.videoShot ?? {}), ...patch } });
  };

  const start = async () => {
    if (!reel || !plan) return;
    setErr("");
    setOut(null);
    cancelRef.current = false;
    setRun({ prog: null, doneShots: 0 });
    try {
      const res = await renderReel(reel, {
        locale: plan.locale,
        shouldCancel: () => cancelRef.current,
        onProgress: (p) => setRun({ prog: p, doneShots: p.phase === "kapanış" ? p.totalShots : p.shot }),
      });
      if (res.cancelled) {
        setErr(L(`İptal edildi — ${res.frames} kare çöpe atıldı, diske hiçbir şey yazılmadı.`, `Cancelled — ${res.frames} frames discarded, nothing was written to disk.`));
        return;
      }
      if (!res.blob) throw new Error(L("kodlayıcı boş çıktı verdi", "the encoder produced empty output"));
      const saved = await saveReel(res.blob, { app: plan.app, locale: plan.locale, sizeId });
      if (!saved.ok) throw new Error(saved.error || L("video yazılamadı", "could not write video"));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(res.blob);
      setOut({
        path: saved.path || "",
        file: saved.file || `${sizeId}.mp4`,
        bytes: saved.bytes ?? res.blob.size,
        url: urlRef.current,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRun(null);
    }
  };

  const busy = !!run;
  const dim = VIDEO_SIZES[sizeId];

  return (
    <>
      <p className="note" style={{ marginTop: 8 }}>
        {LANG === "en" ? (
          <>
            App Store &quot;app preview&quot; reel: each slide is a shot, and the camera moves toward the
            slide&apos;s own framing — <b>the last frame matches the still export</b>. Rendered
            frame by frame (NOT a screen recording), hence a fixed {VIDEO_FPS} fps.
          </>
        ) : (
          <>
            App Store &quot;app preview&quot; makarası: her slayt bir çekim, kamera slaytın kendi
            kadrajına doğru hareket eder — <b>son kare still export ile aynı</b>. Kare kare
            render edilir (ekran kaydı DEĞİL), bu yüzden sabit {VIDEO_FPS} fps.
          </>
        )}
      </p>

      <div className="chips" style={{ margin: "10px 0" }}>
        {(Object.keys(VIDEO_SIZES) as VideoSizeId[]).map((s) => (
          <button
            key={s}
            className={`chip ${sizeId === s ? "on" : ""}`}
            disabled={busy}
            onClick={() => setSizeId(s)}
          >
            {VIDEO_SIZES[s].label} · {VIDEO_SIZES[s].w}×{VIDEO_SIZES[s].h}
          </button>
        ))}
      </div>

      <p className="kunye">
        {dim.w}×{dim.h} · {VIDEO_FPS} {L("FPS SABİT", "FPS FIXED")} · {VIDEO_CODEC} (H.264 HIGH 4.0) ·{" "}
        {(VIDEO_BITRATE / 1e6).toFixed(0)} MBPS CBR · {L("SESSİZ AAC-LC STEREO 44.1K", "SILENT AAC-LC STEREO 44.1K")}
      </p>

      {/* --- çekim listesi ---
          `field` sınıfı SADECE globals.css'teki koyu input/select giysisi için
          (.field input[type=number] / .field select). Genişlikler satır içi
          verildiği için `width:100%` kuralını eziyorlar. */}
      <div className="field" style={{ maxHeight: 240, overflowY: "auto", margin: "10px 0" }}>
        {slides.map((s, i) => {
          const dev = deviceOf(s);
          const move: MoveId = isMoveId(s.videoShot?.move) ? s.videoShot.move : defaultMove(dev);
          const dur = Number(s.videoShot?.durSec ?? DEFAULT_SHOT_SEC);
          const frames = reel ? shotFrames(reel.shots[i], VIDEO_FPS) : 0;
          const usable = MOVES.filter((m) => (dev.mode === "3d" ? true : !m.camera));
          return (
            <div
              key={s.id}
              className="row"
              style={{ marginBottom: 6, alignItems: "center", gap: 8 }}
            >
              <span className="kunye" style={{ width: 24, flex: "0 0 auto" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
                title={s.headline}
              >
                {s.headline || "—"}
              </span>
              <input
                type="number"
                min={0.5}
                max={15}
                step={0.5}
                value={dur}
                disabled={busy}
                title={L("Süre (saniye)", "Duration (seconds)")}
                style={{ width: 62, flex: "0 0 auto" }}
                onChange={(e) => setShot(s, { durSec: Number(e.target.value) || DEFAULT_SHOT_SEC })}
              />
              <select
                value={move}
                disabled={busy}
                title={L("Kamera hareketi", "Camera move")}
                style={{ width: 128, flex: "0 0 auto" }}
                onChange={(e) => setShot(s, { move: e.target.value })}
              >
                {usable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="kunye" style={{ width: 46, flex: "0 0 auto", textAlign: "right" }}>
                {frames}{L("K", "F")}
              </span>
            </div>
          );
        })}
      </div>

      <p className="kunye">
        {L(
          `TOPLAM ${totalSec.toFixed(1)} SN · ${totalFrames} KARE · ${slides.length} ÇEKİM · BAND ${VIDEO_MIN_SEC}–${VIDEO_MAX_SEC} SN`,
          `TOTAL ${totalSec.toFixed(1)} SEC · ${totalFrames} FRAMES · ${slides.length} SHOTS · RANGE ${VIDEO_MIN_SEC}–${VIDEO_MAX_SEC} SEC`
        )}
      </p>
      {durWarn && <p className="inline-err">{durWarn}</p>}
      {support && !support.ok && <p className="inline-err">{support.error}</p>}

      {run && reel && (
        <ProgressGrid
          done={run.doneShots}
          total={reel.shots.length}
          label={
            run.prog
              ? L(`${run.prog.frame}/${run.prog.totalFrames} kare · ${run.prog.msPerFrame.toFixed(0)} ms/kare · ${run.prog.current}`, `${run.prog.frame}/${run.prog.totalFrames} frames · ${run.prog.msPerFrame.toFixed(0)} ms/frame · ${run.prog.current}`)
              : L("kodlayıcı kuruluyor…", "setting up encoder…")
          }
        />
      )}

      {out && (
        <p className="note ok">
          {L("Yazıldı", "Written")}: {out.path}/{out.file} · {(out.bytes / 1048576).toFixed(1)} MB{" "}
          <a href={out.url} download={out.file}>
            {L("İndir", "Download")}
          </a>
        </p>
      )}
      {err && <p className="inline-err">{err}</p>}

      <div className="foot">
        <button className="btn ghost" onClick={close} disabled={busy}>
          {L("Kapat", "Close")}
        </button>
        {busy ? (
          <button
            className="btn danger"
            onClick={() => {
              cancelRef.current = true;
            }}
            title={L("Sıradaki kareden sonra durur, üretilen kareler ÇÖPE gider (yarım dosya yazılmaz)", "Stops after the next frame; rendered frames are DISCARDED (no partial file is written)")}
          >
            <Icon name="x" size={13} />
            {L("İptal", "Cancel")}
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={start}
            disabled={!reel || !slides.length || !!durWarn || (support ? !support.ok : true)}
            title={durWarn || support?.error || L("Kare kare render + H.264 mux", "Frame-by-frame render + H.264 mux")}
          >
            <Icon name="film" size={13} />
            {L("Videoyu bas", "Export video")}
          </button>
        )}
      </div>
    </>
  );
}

/* ---------- Projeler ---------- */
/**
 * Dil künyesi — 26 dilin tamamı yazılırsa satır taşar, tarih ve aksiyonlar
 * kırpılırdı (kullanıcı bu yüzden projeleri silemiyordu). Sayı önde,
 * ilk birkaç kod örnek olarak arkada.
 */
function localeBadge(locales: string[]): string {
  if (!locales.length) return L("dil yok", "no languages");
  const head = locales.slice(0, 4).join(", ");
  const rest = locales.length - 4;
  return `${locales.length} ${L("dil", "languages")} · ${head}${rest > 0 ? ` +${rest}` : ""}`;
}

type ProjectSummary = { id: string; app: string; createdAt: string; locales: string[]; format?: Format };

export function ProjectsDialog({ close }: { close: () => void }) {
  const loadProject = useStudio((s) => s.loadProject);
  const newProject = useStudio((s) => s.newProject);
  const project = useStudio((s) => s.project);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  /** Yeniden adlandırılan projenin id'si — satır yerinde input'a döner. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating,setCreating]=useState(false);
  const [newName,setNewName]=useState(L("Yeni Uygulama", "New App"));
  const [newFormat,setNewFormat]=useState<Format>("iphone");

  const refresh = () =>
    api<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => { setList(r.projects); setLoaded(true); })
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    if (!needle) return list;
    return list.filter(
      (p) =>
        p.app.toLocaleLowerCase("tr").includes(needle) ||
        p.locales.some((l) => l.toLowerCase().includes(needle))
    );
  }, [list, q]);

  /**
   * Çoğaltma — R14. Aynı proje yeni id ile; `format` verilirse o formata
   * geçirilir (iPhone setinden iPad seti: metin/kurgu/ekranlar aynen taşınır,
   * kullanıcı iPad ekranlarını sonra atar). Ekran havuzu paylaşılmaz,
   * kopyalanır: iki proje birbirinden bağımsız yaşar.
   */
  const duplicate = async (p: ProjectSummary, format?: Format) => {
    setBusy(true);
    try {
      const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
      const src = r.project;
      const label = format && format !== formatOf(src) ? FORMATS[format].label : L("kopya", "copy");
      const app = `${src.app} (${label})`;
      const copy: Project = {
        ...structuredClone(src),
        id: uid(),
        app,
        createdAt: new Date().toISOString(),
        format: format ?? formatOf(src),
      };
      copy.sets = Object.fromEntries(
        Object.entries(copy.sets).map(([code, set]) => [code, { ...set, app }])
      );
      await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(copy),
      });
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Yeniden adlandırma. Ayrı bir uç nokta yok: projeyi çek, adı (ve her dil
   * setinin adını) değiştir, aynı id ile geri yaz. Açık olan proje ise
   * bellekteki kopya da tazelenir, yoksa ekranda eski ad kalırdı.
   */
  const rename = async (p: ProjectSummary, name: string) => {
    const next = name.trim();
    setEditing(null);
    if (!next || next === p.app) return;
    setBusy(true);
    try {
      const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
      const updated: Project = { ...r.project, app: next };
      updated.sets = Object.fromEntries(
        Object.entries(updated.sets).map(([code, set]) => [code, { ...set, app: next }])
      );
      await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (p.id === project.id) loadProject(updated);
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay close={close}>
      <Title icon="folder">{L("Projeler", "Projects")}</Title>
      {err && <p className="inline-err">{err}</p>}
      {loaded && list.length === 0 && (
        <p className="note">{L("Kayıtlı proje yok. Düzenlemeler otomatik kaydedilir.", "No saved projects. Edits are saved automatically.")}</p>
      )}

      {list.length > 6 && (
        <input
          className="inp"
          style={{ marginBottom: 8 }}
          placeholder={L("Proje ya da dil ara…", "Search projects or languages…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      {list.length > 0 && shown.length === 0 && (
        <p className="note">{L(`“${q}” ile eşleşen proje yok.`, `No project matches “${q}”.`)}</p>
      )}

      {shown.map((p) => (
        <div key={p.id} className={`prow${p.id === project.id ? " on" : ""}`}>
          {editing === p.id ? (
            <input
              className="prow-rename"
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename(p, draft);
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => void rename(p, draft)}
            />
          ) : (
            /* Aktif proje Klein DEĞİL: Klein kotası tek birincil aksiyona
               ("Kapat") ayrıldı; aktiflik mono künyeyle söylenir. */
            <button
              className="prow-main"
              title={`${p.app} — ${p.locales.join(", ")}`}
              onClick={async () => {
                const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
                loadProject(r.project);
                close();
              }}
            >
              <span className="prow-name">
                {p.app}
                {p.id === project.id && <em className="cnt"> {L("AKTİF", "ACTIVE")}</em>}
              </span>
              <span className="prow-meta">
                {FORMATS[p.format ?? "iphone"].label} · {localeBadge(p.locales)} · {p.createdAt.slice(0, 10)}
              </span>
            </button>
          )}

          <span className="prow-acts">
            <button className="btn sm" title={L("iPhone Duo kopyası oluştur", "Create iPhone Duo copy")} disabled={busy} onClick={() => void duplicate(p, "iphone-duo")}><Icon name="cube" size={13}/></button>
            <button className="btn sm" title={L("Çoğalt", "Duplicate")} disabled={busy} onClick={() => void duplicate(p)}>
              <Icon name="copy" size={13} />
            </button>
            <button
              className="btn sm"
              title={
                (p.format ?? "iphone") === "ipad" ? L("iPhone kopyası oluştur", "Create iPhone copy") : L("iPad kopyası oluştur", "Create iPad copy")
              }
              disabled={busy}
              onClick={() => void duplicate(p, (p.format ?? "iphone") === "ipad" ? "iphone" : "ipad")}
            >
              <Icon name="frame" size={13} />
            </button>
            <button
              className="btn sm"
              title={L("Yeniden adlandır", "Rename")}
              disabled={busy}
              onClick={() => {
                setDraft(p.app);
                setEditing(editing === p.id ? null : p.id);
              }}
            >
              <Icon name="type" size={13} />
            </button>
            <button
              className="btn sm danger"
              title={L("Projeyi sil", "Delete project")}
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirmUi({
                    title: L("Projeyi sil", "Delete project"),
                    message: L(`"${p.app}" projesi (${p.locales.length} dil) silinsin mi? Geri alınamaz.`, `Delete project "${p.app}" (${p.locales.length} languages)? This cannot be undone.`),
                    okLabel: L("Sil", "Delete"),
                    danger: true,
                  }))
                )
                  return;
                await fetch(`/api/projects?id=${p.id}`, { method: "DELETE" });
                refresh();
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </span>
        </div>
      ))}
      <p className="note" style={{ marginTop: 12 }}>
        {LANG === "en" ? (
          <>The template gallery is in the <b>Template</b> drawer on the left.</>
        ) : (
          <>Şablon galerisi soldaki <b>Şablon</b> çekmecesinde.</>
        )}
      </p>

      {creating && <form className="new-project-form" onSubmit={e=>{e.preventDefault();if(newName.trim()){newProject(newName.trim(),newFormat);close();}}}>
        <h3>{L("Yeni bir vitrin oluştur", "Create a new showcase")}</h3><label className="field">{L("Uygulama adı", "App name")}<input aria-label={L("Yeni proje adı", "New project name")} value={newName} onChange={e=>setNewName(e.target.value)} autoFocus/></label>
        <FormatCards value={newFormat} onChange={setNewFormat}/><button type="submit" className="btn primary wide">{L("Projeyi oluştur", "Create project")}</button>
      </form>}
      <div className="foot">
        <button className="btn" onClick={()=>setCreating(!creating)}><Icon name="plus" size={13}/>{L("Yeni proje", "New project")}</button>
        <button className="btn primary" onClick={close}>
          {L("Kapat", "Close")}
        </button>
      </div>
    </Overlay>
  );
}

/* ---------- Ayarlar ---------- */

const SETTING_KEYS = [
  { id: "WIRO_API_KEY", label: "Wiro API key", hint: L("Arka plan/sticker üretimi ve otomatik plan.", "Background/sticker generation and auto plan.") },
  { id: "WIRO_API_SECRET", label: "Wiro API secret", hint: L("Wiro projesi imza istiyorsa gerekir.", "Required if the Wiro project demands a signature.") },
  { id: "ANTHROPIC_API_KEY", label: "Anthropic API key", hint: L("İsteğe bağlı: ekranları gören Art Director.", "Optional: an Art Director that sees your screens.") },
] as const;
type SettingKey = (typeof SETTING_KEYS)[number]["id"];
type SettingsInfo = { keys: Record<SettingKey, string>; version: string; assets: string; dir: string };

export function SettingsDialog({ close }: { close: () => void }) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<SettingsInfo>("/api/settings").then(setInfo).catch((e) => setErr(String(e)));
  }, []);

  const save = async (patch: Partial<Record<SettingKey, string>>) => {
    setErr("");
    setSaving(true);
    try {
      setInfo(await api<SettingsInfo>("/api/settings", patch));
      setDraft({});
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const pending = Object.fromEntries(Object.entries(draft).filter(([, v]) => v?.trim())) as Partial<Record<SettingKey, string>>;

  return (
    <Overlay close={close}>
      <Title icon="sliders">{L("Ayarlar", "Settings")}</Title>
      <div className="field">
        <label>{L("Arayüz dili", "Interface language")}</label>
        <div className="chips">
          {([["tr", "Türkçe"], ["en", "English"]] as const).map(([code, name]) => (
            <button
              key={code}
              className={`chip ${LANG === code ? "on" : ""}`}
              onClick={() => LANG !== code && setLang(code)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        {L(
          "Anahtarlar yalnız bu bilgisayardaki .env dosyasına yazılır ve hemen geçerli olur. Hiçbiri zorunlu değil; anahtar yoksa ilgili özellik kapalı kalır.",
          "Keys are written only to the .env file on this computer and take effect immediately. None are required; without a key the related feature stays off."
        )}{" "}
        {L("Wiro anahtarı:", "Wiro key:")} <a href="https://wiro.ai" target="_blank" rel="noreferrer">wiro.ai</a>
      </p>
      {SETTING_KEYS.map((k) => {
        const current = info?.keys[k.id] ?? "";
        return (
          <div className="field" key={k.id} style={{ marginTop: 10 }}>
            <label>
              {k.label}
              <span className="val">{current ? L(`kayıtlı ${current}`, `saved ${current}`) : L("girilmemiş", "not set")}</span>
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={current ? L("Değiştirmek için yenisini yapıştır", "Paste a new one to replace") : L("Yapıştır", "Paste")}
                value={draft[k.id] ?? ""}
                onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, [k.id]: e.target.value })); }}
                style={{ flex: 1 }}
              />
              {current && (
                <button className="btn ghost sm" disabled={saving} onClick={() => save({ [k.id]: "" })} title={L("Anahtarı sil", "Delete key")}>
                  {L("Kaldır", "Remove")}
                </button>
              )}
            </div>
            <p className="note" style={{ margin: "4px 0 0" }}>{k.hint}</p>
          </div>
        );
      })}
      {info && (
        <p className="note" style={{ marginTop: 14, overflowWrap: "anywhere" }}>
          Vitrin Studio {info.version}{info.assets ? ` · ${L("varlıklar", "assets")} ${info.assets}` : ""}
          <br />
          {L("Projeler", "Projects")}: <code>{info.dir}/data/projects</code> · Export: <code>~/Desktop/Vitrin</code>
          <br />
          {L("Güncellemek için kurulum komutunu yeniden çalıştır:", "To update, re-run the install command:")}{" "}
          <a href={L("https://github.com/cosmnet/Vitrin#kurulum--tek-satır", "https://github.com/cosmnet/Vitrin#install--one-line")} target="_blank" rel="noreferrer">github.com/cosmnet/Vitrin</a>
        </p>
      )}
      {err && <p className="inline-err">{err}</p>}
      <div className="foot">
        <button className="btn ghost" onClick={close}>
          {L("Kapat", "Close")}
        </button>
        <button className="btn primary" onClick={() => save(pending)} disabled={saving || Object.keys(pending).length === 0}>
          {saving ? L("Kaydediliyor…", "Saving…") : saved && Object.keys(pending).length === 0 ? L("Kaydedildi", "Saved") : L("Kaydet", "Save")}
        </button>
      </div>
    </Overlay>
  );
}
