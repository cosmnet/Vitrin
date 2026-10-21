#!/usr/bin/env node
// Vitrin Studio — ThreeUI bundle açıcı + uyarlayıcı.
//
// vendor/threeui-bundles/*.json içindeki files[].code alanlarını
// vendor/threeui/<path> olarak diske yazar, sonra Next.js'te derlenebilmesi
// için MİNİMUM uyarlamayı uygular ve stilleri components/fx/fx.css'e toplar.
//
// Kural: bileşenler önizlemeden YENİDEN YAZILMAZ. Kod bundle'dan birebir
// gelir; aşağıdaki uyarlamalar dışında tek karakter değişmez ve her uyarlama
// dosyanın başındaki başlık yorumunda listelenir.
//
// Uygulanan uyarlamalar
//   1. `import x from "./y.html?raw"`  ->  `import x from "./y.html.raw"`
//      Vite'ın ?raw eki webpack/turbopack'te yok. Her .html için yanına
//      `<ad>.html.raw.ts` modülü üretilir (`export default "<html>"`).
//      Bundle'da olmayan kaynaklar için boş string döndüren stub üretilir.
//   2. CSS yan-etki importları (`import "./x.css"`) kaldırılır — o stiller
//      components/fx/fx.css içinde toplanır.
//   3. section-elements'teki `new URL("./assets/*.svg", import.meta.url)`
//      satırları "" ile değiştirilir; o SVG'ler bundle'da yok, çözülemeyen
//      asset importu derlemeyi kırıyor.
//   4. fx.css üretilirken hedef dosyası bundle'da olmayan @font-face
//      blokları atılır (yine çözülemeyen url() derlemeyi kırıyor).
//
// three: bundle'daki TS/TSX dosyalarının hiçbiri `three` paketini import
// etmiyor (CRT ham WebGL1, predictive-arc canvas2d, gerisi srcDoc iframe).
// r128 API farkı sadece iframe'lerin KENDİ içinde geçerli, kurulu
// three@0.185 ile temas etmiyor — bu yüzden outputEncoding vb. dokunulmadı.
//
// Kullanım:
//   node scripts/unpack-threeui.mjs           # aç + uyarla + fx.css üret
//   node scripts/unpack-threeui.mjs --check   # sadece doğrula, diske yazma

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BUNDLE_DIR = join(ROOT, "vendor", "threeui-bundles");
const OUT_CODE = join(ROOT, "vendor", "threeui");
const OUT_ASSETS = join(ROOT, "public", "assets", "threeui");
const FX_CSS = join(ROOT, "components", "fx", "fx.css");

const CHECK_ONLY = process.argv.includes("--check");

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** path traversal koruması — bundle'daki path'e körü körüne güvenme */
function safeJoin(base, rel) {
  const p = resolve(base, rel);
  if (p !== base && !p.startsWith(base + sep)) throw new Error(`Güvensiz path: ${rel}`);
  return p;
}

function write(absPath, data) {
  if (CHECK_ONLY) return;
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, data);
}

// ---------------------------------------------------------------- 1. topla

const bundleFiles = readdirSync(BUNDLE_DIR).filter((f) => f.endsWith(".json")).sort();

/** path -> { sha, code, bundles[] } */
const files = new Map();
const stats = { bundles: 0, deduped: 0, assets: 0, mismatch: 0 };

for (const fileName of bundleFiles) {
  const bundle = JSON.parse(readFileSync(join(BUNDLE_DIR, fileName), "utf8"));
  stats.bundles++;

  for (const file of bundle.files ?? []) {
    const actual = sha256(file.code);
    if (file.sha256 && file.sha256 !== actual) {
      console.warn(`  ! sha uyuşmuyor ${file.path} (bundle=${bundle.id})`);
      stats.mismatch++;
    }
    const prev = files.get(file.path);
    if (prev) {
      if (prev.sha !== actual) {
        throw new Error(`Aynı path iki farklı içerikle geldi: ${file.path}`);
      }
      prev.bundles.push(bundle.id);
      stats.deduped++;
      continue;
    }
    files.set(file.path, { sha: actual, code: file.code, bundles: [bundle.id] });
  }

  for (const asset of bundle.assets ?? []) {
    if (typeof asset === "string") {
      console.log(`  · asset bildirimi (ikili veri yok): ${asset}`);
      continue;
    }
    if (asset?.path && typeof asset.data === "string") {
      write(safeJoin(OUT_ASSETS, asset.path), Buffer.from(asset.data, "base64"));
      stats.assets++;
    }
  }
}

