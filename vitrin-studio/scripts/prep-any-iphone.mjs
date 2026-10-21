// Herhangi bir iPhone GLB'sini Vitrin Studio formatına hazırlar.
//
// prep-iphone17.mjs'in genelleştirilmiş sürümü: o script tek bir Envato
// modelinin elle çıkarılmış node adlarına bağlıydı, bu script aynı
// dikleştirme mantığını (ekran normali → +Z, PCA ile uzun eksen → +Y,
// kamera/ön-arka doğrulaması) HERHANGİ bir kaynağa uygular ve — kritik fark —
// texture'lı modellerde texture'ları KORUR.
//
//   node scripts/prep-any-iphone.mjs <girdi.glb> <ad> [seçenekler]
//     --scheme=auto|preserve|flat   materyal şeması (varsayılan auto)
//     --slim=1.0                    Z ekseninde geometriye işlenen incelik
//     --height=1.0                  çıktı yüksekliği (Y ekseni)
//     --drop=<regex>                "<node> <materyal>" ile eşleşen primitifleri
//                                   BAKE'TEN ÇIKARIR (ör. ekranın önündeki
//                                   ayna gibi cam kabuğu → glare)
//     --dry                         dosya yazma, sadece raporla
//
//   → public/assets/models/iphone-<ad>.glb
//
// Şema notu (engine/scene3dCore.ts sözleşmesi):
//   findScreenMesh() TAM "Screen" adını arar → ekran materyali mutlaka "Screen".
//   upgradeMaterial() Body/Side/Glass/Flash/... adlarını düz PBR ile EZER; null
//   dönerse orijinal materyal (texture'larıyla) korunur. Bu yüzden texture'lı
//   modellerde sınıf adlarına ".tex" eklenir: anlam korunur ama engine ezmez.

import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { transformPrimitive, dequantize } from "@gltf-transform/functions";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- argümanlar
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  })
);
if (positional.length < 2) {
  console.error("kullanım: node scripts/prep-any-iphone.mjs <girdi.glb> <ad> [--scheme=..] [--slim=..] [--height=..] [--dry]");
  process.exit(1);
}
const SRC = path.resolve(positional[0]);
const NAME = positional[1];
const DST = path.resolve("public/assets/models", `iphone-${NAME}.glb`);
const SCHEME = flags.scheme ?? "auto";
const SLIM = Number(flags.slim ?? 1);
const OUT_H = Number(flags.height ?? 1);
const DRY = !!flags.dry;
const DROP_RE = flags.drop ? new RegExp(flags.drop, "i") : null;

// ------------------------------------------------------- vektör/matris yard.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** a birim vektörünü b birim vektörüne taşıyan 3x3 rotasyon (Rodrigues), satır-öncelikli. */
function rotBetween(a, b) {
  const v = cross(a, b);
  const c = dot(a, b);
  if (c > 0.9999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (c < -0.9999) {
    const axis = norm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return axisAngle(axis, Math.PI);
  }
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}
function axisAngle(u, t) {
  const c = Math.cos(t), s = Math.sin(t), ic = 1 - c;
  return [
    c + u[0] * u[0] * ic, u[0] * u[1] * ic - u[2] * s, u[0] * u[2] * ic + u[1] * s,
    u[1] * u[0] * ic + u[2] * s, c + u[1] * u[1] * ic, u[1] * u[2] * ic - u[0] * s,
    u[2] * u[0] * ic - u[1] * s, u[2] * u[1] * ic + u[0] * s, c + u[2] * u[2] * ic,
  ];
}
const mulM3 = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const applyM3 = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];
/** satır-öncelikli 3x3 → sütun-öncelikli mat4 (glTF / transformPrimitive). */
const m3ToM4 = (R) => [
  R[0], R[3], R[6], 0,
  R[1], R[4], R[7], 0,
  R[2], R[5], R[8], 0,
  0, 0, 0, 1,
];
/** p' = (p - c) * s  (s: [sx,sy,sz]) — sütun-öncelikli mat4. */
const centerScaleM4 = (c, s) => [
  s[0], 0, 0, 0,
  0, s[1], 0, 0,
  0, 0, s[2], 0,
  -s[0] * c[0], -s[1] * c[1], -s[2] * c[2], 1,
];
const mulM4v = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// ------------------------------------------------------------------- oku
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
// Draco girdileri için decoder. "draco3d" bu projede --no-save kurulmuştu ve
// node_modules sıfırlanınca kayboluyor; @gltf-transform/cli ile birlikte gelen
// "draco3dgltf" aynı API'yi sunuyor → yedek olarak o denenir. Hiçbiri yoksa
// sıkıştırılmamış girdiler yine çalışır, Draco'lu girdi net hata verir.
for (const pkg of ["draco3d", "draco3dgltf"]) {
  try {
    const draco = (await import(pkg)).default;
    io.registerDependencies({
      "draco3d.decoder": await draco.createDecoderModule(),
      "draco3d.encoder": await draco.createEncoderModule(),
    });
    break;
  } catch { /* sıradakini dene */ }
}

