"use client";

// Tuval bağlam menüsü — sağ tık (kullanıcının Duperré referansı).
//
// Satır dili doğrudan Rive'ın araç menüsünden alındı (Mobbin'den canlı
// bakıldı): solda ikon, ortada etiket, sağda MONO kısayol; gruplar ince
// saç çizgisiyle ayrılır. Ekrandan taşmayı önlemek için menü kendini
// pencereye göre kelepçeler.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./ui";

export type MenuItem =
  | { kind: "sep" }
  | { kind: "head"; label: string }
  | {
      kind: "item";
      label: string;
      icon?: IconName;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    };

export function ContextMenu({
  x,
  y,
  items,
  close,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
    };
  }, [close]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ctx" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) => {
        if (it.kind === "sep") return <hr key={i} />;
        if (it.kind === "head") return <h5 key={i}>{it.label}</h5>;
        return (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            onClick={() => {
              it.run();
              close();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={13} /> : <span style={{ width: 13 }} />}
            {it.label}
            {it.hint && <span className="k">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
