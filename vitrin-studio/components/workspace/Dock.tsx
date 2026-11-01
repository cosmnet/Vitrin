"use client";

// DOCK — v1.0 çalışma alanı bileşenleri.
//
//   DockColumn  sol/sağ sütun: dikey yığılmış sekme grupları + bölücüler
//   FloatLayer  yüzen pencereler (başlıktan taşı, köşeden boyutlandır)
//   TabDrag     sekme sürükleme: 5px sonra hayalet çıkar; bırakılan yer
//               `data-drop` özniteliğinden okunur (grup / ara / yüzen).
//
// Düzen durumu store/workspace.ts'te; burası yalnız çizer ve jest toplar.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { L } from "@/lib/i18n";
import { DOCK_LIMITS, useWorkspace, type DockGroup, type DockSide, type DropTarget, type FloatWin, type PanelId } from "@/store/workspace";
import { Icon, type IconName } from "../ui";

export type PanelDef = { title: string; icon: IconName; render: () => ReactNode };
export const PanelRegistry = createContext<Record<PanelId, PanelDef> | null>(null);

function usePanels(): Record<PanelId, PanelDef> {
  const r = useContext(PanelRegistry);
  if (!r) throw new Error("PanelRegistry yok");
  return r;
}

/* ------------------------------------------------------------------ *
   Sekme sürükleme
 * ------------------------------------------------------------------ */

function parseDrop(el: Element | null, x: number, y: number): DropTarget {
  const hit = el?.closest?.("[data-drop]") as HTMLElement | null;
  const v = hit?.dataset.drop ?? "";
  const [kind, a, b] = v.split(":");
  if (kind === "group" && (a === "left" || a === "right")) return { kind: "group", side: a, index: Number(b) || 0 };
  if (kind === "split" && (a === "left" || a === "right")) return { kind: "split", side: a, index: Number(b) || 0 };
  if (kind === "floatTabs" && a) return { kind: "floatTabs", id: a };
  return { kind: "float", x, y };
}

