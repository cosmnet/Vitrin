"use client";

// Vitrin Studio — ThreeUI efekt kataloğu (SABİT KONTRAT).
//
// Buradaki dört export'un adı ve prop'ları arayüz ajanı için sabittir;
// değiştirme. Altındaki bileşenler vendor/threeui içinden BİREBİR gelir
// (bkz. scripts/unpack-threeui.mjs) — burada sadece sarmalanır, kopyalanmaz.
//
// Ortak davranış:
//   · hepsi "use client"; vendor bileşenleri ssr:false dynamic ile yüklenir,
//     yani sunucuda hiç çalışmaz (WebGL/iframe/ResizeObserver kullanıyorlar).
//   · IntersectionObserver + document.visibilitychange ile görünmeyen efekt
//     UNMOUNT edilir; rAF döngüsü, WebGL bağlamı ve iframe tamamen kapanır.

import dynamic from "next/dynamic";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import "./fx.css";

/* ------------------------------------------------------------------ *
   Vendor bileşenleri — hepsi ssr:false, hepsi ayrı chunk.
 * ------------------------------------------------------------------ */

const PredictiveArcCanvas = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/predictive-arc/PredictiveArcCanvas").then(
      (m) => m.PredictiveArcCanvas,
    ),
  { ssr: false },
);

const CrtBackground = dynamic(
  () => import("@/vendor/threeui/src/shaders/crt/CrtBackground").then((m) => m.CrtBackground),
  { ssr: false },
);

const ElementsBackground = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/elements/ElementsBackground").then(
      (m) => m.ElementsBackground,
    ),
  { ssr: false },
);

const MatrixField = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/neuform-isolated/NeuformBatchEffects").then(
      (m) => m.MatrixField,
    ),
  { ssr: false },
);

const CloudField = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/neuform-isolated/NeuformIsolatedEffects").then(
      (m) => m.CloudField,
    ),
  { ssr: false },
);

const ThreeUIIntro = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/neuform-isolated/NeuformIsolatedEffects").then(
      (m) => m.ThreeUIIntro,
    ),
  { ssr: false },
);

const LiquidMetalButton = dynamic(
  () =>
    import("@/vendor/threeui/src/shaders/liquid-metal-button/LiquidMetalButton").then(
      (m) => m.LiquidMetalButton,
    ),
  { ssr: false },
);

/* ------------------------------------------------------------------ *
   Görünürlük kapısı
 * ------------------------------------------------------------------ */

