import { drawEditedImage } from "./imageEdit";
import { baseOf, type Format, type Slide, type ImageCrop } from "./types";

export type SplitCrop = ImageCrop;
export function isSplitScreen(slide: Pick<Slide, "layout">): boolean {
  return slide.layout === "split-v" || slide.layout === "split-h";
}

/** Fixed editorial windows, not device silhouettes. Shared by canvas and hit testing. */
export function splitFrames(layout: Slide["layout"], format: Format = "iphone") {
  const { w, h } = baseOf(format);
  const margin = .045 * w, gap = .022 * w;
  const top = .265 * h, bottom = .955 * h;
  if (layout === "split-v") {
    const width = (w - 2 * margin - gap) / 2;
    return [0, 1].map(i => ({ x: margin + i * (width + gap), y: top, w: width, h: bottom - top }));
  }
  const height = (bottom - top - gap) / 2;
  return [0, 1].map(i => ({ x: margin, y: top + i * (height + gap), w: w - 2 * margin, h: height }));
}

export function splitCropDefault(layout: Slide["layout"]): Required<Pick<SplitCrop, "x" | "y" | "zoom">> {
  return { x: .5, y: .35, zoom: layout === "split-v" ? 1.45 : 1.08 };
}

const bounded = (v: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v!)) : fallback;

/** Return a source crop wholly inside the image, at every focus and zoom. */
export function splitSourceRect(iw: number, ih: number, w: number, h: number, crop: SplitCrop, defaults: Required<Pick<SplitCrop, "x" | "y" | "zoom">>) {
  const zoom = bounded(crop.zoom, defaults.zoom, 1, 12);
  const fit = Math.max(w / iw, h / ih) * zoom;
  const sw = w / fit, sh = h / fit;
  return { x: (iw - sw) * bounded(crop.x, defaults.x, 0, 1), y: (ih - sh) * bounded(crop.y, defaults.y, 0, 1), w: sw, h: sh };
}

export function drawSplitScreens(ctx: CanvasRenderingContext2D, slide: Slide, shots: (HTMLImageElement | null)[], W: number, H: number, format: Format) {
  const base = baseOf(format);
  const sx = W / base.w, sy = H / base.h;
  splitFrames(slide.layout, format).forEach((frame, i) => {
    if (slide.layerStates?.[`screen:${i}`]?.hidden) return;
    const x = frame.x * sx, y = frame.y * sy, w = frame.w * sx, h = frame.h * sy;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 24 * sx); ctx.clip();
    ctx.fillStyle = "#e8e9ed"; ctx.fillRect(x, y, w, h);
    const shot = shots[i];
    if (shot) {
      const crop = splitSourceRect(shot.naturalWidth, shot.naturalHeight, w, h, slide.splitCrop?.[i] ?? {}, splitCropDefault(slide.layout));
      const edit = slide.splitCrop?.[i];
      if (edit?.fit || edit?.flipX || edit?.flipY || edit?.zoom !== undefined && edit.zoom < 1) drawEditedImage(ctx, shot, x, y, w, h, { ...splitCropDefault(slide.layout), ...edit });
      else ctx.drawImage(shot, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
    } else {
      ctx.fillStyle = "#545864"; ctx.font = `${36 * sx}px sans-serif`; ctx.textAlign = "center";
      ctx.fillText(`${i + 1}. görseli seç`, x + w / 2, y + h / 2);
    }
    ctx.restore();
  });
}
