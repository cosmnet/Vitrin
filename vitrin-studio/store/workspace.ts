"use client";

// ÇALIŞMA ALANI — v1.0 dock düzeni (Photoshop / After Effects tarzı).
//
// Her panel tek bir yerde yaşar: sol dock, sağ dock ya da yüzen pencere.
// Dock'lar dikey yığılmış GRUPLARDAN, gruplar SEKMELERDEN oluşur. Sekme
// sürüklenip başka gruba, iki grubun arasına (yeni grup) ya da tuvalin
// üstüne (yüzen pencere) bırakılır. Düzen localStorage'da kalır; proje
// JSON'una asla girmez.

import { create } from "zustand";

export type PanelId = "layers" | "text" | "library" | "scene" | "device" | "screens";
export type DockSide = "left" | "right";

export type DockGroup = { id: string; tabs: PanelId[]; active: PanelId; flex: number };
export type FloatWin = { id: string; tabs: PanelId[]; active: PanelId; x: number; y: number; w: number; h: number; z: number };

export type WorkspaceLayout = {
  left: DockGroup[];
  right: DockGroup[];
  floats: FloatWin[];
  leftW: number;
  rightW: number;
};

export type DropTarget =
  | { kind: "group"; side: DockSide; index: number }
  | { kind: "split"; side: DockSide; index: number }
  | { kind: "float"; x: number; y: number }
  | { kind: "floatTabs"; id: string };

export const ALL_PANELS: PanelId[] = ["layers", "text", "library", "scene", "device", "screens"];

const KEY = "vitrin:workspace:v1";
const gid = () => Math.random().toString(36).slice(2, 9);

export const DOCK_LIMITS = { min: 248, max: 520 };

export function defaultLayout(): WorkspaceLayout {
  return {
    left: [
      { id: gid(), tabs: ["layers"], active: "layers", flex: 0.85 },
      { id: gid(), tabs: ["text", "library"], active: "text", flex: 1.4 },
    ],
    right: [{ id: gid(), tabs: ["scene", "device", "screens"], active: "device", flex: 1 }],
    floats: [],
    leftW: 300,
    rightW: 340,
  };
}

/** Bozuk / eski kayıtları onarır: her panel EN FAZLA bir kez, bilinmeyenler düşer. */
function sanitize(raw: unknown): WorkspaceLayout {
  const d = defaultLayout();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<WorkspaceLayout>;
  const seen = new Set<PanelId>();
  const fixTabs = (tabs: unknown): PanelId[] =>
    (Array.isArray(tabs) ? tabs : []).filter((t): t is PanelId => ALL_PANELS.includes(t as PanelId) && !seen.has(t as PanelId) && (seen.add(t as PanelId), true));
  const groups = (list: unknown): DockGroup[] =>
    (Array.isArray(list) ? list : [])
      .map((g) => {
        const tabs = fixTabs((g as DockGroup)?.tabs);
        const active = tabs.includes((g as DockGroup).active) ? (g as DockGroup).active : tabs[0];
        return { id: String((g as DockGroup).id || gid()), tabs, active, flex: Math.max(0.2, Number((g as DockGroup).flex) || 1) };
      })
      .filter((g) => g.tabs.length > 0);
  const left = groups(r.left);
  const right = groups(r.right);
  const floats: FloatWin[] = (Array.isArray(r.floats) ? r.floats : [])
    .map((f) => {
      const tabs = fixTabs(f?.tabs);
      return { id: String(f.id || gid()), tabs, active: tabs.includes(f.active) ? f.active : tabs[0], x: Number(f.x) || 120, y: Number(f.y) || 90, w: Math.max(260, Number(f.w) || 320), h: Math.max(220, Number(f.h) || 460), z: Number(f.z) || 1 };
    })
    .filter((f) => f.tabs.length > 0);
  // Kaybolan paneller (yeni sürümde eklenenler dahil) varsayılan yerlerine döner.
  const missing = ALL_PANELS.filter((p) => !seen.has(p));
  const out: WorkspaceLayout = {
    left,
    right,
    floats,
    leftW: clampW(Number(r.leftW) || d.leftW),
    rightW: clampW(Number(r.rightW) || d.rightW),
  };
  for (const p of missing) placeDefault(out, p);
  return out;
}

