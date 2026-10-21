#!/usr/bin/env node
// Font dosyalarında Türkçe glif kontrolü — HARİCİ BAĞIMLILIK YOK.
//
// woff2 gövdesi düz brotli akışıdır; node:zlib ile açıp sfnt tablolarını
// çıkarıyoruz. otf/ttf zaten düz sfnt. Sonra cmap (format 4 ve 12) okunup
// aranan kod noktalarının gerçekten eşleşip eşleşmediğine bakılıyor.
//
// Kullanım: node scripts/check-glyphs.mjs [dosya|dizin ...]
//           argüman yoksa public/assets/fonts taranır.
//           --strict  → latin dışı kapsama testi patlarsa 1 ile çık (CI için)
// Çıkış kodu varsayılan olarak her zaman 0 — bu bir rapor aracı.
//
// R7 / Wave-1: Türkçe kontrolüne ek olarak LATİN DIŞI kapsama testi.
// Dosya adının altküme eki (-arabic, -devanagari, -jp, -kr, -sc, -cyr,
// -latinext-cyr) hangi yazıyı VAAT ETTİĞİNİ söyler; her vaat gerçek bir dil
// örneğiyle cmap'ten doğrulanır. engine/fonts.ts'teki `scripts` alanı bu
// ölçümün çıktısıdır — tahmin değil.

import { readFile, readdir } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FONT_DIR = path.join(ROOT, "public", "assets", "fonts");

const STRICT = process.argv.includes("--strict");

/** Türkçe'ye özgü + latin-1 ötesi kritik kod noktaları. */
const TURKISH = [
  ["ş", 0x015f], ["Ş", 0x015e],
  ["ğ", 0x011f], ["Ğ", 0x011e],
  ["ı", 0x0131], ["İ", 0x0130],
  ["ç", 0x00e7], ["Ç", 0x00c7],
  ["ö", 0x00f6], ["Ö", 0x00d6],
  ["ü", 0x00fc], ["Ü", 0x00dc],
];

/**
 * Yazı başına GERÇEK dil örneği (App Store başlığı gibi kelimeler).
 * Latin harf/rakam bilerek YOK: her örnek yalnız kendi yazısını sınar.
 */
const SCRIPT_PROBES = {
  cyrillic:   { locale: "ru",      sample: "молитва", label: "Kiril" },
  arabic:     { locale: "ar-SA",   sample: "الصلاة",  label: "Arapça" },
  devanagari: { locale: "hi",      sample: "नमाज़",    label: "Devanagari" },
  jp:         { locale: "ja",      sample: "祈り",     label: "Japonca" },
  kr:         { locale: "ko",      sample: "기도",     label: "Korece" },
  sc:         { locale: "zh-Hans", sample: "祷告",     label: "Çince (Basit.)" },
};

/** Dosya adı eki → dosyanın VAAT ETTİĞİ latin dışı yazılar. */
const TAG_SCRIPTS = {
  "latinext-cyr": ["cyrillic"],
  cyr: ["cyrillic"],
  arabic: ["arabic"],
  devanagari: ["devanagari"],
  jp: ["jp"],
  kr: ["kr"],
  sc: ["sc"],
};

/** "NotoSansJP-400-jp.woff2" → "jp";  "Lora-400i-latinext-cyr.woff2" → "latinext-cyr" */
function tagOf(name) {
  const m = /^.+?-\d+i?-(.+)\.(woff2|otf|ttf)$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------- WOFF2

// WOFF2 spesifikasyonundaki 63 bilinen tablo etiketi (sıra ÖNEMLİ — flag indeksidir).
const KNOWN_TAGS = [
  "cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm",
  "glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern",
  "LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC",
  "JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar",
  "bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty",
  "just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat",
  "Gloc","Feat","Sill",
];

/** WOFF2 UIntBase128: 7 bitlik gruplar, üst bit = devam. */
function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos++];
    if (b === undefined) throw new Error("base128 taşması");
    // ilk baytta öndeki sıfır yasak
    if (i === 0 && b === 0x80) throw new Error("base128 öndeki sıfır");
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return [value, pos];
  }
  throw new Error("base128 çok uzun");
}

/**
 * woff2 -> { tag: Buffer } tablo haritası.
 * Sıkıştırılmış blok tek bir brotli akışıdır; tablolar dizin sırasıyla,
 * araya dolgu konmadan arka arkaya yazılır.
 */
