// MD kare dosyası YAZMA + DOĞRULAMA.
//
// NEDEN VAR: Claude'un kare MD'sini serbest metin olarak yazması en sık
// kırılan yerdi — `## Ekran 1` (numara başlıkta değil), `HEADLINE = x`
// (iki nokta yerine eşittir), `BAŞLIK:` (yerelleştirilmiş alan adı) gibi
// tek bir sapma parser'ı sessizce sıfır kareye düşürüyor. Bu araç MD'yi
// Claude'un elinden alır: yapılandırılmış kareleri alır, KANONİK biçimi
// üretir ve yazmadan önce doğrular. Böylece format hatası mümkün değil.
//
// Doğrulama kaynağı tek: yerleşim id'leri /api/sync/catalog'tan okunur,
// buraya kopyalanmaz (bkz. src/catalog.ts).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { layoutIds } from "../catalog.js";
import { VitrinError } from "../log.js";
import { text, tool, withData } from "../result.js";
/* ------------------------------------------------------------------ *
   Kare şeması
 * ------------------------------------------------------------------ */
const frameSchema = z.object({
    no: z.number().int().min(1).max(999).describe("Kare numarası — her dilde AYNI olmalı"),
    title: z.string().optional().describe("Kare adı; başlık satırında görünür, motoru etkilemez"),
    headline: z.string().min(1).describe("Görselin üstündeki büyük satır — ZORUNLU"),
    sub: z.string().optional().describe("Alt satır"),
    badge: z.string().optional().describe("Rozet (EYEBROW)"),
    laurel: z.string().optional().describe("Defne çelengi metni"),
    screen: z.string().optional().describe("Ekran eşleşme ipucu — her dilde AYNI yazılır"),
    screen2: z.string().optional().describe("İkinci ekran ipucu; verilirse kare split olur"),
    layout: z.string().optional().describe("Yerleşim id'si; boşsa motor seçer"),
});
/* ------------------------------------------------------------------ *
   Kanonik MD üretimi
 * ------------------------------------------------------------------ */
/** Tek satıra indirger — kaçak satır sonu bir sonraki alanı yutardı. */
function oneLine(value) {
    return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}
function renderFrame(f) {
    const out = [];
    const title = f.title ? ` — ${oneLine(f.title)}` : "";
    out.push(`## ${String(f.no).padStart(2, "0")}${title}`);
    if (f.badge)
        out.push(`EYEBROW: ${oneLine(f.badge)}`);
    if (f.laurel)
        out.push(`LAUREL: ${oneLine(f.laurel)}`);
    out.push(`HEADLINE: ${oneLine(f.headline)}`);
    out.push(`CHARS: ${oneLine(f.headline).length}`);
    if (f.sub)
        out.push(`SUB: ${oneLine(f.sub)}`);
    if (f.screen)
        out.push(`SCREEN: ${oneLine(f.screen)}`);
    if (f.screen2)
        out.push(`SCREEN2: ${oneLine(f.screen2)}`);
    if (f.layout)
        out.push(`LAYOUT: ${oneLine(f.layout)}`);
    return out.join("\n");
}
export function renderFramesMd(locale, frames, note) {
    const head = [`# Vitrin kareleri · ${locale}`];
    if (note)
        head.push(`<!-- ${oneLine(note)} -->`);
    head.push("");
    return `${head.join("\n")}\n${frames.map(renderFrame).join("\n\n")}\n`;
}
/* ------------------------------------------------------------------ *
   Doğrulama — yazmadan ÖNCE
 * ------------------------------------------------------------------ */
