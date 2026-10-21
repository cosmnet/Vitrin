"use client";

// MATRİS EXPORT — "tüm matris tek tık" (R7 / Wave-5, PLAN-R7 §5).
//
// Rakip raporu §2/§3'ün iki bulgusu birebir uygulanır:
//   1. fastlane sözleşmesi — `screenshots/<locale>/NN_slug.png`, dil klasörü
//      DÜZ (cihaz alt klasörü yok, cihaz piksel boyutundan çıkarılır), sıra
//      leksikal olduğu için `NN_` sıfır dolgulu.
//   2. CANLI İLERLEME MATRİSİ — "12 dil × 3 boyut × 5 slayt = 180 render'lık
//      işte sessiz bekleme bu araç sınıfının 1 numaralı şikâyeti". Satır = dil,
//      kolon = boyut, her hücrenin kendi durumu var.
//
// Kabuk kuralları (rapor §7): uzun iş = İLERLEME DİYALOĞU (toast değil);
// asit yeşili YALNIZ veri anı (sayaç + ilerleme çubuğu); tilki turuncusu
// YALNIZ hata; ekrandaki tek Klein = birincil aksiyon ("Matrisi bas").
//
// KARIŞIK BOYUT UYARISI (bilerek, belgelenmiş taviz): fastlane düzeninde bir
// dil klasörü düzdür. Aynı klasöre birden çok cihaz boyutu basılırsa App Store
// Connect yüklemesi cihaz başına yapıldığı için karışır. Bu yüzden ZORUNLU
// 6.9" eksiz (`NN_slug.png`), ekstralar boyut ekiyle (`NN_slug_ipad13.png`)
// yazılır ve diyalogda not olarak söylenir.

import { useMemo, useRef, useState } from "react";
import {
  asciiSlug,
  exportSet,
  SIZE_SUFFIX,
  type ExportResult,
} from "@/engine/export";
import { EXPORT_SIZES, FORMATS, formatOf, type ExportSizeId, type Slide } from "@/engine/types";
import { useStudio } from "@/store/studio";
import { pushToast } from "./toast";
import { Icon, ProgressGrid, Row, Segmented } from "./ui";
import { L, LANG } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
   Hücre durumu
 * ------------------------------------------------------------------ */

type CellStatus = "idle" | "queued" | "run" | "done" | "err" | "skip";
type Cell = { status: CellStatus; n?: number; m?: number; msg?: string };

const cellKey = (locale: string, size: ExportSizeId) => `${locale}|${size}`;

export type NameStyle = "plain" | "slug";
export type OutLayout = "classic" | "fastlane";

/**
 * Bir hücrenin dosya adı üreticisi.
 * `primary` = o dilde eksiz yazılacak boyut (zorunlu 6.9", seçili değilse
 * seçililerin ilki). `multi` = o dilde birden çok boyut var mı.
 */
function makeNameFor(
  style: NameStyle,
  layout: OutLayout,
  sizeId: ExportSizeId,
  primary: ExportSizeId,
  multi: boolean
) {
  return (i: number, slide: Slide): string => {
    const nn = String(i + 1).padStart(2, "0");
    const slug = style === "slug" ? `_${asciiSlug(slide.headline, slide.designKey || "screen")}` : "";
    if (layout === "fastlane") {
      // Düz dil klasörü: ekstra boyutlar ADLA ayrılır, alt klasörle değil.
      const suffix = sizeId === primary ? "" : `_${SIZE_SUFFIX[sizeId]}`;
      return `${nn}${slug}${suffix}.png`;
    }
    // Mevcut düzen: birden çok boyut varsa bugünkü gibi boyut alt klasörü.
    return `${multi ? `${sizeId}/` : ""}${nn}${slug}.png`;
  };
}

/** Dizelerin ortak kök yolu (matris özetinde tek satır göstermek için). */
function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  if (paths.length === 1) return paths[0];
  const parts = paths.map((p) => p.split("/"));
  const out: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) out.push(seg);
    else break;
  }
  return out.join("/");
}

/* ------------------------------------------------------------------ *
   Sheet — diyalog kabuğu (bant silme açılışı korunur, matris için geniş)
 * ------------------------------------------------------------------ */