function woff2Tables(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("wOF2 imzası yok");
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(24);

  let pos = 48;
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const tagIndex = flags & 0x3f;
    let tag;
    if (tagIndex === 0x3f) {
      tag = buf.toString("latin1", pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex];
      if (!tag) throw new Error(`bilinmeyen tablo indeksi ${tagIndex}`);
    }
    const transformVersion = (flags >> 6) & 0x03;
    let origLength;
    [origLength, pos] = readBase128(buf, pos);

    // glyf/loca için 0 = dönüştürülmüş, 3 = dönüşümsüz.
    // Diğer tablolarda 0 = dönüşümsüz, 1 = dönüştürülmüş.
    const transformed =
      tag === "glyf" || tag === "loca" ? transformVersion !== 3 : transformVersion === 1;

    let length = origLength;
    if (transformed) [length, pos] = readBase128(buf, pos);

    dir.push({ tag, length });
  }

  // Bazı kodlayıcılar totalCompressedSize'ı yanlış yazıyor (ör. Unbounded'da
  // 65536'ya kırpılmış). Önce başlıktaki değere güven; patlarsa bloğun sonunu
  // dosya sonundan / meta-priv bloklarından türet.
  const metaOffset = buf.readUInt32BE(32);
  const privOffset = buf.readUInt32BE(44);
  const hardEnd = metaOffset || privOffset || buf.length;

  let data;
  try {
    data = brotliDecompressSync(buf.subarray(pos, pos + totalCompressedSize));
  } catch {
    data = brotliDecompressSync(buf.subarray(pos, hardEnd));
  }

  const tables = {};
  let off = 0;
  for (const e of dir) {
    tables[e.tag] = data.subarray(off, off + e.length);
    off += e.length;
  }
  return tables;
}

// ------------------------------------------------------------ düz sfnt

/** otf/ttf -> { tag: Buffer } */
function sfntTables(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = buf.toString("latin1", p, p + 4);
    const offset = buf.readUInt32BE(p + 8);
    const length = buf.readUInt32BE(p + 12);
    tables[tag] = buf.subarray(offset, offset + length);
  }
  return tables;
}

// ---------------------------------------------------------------- cmap

function lookupFormat4(t, base, cp) {
  if (cp > 0xffff) return 0;
  const segCount = t.readUInt16BE(base + 6) / 2;
  const endBase = base + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;

  for (let i = 0; i < segCount; i++) {
    const end = t.readUInt16BE(endBase + i * 2);
    if (cp > end) continue;
    const start = t.readUInt16BE(startBase + i * 2);
    if (cp < start) return 0;
    const delta = t.readInt16BE(deltaBase + i * 2);
    const rangeOffset = t.readUInt16BE(rangeBase + i * 2);
    if (rangeOffset === 0) return (cp + delta) & 0xffff;
    const gp = rangeBase + i * 2 + rangeOffset + (cp - start) * 2;
    if (gp + 1 >= t.length) return 0;
    const g = t.readUInt16BE(gp);
    return g === 0 ? 0 : (g + delta) & 0xffff;
  }
  return 0;
}

function lookupFormat12(t, base, cp) {
  const nGroups = t.readUInt32BE(base + 12);
  for (let i = 0; i < nGroups; i++) {
    const g = base + 16 + i * 12;
    const start = t.readUInt32BE(g);
    const end = t.readUInt32BE(g + 4);
    if (cp < start) return 0;
    if (cp > end) continue;
    return t.readUInt32BE(g + 8) + (cp - start);
  }
  return 0;
}

function lookupFormat6(t, base, cp) {
  const first = t.readUInt16BE(base + 6);
  const count = t.readUInt16BE(base + 8);
  if (cp < first || cp >= first + count) return 0;
  return t.readUInt16BE(base + 10 + (cp - first) * 2);
}

/** cmap tablosundan Unicode alt tablolarını seçip kod noktası -> gid çözer. */
function makeCmapLookup(cmap) {
  const numTables = cmap.readUInt16BE(2);
  const subs = [];
  for (let i = 0; i < numTables; i++) {
    const p = 4 + i * 8;
    const platformID = cmap.readUInt16BE(p);
    const encodingID = cmap.readUInt16BE(p + 2);
    const offset = cmap.readUInt32BE(p + 4);
    if (offset + 4 > cmap.length) continue;
    const format = cmap.readUInt16BE(offset);
    const unicode =
      platformID === 0 ||
      (platformID === 3 && (encodingID === 1 || encodingID === 10));
    if (!unicode) continue;
    // format 12 önce (tam Unicode), sonra 4, sonra 6
    const rank = format === 12 ? 0 : format === 4 ? 1 : format === 6 ? 2 : 9;
    if (rank === 9) continue;
    subs.push({ offset, format, rank });
  }
  subs.sort((a, b) => a.rank - b.rank);
  if (!subs.length) return null;

  return (cp) => {
    for (const s of subs) {
      let g = 0;
      if (s.format === 12) g = lookupFormat12(cmap, s.offset, cp);
      else if (s.format === 4) g = lookupFormat4(cmap, s.offset, cp);
      else if (s.format === 6) g = lookupFormat6(cmap, s.offset, cp);
      if (g) return g;
    }
    return 0;
  };
}

// ---------------------------------------------------------------- ana

function tablesOf(file, buf) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".woff2") return woff2Tables(buf);
  if (ext === ".otf" || ext === ".ttf") return sfntTables(buf);
  throw new Error(`desteklenmeyen uzantı ${ext}`);
}

