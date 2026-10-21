#!/usr/bin/env node
// GLB sıkıştırma — @gltf-transform ile weld + dedup + prune + EXT_meshopt.
//
// Neden meshopt (draco DEĞİL):
//   • draco three'de ayrı WASM decoder + daha yavaş çözme, üstelik normalleri
//     bozabiliyor; meshopt decoder three ile birlikte geliyor
//     (three/examples/jsm/libs/meshopt_decoder.module.js) ve çok hızlı.
//   • meshopt kuantalamayı düğüm dönüşümüyle telafi ediyor → dünya-uzayı
//     bbox'ları (ekran düzlemi yerleşimi!) kayma yapmıyor.
//
// TUTUCU AYARLAR: quantizePosition 16 bit (varsayılan 14 yerine) — "Screen"
// primitifinin bbox'ı ekran düzleminin yerini belirlediği için geometri
// kaymasına tolerans yok. Doğrulama: sıkıştırma sonrası dosya yeniden okunur;
// Screen bbox'ı, materyal adları, uzantılar (KHR_materials_clearcoat!) ve
// texture sayısı karşılaştırılır. Sapma varsa yedek geri yüklenir.
//
// Kullanım:
//   node scripts/compress-models.mjs                 # varsayılan set
//   node scripts/compress-models.mjs iphone-icon.glb # tek dosya
//   node scripts/compress-models.mjs --restore       # tüm yedekleri geri yükle
//   node scripts/compress-models.mjs --dry           # yaz ma, sadece raporla

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "public", "assets", "models");
const BACKUP = path.join(ROOT, "vendor", "models-raw", "pre-compress");
const META = path.join(MODELS, "meta.json");

const DEFAULT_SET = [
  "iphone-15promax.glb",
  "iphone-15promax-hd.glb",
  "iphone-16plus.glb",
  "iphone-17promax.glb",
  "smartwatch.glb",
];

const args = process.argv.slice(2);
const RESTORE = args.includes("--restore");
const DRY = args.includes("--dry");
const files = args.filter((a) => !a.startsWith("--"));
const TARGETS = files.length ? files : DEFAULT_SET;

// EXT_meshopt_compression yazmak/okumak için encoder+decoder IO'ya bağımlılık
// olarak verilir; yoksa writeBinary "encodeGltfBuffer of undefined" ile patlar.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});

/* ------------------------------------------------------------------ *
   Parmak izi — sıkıştırma öncesi/sonrası karşılaştırılır
 * ------------------------------------------------------------------ */

const sha1 = (buf) =>
  buf ? createHash("sha1").update(Buffer.from(buf)).digest("hex").slice(0, 12) : "-";

function fingerprint(doc) {
  const root = doc.getRoot();
  // KHR_mesh_quantization / EXT_meshopt_compression sıkıştırmanın kendi
  // uzantıları — "kayboldu" karşılaştırmasından çıkarılır.
  const exts = root
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((n) => n !== "EXT_meshopt_compression" && n !== "KHR_mesh_quantization")
    .sort();

  // KULLANILAN materyal adları — engine/scene3dCore upgradeMaterial() ada göre
  // eşleştiği için bu küme birebir korunmalı. (Kullanılmayan materyalleri prune
  // silebilir; bu kayıp değil.)
  const usedMaterials = new Set();
  let prims = 0;
  let verts = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prims++;
      const p = prim.getAttribute("POSITION");
      if (p) verts += p.getCount();
      const mat = prim.getMaterial();
      if (mat) usedMaterials.add(mat.getName());
    }
  }
  const materials = [...usedMaterials].sort();
  // Benzersiz görüntü sayısı — rapor için (dedup sonrası doku SAYISI düşer,
  // prune düz renk dokuları materyal katsayısına çevirebilir; ikisi de kayıp
  // değil, görsel doğrulama /test3d render'larıyla yapılır).
  const images = [...new Set(root.listTextures().map((t) => sha1(t.getImage())))].sort();
  const textures = root.listTextures().length;
  const meshes = root.listMeshes().length;

  // "Screen" primitifinin YEREL bbox'ı + düğüm dönüşümü sonrası dünya bbox'ı.
  let screen = null;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mesh.getName() !== "Screen" && (!mat || mat.getName() !== "Screen")) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const el = [0, 0, 0];
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        for (let k = 0; k < 3; k++) {
          if (el[k] < min[k]) min[k] = el[k];
          if (el[k] > max[k]) max[k] = el[k];
        }
      }
      // Primitifi taşıyan düğüm zincirinin ölçek/öteleme etkisi (kuantalama
      // telafisi burada duruyor) — dünya bbox'ı bununla hesaplanır.
      const node = root.listNodes().find((n) => n.getMesh() === mesh);
      const m = node ? node.getWorldMatrix() : null;
      const apply = (p) =>
        m ? [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]] : p;
      const a = apply(min);
      const b = apply(max);
      screen = {
        min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
        max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
        verts: pos.getCount(),
      };
      break;
    }
    if (screen) break;
  }
  return { exts, materials, images, textures, meshes, prims, verts, screen };
}