/** Görünür VE sekme öndeyken true. Aksi halde çocuk unmount edilir. */
function useVisible(ref: React.RefObject<HTMLElement | null>, rootMargin = "160px") {
  const [inView, setInView] = useState(false);
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? true),
      { rootMargin },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  useEffect(() => {
    const sync = () => setAwake(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return inView && awake;
}

/* ------------------------------------------------------------------ *
   FxBackdrop
 * ------------------------------------------------------------------ */

export type FxEffect =
  | "predictive-arc"
  | "cloud-field"
  | "matrix-field"
  | "crt-terminal"
  | "flame"
  | "water";

/** Katalogdaki efekt kimlikleri — UI'da liste kurmak için. */
export const FX_EFFECTS: readonly FxEffect[] = [
  "predictive-arc",
  "cloud-field",
  "matrix-field",
  "crt-terminal",
  "flame",
  "water",
] as const;

/** İnsan okunur adlar + hangi ThreeUI bundle'ından geldiği. */
export const FX_EFFECT_INFO: Record<
  FxEffect,
  { label: string; bundle: string; supportsSpeed: boolean; needsNetwork: boolean }
> = {
  "predictive-arc": {
    label: "Predictive Arc",
    bundle: "predictive-arc",
    supportsSpeed: true,
    needsNetwork: false,
  },
  "cloud-field": {
    label: "Strata Cloud",
    bundle: "cloud-field",
    supportsSpeed: false, // vendor bileşeninde speed prop'u yok
    needsNetwork: true, // iframe içi tailwind/gsap/fonts CDN'den
  },
  "matrix-field": {
    label: "Matrix Field",
    bundle: "matrix-field",
    supportsSpeed: true,
    needsNetwork: true,
  },
  "crt-terminal": {
    label: "CRT Terminal",
    bundle: "crt",
    supportsSpeed: true,
    needsNetwork: false,
  },
  flame: {
    label: "Elemental Flame",
    bundle: "elemental-flame",
    supportsSpeed: true,
    needsNetwork: false,
  },
  water: {
    label: "Elemental Water",
    bundle: "elemental-water",
    supportsSpeed: true,
    needsNetwork: false,
  },
};

export type FxBackdropProps = {
  effect: FxEffect;
  className?: string;
  /** 0..3 — animasyon hızı. cloud-field bu prop'u desteklemiyor. */
  speed?: number;
  /** -180..180 derece hue-rotate. */
  hue?: number;
  /** 0.35..1.65 parlaklık çarpanı. */
  brightness?: number;
  /** 0..1 katman opaklığı. */
  opacity?: number;
};

const LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

/**
 * Bir ThreeUI efektini mutlak konumlu, tıklanamaz bir arka plan katmanı
 * olarak basar. Katman ekrandan çıkınca (ya da sekme arkaya alınınca)
 * efekt unmount edilir; geri girince yeniden kurulur.
 *
 * Kullanım: konumlandırılmış (position: relative) bir kabın içine koy.
 */
export function FxBackdrop({
  effect,
  className,
  speed = 1,
  hue = 0,
  brightness = 1,
  opacity = 1,
}: FxBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(hostRef);

  // Vendor kökleri pointer-events'i kendi set edebiliyor (elements "auto"),
  // bu yüzden katman kuralını çocuğa da geçiriyoruz.
  const childStyle: CSSProperties = { pointerEvents: "none" };

  let child: ReactNode = null;
  if (visible) {
    switch (effect) {
      case "predictive-arc":
        child = <PredictiveArcCanvas speed={speed} hue={hue} brightness={brightness} />;
        break;
      case "cloud-field":
        // NeuformIsolatedEffectProps'ta speed yok — hız sabit.
        child = <CloudField hue={hue} brightness={brightness} style={childStyle} />;
        break;
      case "matrix-field":
        child = (
          <MatrixField speed={speed} hue={hue} brightness={brightness} style={childStyle} />
        );
        break;
      case "crt-terminal":
        child = (
          <CrtBackground variant="terminal" speed={speed} hue={hue} brightness={brightness} />
        );
        break;
      case "flame":
        // Vendor varyant adı "fire".
        child = (
          <ElementsBackground
            variant="fire"
            speed={speed}
            hue={hue}
            brightness={brightness}
            style={childStyle}
          />
        );
        break;
      case "water":
        child = (
          <ElementsBackground
            variant="water"
            speed={speed}
            hue={hue}
            brightness={brightness}
            style={childStyle}
          />
        );
        break;
    }
  }

  return (
    <div
      ref={hostRef}
      className={className}
      data-fx={effect}
      data-fx-state={visible ? "running" : "paused"}
      aria-hidden="true"
      style={{ ...LAYER, opacity }}
    >
      {child}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   GlassButton — rectangle-buttons "dark-pill" (Dark Glass)
 * ------------------------------------------------------------------ */

export type GlassButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit";
  /** Erişilebilirlik etiketi — görsel etiket ikon ağırlıklıysa şart. */
  "aria-label"?: string;
  /** Tarayıcı ipucu balonu. */
  title?: string;
};

/**
 * Dark Glass hap butonu — gerçek <button>.
 *
 * Görsel katman tamamen vendor'ın: markup ThreeUI SectionElements'teki
 * SectionButton ile birebir aynı (.section-button + __title + __circle) ve
 * tüm stil components/fx/fx.css'te toplanan section-elements.css'ten geliyor.
 * Vendor bileşeni etiketi ("Sign up") ve tıklamayı sabitlediği, children /
 * onClick / disabled almadığı için burada aynı iskelet prop'lara bağlandı.
 *
 * Boyutlar vendor'ın 52px "md" ölçüsünü referans alır; sm/lg aynı oranla
 * inline override edilir (container-query'li section kabı burada yok).
 */
const GLASS_SIZES: Record<NonNullable<GlassButtonProps["size"]>, CSSProperties> = {
  sm: { height: 40, padding: "0 22px", fontSize: 13, borderRadius: 999 },
  md: { height: 52, padding: "0 32px", fontSize: 14, borderRadius: 999 },
  lg: { height: 62, padding: "0 42px", fontSize: 16, borderRadius: 999 },
};

export function GlassButton({
  children,
  onClick,
  disabled = false,
  size = "md",
  type = "button",
  "aria-label": ariaLabel,
  title,
}: GlassButtonProps) {
  return (
    <button
      className="section-button"
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-size={size}
      aria-label={ariaLabel}
      title={title}
      style={{
        ...GLASS_SIZES[size],
        fontFamily:
          '"Section SF", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="section-button__title">{children}</span>
      <span className="section-button__circle" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ *
   LiquidOrb — liquid-metal-button "circle"
 * ------------------------------------------------------------------ */

export type LiquidOrbProps = {
  /** Kare kabın kenarı (px). Vendor orb'u kabın vmin'ine göre ölçekler. */
  size?: number;
  onClick?: () => void;
  /** Erişilebilirlik etiketi — verilirse orb ekran okuyucuya görünür olur. */
  "aria-label"?: string;
  /** Tarayıcı ipucu balonu. */
  title?: string;
};

/**
 * Liquid Metal dairesel buton. Vendor bileşeni sandbox'lı bir iframe içinde
 * çalışır; tıklama iframe'den postMessage köprüsüyle gelir, o yüzden onClick
 * bir DOM olayı değil — köprü mesajı.
 */
export function LiquidOrb({
  size = 140,
  onClick,
  "aria-label": ariaLabel,
  title,
}: LiquidOrbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(hostRef, "80px");

  return (
    <div
      ref={hostRef}
      // Etiket verilmediyse orb salt dekoratiftir; ekran okuyucu atlasın.
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel && onClick ? "button" : undefined}
      title={title}
      style={{ width: size, height: size, position: "relative" }}
    >
      {visible ? <LiquidMetalButton variant="circle" embedded onClick={onClick} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   IntroWordmark — threeui-intro
 * ------------------------------------------------------------------ */

/**
 * Açılış / boş durum wordmark'ı (ThreeUI creator-studio-intro).
 * Kabını tamamen doldurur — çağıran taraf boyutlandırır.
 * Kontrat gereği prop almaz.
 */
export function IntroWordmark() {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(hostRef);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        pointerEvents: "none",
      }}
    >
      {visible ? <ThreeUIIntro style={{ pointerEvents: "none" }} /> : null}
    </div>
  );
}