console.log(`\n=== ${path.basename(SRC)} → iphone-${NAME}.glb ===`);
const doc = await io.read(SRC);
await doc.transform(dequantize());
const root = doc.getRoot();
const scene = root.listScenes()[0];

// ------------------------------------------------------- 0) istenmeyen parçalar
// Bazı kaynaklarda ekranın ÖNÜNDE ayrı bir cam kabuğu var (metalness=1,
// roughness=0, alphaMode=BLEND). Engine'in screenshot düzlemi onun ARKASINDA
// kaldığı için ekranın üstüne ortam yansıması (glare şeridi + üstte geniş koyu
// bant) biniyor. Böyle parçalar bake'te çıkarılır.
if (DROP_RE) {
  let dropped = 0;
  const walkDrop = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const key = `${node.getName() ?? ""} ${mesh.getName() ?? ""} ${prim.getMaterial()?.getName() ?? ""}`;
        if (DROP_RE.test(key)) {
          console.log(`  ÇIKARILDI: ${key.trim()}  (${(prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION").getCount()) / 3} üçgen)`);
          prim.dispose();
          dropped++;
        }
      }
      if (!mesh.listPrimitives().length) { mesh.dispose(); node.dispose(); return; }
    }
    node.listChildren().forEach(walkDrop);
  };
  scene.listChildren().forEach(walkDrop);
  console.log(`  --drop="${flags.drop}" → ${dropped} primitif çıkarıldı`);
}

// --------------------------------------- 1) dünya dönüşümlerini geometriye bak
// Node hiyerarşisini düzleştir: her mesh-node'un dünya matrisi vertex'lere
// işlenir, TRS sıfırlanır ve node sahne köküne taşınır. Paylaşılan accessor'lar
// (iki prim aynı POSITION'ı gösteriyorsa) önce ayrıştırılır — aksi halde
// dönüşüm iki kez uygulanır.
function uniqueAttrs(prim) {
  for (const key of ["POSITION", "NORMAL", "TANGENT"]) {
    const acc = prim.getAttribute(key);
    if (!acc) continue;
    if (acc.listParents().filter((p) => p.propertyType === "Primitive" || p.propertyType === "PrimitiveTarget").length > 1) {
      prim.setAttribute(key, doc.createAccessor()
        .setType(acc.getType())
        .setArray(acc.getArray().slice())
        .setBuffer(acc.getBuffer())
        .setNormalized(acc.getNormalized()));
    }
  }
}

const meshNodes = []; // { name, world, prims: Primitive[] }
{
  const seenMesh = new Map(); // Mesh -> kaç node kullanıyor
  const collect = (node) => {
    if (node.getMesh()) seenMesh.set(node.getMesh(), (seenMesh.get(node.getMesh()) ?? 0) + 1);
    node.listChildren().forEach(collect);
  };
  scene.listChildren().forEach(collect);

  const walk = (node) => {
    const world = node.getWorldMatrix();
    const mesh = node.getMesh();
    if (mesh) {
      // Aynı mesh birden fazla node'da ise her node için ayrı kopya gerekir.
      let target = mesh;
      if (seenMesh.get(mesh) > 1) {
        target = doc.createMesh(mesh.getName());
        for (const prim of mesh.listPrimitives()) {
          const p2 = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
          if (prim.getIndices()) p2.setIndices(prim.getIndices());
          for (const key of prim.listSemantics()) p2.setAttribute(key, prim.getAttribute(key));
          target.addPrimitive(p2);
        }
        node.setMesh(target);
      }
      for (const prim of target.listPrimitives()) uniqueAttrs(prim);
      meshNodes.push({ node, name: node.getName() || mesh.getName() || "(unnamed)", world, prims: target.listPrimitives() });
    }
    node.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);

  for (const mn of meshNodes) for (const prim of mn.prims) transformPrimitive(prim, mn.world);

  // Dünya matrisi artık vertex'lerde — node TRS'leri SIFIRLANMALI, aksi halde
  // three.js yüklerken dönüşümü ikinci kez uygular (Blender ihracatlarındaki
  // kök -90°X / 0.01 ölçek buradan sızıyordu).
  const reset = (node) => {
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    node.listChildren().forEach(reset);
  };
  scene.listChildren().forEach(reset);
}

