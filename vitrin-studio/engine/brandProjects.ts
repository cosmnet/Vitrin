import { BRAND_COLLECTIONS, type BrandThemeId } from "./brandThemes";
import { getTemplate } from "./templates";
import { uid, type Project } from "./types";

export function makeBrandDraft(id: BrandThemeId, format: "iphone" | "ipad" = "iphone"): Project {
  const brand = BRAND_COLLECTIONS.find(c => c.id === id)!;
  const tablet = format === "ipad" && !!brand.ipadTemplateId;
  return {
    id: `brand-${uid()}`, app: `${brand.app}${tablet?" iPad":""} · Tema taslağı`, createdAt: new Date().toISOString(),
    format: tablet ? "ipad" : "iphone", screenshots: [], activeLocale: "tr", syncDesign: true,
    brief: `${brand.name}\n${brand.brief ?? "Tema taslağı. Başlıklar, alt yazılar ve ekran görüntüleri daha sonra eklenecek."}`,
    sets: { tr: { app: brand.app, locale: "tr", slides: getTemplate(tablet ? brand.ipadTemplateId! : brand.templateId).build() } },
  };
}
