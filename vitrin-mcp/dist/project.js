// Proje okuma/yazma + özetleme.
//
// ALTIN KURAL: proje JSON'u ASLA metin olarak Claude'a dönmez. Ekran
// görüntüleri eski projelerde dataURL olarak gömülü (Vitrio: 21 MB); tek bir
// `vitrin_open_project` cevabı bağlamı yakabilir. Bu dosyadaki `summarize*`
// fonksiyonları her zaman ÖZET üretir.
import { api } from "./studio.js";
import { VitrinError } from "./log.js";
/* ------------------------------------------------------------------ *
   Kimlik
 * ------------------------------------------------------------------ */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** /api/projects ile aynı kimlik kuralı (10 karakterlik base36). */
export function uid() {
    return (Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5));
}
export function assertId(id) {
    const s = (id ?? "").trim();
    if (!ID_RE.test(s)) {
        throw new VitrinError(`Geçersiz proje kimliği: "${s}"`, "vitrin_list_projects ile doğru id'yi al.");
    }
    return s;
}
/* ------------------------------------------------------------------ *
   CRUD
 * ------------------------------------------------------------------ */
export async function listProjects() {
    const r = await api("/api/projects");
    return r.projects ?? [];
}
export async function loadProject(id) {
    const r = await api(`/api/projects?id=${encodeURIComponent(assertId(id))}`);
    if (!r.project)
        throw new VitrinError("Proje bulunamadı", "vitrin_list_projects ile bak.");
    const p = r.project;
    p.screenshots ??= [];
    p.sets ??= {};
    return p;
}
export async function saveProject(p) {
    await api("/api/projects", { project: p }, { timeoutMs: 180_000 });
}
export async function deleteProject(id) {
    await api(`/api/projects?id=${encodeURIComponent(assertId(id))}`, undefined, {
        method: "DELETE",
    });
}
/** Yükle → değiştir → kaydet. Değiştirici projeyi YERİNDE düzenler. */
export async function mutateProject(id, fn) {
    const p = await loadProject(id);
    const result = await fn(p);
    await saveProject(p);
    return { project: p, result };
}
/* ------------------------------------------------------------------ *
   Dil / slayt seçimi
 * ------------------------------------------------------------------ */
export function resolveLocale(p, raw) {
    const have = Object.keys(p.sets);
    if (!have.length) {
        throw new VitrinError("Projede hiç dil seti yok", "Önce vitrin_import ile içe aktar.");
    }
    const want = (raw ?? "").trim();
    if (!want)
        return have.includes(p.activeLocale) ? p.activeLocale : have[0];
    if (have.includes(want))
        return want;
    throw new VitrinError(`Projede olmayan dil: ${want}`, `Mevcut diller: ${have.join(", ")}`);
}
export function resolveLocales(p, raw) {
    const have = Object.keys(p.sets);
    if (!have.length) {
        throw new VitrinError("Projede hiç dil seti yok", "Önce vitrin_import ile içe aktar.");
    }
    if (!raw || raw === "all")
        return have;
    const missing = raw.filter((l) => !have.includes(l));
    if (missing.length) {
        throw new VitrinError(`Projede olmayan dil: ${missing.join(", ")}`, `Mevcut diller: ${have.join(", ")}`);
    }
    return raw;
}
export function resolveSlides(plan, raw) {
    const n = plan.slides.length;
    if (!raw || raw === "all")
        return Array.from({ length: n }, (_, i) => i);
    const bad = raw.filter((i) => i < 0 || i >= n);
    if (bad.length) {
        throw new VitrinError(`${plan.locale} setinde ${n} slayt var, olmayan indeks istendi: ${bad.join(", ")}`, "İndeksler 0'dan başlar.");
    }
    return raw;
}
/* ------------------------------------------------------------------ *
   Özetleme — asla ham JSON değil
 * ------------------------------------------------------------------ */
function short(s, n = 34) {
    const v = (s ?? "").replace(/\s+/g, " ").trim();
    return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}
export function slideLine(s, i) {
    const bits = [
        String(i).padStart(2, " "),
        (s.designKey ?? "-").padEnd(5, " "),
        short(s.headline).padEnd(35, " "),
        s.themeId.padEnd(12, " "),
        s.layout.padEnd(21, " "),
        s.screenshot ? "ekran✓" : "ekran✗",
    ];
    if (s.screenshot2)
        bits.push("2.ekran✓");
    if (s.badge)
        bits.push(`rozet:${short(s.badge, 14)}`);
    if (s.ornament)
        bits.push("çelenk");
    if (s.needsCopy)
        bits.push("ÇEVİRİLMEDİ");
    return bits.join(" ");
}
export function summarizeSet(plan) {
    const head = ` #  key   başlık                              tema         yerleşim              ekran`;
    return [head, ...plan.slides.map((s, i) => slideLine(s, i))].join("\n");
}
export function summarizeProject(p, locale) {
    const locales = Object.keys(p.sets);
    const active = locale && p.sets[locale] ? locale : resolveLocale(p);
    const counts = locales.map((l) => `${l}(${p.sets[l].slides.length})`).join(" ");
    const lines = [
        `${p.app} · id=${p.id}`,
        `diller: ${counts}`,
        `ekran görüntüsü: ${p.screenshots.length} · tasarım senkronu: ${p.syncDesign === false ? "KAPALI" : "açık"}`,
        p.brief ? `brief: ${short(p.brief, 120)}` : "",
        "",
        `— ${active} —`,
        summarizeSet(p.sets[active]),
    ];
    return lines.filter(Boolean).join("\n");
}
export function summarizeList(rows) {
    if (!rows.length)
        return "Hiç proje yok. vitrin_create_project ile başla.";
    return rows
        .map((r) => `${r.id}  ${r.app}  · ${r.locales.length} dil (${r.locales.slice(0, 6).join(", ")}${r.locales.length > 6 ? "…" : ""}) · ${r.createdAt.slice(0, 10)}`)
        .join("\n");
}
//# sourceMappingURL=project.js.map