/**
 * Bir karakter kapsanıyor mu?
 * Doğrudan cmap'te yoksa NFD parçalarına bakılır: fontlar ज़ (U+095B) gibi
 * bileşikleri çoğu zaman ज + ़ + GSUB ile üretir, cmap'te tek kod noktası yoktur.
 */
function charCovered(lookup, ch) {
  if (lookup(ch.codePointAt(0))) return true;
  const nfd = ch.normalize("NFD");
  if (nfd === ch) return false;
  return Array.from(nfd).every((c) => lookup(c.codePointAt(0)));
}

async function checkFile(file) {
  const buf = await readFile(file);
  const tables = tablesOf(file, buf);
  const cmap = tables["cmap"];
  if (!cmap) throw new Error("cmap tablosu yok");
  const lookup = makeCmapLookup(cmap);
  if (!lookup) throw new Error("kullanılabilir Unicode cmap alt tablosu yok");

  const missing = [];
  for (const [ch, cp] of TURKISH) if (!lookup(cp)) missing.push(ch);

  // Dosya adının vaat ettiği latin dışı yazılar gerçekten var mı?
  const scripts = [];
  for (const s of TAG_SCRIPTS[tagOf(path.basename(file))] || []) {
    const probe = SCRIPT_PROBES[s];
    const bad = Array.from(probe.sample).filter((c) => !charCovered(lookup, c));
    scripts.push({ script: s, ...probe, ok: bad.length === 0, bad });
  }
  return { missing, scripts };
}

async function main() {
  let targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!targets.length) targets = [FONT_DIR];

  const files = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    let entries;
    try {
      entries = await readdir(abs);
    } catch {
      files.push(abs); // dizin değil -> tek dosya
      continue;
    }
    for (const e of entries) {
      if (/\.(woff2|otf|ttf)$/i.test(e)) files.push(path.join(abs, e));
    }
  }
  files.sort();

  const rows = [];
  for (const f of files) {
    const name = path.basename(f);
    try {
      const { missing, scripts } = await checkFile(f);
      rows.push({ name, ok: missing.length === 0, missing, scripts, error: null });
    } catch (err) {
      rows.push({ name, ok: false, missing: [], scripts: [], error: err.message });
    }
  }

  const width = Math.max(...rows.map((r) => r.name.length), 10);
  console.log("\nTürkçe glif kontrolü (ş Ş ğ Ğ ı İ ç Ç ö Ö ü Ü)\n");
  for (const r of rows) {
    const pad = r.name.padEnd(width);
    if (r.error) console.log(`  ?  ${pad}  HATA: ${r.error}`);
    else if (r.ok) console.log(`  OK ${pad}  tam destek`);
    else console.log(`  X  ${pad}  EKSİK: ${r.missing.join(" ")}`);
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length} dosya — ${rows.length - bad.length} tam, ${bad.length} sorunlu`);

  // ---------------------------------------------------------- latin dışı
  const withScripts = rows.filter((r) => r.scripts && r.scripts.length);
  const scriptFails = [];
  if (withScripts.length) {
    console.log("\nLatin dışı kapsama (dosya adı ekinin vaadi cmap'ten doğrulandı)\n");
    console.log(
      `  ${"dosya".padEnd(width)}  ${"dil".padEnd(8)}  ${"yazı".padEnd(14)}  örnek        sonuç`
    );
    for (const r of withScripts) {
      for (const s of r.scripts) {
        if (!s.ok) scriptFails.push(`${r.name}: ${s.label} — eksik ${s.bad.join(" ")}`);
        console.log(
          `  ${r.name.padEnd(width)}  ${s.locale.padEnd(8)}  ${s.label.padEnd(14)}  ` +
            `${s.sample.padEnd(11)}  ${s.ok ? "OK" : "X EKSİK: " + s.bad.join(" ")}`
        );
      }
    }
    const okCount = withScripts.reduce((n, r) => n + r.scripts.filter((s) => s.ok).length, 0);
    const total = withScripts.reduce((n, r) => n + r.scripts.length, 0);
    console.log(`\n${total} kapsama testi — ${okCount} geçti, ${total - okCount} kaldı`);
  }

  // Latin dışı dillerin HER BİRİ için en az bir dosya var mı?
  console.log("\nDil → yazı → kapsayan dosya\n");
  const gaps = [];
  for (const [script, probe] of Object.entries(SCRIPT_PROBES)) {
    const hits = withScripts.filter((r) => r.scripts.some((s) => s.script === script && s.ok));
    if (!hits.length) gaps.push(`${probe.locale} (${probe.label}) — kapsayan dosya YOK`);
    console.log(
      `  ${probe.locale.padEnd(8)} ${probe.label.padEnd(14)} ${String(hits.length).padStart(2)} dosya  ` +
        (hits.length ? hits.map((h) => h.name).join(", ") : "— TOFU RİSKİ")
    );
  }
  console.log("");

  if (STRICT && (scriptFails.length || gaps.length)) {
    for (const l of [...scriptFails, ...gaps]) console.error("  ! " + l);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[check-glyphs] hata:", err);
  process.exit(1);
});
