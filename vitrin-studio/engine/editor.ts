import { bucketOf, elementLabel, hitsElement, patchElement } from "./elements";
import { L } from "@/lib/i18n";
import { getLayoutForFormat } from "./layouts";
import { ornamentAdvance } from "./ornament";
import { deviceBox } from "./snap";
import { splitFrames, isSplitScreen } from "./splitScreens";
import { drawTextBlock, resolveText } from "./text";
import { getTheme } from "./themes";
import { baseOf, deviceAspectOf, deviceStyleForFormat, type Format, type Slide, type SlideElement, type TextFrame } from "./types";

export type EditorLayer = { id: string; label: string; type: "image" | "text" | "device" | "background" | "shape"; hidden?: boolean; locked?: boolean; src?: string; theme?: boolean };
export type LayerBox = { x: number; y: number; w: number; h: number; rotation?: number };

export function themeElements(slide: Slide): SlideElement[] {
  const originals = getTheme(slide.themeId).elements ?? [];
  if (!slide.themeElementOverrides) return originals;
  return originals.map(e => ({ ...e, ...slide.themeElementOverrides?.[e.id] }));
}

export function layerElement(slide: Slide, id: string | null): SlideElement | null {
  if (id?.startsWith("element:")) return slide.elements?.find(e => e.id === id.slice(8)) ?? null;
  if (id?.startsWith("theme:")) return themeElements(slide).find(e => e.id === id.slice(6)) ?? null;
  return null;
}

export function patchLayerElement(slide: Slide, id: string, patch: Partial<SlideElement>): Partial<Slide> {
  if (id.startsWith("theme:")) {
    const key = id.slice(6);
    return { themeElementOverrides: { ...slide.themeElementOverrides, [key]: { ...slide.themeElementOverrides?.[key], ...patch } } };
  }
  return { elements: patchElement(slide.elements, id.replace(/^element:/, ""), patch) };
}