function clampW(v: number): number {
  return Math.round(Math.min(DOCK_LIMITS.max, Math.max(DOCK_LIMITS.min, v)));
}

/** Panelin "evi" — kapatıldıktan sonra yeniden açılınca buraya döner. */
const HOME: Record<PanelId, DockSide> = { layers: "left", text: "left", library: "left", scene: "right", device: "right", screens: "right" };

function placeDefault(l: WorkspaceLayout, p: PanelId): void {
  const side = HOME[p];
  const dock = l[side];
  if (dock.length) {
    const g = dock[dock.length - 1];
    g.tabs.push(p);
    g.active = p;
  } else {
    dock.push({ id: gid(), tabs: [p], active: p, flex: 1 });
  }
}

function read(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(l: WorkspaceLayout): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {
      /* localStorage kapalı olabilir */
    }
  }, 200);
}

/** Paneli bulunduğu yerden çıkarır; boşalan grup/pencere silinir. */
function detach(l: WorkspaceLayout, p: PanelId): void {
  for (const side of ["left", "right"] as DockSide[]) {
    for (const g of l[side]) {
      const i = g.tabs.indexOf(p);
      if (i < 0) continue;
      g.tabs.splice(i, 1);
      if (g.active === p) g.active = g.tabs[Math.max(0, i - 1)] ?? g.tabs[0];
    }
    l[side] = l[side].filter((g) => g.tabs.length > 0);
  }
  for (const f of l.floats) {
    const i = f.tabs.indexOf(p);
    if (i < 0) continue;
    f.tabs.splice(i, 1);
    if (f.active === p) f.active = f.tabs[Math.max(0, i - 1)] ?? f.tabs[0];
  }
  l.floats = l.floats.filter((f) => f.tabs.length > 0);
}

export function panelLocation(l: WorkspaceLayout, p: PanelId): { where: "left" | "right" | "float"; id: string; active: boolean } | null {
  for (const side of ["left", "right"] as DockSide[]) {
    const g = l[side].find((x) => x.tabs.includes(p));
    if (g) return { where: side, id: g.id, active: g.active === p };
  }
  const f = l.floats.find((x) => x.tabs.includes(p));
  return f ? { where: "float", id: f.id, active: f.active === p } : null;
}

type WorkspaceState = {
  layout: WorkspaceLayout;
  /** Sürüklenen sekme — dock'lar bırakma bölgelerini bu varken gösterir. */
  dragging: PanelId | null;
  hydrate: () => void;
  setDragging: (p: PanelId | null) => void;
  /** Paneli görünür ve etkin yapar (kapalıysa evine döner, yüzense öne gelir). */
  focus: (p: PanelId) => void;
  setActive: (groupId: string, p: PanelId) => void;
  close: (p: PanelId) => void;
  move: (p: PanelId, to: DropTarget) => void;
  moveFloat: (id: string, x: number, y: number) => void;
  resizeFloat: (id: string, w: number, h: number) => void;
  raiseFloat: (id: string) => void;
  dockFloat: (id: string, side: DockSide) => void;
  setDockWidth: (side: DockSide, w: number) => void;
  setFlex: (side: DockSide, index: number, flexA: number, flexB: number) => void;
  reset: () => void;
};

