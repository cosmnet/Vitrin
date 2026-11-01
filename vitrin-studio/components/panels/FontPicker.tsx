"use client";

// FONT SEÇİCİ — v1.0. Her aile KENDİ yüzüyle önizlenir (fontlar document.fonts'a
// motorun yükleyicisiyle eklenir; canvas ve CSS aynı dosyayı kullanır).
// Arama, kategori, son kullanılanlar; Türkçesi sınırlı aileler işaretli.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FONT_FAMILIES, FONTS, loadFonts } from "@/engine/fonts";
import { L } from "@/lib/i18n";
import { Icon } from "../ui";

const RECENT_KEY = "vitrin:ui:recent-fonts";
type Cat = "all" | "sans" | "serif" | "display" | "recent";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Bir ailenin kayıtlı ağırlıkları (italik hariç), küçükten büyüğe. */
export function weightsOf(family: string): number[] {
  const w = [...new Set(FONTS.filter((f) => f.family === family && f.style !== "italic").map((f) => f.weight))].sort((a, b) => a - b);
  return w.length ? w : [400, 700];
}

export function hasItalic(family: string): boolean {
  return FONTS.some((f) => f.family === family && f.style === "italic");
}

export default function FontPicker({ value, onChange, sample }: { value: string; onChange: (family: string) => void; sample?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");
  const [ready, setReady] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, w: 300 });
  const recent = useMemo(() => (open ? readRecent() : []), [open]);

  useEffect(() => {
    let alive = true;
    void loadFonts().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    let l = FONT_FAMILIES;
    if (cat === "recent") l = recent.map((r) => FONT_FAMILIES.find((f) => f.family === r)).filter((f): f is (typeof FONT_FAMILIES)[number] => !!f);
    else if (cat !== "all") l = l.filter((f) => f.category === cat);
    return needle ? l.filter((f) => f.family.toLocaleLowerCase("tr").includes(needle)) : l;
  }, [q, cat, recent]);

  const choose = (family: string) => {
    onChange(family);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([family, ...readRecent().filter((f) => f !== family)].slice(0, 8)));
    } catch {
      /* yoksay */
    }
    setOpen(false);
  };

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const w = Math.max(300, r.width);
      const x = Math.min(window.innerWidth - w - 8, r.left);
      const y = r.bottom + 6 + 440 > window.innerHeight ? Math.max(8, r.top - 446) : r.bottom + 6;
      setPos({ x, y, w });
    }
    setOpen((o) => !o);
  };

  const info = FONT_FAMILIES.find((f) => f.family === value);
  return (
    <>
      <button ref={btn} type="button" className="font-trigger" onClick={toggle} aria-expanded={open} title={L("Yazı tipi seç", "Choose typeface")}>
        <span className="font-trigger-name" style={{ fontFamily: `"${value}", var(--sans)` }}>
          {value}
        </span>
        {info && !info.turkish && <em className="font-warn">TR</em>}
        <Icon name="down" size={12} />
      </button>
      {open &&
        createPortal(
          <>
            <button className="ws-menu-dismiss" aria-label={L("Kapat", "Close")} onClick={() => setOpen(false)} />
            <div className="font-pop" style={{ left: pos.x, top: pos.y, width: pos.w }} role="listbox">
              <div className="font-pop-search">
                <Icon name="search" size={13} />
                <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(`${FONT_FAMILIES.length} aile içinde ara`, `Search ${FONT_FAMILIES.length} families`)} />
              </div>
              <div className="font-pop-cats">
                {(
                  [
                    ["all", L("Tümü", "All")],
                    ["sans", "Sans"],
                    ["serif", "Serif"],
                    ["display", "Display"],
                    ["recent", L("Son", "Recent")],
                  ] as const
                ).map(([c, t]) => (
                  <button key={c} type="button" className={cat === c ? "on" : ""} onClick={() => setCat(c)} disabled={c === "recent" && !recent.length}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="font-pop-list">
                {list.map((f) => (
                  <button key={f.family} type="button" role="option" aria-selected={f.family === value} className={`font-row ${f.family === value ? "on" : ""}`} onClick={() => choose(f.family)}>
                    <span className="font-row-sample" style={{ fontFamily: `"${f.family}", var(--sans)`, opacity: ready ? 1 : 0.5 }}>
                      {sample?.trim() ? sample.slice(0, 26) : f.family}
                    </span>
                    <span className="font-row-meta">
                      {f.family}
                      <small>
                        {weightsOf(f.family).length} {L("ağırlık", "weights")}
                        {!f.turkish && ` · ${L("TR sınırlı", "limited TR")}`}
                      </small>
                    </span>
                  </button>
                ))}
                {!list.length && <p className="note">{L("Eşleşen yazı tipi yok.", "No matching typeface.")}</p>}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