/** prim'in POSITION'ından bbox + üçgen sayısı + alan-ağırlıklı normal. */
function primStats(prim) {
  const P = prim.getAttribute("POSITION").getArray();
  const I = prim.getIndices()?.getArray();
  const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (P[i + k] < min[k]) min[k] = P[i + k];
      if (P[i + k] > max[k]) max[k] = P[i + k];
    }
  // alan-ağırlıklı normal toplamı (|Σ n| = düzlemsellik göstergesi)
  let n = [0, 0, 0], area = 0;
  const cnt = I ? I.length : P.length / 3;
  const gi = (t) => (I ? I[t] : t);
  for (let t = 0; t + 2 < cnt; t += 3) {
    const a = gi(t) * 3, b = gi(t + 1) * 3, c = gi(t + 2) * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const x = cross(e1, e2);
    n = [n[0] + x[0], n[1] + x[1], n[2] + x[2]];
    area += len(x) * 0.5;
  }
  return {
    min, max,
    size: sub(max, min),
    ctr: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    tris: Math.floor(cnt / 3),
    nsum: n,           // ham (alan ağırlıklı) normal toplamı
    area,              // toplam yüzey alanı
    flatness: len(n) * 0.5 / (area || 1), // 1 = tam düzlem, 0 = kapalı hacim
  };
}

// ------------------------------------------------- 2) en büyük telefon kümesi
// Sahnede birden fazla nesne varsa (Envato modelinde iki telefon vardı)
// bbox'ları örtüşenler tek küme sayılır; en çok üçgene sahip küme tutulur.
let items = meshNodes.map((mn) => ({ ...mn, stats: mn.prims.map(primStats) }))
  .map((it) => {
    const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
    let tris = 0;
    for (const s of it.stats) {
      tris += s.tris;
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s.min[k]); max[k] = Math.max(max[k], s.max[k]); }
    }
    return { ...it, min, max, tris };
  })
  .filter((it) => it.tris > 0);

{
  const gmin = [1e30, 1e30, 1e30], gmax = [-1e30, -1e30, -1e30];
  for (const it of items) for (let k = 0; k < 3; k++) { gmin[k] = Math.min(gmin[k], it.min[k]); gmax[k] = Math.max(gmax[k], it.max[k]); }
  const eps = len(sub(gmax, gmin)) * 0.02;

  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] - eps <= b.max[k] && b.min[k] - eps <= a.max[k]);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (overlap(items[i], items[j])) parent[find(i)] = find(j);

  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  const ranked = [...groups.values()].sort((a, b) => b.reduce((s, x) => s + x.tris, 0) - a.reduce((s, x) => s + x.tris, 0));
  console.log(`  küme sayısı: ${ranked.length}` +
    (ranked.length > 1 ? `  → üçgen dağılımı: ${ranked.map((g) => g.reduce((s, x) => s + x.tris, 0)).join(" / ")}` : ""));
  if (ranked.length > 1) {
    const keep = new Set(ranked[0]);
    for (const it of items) if (!keep.has(it)) it.node.dispose();
    items = ranked[0];
    console.log(`  → en büyük küme tutuldu (${items.length} mesh-node)`);
  }
}

const allPrims = items.flatMap((it) => it.prims.map((p, i) => ({ prim: p, stats: it.stats[i], node: it.name })));

/** aday listesinin dünya bbox'ı. */
function bboxOf(list) {
  const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
  for (const p of list) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.stats.min[k]); max[k] = Math.max(max[k], p.stats.max[k]); }
  return { min, max, size: sub(max, min), ctr: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}
let box = bboxOf(allPrims);

// ------------------------------------------------------------- 3) ekran bulma
const SCREEN_RE = /screen|display|ekran|oled|lcd|wallpaper|scherm/i;
const SCREEN_EXCL_RE = /rim|frame|bezel|border|edge|out\b/i;
const CAM_RE = /cam|lens|optic|lidar|flash|torch/i;
const BOTTOM_RE = /usb|port|grill|grille|speaker|charg|lightning|conn/i;

const nameOf = (p) => `${p.node} ${p.prim.getMaterial()?.getName() ?? ""}`;

/** Model kalınlık ekseni (bbox'ın en kısa kenarı). */
const thinAxis = box.size.indexOf(Math.min(...box.size));
const faceArea = box.size.reduce((a, v, i) => (i === thinAxis ? a : a * v), 1);

