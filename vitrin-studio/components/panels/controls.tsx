"use client";

// Panellerin küçük kontrolleri — sayı alanı (sürtme + yazma) ve ikon segment.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { beginUndoGesture, endUndoGesture } from "@/store/studio";
import { clamp } from "@/engine/types";

/** Etiketli sayı alanı: yaz + Enter, ya da etiketi yatay sürükle (scrub). */
export function NumberInput({ label, value, onChange, min = -100000, max = 100000, step = 1, suffix, title }: { label: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; title?: string }) {
  const fmt = (v: number) => String(Math.round(v / step) * step === v ? v : Math.round(v * 100) / 100);
  const [draft, setDraft] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (draft.trim() && Number.isFinite(n)) onChange(clamp(n, min, max));
    else setDraft(fmt(value));
  };
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    beginUndoGesture();
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 0.1 : ev.altKey ? 10 : 1;
      const v = Math.round(((v0 + (ev.clientX - x0) * step * k) / step)) * step;
      onChange(clamp(Number(v.toFixed(4)), min, max));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      endUndoGesture();
    };
    document.body.style.cursor = "ew-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <label className="num-input" title={title}>
      <span className="num-input-lb" onPointerDown={scrub}>
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp(Number((value + d).toFixed(4)), min, max));
          }
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

/** İkonlu/kısa etiketli seçim şeridi (hiza, harf dönüşümü…). */
export function IconSeg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="icon-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
