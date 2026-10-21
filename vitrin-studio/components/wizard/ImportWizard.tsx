"use client";

// İçe Aktarma Sihirbazı v3 — eski tek-formluk `IngestDialog`ın yerine geçer.
// Açma/kapama sözleşmesi aynı: TopBar `<ImportWizard close={…} />` basar.
//
//   1 KAYNAK   Gözat ağacı (sunucu güdümlü) + yol kutusu (klasör YA DA .md)
//              + klasör sürükle-bırak + son kullanılanlar + canlı doğrulama şeridi
//   2 DİLLER   dil çipleri (dil başına GERÇEK eşleşme sayısı) + ekran klasörü
//   3 EŞLEŞME  kare başına ızgara; yanlış eşleşme burada düzeltilir (MatchGrid)
//   4 ŞABLON   gerçek render önizleme kartları + "n kare × m dil = k slayt"
//
// "Otomatik kur" 1. adımdan itibaren görünür: bulunan diller + editorial-lux +
// otomatik eşleşmelerle hemen kurar. Kalan adımlar zorunlu değil, iyileştirmedir.
//
// Hiçbir CTA ölü kalmaz: eksik bilgi varsa buton çalışır ve satır içi bir hata
// + yanında ETKİN bir kurtarma eylemi gösterir.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getTemplate } from "@/engine/templates";
import type { Slide } from "@/engine/types";
import { api } from "@/lib/client";
import { L } from "@/lib/i18n";
import {
  matchFrames2ToImages,
  matchFramesToImages,
  type ImageRef,
} from "@/lib/mdframes";
import { useStudio } from "@/store/studio";

import { Icon } from "../ui";
import { FolderBrowser } from "./FolderBrowser";
import { runImport, type LocalePlan } from "./importRun";
import { MatchGrid } from "./MatchGrid";
import { TemplateGrid } from "./TemplateGrid";
import {
  designKeyOf,
  FOLDER_KEY,
  overrideFor,
  pushRecent,
  readRecents,
  resolveOverride,
  SHOTS_KEY,
  type BrowseResult,
  type OverrideMap,
  type Recent,
  type ScanResult,
} from "./types";
import { WIZARD_CSS } from "./wizard.css";

const STEPS = [L("Kaynak", "Source"), L("Diller", "Languages"), L("Eşleşme", "Match"), L("Şablon", "Template")] as const;
const DEFAULT_TEMPLATE = "editorial-lux";

const join = (dir: string, name: string): string =>
  dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;

/** Yol bir .md dosyasıysa klasörünü verir. */
const dirOf = (p: string): string => (/\.[a-z0-9]+$/i.test(p) ? p.replace(/\/[^/]*$/, "") : p);

type LocaleMatch = { pool: ImageRef[]; matches: (ImageRef | null)[]; matches2: (ImageRef | null)[] };