function Sheet({
  children,
  close,
  width = 760,
}: {
  children: React.ReactNode;
  close: () => void;
  width?: number;
}) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" style={{ width, maxWidth: "94vw" }}>
        <div className="dialog-inner">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Bileşen
 * ------------------------------------------------------------------ */

export default function MatrixExport({
  close,
  openQa,
}: {
  close: () => void;
  /** "Lokalizasyon QA…" — kabuk diyalogu değiştirir. */
  openQa?: () => void;
}) {
  const project = useStudio((s) => s.project);
  const format = formatOf(project);
  const defaultSize = FORMATS[format].exportSize;
  const SIZE_IDS = useMemo<ExportSizeId[]>(
    () => format === "iphone" ? ["iphone-69", "iphone-65"] : [defaultSize],
    [format, defaultSize]
  );
  const locales = useMemo(() => Object.keys(project.sets), [project.sets]);

  // Varsayılan: her dil × proje formatının zorunlu boyutu — fastlane + slug
  // (PLAN-R7 §0.7: "export düzeni = fastlane sözleşmesi").
  const [sel, setSel] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const l of locales) out[cellKey(l, defaultSize)] = true;
    return out;
  });
  const [style, setStyle] = useState<NameStyle>("slug");
  const [layout, setLayout] = useState<OutLayout>("fastlane");

  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [running, setRunning] = useState(false);
  const [overall, setOverall] = useState<{ done: number; total: number; label: string } | null>(null);
  const [summary, setSummary] = useState<{ files: number; path: string; cancelled: boolean } | null>(null);
  const [err, setErr] = useState("");
  const cancelRef = useRef(false);

  const on = (l: string, s: ExportSizeId) => !!sel[cellKey(l, s)];
  const slidesOf = (l: string) => project.sets[l]?.slides.length ?? 0;

  const selectedOf = (l: string) => SIZE_IDS.filter((s) => on(l, s));
  const chosen = useMemo(
    () => locales.flatMap((l) => selectedOf(l).map((s) => ({ locale: l, sizeId: s }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locales, sel, SIZE_IDS]
  );
  const totalRenders = chosen.reduce((n, c) => n + slidesOf(c.locale), 0);
  const mixedSize = layout === "fastlane" && locales.some((l) => selectedOf(l).length > 1);

  /* ---------------- seçim ---------------- */

  /** Seçim değişti: bir önceki koşunun hücre durumları artık yanıltıcı. */
  const resetRun = () => {
    setCells({});
    setSummary(null);
    setErr("");
  };

  const toggleCell = (l: string, s: ExportSizeId) => {
    resetRun();
    setSel((cur) => ({ ...cur, [cellKey(l, s)]: !cur[cellKey(l, s)] }));
  };

  const toggleRow = (l: string) => {
    resetRun();
    const all = SIZE_IDS.every((s) => on(l, s));
    setSel((cur) => {
      const next = { ...cur };
      for (const s of SIZE_IDS) next[cellKey(l, s)] = !all;
      return next;
    });
  };

  const toggleCol = (s: ExportSizeId) => {
    resetRun();
    const all = locales.every((l) => on(l, s));
    setSel((cur) => {
      const next = { ...cur };
      for (const l of locales) next[cellKey(l, s)] = !all;
      return next;
    });
  };

  const toggleAll = () => {
    resetRun();
    const all = locales.every((l) => SIZE_IDS.every((s) => on(l, s)));
    setSel(() => {
      const next: Record<string, boolean> = {};
      for (const l of locales) for (const s of SIZE_IDS) next[cellKey(l, s)] = !all;
      return next;
    });
  };

  /* ---------------- örnek yol ---------------- */

  const samplePath = useMemo(() => {
    const l = chosen[0]?.locale ?? project.activeLocale;
    const sizes = selectedOf(l);
    const primary = sizes.includes(defaultSize) ? defaultSize : sizes[0] ?? defaultSize;
    const sizeId = chosen[0]?.sizeId ?? primary;
    const slide = project.sets[l]?.slides[0];
    const name = slide
      ? makeNameFor(style, layout, sizeId, primary, sizes.length > 1)(0, slide)
      : "01.png";
    const dir = layout === "fastlane" ? `screenshots/${l}` : l;
    return `~/Desktop/Vitrin/${project.app}/${dir}/${name}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, style, layout, project]);

  /* ---------------- koşu ---------------- */

  const run = async () => {
    if (!chosen.length) return;
    setErr("");
    setSummary(null);
    cancelRef.current = false;
    setRunning(true);

    const start: Record<string, Cell> = {};
    for (const c of chosen) start[cellKey(c.locale, c.sizeId)] = { status: "queued" };
    setCells(start);

    const paths: string[] = [];
    let files = 0;
    let base = 0;
    let stopped = false;

    setOverall({ done: 0, total: totalRenders, label: L("başlıyor…", "starting…") });

    try {
      for (const c of chosen) {
        const key = cellKey(c.locale, c.sizeId);
        if (cancelRef.current) {
          setCells((cur) => ({ ...cur, [key]: { status: "skip" } }));
          stopped = true;
          continue;
        }
        const plan = project.sets[c.locale];
        if (!plan) {
          setCells((cur) => ({ ...cur, [key]: { status: "err", msg: L("set yok", "no set") } }));
          continue;
        }
        const sizes = selectedOf(c.locale);
        const primary: ExportSizeId = sizes.includes(defaultSize) ? defaultSize : sizes[0];
        const m = plan.slides.length;
        setCells((cur) => ({ ...cur, [key]: { status: "run", n: 0, m } }));

        const at = base;
        let res: ExportResult;
        try {
          res = await exportSet(plan, {
            format,
            sizes: [c.sizeId],
            subPath: layout === "fastlane" ? `screenshots/${c.locale}` : undefined,
            nameFor: makeNameFor(style, layout, c.sizeId, primary, sizes.length > 1),
            shouldCancel: () => cancelRef.current,
            onProgress: (p) => {
              setCells((cur) => ({ ...cur, [key]: { status: "run", n: p.done, m: p.total || m } }));
              setOverall({
                done: at + p.done,
                total: totalRenders,
                label: `${c.locale} · ${EXPORT_SIZES[c.sizeId].w}×${EXPORT_SIZES[c.sizeId].h} · ${p.current}`,
              });
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setCells((cur) => ({ ...cur, [key]: { status: "err", msg } }));
          setErr(msg);
          base += m;
          continue;
        }

        const wrote = res.files?.length ?? 0;
        base += m;
        files += wrote;
        if (res.path) paths.push(res.path);

        if (!res.ok && res.error) {
          setCells((cur) => ({ ...cur, [key]: { status: "err", msg: res.error } }));
          setErr(res.error);
        } else if (res.cancelled) {
          stopped = true;
          setCells((cur) => ({ ...cur, [key]: { status: "done", n: wrote, m, msg: "iptal" } }));
        } else {
          setCells((cur) => ({ ...cur, [key]: { status: "done", n: wrote, m } }));
        }
        if (cancelRef.current) stopped = true;
      }
      setSummary({ files, path: commonRoot(paths), cancelled: stopped });
    } finally {
      setRunning(false);
      setOverall(null);
    }
  };

  const copyPath = async () => {
    const p = summary?.path;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      pushToast({ msg: L("YOL KOPYALANDI", "PATH COPIED"), ttl: 3000 });
    } catch {
      pushToast({ msg: L("KOPYALANAMADI — YOLU ELLE SEÇ", "COPY FAILED — SELECT THE PATH MANUALLY"), kind: "err", ttl: 4000 });
    }
  };

  /* ---------------- hücre görünümü ---------------- */

  const renderCell = (l: string, s: ExportSizeId) => {
    const selected = on(l, s);
    const c = cells[cellKey(l, s)];
    let body: React.ReactNode = <Icon name="check" size={13} />;
    let color = "var(--bone)";
    let border = "1px solid var(--line-2)";
    let bg = "var(--fill-2)";

    if (!selected) {
      body = <span style={{ opacity: 0.5 }}>—</span>;
      color = "var(--ink-4)";
      border = "1px dashed var(--line)";
      bg = "transparent";
    }
    if (c && selected) {
      if (c.status === "queued") {
        body = <span>{L("SIRADA", "QUEUED")}</span>;
        color = "var(--ink-3)";
      } else if (c.status === "run") {
        body = (
          <span>
            {c.n ?? 0}/{c.m ?? 0}
          </span>
        );
        color = "var(--acid)";
        border = "1px solid var(--acid)";
      } else if (c.status === "done") {
        body = (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="check" size={12} />
            {c.msg === "iptal" ? `${c.n ?? 0}/${c.m ?? 0}` : (c.n ?? 0)}
          </span>
        );
        color = "var(--acid)";
      } else if (c.status === "err") {
        body = <span>✗</span>;
        color = "var(--fox)";
        border = "1px solid var(--fox)";
        bg = "var(--fox-wash)";
      } else if (c.status === "skip") {
        body = <span>{L("ATLANDI", "SKIPPED")}</span>;
        color = "var(--ink-4)";
      }
    }

    return (
      <button
        key={s}
        type="button"
        disabled={running}
        title={c?.msg || `${l} · ${EXPORT_SIZES[s].label}`}
        onClick={() => toggleCell(l, s)}
        style={{
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          border,
          background: bg,
          color,
          cursor: running ? "default" : "pointer",
          font: "400 10px/1 var(--mono)",
          letterSpacing: "0.06em",
          borderRadius: "var(--r-sm)",
          transition: "color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease)",
        }}
      >
        {body}
      </button>
    );
  };

  const headBtn: React.CSSProperties = {
    height: 34,
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--ink-3)",
    cursor: "pointer",
    font: "400 9.5px/1.2 var(--mono)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    textAlign: "left",
    padding: "0 6px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
    minWidth: 0,
  };

  return (
    <Sheet close={close}>
      <h2>
        <span className="gcard-ic">
          <Icon name="grid" size={14} />
        </span>
        {L("Matris export", "Matrix export")}
      </h2>
      <p className="note">
        {L(
          "Satır = dil, kolon = boyut. Hücreye tıkla; satır/kolon başlığı topluca seçer.",
          "Row = locale, column = size. Click a cell; row/column headers select in bulk."
        )}{" "}
        <b>
          {L(`${chosen.length} hücre · ${totalRenders} render`, `${chosen.length} cells · ${totalRenders} renders`)}
        </b>
      </p>

      {/* ---- matris ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `132px repeat(${SIZE_IDS.length}, minmax(0, 1fr))`,
          gap: 4,
          margin: "12px 0 4px",
        }}
      >
        <button type="button" style={headBtn} disabled={running} onClick={toggleAll} title={L("Tümünü seç / bırak", "Select / clear all")}>
          <span style={{ color: "var(--ink-2)" }}>{L("TÜMÜ", "ALL")}</span>
          <span style={{ color: "var(--ink-4)" }}>
            {chosen.length}/{locales.length * SIZE_IDS.length}
          </span>
        </button>
        {SIZE_IDS.map((s) => (
          <button
            key={s}
            type="button"
            style={headBtn}
            disabled={running}
            onClick={() => toggleCol(s)}
            title={EXPORT_SIZES[s].label}
          >
            <span style={{ color: "var(--ink-2)" }}>{s}</span>
            <span style={{ color: "var(--ink-4)" }}>
              {EXPORT_SIZES[s].w}×{EXPORT_SIZES[s].h}
            </span>
          </button>
        ))}

        {locales.map((l) => (
          <div key={l} style={{ display: "contents" }}>
            <button
              type="button"
              style={headBtn}
              disabled={running}
              onClick={() => toggleRow(l)}
              title={L(`${l} — satırı seç / bırak`, `${l} — select / clear row`)}
            >
              <span style={{ color: "var(--bone)", textTransform: "none" }}>{l}</span>
              <span style={{ color: "var(--ink-4)" }}>{slidesOf(l)} {L("SLAYT", "SLIDES")}</span>
            </button>
            {SIZE_IDS.map((s) => renderCell(l, s))}
          </div>
        ))}
      </div>

      {/* ---- seçenekler ---- */}
      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
        <Row label={L("Dosya adı", "File name")}>
          <Segmented<NameStyle>
            value={style}
            onChange={setStyle}
            options={[
              { value: "plain", label: "NN.png" },
              { value: "slug", label: "NN_slug.png" },
            ]}
          />
        </Row>
        <Row label={L("Klasör", "Folder")}>
          <Segmented<OutLayout>
            value={layout}
            onChange={setLayout}
            options={[
              { value: "classic", label: L("<dil>/", "<locale>/") },
              { value: "fastlane", label: L("screenshots/<dil>/", "screenshots/<locale>/") },
            ]}
          />
        </Row>
        {/* Örnek yol — dosya yolları BÜYÜK HARFE çevrilmez (mono künye
            kuralının tek istisnası: yol harfi harfine doğru olmalı). */}
        <p
          className="kunye"
          style={{
            margin: "6px 0 0",
            color: "var(--ink-3)",
            textTransform: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {samplePath}
        </p>
      </div>

      {mixedSize && (
        <div
          style={{
            display: "flex",
            gap: 8,
            margin: "10px 0 0",
            padding: "8px 10px",
            border: "1px solid var(--line-2)",
            background: "var(--fill-1)",
          }}
        >
          <span className="kunye" style={{ color: "var(--ink-2)", flex: "none" }}>
            {L("NOT", "NOTE")}
          </span>
          <span className="note" style={{ margin: 0 }}>
            {LANG === "en" ? (
              <>
                In the fastlane layout the locale folder is <b>flat</b> — the device is inferred from
                the pixel size. Multiple sizes are being written to the same folder: the required{" "}
                <b>6.9″</b> has no suffix (<code>NN_slug.png</code>), extras get a size suffix (
                <code>NN_slug_iphone65.png</code>). App Store uploads are per device; filter the
                folder accordingly.
              </>
            ) : (
              <>
                fastlane düzeninde dil klasörü <b>düzdür</b> — cihaz piksel boyutundan çıkarılır. Aynı
                klasöre birden çok boyut basılıyor: zorunlu <b>6.9″</b> eksiz (<code>NN_slug.png</code>),
                ekstralar boyut ekiyle (<code>NN_slug_iphone65.png</code>) yazılır. App Store yüklemesi
                cihaz başına yapılır; klasörü ona göre süz.
              </>
            )}
          </span>
        </div>
      )}

      {/* ---- ilerleme ---- */}
      {/* R8/W4 (C37): toplam ilerleme de hücre ızgarası — hücre = TEK render. */}
      {overall && (
        <ProgressGrid
          done={overall.done}
          total={overall.total}
          label={`${overall.done}/${overall.total} · ${overall.label}`}
        />
      )}

      {summary && (
        <div style={{ marginTop: 12 }}>
          <p className="note ok" style={{ margin: 0 }}>
            {summary.cancelled ? L("İPTAL EDİLDİ — ", "CANCELLED — ") : ""}
            {L(`${summary.files} dosya yazıldı.`, `${summary.files} files written.`)}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span
              className="kunye"
              style={{
                color: "var(--ink-2)",
                flex: 1,
                textTransform: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={summary.path}
            >
              {summary.path}
            </span>
            <button className="btn sm" onClick={copyPath} title={L("Yolu panoya kopyala", "Copy path to clipboard")}>
              <Icon name="copy" size={12} />
              {L("Kopyala", "Copy")}
            </button>
          </div>
        </div>
      )}

      {err && <p className="inline-err">{err}</p>}

      <div className="foot">
        {openQa && (
          <button
            className="btn ghost"
            style={{ marginRight: "auto" }}
            onClick={openQa}
            title={L("Basmadan önce dilleri denetle", "Check locales before exporting")}
          >
            <Icon name="globe" size={13} />
            {L("Lokalizasyon QA…", "Localization QA…")}
          </button>
        )}
        {running ? (
          <button className="btn danger" onClick={() => (cancelRef.current = true)}>
            {L("İptal", "Cancel")}
          </button>
        ) : (
          <button className="btn ghost" onClick={close}>
            {L("Kapat", "Close")}
          </button>
        )}
        <button className="btn primary" onClick={run} disabled={running || !chosen.length}>
          <Icon name="download" size={13} />
          {running ? L("Basılıyor…", "Exporting…") : L(`Matrisi bas (${totalRenders})`, `Export matrix (${totalRenders})`)}
        </button>
      </div>
    </Sheet>
  );
}
