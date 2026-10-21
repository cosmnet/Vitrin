"use client";

// Panel iskeleti — DaVinci Resolve tarzı yeniden boyutlanabilir bölmeler.
// Sol (Media Pool), sağ (Inspector) genişliği ve alt (Timeline) yüksekliği
// sürüklenerek ayarlanır; değerler localStorage'da "vitrin:ui:panels:v4" altında
// saklanır. Studio ssr:false ile yüklendiği için localStorage'ı doğrudan
// useState başlatıcısında okumak güvenlidir (hydration uyuşmazlığı olmaz).

import { useCallback, useEffect, useRef, useState } from "react";
import { L } from "@/lib/i18n";

export type PanelSizes = { left: number; right: number; bottom: number };

const KEY = "vitrin:ui:panels:v4";

// UI v3 ölçüleri (rapor §0): çekmece 240px, inspector 264px, film şeridi
// 132px kart + künye/başlık satırları → 190px panel.
export const PANEL_DEFAULTS: PanelSizes = { left: 292, right: 336, bottom: 146 };

/** Kullanışlı kalan alanı garanti eden sınırlar. */
export const PANEL_LIMITS: Record<keyof PanelSizes, { min: number; max: number }> = {
  left: { min: 200, max: 420 },
  right: { min: 296, max: 460 },
  bottom: { min: 116, max: 340 },
};

function clampPanel(k: keyof PanelSizes, v: number): number {
  const { min, max } = PANEL_LIMITS[k];
  return Math.round(Math.min(max, Math.max(min, v)));
}

function readSizes(): PanelSizes {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...PANEL_DEFAULTS };
    const p = JSON.parse(raw) as Partial<PanelSizes>;
    return {
      left: clampPanel("left", Number(p.left) || PANEL_DEFAULTS.left),
      right: clampPanel("right", Number(p.right) || PANEL_DEFAULTS.right),
      bottom: clampPanel("bottom", Number(p.bottom) || PANEL_DEFAULTS.bottom),
    };
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

/** Panel ölçüleri + kalıcı yazıcı. */
export function usePanelSizes(): [PanelSizes, (patch: Partial<PanelSizes>) => void] {
  const [sizes, setSizes] = useState<PanelSizes>(() => readSizes());

  // Yazma, sürükleme boyunca her karede olmasın diye tek kare geciktirilir.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(sizes));
      } catch {
        /* localStorage kapalı olabilir */
      }
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sizes]);

  const update = useCallback((patch: Partial<PanelSizes>) => {
    setSizes((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(patch) as [keyof PanelSizes, number][]) {
        next[k] = clampPanel(k, v);
      }
      return next;
    });
  }, []);

  return [sizes, update];
}

/* ------------------------------------------------------------------ *
   Divider — panolar arası tutamak. 6px görünür, 12px hedef alan.
   Çift tık: varsayılana döner.
 * ------------------------------------------------------------------ */

export function Divider({
  axis,
  value,
  panel,
  invert,
  onChange,
  className = "",
  style,
}: {
  /** x: dikey çizgi (genişlik ayarı) · y: yatay çizgi (yükseklik ayarı) */
  axis: "x" | "y";
  value: number;
  panel: keyof PanelSizes;
  /** true ise imleç ters yönde büyütür (sağ panel, alt panel) */
  invert?: boolean;
  onChange: (v: number) => void;
  /** UI v3: çekmece tutamağı ızgarada değil, MUTLAK konumlanır. */
  className?: string;
  style?: React.CSSProperties;
}) {
  const drag = useRef<{ p: number; v: number } | null>(null);
  const [hot, setHot] = useState(false);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { p: axis === "x" ? e.clientX : e.clientY, v: value };
    setHot(true);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const cur = axis === "x" ? e.clientX : e.clientY;
    const d = (cur - drag.current.p) * (invert ? -1 : 1);
    onChange(drag.current.v + d);
  };

  const up = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setHot(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      className={`divider ${axis === "x" ? "vert" : "horz"} ${hot ? "hot" : ""} ${className}`}
      style={style}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      title={L("Sürükle: panel boyutu · Çift tık: varsayılan", "Drag: resize panel · Double-click: reset")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onChange(PANEL_DEFAULTS[panel])}
    >
      <i />
    </div>
  );
}