const mutateLayout = (fn: (l: WorkspaceLayout) => void) => (s: WorkspaceState) => {
  const l = structuredClone(s.layout);
  fn(l);
  persist(l);
  return { layout: l };
};

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  layout: defaultLayout(),
  dragging: null,
  hydrate: () => set({ layout: read() }),
  setDragging: (dragging) => set({ dragging }),
  focus: (p) =>
    set(
      mutateLayout((l) => {
        const loc = panelLocation(l, p);
        if (!loc) {
          placeDefault(l, p);
          return;
        }
        if (loc.where === "float") {
          const f = l.floats.find((x) => x.id === loc.id)!;
          f.active = p;
          f.z = Math.max(0, ...l.floats.map((x) => x.z)) + 1;
          return;
        }
        const g = l[loc.where].find((x) => x.id === loc.id)!;
        g.active = p;
      })
    ),
  setActive: (groupId, p) =>
    set(
      mutateLayout((l) => {
        for (const g of [...l.left, ...l.right, ...l.floats]) if (g.id === groupId && g.tabs.includes(p)) g.active = p;
      })
    ),
  close: (p) => set(mutateLayout((l) => detach(l, p))),
  move: (p, to) =>
    set(
      mutateLayout((l) => {
        // Hedef grubu KİMLİĞİYLE hatırla: detach boşalan grubu silince
        // indeksler kayar, kimlik kaymaz.
        const anchorId = to.kind === "group" || to.kind === "split" ? l[to.side][to.index]?.id : undefined;
        if (to.kind === "group") {
          const g = l[to.side][to.index];
          if (g && g.tabs.includes(p) && g.tabs.length === 1) return; // kendi üstüne
        }
        detach(l, p);
        if (to.kind === "group") {
          const dock = l[to.side];
          const g = dock.find((x) => x.id === anchorId);
          if (g) {
            g.tabs.push(p);
            g.active = p;
          } else dock.push({ id: gid(), tabs: [p], active: p, flex: 1 });
        } else if (to.kind === "split") {
          const dock = l[to.side];
          const at = anchorId ? dock.findIndex((x) => x.id === anchorId) : -1;
          dock.splice(at < 0 ? dock.length : at, 0, { id: gid(), tabs: [p], active: p, flex: 1 });
        } else if (to.kind === "floatTabs") {
          const f = l.floats.find((x) => x.id === to.id);
          if (f) {
            f.tabs.push(p);
            f.active = p;
          } else l.floats.push({ id: gid(), tabs: [p], active: p, x: 140, y: 100, w: 330, h: 480, z: 1 });
        } else {
          const z = Math.max(0, ...l.floats.map((x) => x.z)) + 1;
          l.floats.push({ id: gid(), tabs: [p], active: p, x: Math.max(8, to.x - 60), y: Math.max(52, to.y - 14), w: 330, h: 500, z });
        }
      })
    ),
  moveFloat: (id, x, y) =>
    set(
      mutateLayout((l) => {
        const f = l.floats.find((v) => v.id === id);
        if (!f) return;
        const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
        const vh = typeof window !== "undefined" ? window.innerHeight : 1000;
        f.x = Math.round(Math.min(vw - 80, Math.max(-f.w + 80, x)));
        f.y = Math.round(Math.min(vh - 40, Math.max(0, y)));
      })
    ),
  resizeFloat: (id, w, h) =>
    set(
      mutateLayout((l) => {
        const f = l.floats.find((v) => v.id === id);
        if (!f) return;
        f.w = Math.round(Math.max(260, Math.min(900, w)));
        f.h = Math.round(Math.max(200, Math.min(1400, h)));
      })
    ),
  raiseFloat: (id) => {
    const l = get().layout;
    const top = Math.max(0, ...l.floats.map((x) => x.z));
    const f = l.floats.find((x) => x.id === id);
    if (!f || f.z === top) return;
    set(
      mutateLayout((m) => {
        const g = m.floats.find((x) => x.id === id);
        if (g) g.z = top + 1;
      })
    );
  },
  dockFloat: (id, side) =>
    set(
      mutateLayout((l) => {
        const f = l.floats.find((x) => x.id === id);
        if (!f) return;
        l.floats = l.floats.filter((x) => x.id !== id);
        l[side].push({ id: gid(), tabs: f.tabs, active: f.active, flex: 1 });
      })
    ),
  setDockWidth: (side, w) => set(mutateLayout((l) => (side === "left" ? (l.leftW = clampW(w)) : (l.rightW = clampW(w))))),
  setFlex: (side, index, a, b) =>
    set(
      mutateLayout((l) => {
        const g1 = l[side][index];
        const g2 = l[side][index + 1];
        if (!g1 || !g2) return;
        g1.flex = Math.max(0.2, a);
        g2.flex = Math.max(0.2, b);
      })
    ),
  reset: () => {
    const l = defaultLayout();
    persist(l);
    set({ layout: l });
  },
}));

/** Kısa yol — bileşen dışından paneli öne getirmek için. */
export function focusPanel(p: PanelId): void {
  useWorkspace.getState().focus(p);
}