let screenPrims = [];
let screenSource = "";
{
  // (a) ad ile: düzlemsel, ön yüzün en az %25'ini kaplayan aday.
  const named = allPrims.filter((p) => SCREEN_RE.test(nameOf(p)) && !SCREEN_EXCL_RE.test(nameOf(p)));
  const good = named.filter((p) => p.stats.flatness > 0.55 && p.stats.area > faceArea * 0.25);
  if (good.length) {
    // en düzlemsel + en ince olanı seç
    good.sort((a, b) => (a.stats.size[thinAxis] - b.stats.size[thinAxis]) || (b.stats.flatness - a.stats.flatness));
    const t0 = good[0].stats.size[thinAxis];
    screenPrims = good.filter((p) => p.stats.size[thinAxis] <= t0 + box.size[thinAxis] * 0.02);
    screenSource = `ad eşleşmesi (${screenPrims.map((p) => p.prim.getMaterial()?.getName()).join(", ")})`;
  }
  // (b) geometri ile: kalın eksenin uçlarındaki en geniş düz yüzey.
  if (!screenPrims.length) {
    const flat = allPrims
      .filter((p) => p.stats.flatness > 0.6 && p.stats.area > faceArea * 0.35 &&
        p.stats.size[thinAxis] < box.size[thinAxis] * 0.25)
      .sort((a, b) => b.stats.area - a.stats.area);
    if (flat.length) {
      screenPrims = [flat[0]];
      screenSource = `geometri (en geniş düz yüzey, alan=${flat[0].stats.area.toFixed(4)})`;
    }
  }
  // (c) ayrı ekran primi YOK (tek parça gövde + atlas texture): ön yüzeyin
  // üçgenleri gövdeden ayrıştırılıp yeni bir "Screen" primi kurulur.
  if (!screenPrims.length) {
    const extracted = extractFrontFace();
    if (extracted) {
      screenPrims = [extracted];
      allPrims.push(extracted);
      screenSource = `üçgen ayrıştırma (ön yüz gövdeden çıkarıldı, ${extracted.stats.tris} üçgen)`;
    }
  }
}

/**
 * Tek parça modellerde ön (ekran) yüzeyini üçgen seviyesinde ayırır.
 * Ön yüz, kalın eksenin DIŞ bandında en geniş düz alana sahip taraftır —
 * arka tarafta kamera adası olduğu için oradaki dış bant alanı küçüktür.
 */
function extractFrontFace() {
  const T = box.size[thinAxis];
  const ax = thinAxis;
  const tri = []; // { p, i0,i1,i2, n, c, area }
  for (const p of allPrims) {
    const P = p.prim.getAttribute("POSITION").getArray();
    const I = p.prim.getIndices()?.getArray();
    const cnt = I ? I.length : P.length / 3;
    const gi = (t) => (I ? I[t] : t);
    for (let t = 0; t + 2 < cnt; t += 3) {
      const a = gi(t), b = gi(t + 1), c = gi(t + 2);
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      const B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
      const C = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
      const x = cross(sub(B, A), sub(C, A));
      const area = len(x) * 0.5;
      if (!area) continue;
      tri.push({ p, idx: [a, b, c], n: norm(x), ctrAx: (A[ax] + B[ax] + C[ax]) / 3, area });
    }
  }
  // her iki taraf için dış banttaki düz alanı ölç
  const score = (dir) => {
    const edge = dir > 0 ? box.max[ax] : box.min[ax];
    let s = 0;
    for (const t of tri)
      if (t.n[ax] * dir > 0.9 && Math.abs(t.ctrAx - edge) < T * 0.08) s += t.area;
    return s;
  };
  const sPos = score(1), sNeg = score(-1);
  const dir = sPos >= sNeg ? 1 : -1;
  console.log(`  ön yüz taraması: +${ax}=${sPos.toFixed(5)}  -${ax}=${sNeg.toFixed(5)}  → ön = ${dir > 0 ? "+" : "-"}`);
  const edge = dir > 0 ? box.max[ax] : box.min[ax];
  const sel = tri.filter((t) => t.n[ax] * dir > 0.9 && Math.abs(t.ctrAx - edge) < T * 0.06);
  if (!sel.length || sel.reduce((s, t) => s + t.area, 0) < faceArea * 0.3) return null;

  // Kaynak prim başına grupla — attribute'lar prim'e özgü.
  const byPrim = new Map();
  for (const t of sel) {
    if (!byPrim.has(t.p)) byPrim.set(t.p, []);
    byPrim.get(t.p).push(t);
  }
  const [srcP, tris] = [...byPrim.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const src = srcP.prim;
  const semantics = src.listSemantics();
  const remap = new Map();
  const out = Object.fromEntries(semantics.map((s) => [s, []]));
  const idx = [];
  for (const t of tris) {
    for (const v of t.idx) {
      let n = remap.get(v);
      if (n === undefined) {
        n = remap.size;
        remap.set(v, n);
        for (const s of semantics) {
          const acc = src.getAttribute(s);
          const el = acc.getElementSize();
          const arr = acc.getArray();
          for (let k = 0; k < el; k++) out[s].push(arr[v * el + k]);
        }
      }
      idx.push(n);
    }
  }
  // Yeni prim: materyal klonlanır (gövde materyali paylaşılmasın).
  const mat = src.getMaterial()?.clone() ?? doc.createMaterial();
  mat.setName("Screen");
  const prim = doc.createPrimitive().setMaterial(mat);
  for (const s of semantics) {
    const acc = src.getAttribute(s);
    prim.setAttribute(s, doc.createAccessor()
      .setType(acc.getType())
      .setArray(new Float32Array(out[s]))
      .setBuffer(acc.getBuffer()));
  }
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(src.getIndices()?.getBuffer() ?? doc.getRoot().listBuffers()[0]));
  const mesh = doc.createMesh("Screen").addPrimitive(prim);
  const node = doc.createNode("Screen").setMesh(mesh);
  scene.addChild(node);

  // Aynı üçgenler gövdede de kalırsa z-fighting olur → kaynaktan silinir.
  const drop = new Set(tris.map((t) => t.idx.join(",")));
  const I = src.getIndices()?.getArray();
  if (I) {
    const keep = [];
    for (let t = 0; t + 2 < I.length; t += 3)
      if (!drop.has(`${I[t]},${I[t + 1]},${I[t + 2]}`)) keep.push(I[t], I[t + 1], I[t + 2]);
    src.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(keep)).setBuffer(src.getIndices().getBuffer()));
  }

  items.push({ node, name: "Screen", prims: [prim], stats: [primStats(prim)], min: [0, 0, 0], max: [0, 0, 0], tris: idx.length / 3 });
  // kaynak prim istatistiği değişti
  srcP.stats = primStats(src);
  return { prim, stats: primStats(prim), node: "Screen" };
}
if (!screenPrims.length) {
  console.error("  !! ekran bulunamadı — model atlanıyor");
  process.exit(2);
}
console.log(`  ekran: ${screenSource}`);

