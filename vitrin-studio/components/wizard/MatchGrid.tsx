"use client";

// 3. adım — KARE BAŞINA eşleşme ızgarası.
//
// Kullanıcının en büyük şikayeti buydu: "yanlış eşleşen görseli silemiyorum,
// değiştiremiyorum". Eski diyalog GÖRSEL merkezliydi (havuzdaki kartları aç/kapa);
// burası KARE merkezli: her MD karesi bir satır, satırın thumbnail'ine tıklayınca
// puanlanmış adaylar açılır → ata / temizle / otomatiğe dön.
//
// Değişiklikler URL değil KARE NUMARASI + BAĞIL AD olarak saklanır (types.ts),
// böylece "tüm dillere uygula" her dile o dilin KENDİ dosyasını verir.

import { useEffect, useMemo, useRef, useState } from "react";

import { matchCandidates, MATCH_MIN_SCORE, type ImageRef, type MdFrame } from "@/lib/mdframes";
import { L } from "@/lib/i18n";

import {
  designKeyOf,
  overrideFor,
  overrideFromImage,
  ovKey,
  pad2,
  resolveOverride,
  shortName,
  type FrameOverride,
  type OverrideMap,
  type ScanResult,
} from "./types";

/** Bir karenin durum etiketi — güven göstergesi. */
type Conf = { cls: string; label: string };

function confOf(image: ImageRef | null, score: number, manual: boolean, cleared: boolean): Conf {
  if (manual && image) return { cls: "manual", label: L("elle", "manual") };
  if (cleared) return { cls: "none", label: L("temizlendi", "cleared") };
  if (!image) return { cls: "none", label: L("eşleşmedi", "unmatched") };
  if (score >= MATCH_MIN_SCORE) return { cls: "good", label: L(`eşleşti ${score.toFixed(1)}`, `matched ${score.toFixed(1)}`) };
  return { cls: "weak", label: L(`zayıf ${score.toFixed(1)}`, `weak ${score.toFixed(1)}`) };
}