function startTabDrag(e: React.PointerEvent, p: PanelId, title: string, onClick: () => void): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const ws = useWorkspace.getState();
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = document.createElement("div");
      ghost.className = "ws-ghost";
      ghost.textContent = title;
      document.body.appendChild(ghost);
      document.body.classList.add("ws-dragging");
      ws.setDragging(p);
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    document.querySelectorAll(".ws-drop-hot").forEach((n) => n.classList.remove("ws-drop-hot"));
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-drop]");
    under?.classList.add("ws-drop-hot");
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.querySelectorAll(".ws-drop-hot").forEach((n) => n.classList.remove("ws-drop-hot"));
    if (!ghost) {
      onClick();
      return;
    }
    ghost.remove();
    document.body.classList.remove("ws-dragging");
    const target = parseDrop(document.elementFromPoint(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
    useWorkspace.getState().setDragging(null);
    useWorkspace.getState().move(p, target);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/* ------------------------------------------------------------------ *
   Grup başlığı (sekmeler) + gövde
 * ------------------------------------------------------------------ */

function GroupTabs({ group, drop, onUndock, onClose, extra }: { group: { id: string; tabs: PanelId[]; active: PanelId }; drop: string; onUndock?: (p: PanelId) => void; onClose: (p: PanelId) => void; extra?: ReactNode }) {
  const panels = usePanels();
  const setActive = useWorkspace((s) => s.setActive);
  const [menu, setMenu] = useState<{ x: number; y: number; p: PanelId } | null>(null);
  return (
    <div className="ws-tabs" data-drop={drop} onDoubleClick={(e) => e.target === e.currentTarget && onUndock?.(group.active)}>
      {group.tabs.map((p) => (
        <button
          key={p}
          type="button"
          className={`ws-tab ${group.active === p ? "on" : ""}`}
          aria-selected={group.active === p}
          role="tab"
          title={L(`${panels[p].title} · sürükle: taşı / ayır`, `${panels[p].title} · drag: move / undock`)}
          onPointerDown={(e) => startTabDrag(e, p, panels[p].title, () => setActive(group.id, p))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, p });
          }}
        >
          <Icon name={panels[p].icon} size={13} />
          <span>{panels[p].title}</span>
        </button>
      ))}
      <span className="ws-tabs-sp" data-drop={drop} />
      {extra}
      <button
        type="button"
        className="ws-tab-menu"
        title={L("Panel menüsü", "Panel menu")}
        onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, p: group.active })}
      >
        <Icon name="list" size={13} />
      </button>
      {menu &&
        createPortal(
          <>
            <button className="ws-menu-dismiss" aria-label={L("Kapat", "Close")} onClick={() => setMenu(null)} />
            <div className="ws-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y + 4 }} role="menu">
              <p>{panels[menu.p].title}</p>
              {onUndock && (
                <button role="menuitem" onClick={() => (onUndock(menu.p), setMenu(null))}>
                  <Icon name="frame" size={13} />
                  {L("Ayrı pencerede aç", "Open as floating window")}
                </button>
              )}
              <button role="menuitem" onClick={() => (useWorkspace.getState().move(menu.p, { kind: "group", side: "left", index: 0 }), setMenu(null))}>
                <Icon name="left" size={13} />
                {L("Sol dock'a taşı", "Move to left dock")}
              </button>
              <button role="menuitem" onClick={() => (useWorkspace.getState().move(menu.p, { kind: "group", side: "right", index: 0 }), setMenu(null))}>
                <Icon name="right" size={13} />
                {L("Sağ dock'a taşı", "Move to right dock")}
              </button>
              <button role="menuitem" onClick={() => (onClose(menu.p), setMenu(null))}>
                <Icon name="x" size={13} />
                {L("Paneli kapat", "Close panel")}
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

function PanelBody({ id }: { id: PanelId }) {
  const panels = usePanels();
  return <div className="ws-body">{panels[id].render()}</div>;
}

/* ------------------------------------------------------------------ *
   Dock sütunu
 * ------------------------------------------------------------------ */

export function DockColumn({ side }: { side: DockSide }) {
  const groups = useWorkspace((s) => s.layout[side]);
  const dragging = useWorkspace((s) => s.dragging);
  const close = useWorkspace((s) => s.close);
  const setFlex = useWorkspace((s) => s.setFlex);
  const colRef = useRef<HTMLDivElement>(null);

  const undock = (p: PanelId) => {
    const r = colRef.current?.getBoundingClientRect();
    const x = side === "left" ? (r?.right ?? 300) + 40 : (r?.left ?? 900) - 380;
    useWorkspace.getState().move(p, { kind: "float", x: x + 60, y: (r?.top ?? 60) + 40 });
  };

  const splitDrag = (e: React.PointerEvent, i: number) => {
    const a = groups[i];
    const b = groups[i + 1];
    const col = colRef.current;
    if (!a || !b || !col) return;
    e.preventDefault();
    const els = col.querySelectorAll<HTMLElement>(":scope > .ws-group");
    const ha = els[i]?.getBoundingClientRect().height ?? 200;
    const hb = els[i + 1]?.getBoundingClientRect().height ?? 200;
    const total = a.flex + b.flex;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const d = ev.clientY - y0;
      const na = Math.max(80, ha + d);
      const nb = Math.max(80, hb - d);
      setFlex(side, i, (total * na) / (na + nb), (total * nb) / (na + nb));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!groups.length) {
    return (
      <div className={`ws-dock ws-${side} empty ${dragging ? "drag" : ""}`} ref={colRef}>
        <div className="ws-split-zone full" data-drop={`split:${side}:0`}>
          {dragging && <span>{L("Buraya bırak", "Drop here")}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`ws-dock ws-${side} ${dragging ? "drag" : ""}`} ref={colRef}>
      {groups.map((g: DockGroup, i) => (
        <GroupFrag key={g.id} g={g} i={i} side={side} last={i === groups.length - 1} onSplit={splitDrag} onUndock={undock} onClose={close} />
      ))}
      <div className="ws-split-zone tail" data-drop={`split:${side}:${groups.length}`} />
    </div>
  );
}

function GroupFrag({ g, i, side, last, onSplit, onUndock, onClose }: { g: DockGroup; i: number; side: DockSide; last: boolean; onSplit: (e: React.PointerEvent, i: number) => void; onUndock: (p: PanelId) => void; onClose: (p: PanelId) => void }) {
  return (
    <>
      <div className="ws-split-zone" data-drop={`split:${side}:${i}`} />
      <section className="ws-group" style={{ flex: `${g.flex} 1 0` }} data-drop={`group:${side}:${i}`}>
        <GroupTabs group={g} drop={`group:${side}:${i}`} onUndock={onUndock} onClose={onClose} />
        <PanelBody id={g.active} />
      </section>
      {!last && <div className="ws-hsplit" role="separator" aria-orientation="horizontal" onPointerDown={(e) => onSplit(e, i)} />}
    </>
  );
}

/* ------------------------------------------------------------------ *
   Dock genişlik tutamağı
 * ------------------------------------------------------------------ */

export function DockResizer({ side }: { side: DockSide }) {
  const w = useWorkspace((s) => (side === "left" ? s.layout.leftW : s.layout.rightW));
  const setW = useWorkspace((s) => s.setDockWidth);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = w;
    const move = (ev: PointerEvent) => setW(side, w0 + (ev.clientX - x0) * (side === "left" ? 1 : -1));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className="ws-resizer"
      role="separator"
      aria-orientation="vertical"
      title={L(`Sürükle: genişlik (${DOCK_LIMITS.min}–${DOCK_LIMITS.max}px)`, `Drag: width (${DOCK_LIMITS.min}–${DOCK_LIMITS.max}px)`)}
      onPointerDown={down}
    />
  );
}

/* ------------------------------------------------------------------ *
   Yüzen pencereler
 * ------------------------------------------------------------------ */

export function FloatLayer() {
  const floats = useWorkspace((s) => s.layout.floats);
  return (
    <>
      {floats.map((f) => (
        <FloatWindow key={f.id} f={f} />
      ))}
    </>
  );
}

function FloatWindow({ f }: { f: FloatWin }) {
  const { moveFloat, resizeFloat, raiseFloat, dockFloat, close } = useWorkspace.getState();
  const drag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".ws-tab, .ws-tab-menu, .ws-float-btn")) return;
      e.preventDefault();
      raiseFloat(f.id);
      const x0 = e.clientX - f.x;
      const y0 = e.clientY - f.y;
      const move = (ev: PointerEvent) => moveFloat(f.id, ev.clientX - x0, ev.clientY - y0);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [f.id, f.x, f.y, moveFloat, raiseFloat]
  );
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const w0 = f.w;
    const h0 = f.h;
    const move = (ev: PointerEvent) => resizeFloat(f.id, w0 + ev.clientX - x0, h0 + ev.clientY - y0);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Pencere ekran dışında kalmasın (pencere küçüldüyse).
  useEffect(() => {
    const fix = () => moveFloat(f.id, f.x, f.y);
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
  }, [f.id, f.x, f.y, moveFloat]);
  return (
    <div
      className="ws-float"
      style={{ left: f.x, top: f.y, width: f.w, height: f.h, zIndex: 40 + f.z }}
      onPointerDown={() => raiseFloat(f.id)}
      data-drop={`floatTabs:${f.id}`}
    >
      <div className="ws-float-head" onPointerDown={drag}>
        <GroupTabs
          group={f}
          drop={`floatTabs:${f.id}`}
          onClose={close}
          extra={
            <>
              <button type="button" className="ws-float-btn" title={L("Sol dock'a yerleştir", "Dock left")} onClick={() => dockFloat(f.id, "left")}>
                <Icon name="left" size={12} />
              </button>
              <button type="button" className="ws-float-btn" title={L("Sağ dock'a yerleştir", "Dock right")} onClick={() => dockFloat(f.id, "right")}>
                <Icon name="right" size={12} />
              </button>
            </>
          }
        />
      </div>
      <PanelBody id={f.active} />
      <span className="ws-float-grip" onPointerDown={resize} aria-hidden="true" />
    </div>
  );
}
