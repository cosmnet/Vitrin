// Yayımlanmayan, uygulamaya özel içerik kancası (marka temaları, eski temalar
// ve setler, tipografi düzeltmeleri). tsconfig'teki "@private" önce
// gitignore'daki `private/index.ts`'i dener; yoksa bu boş saplama devreye
// girer. Kendi markanı eklemek için bu dosyayı `private/index.ts` olarak
// kopyala ve doldur.
//
// Buradan yalnız TİP içe aktar: themes/templates bu modülü yüklerken henüz
// hazır değiller, yardımcılar fonksiyon parametresi olarak verilir.
import type { Background, CameraPresetId, DeviceStyle, Slide, Theme } from "@/engine/types";
import type { SlideStyle, Template, TemplateConfig, TemplateId } from "@/engine/templates";
import type { ModelEntry } from "@/engine/modelRegistry";

export type BrandCollection = {
  id: string;
  app: string;
  name: string;
  description: string;
  font: string;
  bodyFont: string;
  color: string;
  ink: string;
  paper: string;
  templateId: TemplateId;
  /** Varsa marka galerisinde iPad sürümü de sunulur. */
  ipadTemplateId?: TemplateId;
  background: Background;
  altBackgrounds: Background[];
  headlineWeight: number;
  headlineSize: number;
  subWeight: number;
  /** Koyu zemin olan altBackgrounds sıraları; o karelerde metin `darkInk` olur. */
  darkAlts: number[];
  darkInk: string;
  /** Taslak açılırken karelere konan metinler (yoksa boş). */
  copy?: { headline: string; sub: string }[];
  /** iPhone şablon kartının açıklama eki. */
  hint?: string;
  /** Taslak projenin brief'i. */
  brief?: string;
};

export type BrandFrameHelpers = {
  frame: (frameLabel: string, alt: number | undefined, camera: CameraPresetId, scale?: number) => SlideStyle;
  /** `/assets/brand/<tema>/<asset>.webp` */
  asset: (asset: string) => string;
};

export type PrivateBrand = {
  collection: BrandCollection;
  /** crop: arka plan olarak uygulanırken iPhone'da kullanılacak kırpma. */
  artwork: { id: string; label: string; alpha: boolean; crop?: { x: number; w: number } }[];
  frames: (h: BrandFrameHelpers) => SlideStyle[];
  /** Ek şablonlar (ör. iPad sürümü); `styles` iPhone kareleridir. */
  extraTemplates?: (h: BrandFrameHelpers & { styles: SlideStyle[] }) => Template[];
};

export type LegacyThemeHelpers = {
  halftone: (n: number) => string;
  grad: (n: number) => string;
  grain: (colors: string[], seed: number) => Background;
  PLATE: Record<string, string>;
  BG: Record<string, string>;
};

type DeviceHelper = (camera: CameraPresetId, bodyColor: string, env?: "studio" | "night" | "soft") => DeviceStyle;
export type LegacyTemplateHelpers = {
  makeTemplate: (cfg: TemplateConfig) => Template;
  real: DeviceHelper;
  kontur: DeviceHelper;
};

export const PRIVATE_BRANDS: PrivateBrand[] = [];
export const privateLegacyThemes = (_h: LegacyThemeHelpers): Theme[] => [];
/** Tema galerisinde gösterilecek eski temalar. */
export const PRIVATE_CURATED_THEME_IDS: string[] = [];
/** Tema galerisi kategorilerine eklenecek tema id'leri (kategori → id'ler). */
export const PRIVATE_THEME_CATEGORIES: Record<string, string[]> = {};
export const privateLegacyTemplates = (_h: LegacyTemplateHelpers): Template[] => [];
/** Yeniden dağıtılamayan lisanslı 3D modeller (dosya adı → kayıt). */
export const PRIVATE_MODELS: Record<string, ModelEntry> = {};
export const fitPrivateTypography = (slide: Slide): Slide => slide;
