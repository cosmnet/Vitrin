#!/usr/bin/env node
// Google Fonts'u istenen altkümelerle indirir.
// Kaynak: google-webfonts-helper (gwfh.mranftl.com) — woff2 doğrudan linkleri verir.
//
// Kullanım:  node scripts/fetch-fonts.mjs
//            node scripts/fetch-fonts.mjs --force        (var olanları da yeniden indir)
//            node scripts/fetch-fonts.mjs --only=noto     (id'si eşleşenleri indir)
//
// Çıktı: public/assets/fonts/<Family>-<weight>[i]-<tag>.woff2
//   tag = altküme etiketi: "latinext" (latin+latin-ext), "latinext-cyr", "arabic",
//         "devanagari", "jp", "kr", "sc", "cyr".
// Başarısız olan font atlanır ve sonda raporlanır — süreç yine 0 ile biter.
//
// ALTKÜME PAZARLIĞI: her aile için önce parametresiz meta çekilir (gerçek altküme
// listesi), istenen liste onunla KESİŞTİRİLİR, sonra meta ikinci kez `?subsets=`
// ile çekilir — gwfh o parametreye göre FARKLI (küçük) bir woff2 linki döndürür.
// Böylece "cyrillic-ext yok" (Playfair) gibi durumlar sessizce doğru sonuç verir.

import { mkdir, writeFile, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "assets", "fonts");
const API = "https://gwfh.mranftl.com/api/fonts";
const LATIN = ["latin", "latin-ext"];
const CYR = ["cyrillic", "cyrillic-ext"];
const FORCE = process.argv.includes("--force");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

/**
 * İstenen set.
 *   id       gwfh font id'si
 *   weights  indirilecek ağırlıklar; "400i" = italik varyant
 *   want     istenen altkümeler (ailede olmayanlar sessizce düşer) — vars. latin+latin-ext
 *   need     ZORUNLU altkümeler; ailede yoksa aile atlanır — vars. ["latin-ext"]
 *   tag      dosya adı eki — vars. "latinext"
 */