// --------------------------------------------------------- 4) dikleştirme (R)
// R1: ekran normali → +Z. Alan-ağırlıklı normal dışa bakar (doğru sarım
// varsayımı), bu yüzden ekran doğrudan ÖNE (+Z) gelir; R4'te doğrulanır.
let sn = [0, 0, 0];
for (const p of screenPrims) sn = [sn[0] + p.stats.nsum[0], sn[1] + p.stats.nsum[1], sn[2] + p.stats.nsum[2]];
sn = norm(sn);
// Normal, bbox'ın kalın ekseniyle hizalı değilse (kapalı kabuk vs.) kalın
// eksenin dış yönünü kullan.
if (Math.abs(sn[thinAxis]) < 0.7) {
  const s = screenPrims[0].stats.ctr[thinAxis] >= box.ctr[thinAxis] ? 1 : -1;
  sn = [0, 0, 0]; sn[thinAxis] = s;
  console.log("  (ekran normali güvensiz — bbox kalın ekseni kullanıldı)");
}
console.log(`  ekran normali: ${sn.map((v) => v.toFixed(3)).join(", ")}`);
let R = rotBetween(sn, [0, 0, 1]);

// R2: XY düzleminde uzun kenarı +Y'ye hizala.
// Kovaryans/PCA burada GÜVENİLMEZ: kamera adası ve yan tuşlar dağılımı
// asimetrik yapıyor, ana eksen birkaç derece kayıyor (ölçülen: ~4.4°) ve
// bbox oranı bozuluyor. Telefon yuvarlatılmış bir dikdörtgen olduğundan
// EN KÜÇÜK ALANLI döndürülmüş dikdörtgen doğru yönü tam verir.
{
  const pts = [];
  const push = (list, step) => {
    for (const p of list) {
      const P = p.prim.getAttribute("POSITION").getArray();
      for (let i = 0; i < P.length; i += step) pts.push(applyM3(R, [P[i], P[i + 1], P[i + 2]]));
    }
  };
  push(screenPrims, 3);                       // ekran = temiz dikdörtgen
  if (pts.length < 12) push(allPrims, 9);     // ekran çok küçükse tüm model
  let best = { a: 0, area: Infinity, w: 0, h: 0 };
  const scan = (lo, hi, step) => {
    for (let a = lo; a <= hi; a += step) {
      const c = Math.cos(a), s = Math.sin(a);
      let xmin = 1e30, xmax = -1e30, ymin = 1e30, ymax = -1e30;
      for (const q of pts) {
        const x = q[0] * c - q[1] * s, y = q[0] * s + q[1] * c;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
      const w = xmax - xmin, h = ymax - ymin, area = w * h;
      if (area < best.area) best = { a, area, w, h };
    }
  };
  scan(0, Math.PI / 2, Math.PI / 720);                    // 0.25° tarama
  const a0 = best.a;
  scan(a0 - Math.PI / 720, a0 + Math.PI / 720, Math.PI / 72000); // 0.0025° ince ayar
  let R2 = axisAngle([0, 0, 1], best.a);
  if (best.w > best.h) R2 = mulM3(axisAngle([0, 0, 1], Math.PI / 2), R2); // uzun kenar → +Y
  console.log(`  XY hizalama: ${(best.a * 180 / Math.PI).toFixed(3)}°  (dikdörtgen ${best.w.toFixed(3)}×${best.h.toFixed(3)})`);
  R = mulM3(R2, R);
}

// R3: kameralar üstte olmalı (arka kamera adası telefonun üst köşesinde).
// Kamera/lens adı yoksa alt taraf ipuçlarına (usb/hoparlör) bakılır.
{
  const cam = allPrims.filter((p) => CAM_RE.test(nameOf(p)));
  const bot = allPrims.filter((p) => BOTTOM_RE.test(nameOf(p)));
  const meanY = (list) => {
    let y = 0, w = 0;
    for (const p of list) { y += applyM3(R, p.stats.ctr)[1] * p.stats.area; w += p.stats.area; }
    return w ? y / w : null;
  };
  const cy = meanY(cam), by = meanY(bot), oy = applyM3(R, box.ctr)[1];
  let flip = null;
  if (cy !== null && cam.length) flip = cy < oy;
  else if (by !== null && bot.length) flip = by > oy;
  if (flip === null) {
    // Ad ipucu yok (obfuske edilmiş Sketchfab adları): kamera adası arkada
    // ÇIKINTI yapar. En arkadaki %15'lik bant ada üçgenleridir; onların Y
    // ortalaması üst yönü verir. Bant tüm arka yüzü kaplıyorsa (düz arka)
    // sonuç güvenilmez sayılır ve çevirme yapılmaz.
    let zmin = 1e30, zmax = -1e30;
    const pts = [];
    for (const p of allPrims) {
      const P = p.prim.getAttribute("POSITION").getArray();
      for (let i = 0; i < P.length; i += 3) {
        const q = applyM3(R, [P[i], P[i + 1], P[i + 2]]);
        pts.push(q);
        if (q[2] < zmin) zmin = q[2];
        if (q[2] > zmax) zmax = q[2];
      }
    }
    const band = pts.filter((q) => q[2] < zmin + (zmax - zmin) * 0.15);
    const bw = Math.max(...band.map((q) => q[0])) - Math.min(...band.map((q) => q[0]));
    const by2 = band.reduce((s, q) => s + q[1], 0) / (band.length || 1);
    const H = Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]));
    const W = Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]));
    const localized = bw < W * 0.8;                 // yerel çıkıntı mı?
    const offCenter = Math.abs(by2 - oy) > H * 0.06; // merkezden belirgin kaçık mı?
    if (localized && offCenter) {
      flip = by2 < oy;
      console.log(`  (kamera adı yok — arka çıkıntıdan üst yön: y=${by2.toFixed(4)} vs ${oy.toFixed(4)})`);
    } else {
      flip = false;
      console.log("  (üst yön belirlenemedi — çevirme yapılmadı, göz ile doğrulayın)");
    }
  }
  if (flip) { console.log("  kameralar altta çıktı — Z ekseninde 180° çevriliyor"); R = mulM3(axisAngle([0, 0, 1], Math.PI), R); }
}

