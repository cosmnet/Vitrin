"use client";

// LOKALİZASYON QA — R7 / Wave-5 (PLAN-R7 §5, rakip raporu §1.5).
//
// AppScreens'in "auto text-fit + QA paneli" kalıbı: çeviri uzunluğu, tofu,
// eksik çeviri, eksik ekran ve uygulanmamış RTL aynası TEK listede toplanır.
// Bulgular dil başına gruplanır; her satır Inspector'ın sapma dilini (fox
// bandı = `.drift-row`) kullanır ve "git" ile o dile + o slayta atlar.
//
// Beş denetim (hepsi istemci tarafında, senkron ölçüm):
//   1. EKSİK ÇEVİRİ  needsCopy bayrağı · veya aynı designKey'de İKİ dilde
//                    BİREBİR aynı başlık (kopyalanmış-çevrilmemiş sezgisi).
//   2. TOFU          çözülmüş (tema + override) başlık/alt font ailesi
//                    fontCoversLocale(family, locale) testini geçemiyor —
//                    yani tasarlanan yüz değil, yedek yüz basılıyor.
//   3. TAŞMA         GERÇEK wrapLines/cssFont ölçümü, BASE ölçeğinde:
//                    (a) taban dile göre >1 satır uzun, (b) tek kelime metin
//                    kutusundan geniş, (c) blok kadraj dışına çıkıyor.
//   4. EKSİK EKRAN   screenshot yok · split düzende screenshot2 yok
//                    (renderer sessizce text-top'a düşer).
//   5. RTL           ar-SA slaytında hiza AÇIKÇA "left" — ayna uygulanmamış.
//
// Ölçüm neden gerçek: font metrikleri olmadan "taşma" tahmindir. Her dil için
// loadFontsForLocale() beklenir (CJK yüzleri tembel yüklenir), sonra tek bir
// offscreen 2D context ile render.ts'in metin kurulumu birebir tekrarlanır.

import { useCallback, useEffect, useState } from "react";
import {
  cssFont,
  fallbackFamilyForLocale,
  fontCoversLocale,
  isRtlLocale,
  isTurkishSafe,
  loadFontsForLocale,
  scriptForLocale,
} from "@/engine/fonts";
import { getLayoutForFormat, LAYOUTS } from "@/engine/layouts";
import { ornamentAdvance } from "@/engine/ornament";
import { applyTransform, resolveText, wrapLines, type ResolvedText } from "@/engine/text";
import { getTheme } from "@/engine/themes";
import { baseOf, formatOf, type Format, type Project, type Slide } from "@/engine/types";
import { useStudio } from "@/store/studio";
import { Icon, Section } from "./ui";
import { L } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
   Bulgu modeli
 * ------------------------------------------------------------------ */

export type QaKind = "missing" | "tofu" | "overflow" | "shot" | "rtl";

export type QaFinding = {
  locale: string;
  slideId: string;
  /** 1 tabanlı slayt numarası (film şeridiyle aynı). */
  no: number;
  kind: QaKind;
  msg: string;
};

const KIND_TAG: Record<QaKind, string> = {
  missing: L("ÇEVİRİ", "TRANSLATION"),
  tofu: "TOFU",
  overflow: L("TAŞMA", "OVERFLOW"),
  shot: L("EKRAN", "SCREEN"),
  rtl: "RTL",
};

/* ------------------------------------------------------------------ *
   Ölçüm — render.ts'in metin kurulumunun birebir kopyası (BASE ölçeği)
 * ------------------------------------------------------------------ */

