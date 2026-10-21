import type { ImageCrop, ImageFx } from "./types";
import { clamp } from "./types";

type ImageSource = HTMLImageElement | HTMLCanvasElement;

export function imageFilter(fx?: ImageFx, scale = 1): string {
  if (!fx) return "none";
  const filters: string[] = [];
  if (fx.blur) filters.push(`blur(${clamp(fx.blur, 0, 200) * scale}px)`);
  if (fx.brightness !== undefined && fx.brightness !== 1) filters.push(`brightness(${clamp(fx.brightness, 0, 3)})`);
  if (fx.contrast !== undefined && fx.contrast !== 1) filters.push(`contrast(${clamp(fx.contrast, 0, 3)})`);
  if (fx.sat !== undefined && fx.sat !== 1) filters.push(`saturate(${clamp(fx.sat, 0, 3)})`);
  return filters.join(" ") || "none";
}

/** Shared by canvas, crop preview, backgrounds and export. */
export function drawEditedImage(ctx: CanvasRenderingContext2D, img: ImageSource, x: number, y: number, w: number, h: number, crop?: ImageCrop, fallback: ImageCrop["fit"] = "cover"): void {
  const iw = "naturalWidth" in img ? img.naturalWidth || img.width : img.width;
  const ih = "naturalHeight" in img ? img.naturalHeight || img.height : img.height;
  if (!iw || !ih || !w || !h) return;
  const fit = crop?.fit ?? fallback;
  const zoom = clamp(crop?.zoom ?? 1, .1, 12);
  const ratio = fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = (fit === "stretch" ? w : iw * ratio) * zoom;
  const dh = (fit === "stretch" ? h : ih * ratio) * zoom;
  const fx = clamp(crop?.x ?? .5, 0, 1), fy = clamp(crop?.y ?? .5, 0, 1);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(crop?.flipX ? -1 : 1, crop?.flipY ? -1 : 1);
  ctx.drawImage(img, (w - dw) * fx - w / 2, (h - dh) * fy - h / 2, dw, dh);
  ctx.restore();
}
