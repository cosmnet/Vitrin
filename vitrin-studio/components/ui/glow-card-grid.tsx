"use client";

// 21st.dev'ten çekildi: `21st.dev/r/ncdai/glow-card-grid`.
// VITRIN UYARLAMASI: avatar/isim şablonu kaldırıldı; kart artık serbest
// içerik alır ve renk lekesi bir `blob` düğümüyle verilir (varsayılan:
// Klein #0512E8). Kenarlık `backdrop-filter` + mask-composite tekniğiyle
// imleci izlemeye devam eder — bu, bileşenin özgün fikri.
// Ayrıca özgün kart `container-type: size` + sabit `h-52` ile geliyordu;
// burada kartlar içeriğe göre büyüdüğü için `inline-size`a çevrildi ve
// dikey öteleme `cqh` yerine `cqi` üzerinden hesaplanıyor.

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type GlowCardGridProps = React.ComponentPropsWithoutRef<"div"> & {
  cardRadius?: number;

  blobBlur?: number;
  blobSaturate?: number;
  blobBrightness?: number;
  blobScale?: number;
  blobOpacity?: number;

  borderWidth?: number;
  borderBlur?: number;
  borderSaturate?: number;
  borderBrightness?: number;
  borderContrast?: number;

  children: React.ReactNode;
};

export function GlowCardGrid({
  cardRadius = 18,

  blobBlur = 34,
  blobSaturate = 4.4,
  blobBrightness = 1.25,
  blobScale = 3.2,
  blobOpacity = 0.42,

  borderWidth = 1.5,
  borderBlur = 8,
  borderSaturate = 4.6,
  borderBrightness = 2.6,
  borderContrast = 2.2,

  className,
  style,
  ...props
}: GlowCardGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let frame = 0;
    let last: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const event = last;
      if (!event || !gridRef.current) return;

      const cards = gridRef.current.querySelectorAll<HTMLElement>(
        "[data-slot='glow-card']"
      );

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const x = (event.clientX - centerX) / (rect.width / 2);
        const y = (event.clientY - centerY) / (rect.height / 2);

        card.style.setProperty("--pointer-x", x.toFixed(3));
        card.style.setProperty("--pointer-y", y.toFixed(3));
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      last = event;
      if (frame === 0) frame = requestAnimationFrame(apply);
    };

    document.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={gridRef}
      className={cn("grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}
      style={
        {
          "--card-radius": `${cardRadius}px`,
          "--card-blob-blur": `${blobBlur}px`,
          "--card-blob-saturate": blobSaturate,
          "--card-blob-brightness": blobBrightness,
          "--card-blob-scale": blobScale,
          "--card-blob-opacity": blobOpacity,
          "--card-border-width": `${borderWidth}px`,
          "--card-border-blur": `${borderBlur}px`,
          "--card-border-saturate": borderSaturate,
          "--card-border-brightness": borderBrightness,
          "--card-border-contrast": borderContrast,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export type GlowCardProps = {
  /** Kartın renk lekesi — Klein varsayılan. */
  blob?: string;
  className?: string;
  children: React.ReactNode;
};

export function GlowCard({
  blob = "#0512e8",
  className,
  children,
}: GlowCardProps) {
  return (
    <div
      data-slot="glow-card"
      className={cn(
        "@container group relative w-full overflow-hidden rounded-(--card-radius)",
        "bg-ink-2/70 ring-1 ring-inset ring-hairline",
        "transition-[translate,box-shadow] duration-[320ms] ease-vitrin",
        "hover:-translate-y-1",
        className
      )}
    >
      <div className="flex size-full overflow-hidden rounded-(--card-radius) [clip-path:inset(0_round_var(--card-radius))]">
        {/* imleci ters yönde izleyen renk lekesi */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center",
            "translate-x-[calc(var(--pointer-x,-1.4)*50cqi)] translate-y-[calc(var(--pointer-y,-1.4)*34cqi)] translate-z-0 scale-(--card-blob-scale)",
            "blur-(--card-blob-blur) brightness-(--card-blob-brightness) saturate-(--card-blob-saturate)",
            "opacity-(--card-blob-opacity) will-change-[transform,filter]"
          )}
        >
          <span
            className="size-24 rounded-full"
            style={{
              background: `radial-gradient(closest-side, ${blob} 0%, ${blob}00 100%)`,
            }}
          />
        </div>

        <div className="relative z-1 flex flex-1 flex-col">{children}</div>
      </div>

      {/* lekeyi yakalayıp parlayan kenarlık */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 translate-z-0 rounded-(--card-radius)",
          "border-(length:--card-border-width) border-solid border-transparent",
          "backdrop-blur-(--card-border-blur) backdrop-brightness-(--card-border-brightness) backdrop-contrast-(--card-border-contrast) backdrop-saturate-(--card-border-saturate)",
          "[clip-path:inset(0_round_var(--card-radius))]"
        )}
        style={
          {
            maskImage:
              "linear-gradient(#fff 0 100%), linear-gradient(#fff 0 100%)",
            maskOrigin: "border-box, padding-box",
            maskClip: "border-box, padding-box",
            maskComposite: "exclude",
            WebkitMaskComposite: "xor",
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export default GlowCardGrid;
