"use client";

// Paylaşılan arayüz parçaları — katlanır bölümler, 28px satırlar, segmented
// control, toggle, swatch satırı, slider ve ikon seti (1.5px stroke, inline
// SVG). Ayrıca renderRev: tema nesnesi yerinde düzenlenince (ör. overlay
// şiddeti) canvas önizlemelerini tazelemek için minik yayın-abone sayacı.
//
// UI v3 (R7/W3): Inspector artık 2 sekme + katlanır bölüm. Bölüm gövdesi
// `grid-template-rows: 0fr → 1fr` ile açılır (JS ölçüm yok, yükseklikten
// bağımsız); açık/kapalı durumu localStorage'da yaşar.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { api } from "@/lib/client";
import { beginUndoGesture, breakUndoCoalescing, endUndoGesture } from "@/store/studio";
import { L } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
   renderRev — store dışı görsel durum değişimlerini duyurur
 * ------------------------------------------------------------------ */

let rev = 0;
const subs = new Set<() => void>();

/** Tema (in-memory) düzenlendi — önizleme canvas'ları yeniden çizilsin. */
export function bumpRenderRev(): void {
  rev++;
  for (const f of subs) f();
}

/** Abone ol; bump'ta bileşen yeniden render edilir. */
export function useRenderRev(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => rev,
    () => 0
  );
}

/* ------------------------------------------------------------------ *
   Asset envanteri — /api/assets tek sefer okunur, tüm paneller paylaşır.
 * ------------------------------------------------------------------ */

export type AssetList = {
  bg: string[];
  models: string[];
  generated: string[];
  textures: string[];
  plates2: string[];
};

export const EMPTY_ASSETS: AssetList = {
  bg: [],
  models: [],
  generated: [],
  textures: [],
  plates2: [],
};

let assetCache: AssetList | null = null;
let assetPromise: Promise<AssetList> | null = null;

function fetchAssets(): Promise<AssetList> {
  if (assetCache) return Promise.resolve(assetCache);
  if (!assetPromise) {
    assetPromise = api<Partial<AssetList>>("/api/assets")
      .then((a) => {
        assetCache = { ...EMPTY_ASSETS, ...a };
        return assetCache;
      })
      .catch(() => EMPTY_ASSETS);
  }
  return assetPromise;
}

/** public/assets envanteri (bg, textures, generated, plates2, models). */
export function useAssets(): AssetList {
  const [assets, setAssets] = useState<AssetList>(assetCache ?? EMPTY_ASSETS);
  useEffect(() => {
    let dead = false;
    fetchAssets().then((a) => {
      if (!dead) setAssets(a);
    });
    return () => {
      dead = true;
    };
  }, []);
  return assets;
}

/* ------------------------------------------------------------------ *
   İkon seti — 24 viewBox, stroke 1.5, currentColor
 * ------------------------------------------------------------------ */

export type IconName =
  | "sliders"
  | "text"
  | "image"
  | "palette"
  | "grid"
  | "layers"
  | "phone"
  | "type"
  | "sparkle"
  | "chevron"
  | "up"
  | "down"
  | "copy"
  | "trash"
  | "plus"
  | "wand"
  | "globe"
  | "cube"
  | "rotate"
  | "download"
  | "folder"
  | "move"
  | "reset"
  | "x"
  | "undo"
  | "redo"
  | "save"
  | "sun"
  | "film"
  | "frame"
  | "zoom"
  | "check"
  | "plate"
  | "search"
  | "lock"
  | "paste"
  | "link"
  | "right"
  | "left"
  | "hand"
  | "brush"
  | "dropper"
  | "list"
  | "eye"
  | "eyeOff"
  | "crop";