export function ImportWizard({ close }: { close: () => void }) {
  const mutate = useStudio((s) => s.mutate);
  const setActiveSlide = useStudio((s) => s.setActiveSlide);
  const setBusy = useStudio((s) => s.setBusy);

  const [step, setStep] = useState(1);
  const [path, setPath] = useState("");
  const [shotsRoot, setShotsRoot] = useState("");
  const [res, setRes] = useState<ScanResult | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [byNumber, setByNumber] = useState(true);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE);
  const [activeLoc, setActiveLoc] = useState<string>("");
  const [browserFor, setBrowserFor] = useState<"md" | "shots" | null>(null);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");
  const [dropOver, setDropOver] = useState(false);
  const dragDepth = useRef(0);

  // Son kullanılan klasör + geçmiş.
  useEffect(() => {
    try {
      setPath(window.localStorage.getItem(FOLDER_KEY) || "");
      setShotsRoot(window.localStorage.getItem(SHOTS_KEY) || "");
    } catch {
      /* localStorage kapalı olabilir — sorun değil */
    }
    setRecents(readRecents());
  }, []);

  // Bu diyaloğu Studio değil TopBar açıyor; Esc'i kendimiz karşılıyoruz.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /* ---------------- tarama ---------------- */

  const scan = useCallback(
    async (target?: string, shots?: string): Promise<ScanResult | null> => {
      const p = (target ?? path).trim();
      if (!p) {
        setErr(L("Önce bir klasör ya da .md dosyası seç.", "Pick a folder or .md file first."));
        setBrowserFor("md");
        return null;
      }
      setErr("");
      setHint("");
      setScanning(true);
      setBusy(L("MD klasörü taranıyor…", "Scanning MD folder…"));
      try {
        // `path` klasör de olabilir tek bir .md dosyası da (sunucu ayırt eder).
        const r = await api<ScanResult>("/api/ingest", {
          path: p,
          shotsRoot: (shots ?? shotsRoot).trim() || undefined,
        });
        if (!r.locales.length) throw new Error(L("Bu klasörde kare içeren .md dosyası bulunamadı.", "No .md file with frames found in this folder."));
        setRes(r);
        setOverrides({});
        if (r.shotsRoot) setShotsRoot(r.shotsRoot);
        // Tek .md işaret edildiyse yalnız o dil seçili gelir.
        const only = r.pickedLocale && r.locales.some((l) => l.code === r.pickedLocale);
        const codes = only ? [r.pickedLocale as string] : r.locales.map((l) => l.code);
        setSel(codes);
        setActiveLoc(codes[0] ?? r.locales[0]?.code ?? "");
        try {
          window.localStorage.setItem(FOLDER_KEY, p);
          window.localStorage.setItem(SHOTS_KEY, shots ?? shotsRoot);
        } catch {
          /* yok say */
        }
        setRecents(pushRecent(p, shots ?? shotsRoot));
        return r;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setScanning(false);
        setBusy(null);
      }
    },
    [path, shotsRoot, setBusy]
  );

  /* ---------------- sürükle-bırak ---------------- */

  // Tarayıcı sürüklenen klasörün MUTLAK yolunu vermez; yalnız ADINI veriyor
  // (`webkitGetAsEntry`). Adı bilinen köklerin altında arayıp çözüyoruz;
  // bulunamazsa çıkmaz sokak değil, Gözat açılıyor.
  const resolveDropped = useCallback(
    async (name: string, isDir: boolean): Promise<string | null> => {
      const roots: string[] = [];
      const cur = dirOf(path.trim());
      if (cur) roots.push(cur);
      let home = "";
      try {
        const h = await api<BrowseResult>("/api/ingest?browse=");
        home = h.home;
      } catch {
        /* ev klasörü okunamadı — kalan köklerle devam */
      }
      if (home) {
        roots.push(home, join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads"));
      }
      for (const root of [...new Set(roots)].filter(Boolean)) {
        try {
          const b = await api<BrowseResult>(`/api/ingest?browse=${encodeURIComponent(root)}`);
          if (isDir && b.dirs.some((d) => d.name === name)) return join(b.path, name);
          if (!isDir && b.mdFiles.includes(name)) return join(b.path, name);
        } catch {
          /* bu kök okunamadı — sıradaki */
        }
      }
      return null;
    },
    [path]
  );

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropOver(false);
    const item = e.dataTransfer.items?.[0];
    const entry = item && "webkitGetAsEntry" in item ? item.webkitGetAsEntry() : null;
    const name = entry?.name ?? e.dataTransfer.files?.[0]?.name ?? "";
    if (!name) {
      setErr(L("Bırakılan öğe okunamadı — Gözat'tan seçebilirsin.", "Couldn't read the dropped item — pick it with Browse."));
      setBrowserFor("md");
      return;
    }
    const isDir = entry ? entry.isDirectory : false;
    setHint(L(`"${name}" aranıyor…`, `Looking for "${name}"…`));
    const found = await resolveDropped(name, isDir);
    if (!found) {
      setHint("");
      setErr(
        L(
          `"${name}" bilinen klasörlerin altında bulunamadı — tarayıcı sürüklenen dosyanın tam yolunu vermiyor. Gözat'tan seç.`,
          `"${name}" wasn't found under known folders — the browser doesn't expose the full path of dropped items. Pick it with Browse.`
        )
      );
      setBrowserFor("md");
      return;
    }
    setHint("");
    setPath(found);
    await scan(found);
  };

  /* ---------------- eşleşme ---------------- */

  // Eşleşme DİL DİL hesaplanır: her dilin havuzu önce kendi klasörü
  // (tr/01-remote.png), sonra ortak havuz. Böylece tr, ar-SA'nın ekranını almaz.
  const perLocale = useMemo(() => {
    const out: Record<string, LocaleMatch> = {};
    if (!res) return out;
    for (const loc of res.locales) {
      const pool = [...(res.localeImages?.[loc.code] ?? []), ...res.images];
      const matches = matchFramesToImages(loc.frames, pool, { byNumber });
      const matches2 = matchFrames2ToImages(loc.frames, pool, { byNumber, avoid: matches });
      out[loc.code] = { pool, matches, matches2 };
    }
    return out;
  }, [res, byNumber]);

  // Otomatik eşleşmenin üstüne kullanıcının elle yaptıkları: override kare
  // numarasına yazılır, her dilde o dilin KENDİ dosyasına çözülür.
  const finalPerLocale = useMemo(() => {
    const out: Record<string, { matches: (ImageRef | null)[]; matches2: (ImageRef | null)[] }> = {};
    if (!res) return out;
    for (const loc of res.locales) {
      const m = perLocale[loc.code];
      if (!m) continue;
      const matches: (ImageRef | null)[] = [];
      const matches2: (ImageRef | null)[] = [];
      loc.frames.forEach((f, i) => {
        const hit = overrideFor(overrides, loc.code, designKeyOf(f.no));
        if (!hit) {
          matches.push(m.matches[i]);
          matches2.push(m.matches2[i]);
          return;
        }
        const im = resolveOverride(hit.ov, loc.code, res);
        matches.push(im);
        // Kare temizlendiyse ikinci ekran da düşer — yarım split kalmasın.
        matches2.push(im ? m.matches2[i] : null);
      });
      out[loc.code] = { matches, matches2 };
    }
    return out;
  }, [res, perLocale, overrides]);

  const counts = useMemo(() => {
    const out: Record<string, { matched: number; total: number }> = {};
    if (!res) return out;
    for (const loc of res.locales) {
      const f = finalPerLocale[loc.code];
      out[loc.code] = {
        matched: f ? f.matches.filter(Boolean).length : 0,
        total: loc.frames.length,
      };
    }
    return out;
  }, [res, finalPerLocale]);

  const imageTotal = useMemo(() => {
    if (!res) return 0;
    const seen = new Set<string>();
    for (const list of Object.values(res.localeImages ?? {})) for (const im of list) seen.add(im.url);
    for (const im of res.images) seen.add(im.url);
    return seen.size;
  }, [res]);

  const bucketCount = res ? Object.keys(res.localeImages ?? {}).length : 0;
  const frameCount = res
    ? (res.locales.find((l) => l.code === (activeLoc || sel[0]))?.frames.length ??
      res.locales[0]?.frames.length ??
      0)
    : 0;
  const slideTotal = sel.reduce(
    (n, c) => n + (res?.locales.find((l) => l.code === c)?.frames.length ?? 0),
    0
  );

  // 4. adım kartlarına basılacak örnek: kullanıcının KENDİ ilk eşleşen ekranı.
  const sample = useMemo((): Slide | undefined => {
    if (!res) return undefined;
    const code = activeLoc || sel[0] || res.locales[0]?.code;
    const loc = res.locales.find((l) => l.code === code);
    const f = code ? finalPerLocale[code] : null;
    if (!loc || !f) return undefined;
    const i = f.matches.findIndex(Boolean);
    if (i < 0) return undefined;
    return {
      id: "wiz-sample",
      screenshot: f.matches[i]?.url,
      headline: loc.frames[i].headline,
      sub: loc.frames[i].sub,
      badge: loc.frames[i].eyebrow,
      themeId: getTemplate(templateId).themeId,
      layout: "device-bleed-bottom",
    };
  }, [res, activeLoc, sel, finalPerLocale, templateId]);

  /* ---------------- içe aktarma ---------------- */

  const buildPlan = useCallback(
    (codes: string[]): LocalePlan[] => {
      if (!res) return [];
      return codes
        .map((code) => {
          const loc = res.locales.find((l) => l.code === code);
          const f = finalPerLocale[code];
          if (!loc || !f) return null;
          return { code, frames: loc.frames, matches: f.matches, matches2: f.matches2 };
        })
        .filter((p): p is LocalePlan => p !== null);
    },
    [res, finalPerLocale]
  );

  const doImport = async (codes: string[], template = templateId) => {
    if (importing) return;
    const plan = buildPlan(codes);
    if (!plan.length) {
      setErr(L("En az bir dil seçilmeli.", "Select at least one language."));
      return;
    }
    setImporting(true);
    setErr("");
    try {
      await runImport(plan, template, { mutate, setActiveSlide, setBusy });
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  /** Otomatik kur — bulunan diller, varsayılan şablon, otomatik eşleşmeler. */
  const autoSetup = async () => {
    if (!res) return;
    const codes = sel.length ? sel : res.locales.map((l) => l.code);
    await doImport(codes, templateId);
  };

  /* ---------------- adım gezinme ---------------- */

  const goNext = () => {
    setErr("");
    if (step === 1) {
      if (!res) {
        void scan();
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!sel.length) {
        setErr(L("En az bir dil seç — ya da tümünü seç.", "Select at least one language — or select all."));
        return;
      }
      if (!activeLoc || !sel.includes(activeLoc)) setActiveLoc(sel[0]);
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
    void doImport(sel);
  };

  const canJump = (n: number) => n === 1 || !!res;

  /* ---------------- render ---------------- */

  const primaryLabel = () => {
    if (step === 1) return res ? L("İleri", "Next") : scanning ? L("Taranıyor…", "Scanning…") : L("Tara", "Scan");
    if (step < 4) return L("İleri", "Next");
    return importing
      ? L("Kuruluyor…", "Setting up…")
      : L(
          `${frameCount} kare × ${sel.length} dil = ${slideTotal} slayt oluştur`,
          `Create ${slideTotal} slides (${frameCount} frames × ${sel.length} languages)`
        );
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <style>{WIZARD_CSS}</style>
      <div
        className={`wiz-dialog ${dropOver ? "drop-over" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDropOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDropOver(false);
        }}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="wiz-head">
          <h2>
            <span className="gcard-ic">
              <Icon name="text" size={15} />
            </span>
            {L("MD içe aktar", "Import MD")}
            <span className="wiz-spacer" />
            {res && (
              <button
                type="button"
                className="btn sm"
                onClick={() => void autoSetup()}
                disabled={importing}
                title={L("Bulunan dilleri varsayılan şablonla hemen kurar", "Sets up the detected languages right away with the default template")}
              >
                <Icon name="sparkle" size={13} />
                {L("Otomatik kur", "Auto setup")}
              </button>
            )}
          </h2>
          <div className="wiz-rail">
            {/* Bant motifi: tamamlanan pay + içinde bulunulan adım dolu görünür. */}
            <i style={{ width: `${(step / STEPS.length) * 100}%` }} />
          </div>
          <div className="wiz-steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`wiz-step ${step === i + 1 ? "on" : step > i + 1 ? "done" : ""}`}
                disabled={!canJump(i + 1)}
                onClick={() => canJump(i + 1) && setStep(i + 1)}
              >
                <em>{i + 1}</em>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="wiz-body">
          {/* ---------- 1. KAYNAK ---------- */}
          {step === 1 && (
            <>
              <p className="note">
                {L("Klasördeki her ", "Each ")}<b>.md</b>
                {L(" bir dil olur (", " in the folder becomes a language (")}<code>tr.md</code> → <code>tr</code>).{" "}
                {L("Tek bir ", "You can also pick a single ")}<b>.md</b>
                {L(" dosyası da seçebilirsin — o zaman sadece o dil gelir.", " file — then only that language is imported.")}{" "}
                {L("Klasörü bu pencereye sürükleyip bırakabilirsin.", "You can drag and drop a folder onto this window.")}
              </p>

              <div className="row" style={{ marginTop: 12 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{L("Klasör ya da .md dosyası", "Folder or .md file")}</label>
                  <input
                    type="text"
                    value={path}
                    placeholder="/Users/…/docs/marketing/frames-v13  ·  …/frames-v13/tr.md"
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !scanning) void scan();
                    }}
                  />
                </div>
                <button
                  className="btn fix"
                  onClick={() => setBrowserFor(browserFor === "md" ? null : "md")}
                >
                  <Icon name="folder" size={13} />
                  {L("Gözat", "Browse")}
                </button>
                <button className="btn fix" onClick={() => void scan()} disabled={scanning}>
                  {scanning ? L("Taranıyor…", "Scanning…") : L("Tara", "Scan")}
                </button>
              </div>

              {browserFor === "md" && (
                <div style={{ marginTop: 8 }}>
                  <FolderBrowser
                    start={dirOf(path.trim())}
                    allowMd
                    selected={path.trim()}
                    onSelect={(p) => {
                      setPath(p);
                      setBrowserFor(null);
                      void scan(p);
                    }}
                  />
                </div>
              )}

              {recents.length > 0 && !res && (
                <>
                  <div className="field" style={{ marginTop: 12, marginBottom: 2 }}>
                    <label>{L("Son kullanılanlar", "Recent")}</label>
                  </div>
                  <div className="wiz-recents">
                    {recents.map((r) => (
                      <button
                        key={r.path}
                        type="button"
                        className="wiz-recent"
                        onClick={() => {
                          setPath(r.path);
                          if (r.shotsRoot) setShotsRoot(r.shotsRoot);
                          void scan(r.path, r.shotsRoot ?? "");
                        }}
                      >
                        <Icon name="folder" size={12} />
                        <code>{r.path}</code>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {hint && <p className="note">{hint}</p>}

              {res && (
                <div className="wiz-strip ok">
                  <b>{res.locales.length}</b> {L("dil", "languages")} · <b>{frameCount}</b> {L("kare", "frames")} ·{" "}
                  <b>{imageTotal}</b> {L("görsel", "images")}
                  {bucketCount > 0 && L(` (${bucketCount} dil klasörü)`, ` (${bucketCount} language folders)`)}
                  {res.pickedLocale && L(` · tek dil seçildi: ${res.pickedLocale}`, ` · single language selected: ${res.pickedLocale}`)}
                  <span className="wiz-spacer" />
                  <button type="button" className="btn sm" onClick={() => void scan()}>
                    {L("Yeniden tara", "Rescan")}
                  </button>
                </div>
              )}
            </>
          )}

          {/* ---------- 2. DİLLER & EKRANLAR ---------- */}
          {step === 2 && res && (
            <>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>
                  {L("Diller", "Languages")}
                  <em className="val">
                    <a
                      href="#"
                      onClick={(e) => (
                        e.preventDefault(), setSel(res.locales.map((l) => l.code))
                      )}
                    >
                      {L("tümü", "all")}
                    </a>
                    {" · "}
                    <a href="#" onClick={(e) => (e.preventDefault(), setSel([]))}>
                      {L("hiçbiri", "none")}
                    </a>
                  </em>
                </label>
              </div>
              <div className="wiz-locs">
                {res.locales.map((l) => {
                  const c = counts[l.code] ?? { matched: 0, total: l.frames.length };
                  const full = c.matched >= c.total;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      className={`wiz-loc ${sel.includes(l.code) ? "on" : ""}`}
                      onClick={() =>
                        setSel((s) =>
                          s.includes(l.code) ? s.filter((x) => x !== l.code) : [...s, l.code]
                        )
                      }
                      title={L(`${l.frames.length} kare`, `${l.frames.length} frames`)}
                    >
                      <span className="code">{l.code}</span>
                      <span className={`cnt ${full ? "full" : "part"}`}>
                        {c.matched}/{c.total} {full ? "✓" : "⚠"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="field" style={{ marginTop: 16, marginBottom: 6 }}>
                <label>
                  {L("Ekran görüntüleri kökü", "Screenshots root")}
                  <em className="val">
                    <a
                      href="#"
                      onClick={(e) => (
                        e.preventDefault(), setBrowserFor(browserFor === "shots" ? null : "shots")
                      )}
                    >
                      {L("Değiştir", "Change")}
                    </a>
                  </em>
                </label>
              </div>
              <div className="wiz-strip">
                <code style={{ fontSize: 11 }}>{res.shotsRoot || res.folder}</code>
              </div>
              <p className="note" style={{ marginTop: 6 }}>
                {L("Her dilin kendi klasörü varsa (", "If each language has its own folder (")}<code>tr/</code>, <code>ar-SA/</code>
                {L(") ekranlar oradan alınır; kalanlar ortak havuzdan.", ") screens are taken from there; the rest from the shared pool.")}
              </p>

              {browserFor === "shots" && (
                <div style={{ marginTop: 8 }}>
                  <FolderBrowser
                    start={res.shotsRoot || res.folder}
                    selected={shotsRoot}
                    onSelect={(p) => {
                      setShotsRoot(p);
                      setBrowserFor(null);
                      void scan(path, p);
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* ---------- 3. EŞLEŞME ---------- */}
          {step === 3 && res && (
            <>
              <div className="wiz-strip">
                <span>{L("Dil:", "Language:")}</span>
                <div className="chips" style={{ flex: 1 }}>
                  {(sel.length ? sel : res.locales.map((l) => l.code)).map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={`chip ${activeLoc === code ? "on" : ""}`}
                      onClick={() => setActiveLoc(code)}
                    >
                      {code}
                      <span style={{ opacity: 0.55, marginLeft: 5 }}>
                        {counts[code]?.matched ?? 0}/{counts[code]?.total ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "8px 0 10px",
                  flexWrap: "wrap",
                }}
              >
                <label className="wiz-scope">
                  <input
                    type="checkbox"
                    checked={byNumber}
                    onChange={(e) => setByNumber(e.target.checked)}
                  />
                  {L("Numaraya göre eşleştir (04 → kare 04)", "Match by number (04 → frame 04)")}
                </label>
                <span style={{ flex: 1 }} />
                {Object.keys(overrides).length > 0 && (
                  <button type="button" className="btn sm" onClick={() => setOverrides({})}>
                    {L("Elle yapılanları sıfırla", "Reset manual changes")} ({Object.keys(overrides).length})
                  </button>
                )}
              </div>
              {activeLoc && perLocale[activeLoc] && (
                <MatchGrid
                  res={res}
                  locale={activeLoc}
                  frames={res.locales.find((l) => l.code === activeLoc)?.frames ?? []}
                  pool={perLocale[activeLoc].pool}
                  auto={perLocale[activeLoc].matches}
                  byNumber={byNumber}
                  overrides={overrides}
                  setOverrides={setOverrides}
                />
              )}
            </>
          )}

          {/* ---------- 4. ŞABLON ---------- */}
          {step === 4 && res && (
            <>
              <p className="note" style={{ marginBottom: 10 }}>
                {L(
                  "Metin MD'den, giysi (tema · yerleşim · kamera) şablondan gelir. Kartlarda kendi ilk ekranın basılı.",
                  "Text comes from the MD; the look (theme · layout · camera) comes from the template. Cards show your own first screen."
                )}
              </p>
              <TemplateGrid value={templateId} onChange={setTemplateId} sample={sample} />
            </>
          )}

          {err && (
            <p className="error" style={{ marginTop: 10 }}>
              {err}{" "}
              {step === 2 && !sel.length && res && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setSel(res.locales.map((l) => l.code))}
                >
                  {L("Tümünü seç", "Select all")}
                </button>
              )}
              {step === 1 && (
                <button type="button" className="btn sm" onClick={() => setBrowserFor("md")}>
                  {L("Gözat", "Browse")}
                </button>
              )}
            </p>
          )}
        </div>

        <div className="wiz-foot">
          <button className="btn ghost" onClick={close}>
            {L("Vazgeç", "Cancel")}
          </button>
          <span className="wiz-spacer" />
          {step > 1 && (
            <button className="btn" onClick={() => (setErr(""), setStep(step - 1))}>
              {L("Geri", "Back")}
            </button>
          )}
          {/* UI v3: tek Klein birincil aksiyon (vendor cam hap kaldırıldı —
              Fast Refresh'te stilini düşürüyordu ve cosm diline yabancıydı). */}
          <button className="btn primary" onClick={goNext} disabled={scanning || importing}>
            <Icon name={step === 4 ? "download" : "chevron"} size={13} />
            {primaryLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}