function setFont(ctx: CanvasRenderingContext2D, st: ResolvedText): void {
  ctx.font = cssFont(st.weight, st.sizePx, st.fontFamily, st.style === "italic");
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${st.letterSpacing || 0}px`;
  } catch {
    /* eski tarayıcı */
  }
}

type Metrics = {
  lines: number;
  /** Kutudan geniş İLK kelime (yoksa null). */
  wideWord: string | null;
  /** Metin bloğunun alt kenarı, BASE px. */
  bottom: number;
  head: ResolvedText;
  sub: ResolvedText | null;
};

function measureSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  locale: string,
  format: Format
): Metrics {
  const theme = getTheme(slide.themeId);
  // renderSlideAt ile AYNI düşüş: split düzen + ikinci ekran yok → text-top.
  let layout = getLayoutForFormat(LAYOUTS[slide.layout] ? slide.layout : theme.defaultLayout, format);
  if (layout.device2 && !layout.splitPanels && !slide.screenshot2) layout = getLayoutForFormat("text-top", format);
  const align = layout.text.align;
  const B = baseOf(format);
  const blockW = layout.text.w * B.w;

  const head = resolveText({ ...theme.headline, align }, slide.headlineStyle);
  const content = applyTransform(slide.headline || "", head.transform, locale);
  setFont(ctx, head);
  const lines = wrapLines(ctx, content, blockW);
  // "Tek kelime kutudan geniş" YALNIZ sarma onu kurtaramıyorsa hatadır:
  // wrapLines CJK öbeklerini karakterden kırar (breakCjk), Latin kelimeleri
  // ASLA kırmaz. Kelimeyi tek başına sardırıp tek satır kalıyor ve hâlâ
  // taşıyorsa gerçekten sığmıyordur — motorun kendi kuralı, kopya regex yok.
  let wideWord: string | null = null;
  for (const w of content.split(/\s+/).filter(Boolean)) {
    if (ctx.measureText(w).width <= blockW) continue;
    const parts = wrapLines(ctx, w, blockW);
    if (parts.length === 1 && ctx.measureText(parts[0]).width > blockW) {
      wideWord = w;
      break;
    }
  }

  // Blok üst hizası + rozet/çelenk payı (render.ts ile aynı sabitler).
  let y = layout.text.y * B.h + (slide.textOffset?.y ?? 0);
  if (slide.badge) y += 40 * 1.9 + 36;
  // Çelenk payı ornament.ts'ten — render.ts ile aynı ölçüm, kopya sabit yok.
  if (slide.ornament) y += ornamentAdvance(slide, layout, ctx, locale, format);

  const lh = (head.lineHeight || 1.1) * head.sizePx;
  let bottom = y + lines.length * lh + head.sizePx * 0.1;

  let sub: ResolvedText | null = null;
  if (slide.sub) {
    sub = resolveText({ ...theme.sub, align }, slide.subStyle);
    setFont(ctx, sub);
    const subLines = wrapLines(ctx, applyTransform(slide.sub, sub.transform, locale), blockW);
    bottom += 18 + subLines.length * (sub.lineHeight || 1.1) * sub.sizePx;
  }

  return { lines: lines.length, wideWord, bottom, head, sub };
}

/* ------------------------------------------------------------------ *
   Tarama
 * ------------------------------------------------------------------ */

/** Taban dil: "tr" varsa o, yoksa ilk dil. Taşma karşılaştırmasının referansı. */
function baseLocaleOf(project: Project): string {
  const keys = Object.keys(project.sets);
  return keys.includes("tr") ? "tr" : keys[0];
}

export async function scanProject(project: Project): Promise<QaFinding[]> {
  const locales = Object.keys(project.sets);
  // Proje formatı — kadraj yüksekliği (taşma eşiği) ve BASE tabanı buradan.
  const fmt = formatOf(project);
  const B = baseOf(fmt);
  const out: QaFinding[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;

  const base = baseLocaleOf(project);
  // designKey → satır sayısı (taban dil), taşma karşılaştırması için.
  const baseLines: Record<string, number> = {};
  // designKey → normalize başlık → o başlığı kullanan diller.
  const heads: Record<string, Record<string, string[]>> = {};

  for (const locale of locales) {
    await loadFontsForLocale(locale);
    const slides = project.sets[locale]?.slides ?? [];
    const rtl = isRtlLocale(locale);
    const script = scriptForLocale(locale);

    slides.forEach((slide, i) => {
      const no = i + 1;
      const key = slide.designKey || `i${i}`;
      const push = (kind: QaKind, msg: string) =>
        out.push({ locale, slideId: slide.id, no, kind, msg });

      const m = measureSlide(ctx, slide, locale, fmt);
      if (locale === base) baseLines[key] = m.lines;

      const norm = (slide.headline || "").trim().toLocaleLowerCase(locale);
      if (norm) {
        ((heads[key] ??= {})[norm] ??= []).push(locale);
      }

      /* 1 — eksik çeviri (bayrak) */
      if (slide.needsCopy) push("missing", L("çeviri bekliyor — metin kaynaktan kopyalandı", "awaiting translation — text copied from source"));
      if (!slide.headline?.trim()) push("missing", L("başlık boş", "headline is empty"));

      /* 2 — tofu riski */
      for (const [what, st] of [
        [L("başlık", "headline"), m.head],
        [L("alt satır", "subtitle"), m.sub],
      ] as const) {
        if (!st) continue;
        if (!fontCoversLocale(st.fontFamily, locale)) {
          push(
            "tofu",
            L(
              `${what} fontu "${st.fontFamily}" ${script} yazısını kapsamıyor → ${fallbackFamilyForLocale(locale)}`,
              `${what} font "${st.fontFamily}" does not cover ${script} script → ${fallbackFamilyForLocale(locale)}`
            )
          );
        } else if (script === "latin" && locale.toLowerCase().startsWith("tr") && !isTurkishSafe(st.fontFamily)) {
          push("tofu", L(`${what} fontu "${st.fontFamily}" ş/ğ/İ gliflerini içermiyor`, `${what} font "${st.fontFamily}" lacks ş/ğ/İ glyphs`));
        }
      }

      /* 3 — taşma */
      if (m.wideWord) {
        push("overflow", L(`kelime metin kutusundan geniş: "${m.wideWord}"`, `word is wider than the text box: "${m.wideWord}"`));
      }
      if (m.bottom > B.h) {
        push("overflow", L(`metin bloğu kadrajın ${Math.round(m.bottom - B.h)}px altına taşıyor`, `text block overflows the frame by ${Math.round(m.bottom - B.h)}px`));
      }

      /* 4 — eksik ekran */
      if (!slide.screenshot) push("shot", L("ekran görüntüsü yok", "no screenshot"));
      const wants2 = !!(LAYOUTS[slide.layout]?.device2);
      if (wants2 && !slide.screenshot2) {
        push("shot", L(`${slide.layout} düzeni ikinci ekran ister — yoksa text-top'a düşer`, `${slide.layout} layout needs a second screenshot — otherwise falls back to text-top`));
      }
      // R10: üçüncü ekran EKSİKSE düzen düşmez, motor bir öncekine geri döner →
      // aynı görüntü iki cihazda çıkar. Hata değil, uyarı: QA'da görünsün.
      if (LAYOUTS[slide.layout]?.device3 && slide.screenshot2 && !slide.screenshot3) {
        push("shot", L(`${slide.layout} üçüncü ekranı boş — motor 2. ekranı tekrar basar`, `${slide.layout} third screenshot is empty — the engine repeats the 2nd`));
      }

      /* 5 — RTL aynası */
      if (rtl) {
        for (const [what, st] of [
          [L("başlık", "headline"), slide.headlineStyle],
          [L("alt satır", "subtitle"), slide.subStyle],
        ] as const) {
          if (st?.align === "left") {
            push("rtl", L(`${what} hizası açıkça "left" — RTL aynası uygulanmamış olabilir`, `${what} alignment is explicitly "left" — RTL mirroring may not be applied`));
          }
        }
        if (slide.textOffset && slide.textOffset.x > 0) {
          push("rtl", L("metin kaydırması sağa pozitif — ayna sırasında negatiflenmemiş olabilir", "text offset is positive to the right — may not have been negated when mirroring"));
        }
      }
    });
  }

  /* 3b — taban dile göre satır farkı (ikinci geçiş: baseLines dolduktan sonra) */
  for (const locale of locales) {
    if (locale === base) continue;
    await loadFontsForLocale(locale);
    const slides = project.sets[locale]?.slides ?? [];
    slides.forEach((slide, i) => {
      const key = slide.designKey || `i${i}`;
      const ref = baseLines[key];
      if (ref === undefined) return;
      const m = measureSlide(ctx, slide, locale, fmt);
      if (m.lines > ref + 1) {
        out.push({
          locale,
          slideId: slide.id,
          no: i + 1,
          kind: "overflow",
          msg: L(`başlık ${base} diline göre ${m.lines - ref} satır uzun (${m.lines} vs ${ref})`, `headline is ${m.lines - ref} lines longer than ${base} (${m.lines} vs ${ref})`),
        });
      }
    });
  }

  /* 1b — birebir aynı başlık = "çeviri bekliyor olabilir" sezgisi.
     İlk dil (sets sırası = içe aktarma sırası) KAYNAK sayılır ve işaretlenmez;
     aynı metni taşıyan DİĞER diller uyarılır. */
  for (const [key, byHead] of Object.entries(heads)) {
    for (const [, locs] of Object.entries(byHead)) {
      if (locs.length < 2) continue;
      const ordered = locales.filter((l) => locs.includes(l));
      for (const locale of ordered.slice(1)) {
        const slides = project.sets[locale]?.slides ?? [];
        const i = slides.findIndex((s) => (s.designKey || "") === key);
        const slide = i >= 0 ? slides[i] : null;
        if (!slide || slide.needsCopy) continue; // bayrak zaten söyledi
        out.push({
          locale,
          slideId: slide.id,
          no: i + 1,
          kind: "missing",
          msg: L(`başlık ${ordered[0]} ile birebir aynı — çeviri bekliyor olabilir`, `headline is identical to ${ordered[0]} — may be awaiting translation`),
        });
      }
    }
  }

  // Dil sırası → slayt no → tür: liste okunabilir kalsın.
  const kindOrder: QaKind[] = ["missing", "tofu", "overflow", "shot", "rtl"];
  out.sort(
    (a, b) =>
      locales.indexOf(a.locale) - locales.indexOf(b.locale) ||
      a.no - b.no ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)
  );
  return out;
}