/** Dosya adı dil kodu olacağı için yol ayracı / uzantı kabul edilmez. */
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
async function validate(locale, frames) {
    const problems = [];
    if (!LOCALE_RE.test(locale)) {
        problems.push(`Dil kodu geçersiz: "${locale}". Dosya adı dil kodu olur — "tr", "en-US", "zh-Hans" gibi.`);
    }
    if (!frames.length)
        problems.push("Hiç kare verilmedi.");
    const seen = new Map();
    for (const f of frames) {
        seen.set(f.no, (seen.get(f.no) ?? 0) + 1);
        if (!oneLine(f.headline)) {
            problems.push(`Kare ${f.no}: HEADLINE boş — parser bu kareyi sessizce atardı.`);
        }
        if (f.screen2 && !f.screen) {
            problems.push(`Kare ${f.no}: SCREEN2 var ama SCREEN yok — ikinci ekran tek başına eşleşmez.`);
        }
    }
    for (const [no, n] of seen) {
        if (n > 1)
            problems.push(`Kare numarası ${no} ${n} kez geçiyor — numaralar tekil olmalı.`);
    }
    // Yerleşim id'leri stüdyodan; stüdyo kapalıysa bu kontrol atlanır.
    const used = [...new Set(frames.map((f) => f.layout).filter(Boolean))];
    if (used.length) {
        try {
            const known = await layoutIds();
            for (const id of used) {
                if (!known.includes(id)) {
                    problems.push(`Bilinmeyen LAYOUT "${id}". Geçerli olanlar: ${known.join(", ")}`);
                }
            }
        }
        catch {
            // Katalog okunamadı — yerleşim doğrulaması yapılmadı, yazma engellenmez.
        }
    }
    return problems;
}
/* ------------------------------------------------------------------ *
   Araç kaydı
 * ------------------------------------------------------------------ */
export function registerMd(server) {
    tool(server, "vitrin_write_frames", {
        title: "Kare MD'si yaz",
        description: "Bir dilin kare MD dosyasını KANONİK biçimde yazar (<folder>/<locale>.md). " +
            "MD'yi elle yazma — bu aracı kullan: alan adlarını, başlık satırını ve " +
            "karakter sayısını kendisi üretir, yazmadan önce doğrular. " +
            "Kare numarası her dilde AYNI olmalı (diller arası eşleşme buradan yürür); " +
            "SCREEN ipucu her dilde AYNI yazılır (dosya adlarıyla eşleşir, çevrilmez).",
        inputSchema: z.object({
            folder: z
                .string()
                .describe("MD'nin yazılacağı KÖK klasör — vitrin_scan_folder'a verdiğin klasörün aynısı"),
            locale: z.string().describe('Dil kodu; dosya adı bu olur ("tr" → tr.md)'),
            frames: z.array(frameSchema).min(1).describe("Kareler; numara sırasına göre yazılır"),
            note: z.string().optional().describe("Dosya başına düşülecek tek satırlık HTML yorumu"),
            overwrite: z
                .boolean()
                .optional()
                .describe("Dosya varsa üzerine yaz (varsayılan false — varsa hata verir)"),
        }),
    }, async ({ folder, locale, frames, note, overwrite }) => {
        const problems = await validate(locale, frames);
        if (problems.length) {
            throw new VitrinError(`MD yazılmadı — ${problems.length} sorun`, problems.join(" · "));
        }
        const sorted = [...frames].sort((a, b) => a.no - b.no);
        const file = path.join(folder, `${locale}.md`);
        const body = renderFramesMd(locale, sorted, note);
        try {
            await writeFile(file, body, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
        }
        catch (err) {
            const code = err.code;
            if (code === "EEXIST") {
                throw new VitrinError(`Dosya zaten var: ${file}`, "Üzerine yazmak istiyorsan overwrite=true ver.");
            }
            if (code === "ENOENT") {
                throw new VitrinError(`Klasör yok: ${folder}`, "Önce klasörü oluştur ya da yolu düzelt.");
            }
            throw err;
        }
        const split = sorted.filter((f) => f.screen2).length;
        const noHint = sorted.filter((f) => !f.screen).length;
        return withData(text(`Yazıldı: ${file}`, `${sorted.length} kare (${split} çift ekran)`, noHint
            ? `UYARI: ${noHint} karede SCREEN ipucu yok — eşleşme yalnız kare numarasına kalır.`
            : "Her karede SCREEN ipucu var.", "Doğrulamak için: vitrin_scan_folder"), { file, locale, frames: sorted.length, split, withoutScreenHint: noHint });
    });
}
//# sourceMappingURL=md.js.map