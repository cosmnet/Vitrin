import { BRAND_COLLECTIONS, BRAND_THEMES, brandAsset, type BrandThemeId } from "./brandThemes";
import { L } from "@/lib/i18n";
import type { Template, SlideStyle } from "./templates";
import { PRIVATE_BRANDS } from "@private";
import type { BrandFrameHelpers } from "@/private-stub";
import { uid, type Slide, type CameraPresetId } from "./types";

function frame(themeId: BrandThemeId, frameLabel: string, alt: number | undefined, camera: CameraPresetId, scale = 1): SlideStyle {
  const theme = BRAND_THEMES.find(t => t.id === themeId)!;
  const brand = BRAND_COLLECTIONS.find(c => c.id === themeId)!;
  const dark = alt !== undefined && brand.darkAlts.includes(alt);
  const ink = dark ? brand.darkInk : theme.headline.color;
  return {
    themeId, frameLabel, layout: "text-top", hideDevice: false,
    background: structuredClone(alt === undefined ? theme.background : theme.altBackgrounds![alt]),
    device: theme.device.mode === "3d" ? { ...theme.device, camera } : undefined,
    deviceOffset: { x: 0, y: 0, scale },
    // Future copy always receives the correct contrast for this frame.
    headlineStyle: { color: ink },
    subStyle: { color: ink },
  };
}

const helpers = (id: BrandThemeId): BrandFrameHelpers => ({
  frame: (label, alt, camera, scale) => frame(id, label, alt, camera, scale),
  asset: asset => brandAsset(id, asset),
});

export const BRAND_TEMPLATES: Template[] = PRIVATE_BRANDS.flatMap(b => {
  const c = b.collection;
  const h = helpers(c.id);
  const frames = b.frames(h);
  const style = (i: number): SlideStyle => structuredClone(frames[i % frames.length]);
  const copy = (i: number) => c.copy?.[i % c.copy.length] ?? { headline: "", sub: "" };
  const iphone: Template = {
    id: c.templateId, name: `${c.name} · iPhone`,
    hint: `${c.description} · ${c.hint ?? L(`${frames.length} kare · metin ve ekranlar için boş taslak`, `${frames.length} frames · blank draft for text and screens`)}`,
    color: c.color, kategori: "minimal", themeId: c.id, family: "iphone", defaultCount: frames.length, style,
    build: (n = frames.length): Slide[] => Array.from({ length: Math.max(1, Math.min(12, Math.round(n))) }, (_, i) => ({
      id: uid(), ...copy(i), ...style(i),
    })),
  };
  return [iphone, ...(b.extraTemplates?.({ ...h, styles: frames }) ?? [])];
});
