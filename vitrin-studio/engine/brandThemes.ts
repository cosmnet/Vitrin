import type { Theme } from "./types";
import { PRIVATE_BRANDS } from "@private";
import type { BrandCollection } from "@/private-stub";

// Marka serileri uygulamaya özeldir ve yalnız `private/` içinde tanımlanır
// (bkz. private-stub/index.ts). Yayımlanan sürümde liste boştur.

export type { BrandCollection };
export type BrandThemeId = string;
export const brandAsset = (theme: BrandThemeId, asset: string) => `/assets/brand/${theme}/${asset}.webp`;

export const BRAND_COLLECTIONS: BrandCollection[] = PRIVATE_BRANDS.map(b => b.collection);

export const BRAND_ARTWORK: { theme: BrandThemeId; id: string; label: string; alpha: boolean; crop?: { x: number; w: number } }[] =
  PRIVATE_BRANDS.flatMap(b => b.artwork.map(a => ({ theme: b.collection.id, ...a })));

// The artwork carries no baked-in copy or app screenshots. Type and phones
// remain editable.
export const BRAND_THEMES: Theme[] = BRAND_COLLECTIONS.map(c => ({
  id: c.id,
  name: c.name,
  background: structuredClone(c.background),
  altBackgrounds: structuredClone(c.altBackgrounds),
  headline: { fontFamily: c.font, weight: c.headlineWeight, sizePx: c.headlineSize, lineHeight: 1.04, letterSpacing: -3, color: c.ink, align: "left", transform: "none" },
  sub: { fontFamily: c.bodyFont, weight: c.subWeight, sizePx: 38, lineHeight: 1.42, letterSpacing: .1, color: c.ink, align: "left", transform: "none" },
  badge: { bg: c.color, color: c.paper, fontFamily: c.bodyFont },
  device: { mode: "3d", model: "real", camera: "front", lightRig: "softbox", bodyColor: "#c4cad3", shadow: true, reflection: false, float: .025, glare: .02 },
  defaultLayout: "text-top",
  accent: c.color,
}));
