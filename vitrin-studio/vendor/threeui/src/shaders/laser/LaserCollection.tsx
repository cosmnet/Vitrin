// ThreeUI kaynağı — vendor/threeui-bundles/*.json içinden BİREBİR açıldı.
// kaynak  : src/shaders/laser/LaserCollection.tsx
// sha256  : e81830f73d86cbaa71e4f32568ec596c461500370ef971315b1dff682c9d1639
// bundle  : matrix-field
// üretim  : node scripts/unpack-threeui.mjs — ELLE DÜZENLEME, ezilir.
// uyarlama: yok (bundle kodu aynen)
import { lazy, Suspense } from "react";

import type { NeuformBatchEffectProps } from "../neuform-isolated/NeuformBatchEffects";
import type { LaserVariantsProps, ThreeUILaserVariant } from "./LaserVariants";

export type LaserVariant = "matrix-field" | ThreeUILaserVariant;

export type LaserCollectionProps = Omit<NeuformBatchEffectProps, "mode" | "gap" | "strokeWidth"> & {
  variant?: LaserVariant;
};

const MatrixField = lazy(() =>
  import("../neuform-isolated/NeuformBatchEffects").then((module) => ({ default: module.MatrixField })),
);

const ThreeUILaserVariantRenderer = lazy(() =>
  import("./LaserVariants").then((module) => ({ default: module.LaserVariants })),
);

const FALLBACK = <div className="threeui-background laser-variant" />;

export function LaserCollection({ variant = "matrix-field", ...props }: LaserCollectionProps) {
  if (variant !== "matrix-field") {
    const laserProps = props as LaserVariantsProps;

    return (
      <Suspense fallback={FALLBACK}>
        <ThreeUILaserVariantRenderer {...laserProps} variant={variant} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={FALLBACK}>
      <MatrixField {...props} />
    </Suspense>
  );
}