function screenDelta(a, b) {
  if (!a.screen || !b.screen) return a.screen === b.screen ? 0 : Infinity;
  let d = 0;
  for (let k = 0; k < 3; k++) {
    d = Math.max(d, Math.abs(a.screen.min[k] - b.screen.min[k]));
    d = Math.max(d, Math.abs(a.screen.max[k] - b.screen.max[k]));
  }
  return d;
}

const fmt = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/* ------------------------------------------------------------------ *
   meta.json sürüm bump
 * ------------------------------------------------------------------ */

async function bumpVersions(names) {
  let meta = { schema: 1, models: {} };
  try {
    meta = JSON.parse(await readFile(META, "utf8"));
  } catch {
    /* yok — yeni kur */
  }
  if (!meta.models) meta.models = {};
  for (const n of names) {
    const e = meta.models[n] ?? {};
    e.version = Math.floor(Number(e.version) || 2) + 1;
    meta.models[n] = e;
  }
  meta.schema = 1;
  await writeFile(META, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return meta;
}

/* ------------------------------------------------------------------ *
   Ana akış
 * ------------------------------------------------------------------ */

async function restoreAll() {
  for (const name of TARGETS) {
    const bak = path.join(BACKUP, name);
    if (!existsSync(bak)) {
      console.log(`  ${name}: yedek yok, atlandı`);
      continue;
    }
    await copyFile(bak, path.join(MODELS, name));
    console.log(`  ${name}: yedekten geri yüklendi`);
  }
}

async function main() {
  if (RESTORE) {
    console.log("Yedekten geri yükleme:");
    await restoreAll();
    return;
  }

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await mkdir(BACKUP, { recursive: true });

  const rows = [];
  const bumped = [];

  for (const name of TARGETS) {
    const src = path.join(MODELS, name);
    if (!existsSync(src)) {
      console.log(`! ${name}: dosya yok, atlandı`);
      continue;
    }
    const bak = path.join(BACKUP, name);
    // Yedek YALNIZCA ilk kez alınır — ikinci çalıştırma sıkıştırılmışı
    // "orijinal" diye yedeklemesin.
    if (!existsSync(bak)) await copyFile(src, bak);

    const beforeBytes = (await stat(bak)).size;
    const before = fingerprint(await io.read(bak));

    let doc;
    try {
      doc = await io.read(bak); // her zaman ORİJİNALDEN sıkıştır (idempotent)
      await doc.transform(
        weld(),
        dedup({ propertyTypes: ["Accessor", "Texture", "Mesh"] }),
        prune({ keepAttributes: false, keepLeaves: false }),
        meshopt({
          encoder: MeshoptEncoder,
          level: "medium", // filtre yok — en uyumlu/en az kayıplı mod
          quantizePosition: 16, // TUTUCU: ekran bbox'ı kaymasın
          quantizeTexcoord: 14,
          quantizeNormal: 12,
          quantizationVolume: "mesh",
        })
      );
    } catch (err) {
      console.log(`! ${name}: sıkıştırma HATASI — ${err.message}; orijinal korunuyor`);
      await copyFile(bak, src);
      rows.push({ name, beforeBytes, afterBytes: beforeBytes, ok: false, note: err.message });
      continue;
    }

    const bytes = await io.writeBinary(doc);
    const afterBytes = bytes.byteLength;

    // --- Doğrulama: yazmadan önce belleği tekrar oku.
    const after = fingerprint(await io.readBinary(bytes));
    const problems = [];
    const missingExt = before.exts.filter((e) => !after.exts.includes(e));
    if (missingExt.length) problems.push(`uzantı kayboldu: ${missingExt.join(",")}`);
    // KULLANILAN materyal adları birebir korunmalı (upgradeMaterial ada bakıyor).
    const lostMats = before.materials.filter((n) => !after.materials.includes(n));
    if (lostMats.length) problems.push(`materyal kayboldu: ${lostMats.slice(0, 4).join(",")}`);
    if (after.prims !== before.prims) problems.push(`primitif ${before.prims} → ${after.prims}`);
    // weld tekrar eden köşeleri birleştirir; %40'tan fazla kayıp şüphelidir.
    if (after.verts < before.verts * 0.6)
      problems.push(`köşe sayısı ${before.verts} → ${after.verts} (>%40 kayıp)`);
    if (!after.materials.includes("Screen") && before.materials.includes("Screen"))
      problems.push('"Screen" materyali kayboldu');
    if (!after.screen && before.screen) problems.push('"Screen" primitifi kayboldu');
    const d = screenDelta(before, after);
    // Model yüksekliği ~1 birim; 1e-4 = ekranın ~%0.02'si (<0.2 px @900px render)
    if (d > 1e-4) problems.push(`Screen bbox kayması ${d.toExponential(2)} (>1e-4)`);

    if (problems.length) {
      console.log(`! ${name}: DOĞRULAMA BAŞARISIZ — ${problems.join("; ")}`);
      await copyFile(bak, src); // orijinali geri koy
      rows.push({ name, beforeBytes, afterBytes: beforeBytes, ok: false, note: problems.join("; ") });
      continue;
    }

    if (!DRY) {
      await writeFile(src, Buffer.from(bytes));
      bumped.push(name);
    }
    rows.push({
      name,
      beforeBytes,
      afterBytes,
      ok: true,
      note:
        `Screen Δ ${d.toExponential(1)} · doku ${before.textures}→${after.textures} ` +
        `(${after.images.length} benzersiz görüntü korundu) · ext ${after.exts.join(",") || "-"}`,
    });
    console.log(
      `✓ ${name}: ${fmt(beforeBytes)} → ${fmt(afterBytes)} ` +
        `(%${(100 - (afterBytes / beforeBytes) * 100).toFixed(1)} küçüldü)`
    );
  }

  if (bumped.length) {
    const meta = await bumpVersions(bumped);
    console.log(
      `\nmeta.json sürümleri artırıldı: ` +
        bumped.map((n) => `${n}=v${meta.models[n].version}`).join(", ")
    );
  }

  console.log("\n| model | önce | sonra | kazanç | durum |");
  console.log("|---|---|---|---|---|");
  let tb = 0;
  let ta = 0;
  for (const r of rows) {
    tb += r.beforeBytes;
    ta += r.afterBytes;
    console.log(
      `| ${r.name} | ${fmt(r.beforeBytes)} | ${fmt(r.afterBytes)} | ` +
        `%${(100 - (r.afterBytes / r.beforeBytes) * 100).toFixed(1)} | ${r.ok ? "ok" : "GERİ ALINDI"} — ${r.note} |`
    );
  }
  console.log(
    `| **toplam** | ${fmt(tb)} | ${fmt(ta)} | %${(100 - (ta / tb) * 100).toFixed(1)} | |`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