/* ------------------------------------------------------------------ *
   Panel
 * ------------------------------------------------------------------ */

const MAX_ROWS = 60;

export default function LocQa({ close }: { close: () => void }) {
  const project = useStudio((s) => s.project);
  const [findings, setFindings] = useState<QaFinding[]>([]);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const locales = Object.keys(project.sets);

  const rescan = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const f = await scanProject(useStudio.getState().project);
      setFindings(f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void rescan();
  }, [rescan]);

  const countOf = (l: string) => findings.filter((f) => f.locale === l).length;
  const shown = filter ? locales.filter((l) => l === filter) : locales;

  const go = (f: QaFinding) => {
    const st = useStudio.getState();
    if (f.locale !== st.project.activeLocale) st.setLocale(f.locale);
    st.setActiveSlide(f.slideId);
    close();
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" style={{ width: 700, maxWidth: "94vw" }}>
        <div className="dialog-inner">
          <h2>
            <span className="gcard-ic">
              <Icon name="globe" size={14} />
            </span>
            {L("Lokalizasyon QA", "Localization QA")}
          </h2>
          <p className="note">
            {L(
              `${locales.length} dil taranır: eksik çeviri, tofu riski, taşma, eksik ekran, RTL aynası. Ölçüm gerçek font metrikleriyle, 1320×2868 tabanında yapılır.`,
              `Scanning ${locales.length} locales: missing translation, tofu risk, overflow, missing screenshot, RTL mirroring. Measured with real font metrics at a 1320×2868 base.`
            )}
          </p>

          {/* dil çipleri — sayaç rozeti + filtre */}
          <div className="chips" style={{ margin: "12px 0 4px" }}>
            {locales.map((l) => {
              const n = countOf(l);
              return (
                <button
                  key={l}
                  className={`chip ${filter === l ? "on" : ""}`}
                  onClick={() => setFilter(filter === l ? null : l)}
                  title={L(`${l} — ${n} bulgu`, `${l} — ${n} findings`)}
                >
                  {l}
                  <em
                    className="cnt"
                    style={{
                      marginLeft: 6,
                      fontStyle: "normal",
                      color: n ? "var(--fox)" : "var(--ink-4)",
                    }}
                  >
                    {n}
                  </em>
                </button>
              );
            })}
          </div>

          {busy && (
            <>
              <div className="progress">
                <div style={{ width: "100%", opacity: 0.5 }} />
              </div>
              <p className="kunye" style={{ color: "var(--ink-3)" }}>
                {L("TARANIYOR — FONTLAR YÜKLENİYOR…", "SCANNING — LOADING FONTS…")}
              </p>
            </>
          )}

          {!busy && findings.length === 0 && (
            <p className="note ok" style={{ marginTop: 10 }}>
              {L(`Bulgu yok — ${locales.length} dil temiz.`, `No findings — ${locales.length} locales clean.`)}
            </p>
          )}

          {!busy &&
            shown.map((l) => {
              const list = findings.filter((f) => f.locale === l);
              return (
                <Section
                  key={l}
                  id={`qa.${l}`}
                  title={l}
                  hint={list.length ? L(`${list.length} BULGU`, `${list.length} FINDINGS`) : L("TEMİZ", "CLEAN")}
                  defaultOpen={list.length > 0}
                >
                  {list.length === 0 && <p className="note ok">{L("Bu dilde bulgu yok.", "No findings in this locale.")}</p>}
                  {list.slice(0, MAX_ROWS).map((f, i) => (
                    <div className="drift-row" key={`${f.slideId}-${f.kind}-${i}`}>
                      <span style={{ flex: "none", opacity: 0.75 }}>
                        {String(f.no).padStart(2, "0")}
                      </span>
                      <span style={{ flex: "none", opacity: 0.75 }}>{KIND_TAG[f.kind]}</span>
                      <span style={{ textTransform: "none", minWidth: 0 }}>{f.msg}</span>
                      <button onClick={() => go(f)}>{L("git", "go")}</button>
                    </div>
                  ))}
                  {list.length > MAX_ROWS && (
                    <p className="note">{L(`+${list.length - MAX_ROWS} bulgu daha (listede kısaltıldı).`, `+${list.length - MAX_ROWS} more findings (list truncated).`)}</p>
                  )}
                </Section>
              );
            })}

          {err && <p className="inline-err">{err}</p>}

          <div className="foot">
            <span className="kunye" style={{ marginRight: "auto", color: "var(--ink-3)" }}>
              {busy ? "…" : L(`${findings.length} BULGU · ${locales.length} DİL`, `${findings.length} FINDINGS · ${locales.length} LOCALES`)}
            </span>
            <button className="btn ghost" onClick={close}>
              {L("Kapat", "Close")}
            </button>
            <button className="btn" onClick={() => void rescan()} disabled={busy}>
              <Icon name="rotate" size={13} />
              {L("Yeniden tara", "Rescan")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