// ---------------------------------------------------------- 2. uyarla + yaz

const RAW_IMPORT = /(from\s+")([^"]+\.html)\?raw(")/g;
const CSS_IMPORT = /^import\s+"\.\/[^"]+\.css";\n/gm;
const ASSET_URL = /new URL\("(\.\/assets\/[^"]+)", import\.meta\.url\)\.href/g;

/** ?raw ile istenen ama bundle'da olmayan html kaynakları */
const missingSources = new Set();
/** üretilecek `<x>.html.raw.ts` modülleri: path -> html içeriği (null = stub) */
const rawModules = new Map();

function header(commentStyle, path, sha, bundles, notes) {
  const lines = [
    `ThreeUI kaynağı — vendor/threeui-bundles/*.json içinden BİREBİR açıldı.`,
    `kaynak  : ${path}`,
    `sha256  : ${sha}`,
    `bundle  : ${bundles.join(", ")}`,
    `üretim  : node scripts/unpack-threeui.mjs — ELLE DÜZENLEME, ezilir.`,
    notes.length ? `uyarlama:` : `uyarlama: yok (bundle kodu aynen)`,
    ...notes.map((n) => `  - ${n}`),
  ];
  if (commentStyle === "css") return `/*\n${lines.map((l) => ` * ${l}`).join("\n")}\n */\n`;
  return `${lines.map((l) => `// ${l}`).join("\n")}\n`;
}

for (const [path, entry] of files) {
  const abs = safeJoin(OUT_CODE, path);
  const isCode = /\.tsx?$/.test(path);

  if (!isCode) {
    // .html ve .css bundle'dan byte-exact çıkar (html'ler srcDoc yükü,
    // css'ler fx.css'e toplanacak kaynak).
    write(abs, entry.code);
    continue;
  }

  const notes = [];
  let code = entry.code;

  // 1. ?raw importları
  code = code.replace(RAW_IMPORT, (_m, pre, spec, post) => {
    const target = resolve(dirname(abs), spec);
    rawModules.set(target, files.has(relative(OUT_CODE, target).split(sep).join("/")) ? target : null);
    if (!files.has(relative(OUT_CODE, target).split(sep).join("/"))) {
      missingSources.add(relative(OUT_CODE, target).split(sep).join("/"));
    }
    return `${pre}${spec}.raw${post}`;
  });
  if (RAW_IMPORT.test(entry.code)) {
    notes.push(`"…​.html?raw" importları "….html.raw" TS modülüne çevrildi (Vite -> Next).`);
  }
  RAW_IMPORT.lastIndex = 0;

  // 2. CSS yan-etki importları
  if (CSS_IMPORT.test(code)) {
    CSS_IMPORT.lastIndex = 0;
    const removed = code.match(CSS_IMPORT).map((m) => m.trim());
    code = code.replace(CSS_IMPORT, "");
    notes.push(`CSS importu kaldırıldı (${removed.join(" ")}) — components/fx/fx.css'te toplandı.`);
  }
  CSS_IMPORT.lastIndex = 0;

  // 3. bundle'da olmayan SVG asset URL'leri
  if (ASSET_URL.test(code)) {
    ASSET_URL.lastIndex = 0;
    code = code.replace(ASSET_URL, '""');
    notes.push(`assets/*.svg bundle'da yok; new URL(...) yerine "" (o bölümlerde boş görsel).`);
  }
  ASSET_URL.lastIndex = 0;

  write(abs, header("js", path, entry.sha, entry.bundles, notes) + code);
}

// ------------------------------------------------- 3. .html.raw.ts modülleri