export function editorLayout(slide: Slide, format: Format) {
  const layout = getLayoutForFormat(slide.layout, format);
  return layout.device2 && !layout.splitPanels && !slide.screenshot2 ? getLayoutForFormat("text-top", format) : layout;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Measure with the actual renderer so long words and wrapping match the exported text. */
export function textFrames(slide: Slide, format: Format, locale?: string): Record<"headline" | "sub", LayerBox> {
  const B = baseOf(format), theme = getTheme(slide.themeId), layout = editorLayout(slide, format);
  const off = slide.textOffset ?? { x: 0, y: 0 };
  const x = layout.text.x * B.w + off.x, w = layout.text.w * B.w;
  let y = layout.text.y * B.h + off.y;
  if (slide.badge && !slide.layerStates?.badge?.hidden) y += 112;
  if (slide.ornament) y += ornamentAdvance(slide, layout, null, locale, format);
  if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  const frame = (key: "headline" | "sub", defaultY: number) => {
    const override = slide.textBoxes?.[key];
    const f = override ?? { x, y: defaultY, w, rotation: off.rotation };
    const style = resolveText({ ...theme[key === "headline" ? "headline" : "sub"], align: layout.text.align }, slide[key === "headline" ? "headlineStyle" : "subStyle"]);
    const h = measureCtx ? drawTextBlock(measureCtx, { text: slide[key] ?? "", style, x: 0, y: 0, w: f.w, scale: 1, locale }) : style.sizePx * (style.lineHeight ?? 1.1) * 2;
    return { ...f, h };
  };
  const headline = frame("headline", y);
  // A freeform headline no longer moves the template's subtitle along with it.
  const headStyle = resolveText({ ...theme.headline, align: layout.text.align }, slide.headlineStyle);
  const defaultHeadH = slide.textBoxes?.headline && measureCtx ? drawTextBlock(measureCtx, { text: slide.headline, style: headStyle, x: 0, y: 0, w, scale: 1, locale }) : headline.h;
  const sub = frame("sub", y + defaultHeadH + 18);
  return { headline, sub };
}

export function layerBox(slide: Slide, id: string | null, format: Format, locale?: string): LayerBox | null {
  const el = layerElement(slide, id);
  if (el) return { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
  const B = baseOf(format);
  if (id === "background") return { x: 0, y: 0, w: B.w, h: B.h };
  if (id === "headline" || id === "sub") return textFrames(slide, format, locale)[id];
  if (id?.startsWith("screen:")) return splitFrames(slide.layout, format)[Number(id.slice(7))] ?? null;
  const layout = editorLayout(slide, format);
  const dev = deviceStyleForFormat(slide.device ?? getTheme(slide.themeId).device, format);
  const aspect = deviceAspectOf(dev.kind);
  if (id === "device") {
    const box = deviceBox(slide, layout, format);
    const w = box.h * aspect;
    return { ...box, x: box.x + (box.w - w) / 2, w, rotation: (layout.device.rotation ?? 0) * 180 / Math.PI + (slide.deviceOffset?.rotation ?? 0) };
  }
  const device = id === "device2" ? layout.device2 : id === "device3" ? layout.device3 : null;
  if (device) {
    const off = (id === "device3" ? slide.device3Offset : slide.device2Offset) ?? { x: 0, y: 0 };
    const h = device.scale * B.h * (off.scale ?? 1), w = h * aspect;
    return { x: device.cx * B.w + off.x - w / 2, y: device.cy * B.h + off.y - h / 2, w, h, rotation: (device.rotation ?? 0) * 180 / Math.PI + (off.rotation ?? 0) };
  }
  return null;
}

export function editorLayers(slide: Slide): EditorLayer[] {
  const layout = getLayoutForFormat(slide.layout);
  const element = (e: SlideElement, fromTheme = false): EditorLayer => ({ id: `${fromTheme ? "theme" : "element"}:${e.id}`, label: elementLabel(e), type: e.kind === "text" ? "text" : e.kind === "image" || e.kind === "sticker" ? "image" : "shape", hidden: e.hidden, locked: e.locked, src: e.src, theme: fromTheme });
  const built = (id: string, label: string, type: EditorLayer["type"], src?: string): EditorLayer => ({ id, label: slide.layerStates?.[id]?.name || label, type, src, ...slide.layerStates?.[id] });
  const text = [built("headline", L("Başlık", "Headline"), "text"), built("sub", L("Alt yazı", "Subtitle"), "text")];
  const devices = isSplitScreen(slide) ? [built("screen:1", L("2. ekran · kırpma", "Screen 2 · crop"), "image", slide.screenshot2), built("screen:0", L("1. ekran · kırpma", "Screen 1 · crop"), "image", slide.screenshot)] : [...(layout.device3 && slide.screenshot2 ? [built("device3", L("3. cihaz", "Device 3"), "device", slide.screenshot3 ?? slide.screenshot2)] : []), ...(layout.device2 && slide.screenshot2 ? [built("device2", L("2. cihaz", "Device 2"), "device", slide.screenshot2)] : []), { ...built("device", L("Cihaz", "Device"), "device", slide.screenshot), hidden: slide.hideDevice }];
  const theme = getTheme(slide.themeId);
  const over = [...(slide.elements ?? []).filter(e => bucketOf(e) === "over").reverse().map(e => element(e)), ...themeElements(slide).filter(e => bucketOf(e) === "over").reverse().map(e => element(e, true))];
  const under = [...(slide.elements ?? []).filter(e => bucketOf(e) === "under").reverse().map(e => element(e)), ...themeElements(slide).filter(e => bucketOf(e) === "under").reverse().map(e => element(e, true))];
  const bg = slide.background ?? theme.background;
  return [...over, ...(layout.textZ === "below" ? [...devices, ...text] : [...text, ...devices]), ...under, built("background", L("Arka plan", "Background"), "background", bg.kind === "image" ? bg.src : undefined)];
}

export function hitLayers(slide: Slide, bx: number, by: number, format: Format, locale?: string, pad = 0): EditorLayer[] {
  return editorLayers(slide).filter(layer => {
    if (layer.hidden || layer.locked) return false;
    if (layer.id === "sub" && !slide.sub) return false;
    if (layer.id === "headline" && !slide.headline) return false;
    const box = layerBox(slide, layer.id, format, locale);
    return box && hitsElement({ id: layer.id, kind: "rect", ...box }, bx, by, pad);
  });
}

export function textFramePatch(slide: Slide, key: "headline" | "sub", frame: TextFrame): Partial<Slide> {
  return { textBoxes: { ...slide.textBoxes, [key]: frame } };
}