// R4: ön/arka doğrulaması — ekran, kamera camlarından ÖNDE (+Z) olmalı.
{
  const zOf = (list) => {
    let z = 0, w = 0;
    for (const p of list) { z += applyM3(R, p.stats.ctr)[2] * p.stats.area; w += p.stats.area; }
    return w ? z / w : null;
  };
  const sz = zOf(screenPrims);
  const cam = allPrims.filter((p) => CAM_RE.test(nameOf(p)));
  const cz = cam.length ? zOf(cam) : null;
  const oz = applyM3(R, box.ctr)[2];
  const back = cz !== null ? cz : oz;
  if (sz !== null && sz < back) {
    console.log("  ekran arkada çıktı — Y ekseninde 180° çevriliyor");
    R = mulM3(axisAngle([0, 1, 0], Math.PI), R);
  }
}

// ------------------------------------------- 5) R'yi uygula, merkezle, ölçekle
for (const p of allPrims) transformPrimitive(p.prim, m3ToM4(R));
for (const p of allPrims) p.stats = primStats(p.prim);
box = bboxOf(allPrims);

const k = OUT_H / box.size[1];
for (const p of allPrims) transformPrimitive(p.prim, centerScaleM4(box.ctr, [k, k, k * SLIM]));
for (const p of allPrims) p.stats = primStats(p.prim);
box = bboxOf(allPrims);