const PATHS: Record<IconName, ReactNode> = {
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="m3 3 18 18M9.5 5.3A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6 6.3A17 17 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 4-0.8"/></>,
  crop: <><path d="M7 2v15h15M2 7h15v15M7 7h10"/></>,
  text: (
    <>
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17.5 10 12l4 4 2.5-2.5 3 3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-.9 1.4-1.9-.6-1.2-.1-2.6 1.5-2.6h1.8a3.7 3.7 0 0 0 3.8-3.8C20.2 7 16.5 3.5 12 3.5Z" />
      <circle cx="8" cy="10" r="1" />
      <circle cx="12" cy="7.5" r="1" />
      <circle cx="16" cy="10" r="1" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.8 8 4.4-8 4.4-8-4.4 8-4.4Z" />
      <path d="m4 12.4 8 4.4 8-4.4" />
      <path d="m4 16.2 8 4.4 8-4.4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.6" />
      <path d="M10.5 5h3" />
    </>
  ),
  type: (
    <>
      <path d="M5 8V5.5h14V8" />
      <path d="M12 5.5V19" />
      <path d="M9.5 19h5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4c.6 3.4 2.6 5.4 6 6-3.4.6-5.4 2.6-6 6-.6-3.4-2.6-5.4-6-6 3.4-.6 5.4-2.6 6-6Z" />
      <path d="M18.5 15.5c.3 1.5 1.2 2.4 2.7 2.7-1.5.3-2.4 1.2-2.7 2.7-.3-1.5-1.2-2.4-2.7-2.7 1.5-.3 2.4-1.2 2.7-2.7Z" />
    </>
  ),
  chevron: <path d="m8.5 10 3.5 4 3.5-4" />,
  up: <path d="M12 19V5m0 0-5 5m5-5 5 5" />,
  down: <path d="M12 5v14m0 0 5-5m-5 5-5-5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
      <path d="M6.5 6.5 7.4 19a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6l.9-12.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  wand: (
    <>
      <path d="m5 19 10.5-10.5" />
      <path d="M15.5 8.5 17 7" />
      <path d="M18.5 3.5v2m0 3v-1m1.5-1.5h2m-5 0h1" />
      <path d="M6 5v2M5 6h2" />
      <path d="M18 15v2m-1 -1h2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" />
    </>
  ),
  cube: (
    <>
      <path d="m12 3.5 7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8L12 3.5Z" />
      <path d="M12 12 4.5 7.8M12 12l7.5-4.2M12 12v8.5" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 3.5V7h-3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
      <path d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5" />
    </>
  ),
  folder: (
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18v-11.5Z" />
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 5.5 3-2.5 3 2.5M9 18.5l3 2.5 3-2.5M5.5 9 3 12l2.5 3M18.5 9l2.5 3-2.5 3" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 3.5V7h3.5" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  undo: (
    <>
      <path d="M4 9h11a5 5 0 0 1 0 10H9" />
      <path d="M7.5 5.5 4 9l3.5 3.5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9H9a5 5 0 0 0 0 10h6" />
      <path d="M16.5 5.5 20 9l-3.5 3.5" />
    </>
  ),
  save: (
    <>
      <path d="M5 4.5h11L19.5 8v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V6A1.5 1.5 0 0 1 6 4.5Z" />
      <path d="M8 4.5v5h7v-5" />
      <path d="M8 20.5v-6h8v6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M8.5 5.5v13M15.5 5.5v13" />
    </>
  ),
  frame: (
    <>
      <path d="M7.5 3.5v17M16.5 3.5v17M3.5 7.5h17M3.5 16.5h17" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
      <path d="M8.5 11h5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  plate: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <rect x="9.5" y="7.5" width="5" height="9" rx="1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3.5h6V5" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  right: <path d="M5 12h13m0 0-5-5m5 5-5 5" />,
  left: <path d="M19 12H6m0 0 5-5m-5 5 5 5" />,
  hand: (
    <>
      <path d="M8 11V6.2a1.6 1.6 0 0 1 3.2 0V11" />
      <path d="M11.2 10.4V5.4a1.6 1.6 0 0 1 3.2 0V11" />
      <path d="M14.4 11V7.6a1.6 1.6 0 0 1 3.2 0v6.6a6.4 6.4 0 0 1-6.4 6.4h-.6a5 5 0 0 1-4.2-2.4L4 14.5a1.6 1.6 0 0 1 2.6-1.8L8 14.4V11" />
    </>
  ),
  brush: (
    <>
      <path d="M14 4.5 19.5 10 10 19.5H4.5V14L14 4.5Z" />
      <path d="m11.5 7 5.5 5.5" />
    </>
  ),
  dropper: (
    <>
      <path d="m16.5 3.5 4 4-2 2-4-4 2-2Z" />
      <path d="m13.8 6.2 4 4-8.3 8.3-4.5.5.5-4.5 8.3-8.3Z" />
    </>
  ),
  list: <path d="M4.5 7h15M4.5 12h15M4.5 17h9" />,
  sliders: <><path d="M4 7h9m4 0h3M4 12h3m4 0h9M4 17h11m4 0h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></>,
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}


/* ------------------------------------------------------------------ *
   Section — katlanır Inspector bölümü (rapor §4)

   Gövde `grid-template-rows: 0fr → 1fr` ile açılır: yükseklik ölçen JS
   yok, içerik değişince zıplama yok. Açık/kapalı durumu localStorage'da
   ("vitrin:ui:sec") bölüm anahtarı başına saklanır.
 * ------------------------------------------------------------------ */

const SEC_KEY = "vitrin:ui:sec:v4";

function readSecState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SEC_KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

let secCache: Record<string, boolean> | null = null;

function secOpen(id: string, fallback: boolean): boolean {
  if (secCache === null) secCache = typeof localStorage === "undefined" ? {} : readSecState();
  return secCache[id] ?? fallback;
}

function secWrite(id: string, open: boolean): void {
  if (secCache === null) secCache = {};
  secCache[id] = open;
  try {
    localStorage.setItem(SEC_KEY, JSON.stringify(secCache));
  } catch {
    /* localStorage kapalı olabilir */
  }
}

export function Section({
  id,
  title,
  hint,
  children,
  defaultOpen = true,
}: {
  /** localStorage anahtarı — sekmeler arası çakışmasın diye "tasarim.metin" gibi. */
  id: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => secOpen(id, defaultOpen));
  const toggle = () => {
    setOpen((o) => {
      secWrite(id, !o);
      return !o;
    });
  };
  return (
    <section className={`sec ${open ? "open" : ""}`}>
      <button type="button" className="sec-head" onClick={toggle} aria-expanded={open}>
        <h3>{title}</h3>
        {hint !== undefined && hint !== null && hint !== "" && <span className="hint">{hint}</span>}
        <Icon name="chevron" size={14} className="chev" />
      </button>
      <div className="sec-wrap">
        <div className="sec-inner">
          <div className="sec-body">{open ? children : null}</div>
        </div>
      </div>
    </section>
  );
}

/** GELİŞMİŞ açılımı — ileri kontroller varsayılan olarak kapalı (rapor §8). */
export function Advanced({
  id,
  label = L("Gelişmiş", "Advanced"),
  children,
}: {
  id: string;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => secOpen(`adv.${id}`, false));
  return (
    <div className={`adv ${open ? "open" : ""}`}>
      <button
        type="button"
        className="adv-head"
        aria-expanded={open}
        onClick={() =>
          setOpen((o) => {
            secWrite(`adv.${id}`, !o);
            return !o;
          })
        }
      >
        <Icon name="chevron" size={12} className={open ? "" : "chev-c"} />
        {label}
      </button>
      <div className="adv-wrap">
        <div className="adv-inner">
          <div className="adv-body">{open ? children : null}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   GlassCard — eski katlanır kart. Sekme dışı yüzeyler (test sayfaları)
   hâlâ çağırabilsin diye korunur; UI v3 kabuğu Section kullanır.
 * ------------------------------------------------------------------ */

export function GlassCard({
  icon,
  title,
  children,
  defaultOpen = true,
  hint,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`gcard ${open ? "open" : ""}`}>
      <button className="gcard-head" onClick={() => setOpen(!open)} type="button">
        <span className="gcard-ic">
          <Icon name={icon} size={14} />
        </span>
        <h3>{title}</h3>
        {hint && <span className="gcard-hint">{hint}</span>}
        <Icon name="chevron" size={14} className={`chev ${open ? "rot" : ""}`} />
      </button>
      {open && <div className="gcard-body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ *
   PanelTabs — 2 sekmeli şerit (TASARIM | SAHNE). Mono künye, aktifin
   altında KEMİK bant: Klein kotası tuval/film şeridi/palete ayrıldı.
 * ------------------------------------------------------------------ */

export type PanelTab<T extends string> = { id: T; label: string };

export function PanelTabs<T extends string>({
  value,
  tabs,
  onChange,
  compact = false,
}: {
  value: T;
  tabs: PanelTab<T>[];
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div className={`ptabs ${compact ? "compact" : ""}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          title={t.label}
          className={`ptab ${t.id === value ? "on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Row — 28px satır, 88px etiket kolonu (rapor §4 ölçüsü)
 * ------------------------------------------------------------------ */

export function Row({
  label,
  children,
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="r28" title={title}>
      <span className="lb">{label}</span>
      <span className="ct">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Segmented — 2D/3D gibi ikili/üçlü seçimler (dropdown yerine)
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`seg-item ${o.value === value ? "on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Toggle — bant anahtarı
 * ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------ *
   Swatches — hızlı renk satırı + serbest seçici + damlalık + son renkler

   R8/W4 (B-7.1/7.2/7.3): panelde renk giren TEK bileşen burasıdır, o
   yüzden iki kazanç da tek yerde:

   · DAMLALIK — Chrome'un `EyeDropper` API'si (ekranın tamamından renk
     emer, bizim tuvalimiz dahil). API yoksa düğme HİÇ çizilmez, çünkü
     çalışmayan bir düğme yanlış söz verir.
   · SON 8 RENK — ikinci sıra. Bu bir KULLANICI TERCİHİDİR, tasarım değil:
     localStorage'da yaşar, proje JSON'una asla girmez, dillere yayılmaz.
     Yazım geciktirilir (700 ms): renk seçicide sürükleme onlarca ara ton
     üretir, hepsi listeye girse liste tek jestte dolardı.
 * ------------------------------------------------------------------ */

const RECENT_KEY = "vitrin:ui:recent-colors";
const RECENT_MAX = 8;

let recentCache: string[] | null = null;
const recentSubs = new Set<() => void>();
let recentTimer: ReturnType<typeof setTimeout> | null = null;

function readRecent(): string[] {
  if (recentCache) return recentCache;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as unknown;
    recentCache = Array.isArray(raw)
      ? raw.filter((c): c is string => typeof c === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    recentCache = [];
  }
  return recentCache;
}

/** Rengi son-kullanılanların başına taşır (tekrar yok, en fazla 8). */
export function rememberColor(color: string): void {
  const c = String(color || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return;
  const cur = readRecent();
  if (cur[0] === c) return;
  recentCache = [c, ...cur.filter((x) => x.toLowerCase() !== c)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache));
  } catch {
    /* localStorage kapalı olabilir */
  }
  for (const f of recentSubs) f();
}

/** Sürükleme bitene kadar bekler — tek jest listeyi doldurmasın. */
function rememberSoon(color: string): void {
  if (recentTimer) clearTimeout(recentTimer);
  recentTimer = setTimeout(() => rememberColor(color), 700);
}

function useRecentColors(): string[] {
  return useSyncExternalStore(
    (cb) => {
      recentSubs.add(cb);
      return () => recentSubs.delete(cb);
    },
    () => readRecent(),
    () => (recentCache ??= [])
  );
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Tarayıcı damlalığı destekliyor mu (Chrome/Edge 95+). */
function eyeDropperCtor(): EyeDropperCtor | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof c === "function" ? c : null;
}

export function Swatches({
  value,
  colors,
  onChange,
  recent = true,
}: {
  value: string;
  colors: string[];
  onChange: (c: string) => void;
  /** Son kullanılan renkler satırı (vars. açık). */
  recent?: boolean;
}) {
  const recents = useRecentColors();
  // Kurulumdan sonra bak: sunucu HTML'i ile ilk istemci render'ı aynı kalsın.
  const [dropper, setDropper] = useState<EyeDropperCtor | null>(null);
  useEffect(() => setDropper(() => eyeDropperCtor()), []);

  const pick = (c: string) => {
    onChange(c);
    rememberColor(c);
  };
  const same = (c: string) => c.toLowerCase() === String(value || "").toLowerCase();

  const suck = async () => {
    if (!dropper) return;
    try {
      const r = await new dropper().open();
      if (r?.sRGBHex) pick(r.sRGBHex);
    } catch {
      /* kullanıcı ESC ile vazgeçti — sessiz */
    }
  };

  return (
    // Kolon sarmalayıcı: `Row`un `.ct`si flex satırdır, sarmalayıcı olmadan
    // "son renkler" ikinci satır DEĞİL, çiplerin sağına düşerdi.
    <div className="swatch-col">
      <div className="swatches">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${same(c) ? "on" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => pick(c)}
          />
        ))}
        <span className="swatch pick" title={L("Serbest renk", "Custom color")}>
          <input
            type="color"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              rememberSoon(e.target.value);
            }}
          />
        </span>
        {dropper && (
          <button
            type="button"
            className="swatch dropper"
            title={L("Damlalık — ekrandan renk em", "Eyedropper — pick a color from the screen")}
            onClick={suck}
          >
            <Icon name="dropper" size={11} />
          </button>
        )}
      </div>
      {recent && recents.length > 0 && (
        <div className="swatches recent" title={L("Son kullanılan renkler", "Recently used colors")}>
          {recents.map((c) => (
            <button
              key={`r-${c}`}
              type="button"
              className={`swatch sm ${same(c) ? "on" : ""}`}
              style={{ background: c }}
              title={c}
              onClick={() => pick(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   ProgressGrid — slayt başına dolan KESİKLİ IZGARA (R8/W4 · C37)

   Düz bir bant "ne kadar kaldı" der; ızgara "kaç kare bitti" der. Her
   hücre bir render'dır: sırada olan kesik konturlu, biten asit dolgulu.
   Sayı çok büyürse (matris koşusu) hücre 4px'e iner, ızgara yine okunur.
 * ------------------------------------------------------------------ */

export function ProgressGrid({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: ReactNode;
}) {
  const n = Math.max(1, Math.min(total, 240));
  const pct = Math.round((done / Math.max(1, total)) * 100);
  const cell = n > 96 ? 5 : n > 48 ? 8 : n > 24 ? 12 : 16;
  return (
    <div className="pgrid-wrap">
      <div
        className="pgrid"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))` }}
      >
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className={`pcell ${i < done ? "on" : ""}`} style={{ height: cell }} />
        ))}
      </div>
      {label !== undefined && (
        <p className="kunye pgrid-lb">
          <b>{pct}%</b> · {label}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   SliderRow — 28px satır: etiket · range · sürtme-scrub sayı

   Sayı alanı yatay sürüklenerek değiştirilir (Framer/Figma "scrub"
   davranışı): kaba ayar slider'da, hassas ayar sayıda.

   R8/W1 (C15/C16/C20):
     · ÇİFT TIK → varsayılan (`defaultValue` verilmişse). Etiket ya da sayı
       üzerinde; `Divider`'ın (panels.tsx) jesti ile birebir aynı.
     · ⌥ = KABA kademe (span/60), ⇧ = hassas (span/960), çıplak = span/240.
     · Bir sürükleme = BİR geri alma adımı. pointerdown'da jest açılır,
       pointerup'ta kapanır (store'daki begin/endUndoGesture); arada kaç
       `updateSlide` koşarsa koşsun ⌘Z jestin tamamını geri alır. Yavaş
       sürüklemede 550ms'lik katlama penceresinin kapanması artık jesti
       bölmüyor.
 * ------------------------------------------------------------------ */

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  defaultValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** Çift tıkta dönülecek değer. Verilmezse çift tık jesti kapalıdır. */
  defaultValue?: number;
}) {
  const [scrub, setScrub] = useState(false);
  const drag = useRef<{ x: number; v: number } | null>(null);

  const clampStep = useCallback(
    (v: number) => {
      const snapped = Math.round(v / step) * step;
      // step 0.02 gibi ondalıklarda kayan nokta artığını temizle
      const dec = (String(step).split(".")[1] || "").length;
      return Number(Math.min(max, Math.max(min, snapped)).toFixed(dec));
    },
    [min, max, step]
  );

  const down = (e: React.PointerEvent) => {
    beginUndoGesture(); // sürükleme boyunca TEK anlık görüntü
    drag.current = { x: e.clientX, v: value };
    setScrub(true);
    // Yakalama BAŞARISIZ olabilir (etkin olmayan pointer id → NotFoundError);
    // scrub yine de çalışsın diye jestten SONRA ve korumalı.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* yakalamasız devam */
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const span = max - min;
    // 240px sürükleme = tam aralık; ⌥ kaba (4× hızlı), ⇧ hassas (4× yavaş)
    const per = span / (e.altKey ? 60 : e.shiftKey ? 960 : 240);
    onChange(clampStep(drag.current.v + (e.clientX - drag.current.x) * per));
  };
  const up = (e: React.PointerEvent) => {
    drag.current = null;
    setScrub(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* zaten bırakılmış */
    }
    endUndoGesture(); // jest kapandı → geçmişe tek adım
  };

  const canReset = defaultValue !== undefined;
  const reset = () => {
    if (defaultValue === undefined) return;
    // Sıfırlama AYRI bir kalem: az önceki sürüklemeyle aynı adıma katlanmasın.
    breakUndoCoalescing();
    onChange(clampStep(defaultValue));
    breakUndoCoalescing();
  };

  const hint = canReset
    ? L(`Sürükle: ⇧ hassas · ⌥ kaba · çift tık: varsayılan (${
        format ? format(defaultValue as number) : defaultValue
      })`, `Drag: ⇧ fine · ⌥ coarse · double-click: default (${
        format ? format(defaultValue as number) : defaultValue
      })`)
    : L("Sürükleyerek değiştir (⇧ hassas · ⌥ kaba)", "Drag to change (⇧ fine · ⌥ coarse)");

  return (
    <div className="r28">
      <span
        className={`lb ${canReset ? "dbl" : ""}`}
        title={canReset ? hint : undefined}
        onDoubleClick={canReset ? reset : undefined}
      >
        {label}
      </span>
      <span className="ct">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onPointerDown={beginUndoGesture}
          onPointerUp={endUndoGesture}
          onPointerCancel={endUndoGesture}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span
          className={`num ${scrub ? "scrub" : ""}`}
          title={hint}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={canReset ? reset : undefined}
        >
          {format ? format(value) : String(value)}
        </span>
      </span>
    </div>
  );
}
