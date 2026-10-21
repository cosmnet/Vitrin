import { isTabletKind, isDuoKind, type DeviceStyle2D } from "./types";

/**
 * Device-shaped display masks, shared by clipping, outline and shadow.
 * Phone radius follows our calibrated Pro Max display (short edge × .1496).
 * Tablet uses its own smaller display corner; rotation must not change it.
 * A continuous superellipse approximates the hardware curve, not a quarter
 * circle. This is not an Apple-certified per-model engineering contour.
 * Reference: https://developer.apple.com/design/resources/ (Product Bezels).
 */
export function screenCornerRadius(style: DeviceStyle2D, w: number, h: number): number {
  if (style.cornerMode === "custom") {
    const referenceHeight = isTabletKind(style.kind) ? 2752 : 2868;
    return Math.max(0, (style.cornerRadius ?? 180) * Math.max(w, h) / referenceHeight);
  }
  return Math.min(w, h) * (isTabletKind(style.kind) || isDuoKind(style.kind) ? 0.055 : 0.1496);
}

/** Continuous corner; zero curvature where the curve meets each straight edge. */
export function screenRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, radius: number,
  continuous = true,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (!r) { ctx.rect(x, y, w, h); return; }
  if (!continuous) { ctx.roundRect(x, y, w, h, r); return; }

  // Match the diagonal inset of a circular radius while smoothing its joins.
  const power = 2 / 2.5;
  const extent = Math.min(r * (1 - Math.SQRT1_2) / (1 - Math.pow(Math.SQRT1_2, power)), w / 2, h / 2);
  const centers = [
    [x + w - extent, y + extent, -Math.PI / 2],
    [x + w - extent, y + h - extent, 0],
    [x + extent, y + h - extent, Math.PI / 2],
    [x + extent, y + extent, Math.PI],
  ];
  const signed = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), power);
  for (let corner = 0; corner < 4; corner++) {
    const [cx, cy, start] = centers[corner];
    for (let i = 0; i <= 64; i++) {
      const a = start + (Math.PI / 2) * i / 64;
      const px = cx + extent * signed(Math.cos(a));
      const py = cy + extent * signed(Math.sin(a));
      if (corner === 0 && i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}