// ------------------------------------------------------- 6) materyal şeması
const hasTex = root.listTextures().length > 0;
const mode = SCHEME === "auto" ? (hasTex ? "preserve" : "flat") : SCHEME;
console.log(`  şema: ${mode} (texture=${root.listTextures().length})`);

const screenMats = new Set(screenPrims.map((p) => p.prim.getMaterial()).filter(Boolean));

/** Materyalin anlam sınıfını ad + geometri ile tayin eder. */
function classify(mat) {
  const prims = allPrims.filter((p) => p.prim.getMaterial() === mat);
  if (!prims.length) return "Body";
  if (screenMats.has(mat)) return "Screen";
  const nm = `${mat.getName()} ${prims.map((p) => p.node).join(" ")}`;
  const b = bboxOf(prims);
  const maxDim = Math.max(...b.size);
  const onBack = b.ctr[2] < 0;
  const emissive = mat.getEmissiveFactor?.().some((v) => v > 0.05) || !!mat.getEmissiveTexture?.();
  const warm = (() => { const c = mat.getBaseColorFactor(); return c[0] > 0.6 && c[0] > c[2] * 1.25; })();

  if (/flash|torch|\bled\b/i.test(nm)) return "Flash";
  if (/lens|optic|glass|cam(era)?[_. ]?(pixel|glass|lens)?/i.test(nm) && onBack) return "Glass";
  if (/side|rail|rim|frame|antenn?a|button|band|edge|bezel|screw|grill/i.test(nm)) return "Side";
  if (/back|body|cover|shell|housing|chassis|case|plastic/i.test(nm)) return "Body";
  // ad ipucu yoksa geometri: küçük + arkada + sıcak/emissive → Flash,
  // küçük + arkada + parlak → Glass, ince ve kenarda → Side.
  if (onBack && maxDim < box.size[1] * 0.09 && (warm || emissive)) return "Flash";
  if (onBack && maxDim < box.size[1] * 0.16 && mat.getRoughnessFactor() < 0.2) return "Glass";
  const thinX = b.size[0] < box.size[0] * 0.16 && Math.abs(b.ctr[0]) > box.size[0] * 0.3;
  const thinY = b.size[1] < box.size[1] * 0.12 && Math.abs(b.ctr[1]) > box.size[1] * 0.35;
  if (thinX || thinY) return "Side";
  return "Body";
}

// flat şema için düz PBR değerleri (prep-iphone17.mjs ile aynı his).
const FLAT_PBR = {
  Body: { color: [0.28, 0.28, 0.30, 1], metal: 0.85, rough: 0.34 },
  Screen: { color: [0.008, 0.008, 0.01, 1], metal: 0.0, rough: 0.18 },
  Side: { color: [0.02, 0.02, 0.022, 1], metal: 0.9, rough: 0.3 },
  Glass: { color: [0.05, 0.055, 0.07, 1], metal: 0.0, rough: 0.12 },
  Flash: { color: [0.95, 0.85, 0.7, 1], metal: 0.0, rough: 0.5 },
};
// preserve şemasında engine'in EZDİĞİ adlardan kaçınmak gerekir; ".tex" soneki
// hem sınıfı belli eder hem upgradeMaterial()'ın hiçbir kuralına takılmaz.
// ("Glass" → /Lens|Optic|Glass/i kuralına takılırdı, "Camera" güvenli.)
const TEX_NAME = { Body: "Body.tex", Side: "Side.tex", Glass: "Camera.tex", Flash: "Flash.tex", Screen: "Screen" };

const counts = {};
const used = new Set();
const report = [];
for (const mat of root.listMaterials()) {
  const cls = classify(mat);
  counts[cls] = (counts[cls] ?? 0) + 1;
  const orig = mat.getName();
  let name;
  if (mode === "flat") {
    name = cls;
    const s = FLAT_PBR[cls];
    mat.setBaseColorFactor(s.color).setMetallicFactor(s.metal).setRoughnessFactor(s.rough);
    // düz şemada texture bağları anlamsız — temizle
    for (const set of ["BaseColorTexture", "MetallicRoughnessTexture", "NormalTexture", "EmissiveTexture", "OcclusionTexture"])
      mat[`set${set}`]?.(null);
  } else {
    name = TEX_NAME[cls];
    // "Screen" tek olmalı (findScreenMesh ilk tam eşleşmeyi alır)
    if (name !== "Screen" || used.has("Screen")) {
      let n = name, i = 0;
      while (used.has(n)) n = `${name}.${String(++i).padStart(3, "0")}`;
      name = n;
    }
  }
  used.add(name);
  mat.setName(name);
  mat.setExtras({ ...(mat.getExtras() ?? {}), sourceMaterial: orig, vitrinClass: cls });
  report.push(`${orig || "(adsız)"} → ${name}`);
}
console.log(`  sınıflar: ${Object.entries(counts).map(([k2, v]) => `${k2}=${v}`).join(" ")}`);