let rawWritten = 0;
let rawStubs = 0;
for (const target of rawModules.keys()) {
  const rel = relative(OUT_CODE, target).split(sep).join("/");
  const entry = files.get(rel);
  const modulePath = `${target}.raw.ts`;
  const notes = entry
    ? [`${basename(rel)} içeriği string sabite gömüldü (Vite ?raw karşılığı).`]
    : [`Bu kaynak satın alınan 13 bundle'da YOK — boş string stub. İlgili varyant boş iframe basar.`];
  const body = entry
    ? `export default ${JSON.stringify(entry.code)};\n`
    : `export default "";\n`;
  write(
    modulePath,
    header("js", `${rel}?raw`, entry ? entry.sha : "—", entry ? entry.bundles : ["yok"], notes) + body,
  );
  entry ? rawWritten++ : rawStubs++;
}

// ------------------------------------------------------------ 4. fx.css topla

const CSS_SOURCES = [
  "src/shaders/threeui.css",
  "src/shaders/section-elements/section-elements.css",
  "src/shaders/lumen-cta/lumen-cta.css",
];

const FONT_FACE = /@font-face\s*\{[^}]*\}\n?/g;
const LOCAL_URL = /url\("(\.[^"]+)"\)/g;

const cssChunks = [];
let droppedFaces = 0;

for (const rel of CSS_SOURCES) {
  const entry = files.get(rel);
  if (!entry) {
    console.warn(`  ! fx.css: ${rel} bundle'da yok, atlandı`);
    continue;
  }
  const dropped = [];
  const body = entry.code.replace(FONT_FACE, (block) => {
    const urls = [...block.matchAll(LOCAL_URL)].map((m) => m[1]);
    const missing = urls.filter((u) => !files.has(relative(OUT_CODE, resolve(dirname(safeJoin(OUT_CODE, rel)), u)).split(sep).join("/")));
    if (!missing.length) return block;
    dropped.push(...missing);
    droppedFaces++;
    return "";
  });
  cssChunks.push(
    header("css", rel, entry.sha, entry.bundles, [
      `components/fx/fx.css içine toplandı; bileşenlerdeki CSS importu kaldırıldı.`,
      ...(dropped.length
        ? [`@font-face atıldı — woff2 dosyaları bundle'da yok: ${[...new Set(dropped)].map((d) => basename(d)).join(", ")} (sistem fontuna düşer).`]
        : []),
    ]) + body.trim() + "\n",
  );
}

const fxCss =
  `/* Vitrin Studio — ThreeUI stil derlemesi. ÜRETİLMİŞ DOSYA.\n` +
  `   node scripts/unpack-threeui.mjs ile yeniden üretilir; elle düzenleme.\n` +
  `   Tüm seçiciler sınıf tabanlı, global element resetleri yok — uygulamanın\n` +
  `   kendi stillerine dokunmaz. */\n\n` +
  cssChunks.join("\n");

write(FX_CSS, fxCss);

// -------------------------------------------------------------- 5. manifest

const manifest = Object.fromEntries(
  [...files.entries()].sort().map(([path, v]) => [path, { sha256: v.sha, bundles: v.bundles }]),
);
if (!CHECK_ONLY) {
  writeFileSync(
    join(OUT_CODE, "MANIFEST.json"),
    JSON.stringify({ files: manifest, missingRawSources: [...missingSources].sort() }, null, 2) + "\n",
  );
}

console.log(
  `\nThreeUI: ${stats.bundles} bundle · ${files.size} dosya · ${stats.deduped} tekrar · ` +
    `${stats.assets} asset · ${stats.mismatch} sha uyuşmazlığı`,
);
console.log(`  html.raw modülü : ${rawWritten} gerçek + ${rawStubs} stub (bundle'da olmayan kaynak)`);
console.log(`  fx.css          : ${cssChunks.length} stil dosyası, ${droppedFaces} @font-face atıldı`);
console.log(`  kod  -> ${OUT_CODE}`);
console.log(`  stil -> ${FX_CSS}`);
if (CHECK_ONLY) console.log("  (--check: diske yazılmadı)");