const WANTED = [
  // --- ONARIM: bunlar zaten vardı ama SADECE "latin" altkümesiyle indirilmişti,
  // yani ş/Ş/ğ/Ğ/İ glifleri dosyada hiç yoktu ve tarayıcı sistem fontuna
  // düşüyordu ("bozuk karakter" şikayetinin asıl sebebi). latin-ext ile yeniden.
  { id: "fraunces",            weights: ["600"] },
  { id: "playfair-display",    weights: ["600"] },
  { id: "syne",                weights: ["700"] },
  { id: "outfit",              weights: ["500", "700"] },

  // --- YENİ: çeşitlilik için
  { id: "sora",                weights: ["400", "700"] },
  { id: "manrope",             weights: ["500", "800"] },
  { id: "space-grotesk",       weights: ["500", "700"] },
  { id: "bricolage-grotesque", weights: ["700"] },
  { id: "unbounded",           weights: ["600"] },
  { id: "archivo-black",       weights: ["400"] },
  { id: "dm-serif-display",    weights: ["400"] },
  { id: "lora",                weights: ["500", "600", "400i"] },
  { id: "cormorant-garamond",  weights: ["600"] },
  { id: "figtree",             weights: ["500"] },
  { id: "anton",               weights: ["400"] },
  { id: "caveat",              weights: ["600"] },

  // --- R10: 2026 vitrin dili için üç eksik yüz.
  // Instrument Serif  → yüksek kontrastlı, sıkı editoryal display (dergi kapağı).
  //                     Fraunces/Playfair yumuşak ve yuvarlak; bu keskin ve modern.
  // Instrument Sans   → dar-nötr grotesk; başlık altı künye/etiket satırları için
  //                     Outfit'ten daha az yuvarlak, daha "arayüz" hissi.
  // JetBrains Mono    → brutalist/teknik temaların mono yüzü. Kiril'i de VAR,
  //                     bu yüzden latinext-cyr olarak alınır (ru'da yüz değişmez).
  { id: "instrument-serif",    weights: ["400", "400i"] },
  { id: "instrument-sans",     weights: ["500", "700"] },
  { id: "jetbrains-mono",      weights: ["500", "700"], want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },

  // ---------------------------------------------------------------- R7 / Wave-1
  // 15 dilin 6'sı (ar-SA, hi, ja, ko, ru, zh-Hans) bugüne kadar TOFU basıyordu:
  // buradaki her dosya latin-ext altkümesiyle indirilmişti, yani Arap/Devanagari/
  // CJK/Kiril glifleri hiçbir dosyada YOKTU. Aşağısı o boşluğu kapatır.

  // Arapça — Kufi, App Store başlıkları için Naskh'tan daha "display".
  // latin de içerir ki marka adı/rakamlar aynı yüzde kalsın.
  { id: "noto-kufi-arabic",    weights: ["400", "700"], want: ["arabic", ...LATIN],
    need: ["arabic"],              tag: "arabic" },

  // Hintçe (Devanagari)
  { id: "noto-sans-devanagari", weights: ["400", "700"], want: ["devanagari", ...LATIN],
    need: ["devanagari"],          tag: "devanagari" },

  // CJK — gwfh'ın statik dosyaları unicode-range'siz TEK parça, doğal olarak büyük.
  { id: "noto-sans-jp",        weights: ["400", "700"], want: ["japanese", ...LATIN],
    need: ["japanese"],            tag: "jp" },
  { id: "noto-sans-kr",        weights: ["400", "700"], want: ["korean", ...LATIN],
    need: ["korean"],              tag: "kr" },
  { id: "noto-sans-sc",        weights: ["400", "700"], want: ["chinese-simplified", ...LATIN],
    need: ["chinese-simplified"],  tag: "sc" },

  // Kiril — ÖNCE mevcut ailelerin kendi kiril altkümesi (tema görünümü korunur),
  // kiril'i OLMAYAN aileler (Outfit, Sora, Space Grotesk, Figtree, Syne,
  // Bricolage, Anton, Archivo Black, Fraunces, DM Serif + yerel Kiltier/Arseri/
  // BetroVogue) için gövde yedeği = Noto Sans.
  { id: "manrope",             weights: ["500", "800"], want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  { id: "unbounded",           weights: ["600"],        want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  { id: "caveat",              weights: ["600"],        want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  { id: "lora",                weights: ["500", "600", "400i"], want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  { id: "cormorant-garamond",  weights: ["600"],        want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  // Playfair'da cyrillic-ext YOK — pazarlık onu düşürür, cyrillic kalır.
  { id: "playfair-display",    weights: ["600"],        want: [...LATIN, ...CYR],
    need: ["cyrillic"], tag: "latinext-cyr" },
  // Kiril gövde yedeği.
  { id: "noto-sans",           weights: ["400", "700"], want: [...LATIN, ...CYR],
    need: ["cyrillic", "cyrillic-ext"], tag: "cyr" },
];

/** "Space Grotesk" -> "SpaceGrotesk" (dosya adı için) */
function slugFamily(family) {
  return family.replace(/[^A-Za-z0-9]/g, "");
}

/** "400i" -> { weight: "400", italic: true } */
function parseWeight(w) {
  const italic = w.endsWith("i");
  return { weight: italic ? w.slice(0, -1) : w, italic };
}

/** gwfh varyant id'si: normal ağırlıklar "regular"/"500", italikler "italic"/"500italic" */
function matchVariant(variants, weight, italic) {
  return variants.find(
    (v) => String(v.fontWeight) === weight && (v.fontStyle === "italic") === italic
  );
}

async function fileExists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // woff2 imzası: 'wOF2'
  if (buf.length < 64 || buf.toString("latin1", 0, 4) !== "wOF2") {
    throw new Error(`geçersiz woff2 (${buf.length} bayt)`);
  }
  await writeFile(dest, buf);
  return buf.length;
}

function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const ok = [];
  const skipped = [];
  const failed = [];
  const big = [];

  for (const item of WANTED) {
    if (ONLY && !item.id.includes(ONLY)) continue;

    const want = item.want || LATIN;
    const need = item.need || ["latin-ext"];
    const tag = item.tag || "latinext";

    // 1) Parametresiz meta → ailenin GERÇEK altküme listesi.
    let probe;
    try {
      probe = await fetchJson(`${API}/${item.id}`);
    } catch (err) {
      failed.push(`${item.id}: metadata alınamadı — ${err.message}`);
      continue;
    }
    const family = probe.family || item.id;
    const available = probe.subsets || [];

    const missingNeed = need.filter((s) => !available.includes(s));
    if (missingNeed.length) {
      failed.push(`${family} [${tag}]: ${missingNeed.join("+")} altkümesi yok — atlandı`);
      continue;
    }
    const chosen = want.filter((s) => available.includes(s));
    const dropped = want.filter((s) => !available.includes(s));

    // 2) Kesişimle ikinci meta → altkümeye göre gerçekten küçültülmüş woff2 linkleri.
    let meta;
    try {
      meta = await fetchJson(`${API}/${item.id}?subsets=${chosen.join(",")}`);
    } catch (err) {
      failed.push(`${family} [${tag}]: altküme metadata'sı alınamadı — ${err.message}`);
      continue;
    }
    if (dropped.length) {
      skipped.push(`${family} [${tag}]: ailede olmayan altküme atlandı — ${dropped.join(",")}`);
    }

    for (const w of item.weights) {
      const { weight, italic } = parseWeight(w);
      const variant = matchVariant(meta.variants || [], weight, italic);
      if (!variant) {
        failed.push(`${family} ${w}: bu ağırlık yok`);
        continue;
      }
      if (!variant.woff2) {
        failed.push(`${family} ${w}: woff2 linki yok`);
        continue;
      }

      const name = `${slugFamily(family)}-${weight}${italic ? "i" : ""}-${tag}.woff2`;
      const dest = path.join(OUT_DIR, name);

      if (!FORCE && (await fileExists(dest))) {
        const st = await stat(dest);
        skipped.push(`${name} (${fmtBytes(st.size)})`);
        continue;
      }

      try {
        const bytes = await download(variant.woff2, dest);
        ok.push(`${name} (${fmtBytes(bytes)}) [${chosen.join(",")}]`);
        // 4 MB üstü dosyalar eager yüklenmemeli — engine/fonts.ts lazy yolu kullanır.
        if (bytes > 4 * 1024 * 1024) big.push(`${name} — ${fmtBytes(bytes)}`);
      } catch (err) {
        failed.push(`${family} ${w}: indirilemedi — ${err.message}`);
      }
    }
  }

  console.log(`\n[fetch-fonts] hedef: ${OUT_DIR}`);
  console.log(`\nİNDİRİLDİ (${ok.length}):`);
  for (const l of ok) console.log("  + " + l);
  if (skipped.length) {
    console.log(`\nZATEN VARDI (${skipped.length}) — --force ile yenile:`);
    for (const l of skipped) console.log("  = " + l);
  }
  if (failed.length) {
    console.log(`\nBAŞARISIZ / ATLANDI (${failed.length}):`);
    for (const l of failed) console.log("  ! " + l);
  } else {
    console.log("\nBaşarısız yok.");
  }
  if (big.length) {
    console.log(`\nBÜYÜK DOSYA UYARISI (>4 MB) — eager yüklemeyin:`);
    for (const l of big) console.log("  ~ " + l);
  }
  console.log("");
}

main().catch((err) => {
  console.error("[fetch-fonts] beklenmeyen hata:", err);
  process.exit(1);
});