// Mesh/node adlarını da şemaya yaklaştır — findScreenMesh mesh ADINA da bakar.
for (const p of screenPrims) {
  const mn = items.find((it) => it.prims.includes(p.prim));
  if (mn) { mn.node.setName("Screen"); mn.node.getMesh()?.setName("Screen"); }
}

// -------------------------------------------------------- 7) doğrulama + yaz
const sBox = bboxOf(screenPrims);
const camPrims = allPrims.filter((p) => CAM_RE.test(nameOf(p)) || /Camera\.tex|^Glass$/.test(p.prim.getMaterial()?.getName() ?? ""));
const cBox = camPrims.length ? bboxOf(camPrims) : null;
// Gövde kalınlığı: kamera adası telefonun ÜST köşesindedir, bu yüzden ölçüm
// merkez bölgede yapılır (|x|<0.15w, |y|<0.15h) — orada yalnız düz gövde var.
let slabD = box.size[2];
{
  let zmin = 1e30, zmax = -1e30;
  const rx = box.size[0] * 0.15, ry = box.size[1] * 0.15;
  for (const p of allPrims) {
    const P = p.prim.getAttribute("POSITION").getArray();
    for (let i = 0; i < P.length; i += 3) {
      if (Math.abs(P[i]) > rx || Math.abs(P[i + 1]) > ry) continue;
      if (P[i + 2] < zmin) zmin = P[i + 2];
      if (P[i + 2] > zmax) zmax = P[i + 2];
    }
  }
  if (zmax > zmin) slabD = zmax - zmin;
}

const d = box.size;
console.log(`  --- doğrulama ---`);
console.log(`  bbox w,h,d       : ${d.map((v) => v.toFixed(4)).join(", ")}`);
console.log(`  oran w/h         : ${(d[0] / d[1]).toFixed(4)}   (gerçek iPhone ~0.478)`);
console.log(`  oran d/h (bbox)  : ${(d[2] / d[1]).toFixed(4)}   (kamera adası dahil ~0.084)`);
console.log(`  oran d/h (gövde) : ${(slabD / d[1]).toFixed(4)}   (merkez bölge, gerçek ~0.054)`);
console.log(`  merkez           : ${box.ctr.map((v) => v.toFixed(5)).join(", ")}`);
console.log(`  ekran bbox       : ${sBox.size.map((v) => v.toFixed(4)).join(", ")}  z=${sBox.ctr[2].toFixed(4)}`);
console.log(`  ekran/gövde alanı: ${((sBox.size[0] * sBox.size[1]) / (d[0] * d[1]) * 100).toFixed(1)}%`);
const okFront = sBox.ctr[2] > (cBox ? cBox.ctr[2] : 0);
console.log(`  ekran ÖNDE (+Z)  : ${okFront ? "EVET" : "HAYIR ✗"}${cBox ? `  (kamera z=${cBox.ctr[2].toFixed(4)})` : ""}`);
if (cBox) console.log(`  kamera ÜSTTE(+Y) : ${cBox.ctr[1] > 0 ? "EVET" : "HAYIR ✗"}  (kamera y=${cBox.ctr[1].toFixed(4)})`);
console.log(`  üçgen            : ${allPrims.reduce((s, p) => s + p.stats.tris, 0)}`);

// three.js GLTFLoader sade kurulmuş (DRACOLoader/KTX2 yok) → sıkıştırma
// uzantılarını çıkararak yaz.
for (const ext of root.listExtensionsUsed())
  if (/draco|meshopt|basisu/i.test(ext.extensionName)) { console.log(`  uzantı kaldırıldı: ${ext.extensionName}`); ext.dispose(); }

if (DRY) { console.log("  (--dry: yazılmadı)"); }
else {
  fs.mkdirSync(path.dirname(DST), { recursive: true });
  await io.write(DST, doc);
  console.log(`  YAZILDI: ${path.relative(process.cwd(), DST)}  (${(fs.statSync(DST).size / 1048576).toFixed(2)} MB)`);
}