export function MatchGrid({
  res,
  locale,
  frames,
  pool,
  auto,
  byNumber,
  overrides,
  setOverrides,
}: {
  res: ScanResult;
  /** Aktif dil — kartlar bu dilin havuzuyla çizilir. */
  locale: string;
  frames: MdFrame[];
  /** Bu dilin havuzu: kendi kovası + ortak havuz. */
  pool: ImageRef[];
  /** Otomatik eşleşme (override yoksa geçerli olan). */
  auto: (ImageRef | null)[];
  byNumber: boolean;
  overrides: OverrideMap;
  setOverrides: (next: OverrideMap) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Popover dışına tıklayınca / Esc ile kapanır.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Aynı puan defteri (scoreImageMatch) — liste otomatik eşleşmeyle tutarlı.
  const cands = useMemo(
    () => frames.map((f) => matchCandidates(f, pool, { byNumber, limit: 60, all: true })),
    [frames, pool, byNumber]
  );

  // Her kare için yürürlükteki görsel + puan.
  const rows = frames.map((f, i) => {
    const dk = designKeyOf(f.no);
    const hit = overrideFor(overrides, locale, dk);
    const image = hit ? resolveOverride(hit.ov, locale, res) : auto[i];
    const score = image ? (cands[i].find((c) => c.image.url === image.url)?.score ?? 0) : 0;
    return {
      i,
      frame: f,
      dk,
      image,
      score,
      manual: !!hit,
      scope: hit?.scope ?? "all",
      cleared: !!hit && hit.ov.rel === null,
    };
  });

  // Eşleşmeyen kareler üste — düzeltilecek şey ilk göze çarpsın.
  const order = [...rows].sort((a, b) => Number(!!a.image) - Number(!!b.image));

  const put = (dk: string, scope: string, value: FrameOverride | null) => {
    const next: OverrideMap = { ...overrides };
    // Bir kareye tek kayıt: kapsam değişince eskisi silinir.
    delete next[ovKey("all", dk)];
    delete next[ovKey(locale, dk)];
    if (value) next[ovKey(scope, dk)] = value;
    setOverrides(next);
  };

  return (
    <div className="wiz-frames">
      {order.map((r) => {
        const conf = confOf(r.image, r.score, r.manual && !r.cleared, r.cleared);
        const isOpen = open === r.i;
        return (
          <div key={r.dk} className={`wiz-frame ${r.image ? "" : "miss"}`}>
            <button
              type="button"
              className="wiz-thumb"
              onClick={() => setOpen(isOpen ? null : r.i)}
              title={r.image ? r.image.name : L("Ekran seç", "Choose screen")}
              aria-expanded={isOpen}
            >
              {r.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image.url} alt={r.image.name} loading="lazy" decoding="async" />
              ) : (
                <span className="none">{L("seç", "pick")}</span>
              )}
            </button>

            <div className="wiz-fmeta">
              <span className="wiz-fno">{pad2(r.frame.no)}</span>
              <span className="wiz-fhead">{r.frame.headline}</span>
              <span className="wiz-fhint">
                {r.frame.screenHint ? `SCREEN: ${r.frame.screenHint}` : L("SCREEN ipucu yok", "No SCREEN hint")}
              </span>
              <span className="wiz-ffile">
                {r.image ? r.image.name : "—"}
                {r.manual && r.scope !== "all" && ` · ${L("sadece", "only")} ${locale}`}
              </span>
            </div>

            <span className={`wiz-conf ${conf.cls}`}>{conf.label}</span>

            {isOpen && (
              <div className="wiz-pop" ref={popRef}>
                <h5>
                  {pad2(r.frame.no)} · {L("adaylar", "candidates")} ({locale})
                </h5>
                {cands[r.i].slice(0, 14).map((c) => (
                  <button
                    key={c.image.url}
                    type="button"
                    className={`wiz-cand ${r.image?.url === c.image.url ? "on" : ""}`}
                    // Atama sonrası popover kapanır: kare eşleştiği anda
                    // "eşleşmeyenler üstte" sırası değişir, açık kalan panel
                    // ekranda zıplardı. Kapsam kutusu ("sadece bu dil") aynı
                    // popover'ı tekrar açınca etkin gelir.
                    onClick={() => {
                      put(r.dk, r.scope, overrideFromImage(c.image, locale));
                      setOpen(null);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.image.url} alt="" loading="lazy" decoding="async" />
                    <span className="f">{shortName(c.image.name)}</span>
                    <span className="s">{c.score.toFixed(1)}</span>
                  </button>
                ))}
                {!cands[r.i].length && <div className="wiz-empty">{L("Havuzda görsel yok.", "No images in the pool.")}</div>}
                <div className="wiz-pop-foot">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      put(r.dk, r.scope, { rel: null, bucketRel: false });
                      setOpen(null);
                    }}
                  >
                    {L("Temizle", "Clear")}
                  </button>
                  {r.manual && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        put(r.dk, r.scope, null);
                        setOpen(null);
                      }}
                    >
                      {L("Otomatiğe dön", "Back to auto")}
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  <label className="wiz-scope" title={L("Kapalıyken bu eşleşme tüm dillere uygulanır", "When off, this match applies to all languages")}>
                    <input
                      type="checkbox"
                      checked={r.scope !== "all"}
                      onChange={(e) => {
                        const cur = overrideFor(overrides, locale, r.dk);
                        if (!cur) return;
                        put(r.dk, e.target.checked ? locale : "all", cur.ov);
                      }}
                      disabled={!r.manual}
                    />
                    {L("sadece bu dil", "this language only")}
                  </label>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {!frames.length && <p className="note">{L("Bu dilde kare yok.", "No frames in this language.")}</p>}
    </div>
  );
}
