// GET /api/sync/catalog — tema / şablon / yerleşim / boyut kataloğu.
//
// NEDEN VAR: MCP tema ve şablon listelerini kullanıcıya sunacak ve
// `vitrin_apply_template` şablonun "giysi" adımlarını uygulayacak. Bu veri
// engine/themes.ts + templates.ts + layouts.ts içinde TS sabiti olarak
// duruyor; MCP saf Node olduğu için import edemez. Listeyi MCP'ye kopyalamak
// (10 tema × 645 satır) sapma üretirdi — bunun yerine motor burada okunur.
// Üç modül de DOM'suz: yalnız ./types ve birbirlerini import ederler.

import { NextResponse } from "next/server";

import { LAYOUTS } from "@/engine/layouts";
import { TEMPLATES } from "@/engine/templates";
import { THEMES } from "@/engine/themes";
import { EXPORT_SIZES, FORMATS } from "@/engine/types";

export const runtime = "nodejs";

/** Şablon `style(i)` döngüseldir; 12 adım App Store'un slayt üst sınırını kapsar. */
const MAX_SLIDES = 12;

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      themes: THEMES.map((t) => ({
        id: t.id,
        name: t.name,
        accent: t.accent,
        defaultLayout: t.defaultLayout,
        deviceMode: t.device.mode,
        headlineFont: t.headline.fontFamily,
        backgroundKind: t.background.kind,
        altCount: t.altBackgrounds?.length ?? 0,
      })),
      templates: TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        hint: t.hint,
        color: t.color,
        kategori: t.kategori,
        themeId: t.themeId,
        defaultCount: t.defaultCount,
        // i. slaytın giysisi — MCP `vitrin_apply_template`te aynen uygular.
        styles: Array.from({ length: MAX_SLIDES }, (_, i) => t.style(i)),
      })),
      layouts: Object.values(LAYOUTS).map((l) => ({
        id: l.id,
        text: l.text,
        device: l.device,
        device2: l.device2,
        // R10 üçlü düzenler bu alanı kullanıyor; MCP kataloğu eksik kalmasın.
        device3: l.device3,
        textZ: l.textZ,
      })),
      sizes: Object.entries(EXPORT_SIZES).map(([id, s]) => ({ id, ...s })),
      // Formatlar: MCP `vitrin_create_project format` ve iPad projeleri için.
      formats: Object.entries(FORMATS).map(([id, f]) => ({ id, ...f })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
