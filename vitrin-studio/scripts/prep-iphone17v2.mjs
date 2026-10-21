// Envato "iPhone 17 Pro Max" (spacepixelcreative) → public/assets/models/iphone-17promax.glb
//
// prep-iphone17.mjs'in yerine geçer. Farklar:
//   * Sahnedeki iki telefondan EKSENE YAKIN olanı (B kümesi) seçilir —
//     A kümesi keyfi bir açıyla döndürülmüş, dikleştirme hatası büyür.
//   * XY hizalaması PCA yerine EN KÜÇÜK ALANLI DİKDÖRTGEN ile yapılır
//     (prep-any-iphone.mjs'te ölçülen PCA sapması ~4.4°).
//   * Gövde rengi KORUNUR (Cosmic Orange, linear 0.257/0.023/0.001) →
//     materyal adı "Body.tex" olur, engine'in upgradeMaterial()'ı onu EZMEZ.
//   * "hitam kaca" iki yerde kullanılıyor: gövdenin ön camı (= Screen) ve
//     arka sensör camı (Circle.041). İkincisi CamCover'a ayrılır, yoksa
//     Screen bbox'ı arkaya taşıp ekran düzlemi yüzer.
//   * Yan tuş node'ları kanonik uzayda ölçülür; gövde silüetinden fazla
//     taşanlar (--buttons=drop) atılır.
//
// Çalıştır:
//   node scripts/prep-iphone17v2.mjs [--dry] [--report] [--cluster=A|B]
//                                    [--buttons=keep|drop] [--slim=..]

import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsClearcoat } from "@gltf-transform/extensions";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  })
);
const DRY = !!flags.dry;
const REPORT = !!flags.report || DRY;
const CLUSTER_ID = (flags.cluster ?? "B").toUpperCase();
// Yan tuşlar varsayılan olarak ATILIR. Ölçüm gövde silüetinden yalnızca
// %1.25 taşıdıklarını söylüyor ama render'da (10-17promax-front, ilk tur)
// raydan KOPUK, sert kenarlı dilimler gibi çıkıyorlar: modelde tuşlar ayrı
// kabuklar, ray ile kaynaklı değil. "--buttons=keep" ile geri açılır.
const BUTTONS = flags.buttons ?? "drop";
const BUTTON_OUT_MAX = Number(flags.buttonOut ?? 0);
const OUT_H = Number(flags.height ?? 1);

const SRC = path.resolve("vendor/models-raw/iphone17v2/3.glb");
const DST = path.resolve("public/assets/models/iphone-17promax.glb");

// --------------------------------------------------------------- küme tanımı
// Sahnede iki özdeş telefon var (geometri birebir aynı, poz farklı).
//   A: Circle.033-040 + Plane.029-035  — ekran normali (-0.45,-0.12,0.88)
//   B: Circle.041-048 + Plane.036-042  — ekran normali ~(0,0.05,-1) (yüzüstü)
// B eksene çok yakın → daha az dönme hatası.
const CLUSTERS = {
  A: {
    body: "Plane.035",
    island: "Plane.034",
    plate: "Plane.029",
    buttons: ["Plane.030", "Plane.031", "Plane.032", "Plane.033"],
    cams: ["Circle.033", "Circle.034", "Circle.035", "Circle.036", "Circle.037", "Circle.038", "Circle.039", "Circle.040"],
  },
  B: {
    body: "Plane.042",
    island: "Plane.041",
    plate: "Plane.036",
    buttons: ["Plane.037", "Plane.038", "Plane.039", "Plane.040"],
    cams: ["Circle.041", "Circle.042", "Circle.043", "Circle.044", "Circle.045", "Circle.046", "Circle.047", "Circle.048"],
  },
};
const C = CLUSTERS[CLUSTER_ID];
const MEMBERS = new Set([C.body, C.island, C.plate, ...C.buttons, ...C.cams]);

// ------------------------------------------------------------ materyal şeması
// Engine sözleşmesi (engine/scene3dCore.ts · upgradeMaterial):
//   "Screen" / "Glass" / "Flash" / "Display_Frame" → engine düz PBR ile EZER.
//   Eşleşmeyen adlar (".tex", "CamCover") → GLB materyali OLDUĞU GİBİ kalır.
// Gövde turuncusunu korumak için gövde adı "Body.tex".
const CLASS_OF = (matName, nodeName) => {
  switch (matName) {
    case "Material.001_ViewportColor":
      return "Body.tex";
    case "hitam kaca.001_ViewportColor":
      // Gövdedeki ön cam = ekran; başka node'daki siyah cam = arka sensör camı.
      return nodeName === C.body ? "Screen" : "CamCover";
    case "hitam sisi.001_ViewportColor":
      // Ekran çevresindeki siyah bant + lens namlu halkaları.
      return "Display_Frame";
    case "kaca.001_ViewportColor":
      return "Glass";
    case "cahaya.001_ViewportColor":
      return "Flash";
    default:
      return null;
  }
};

// Çıktı GLB'sine yazılan PBR. Engine'in ezdiği sınıflarda bu sadece
// "GLB tek başına açıldığında da doğru görünsün" içindir; ezmediklerinde
// (Body.tex, CamCover) NİHAİ görünümü bu belirler.
// Gövde: anodize alüminyum unibody. Renk kaynaktan (Cosmic Orange) birebir.
// Metalik payı yükseltmek rengi derinleştirip specular'ı renklendirir; ince
// bir clearcoat (KHR_materials_clearcoat — three.js GLTFLoader destekler,
// MeshPhysicalMaterial'a çevirir) plastik hissini kırar.
const PBR = {
  "Body.tex":      { color: [0.257, 0.023, 0.001, 1], metal: 0.55, rough: 0.40, clearcoat: 0.35, ccRough: 0.28 },
  Screen:          { color: [0.006, 0.006, 0.008, 1], metal: 0.0, rough: 0.10 },
  Display_Frame:   { color: [0.002, 0.002, 0.003, 1], metal: 0.0, rough: 0.12 },
  Glass:           { color: [0.02, 0.022, 0.028, 1], metal: 0.0, rough: 0.06 },
  Flash:           { color: [0.90, 0.86, 0.80, 1], metal: 0.0, rough: 0.35 },
  CamCover:        { color: [0.006, 0.006, 0.007, 1], metal: 0.0, rough: 0.09, clearcoat: 1, ccRough: 0.05 },
};

// -------------------------------------------------------- vektör/matris yard.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mulM4 = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const mulM4dir = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];
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
const emptyBox = () => ({ min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] });
const grow = (box, p) => {
  for (let k = 0; k < 3; k++) {
    if (p[k] < box.min[k]) box.min[k] = p[k];
    if (p[k] > box.max[k]) box.max[k] = p[k];
  }
};
const boxSize = (b) => sub(b.max, b.min);
const boxCtr = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const f4 = (a) => a.map((v) => v.toFixed(4).padStart(8)).join(" ");

// ------------------------------------------------------------------ oku
console.log(`\n=== ${path.relative(process.cwd(), SRC)} → iphone-17promax.glb  (küme ${CLUSTER_ID}) ===`);
const io = new NodeIO().registerExtensions([KHRMaterialsClearcoat]);
const src = await io.read(SRC);
const scene = src.getRoot().listScenes()[0];

/** parça = tek (node, materyal) çifti; dünya uzayına açılmış kopya. */
const parts = [];
for (const node of scene.listChildren()) {
  const name = node.getName();
  if (!MEMBERS.has(name)) continue;
  const mesh = node.getMesh();
  if (!mesh) continue;
  const world = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const matName = prim.getMaterial()?.getName() ?? "";
    const cls = CLASS_OF(matName, name);
    if (!cls) { console.log(`  ! bilinmeyen materyal atlandı: ${name} / ${matName}`); continue; }
    const P = prim.getAttribute("POSITION").getArray();
    const N = prim.getAttribute("NORMAL")?.getArray();
    const I = prim.getIndices()?.getArray() ?? [...Array(P.length / 3).keys()];
    const pos = new Float64Array(P.length);
    const nrm = N ? new Float64Array(P.length) : null;
    for (let i = 0; i < P.length; i += 3) {
      const wp = mulM4(world, [P[i], P[i + 1], P[i + 2]]);
      pos[i] = wp[0]; pos[i + 1] = wp[1]; pos[i + 2] = wp[2];
      if (N) {
        const wn = norm(mulM4dir(world, [N[i], N[i + 1], N[i + 2]]));
        nrm[i] = wn[0]; nrm[i + 1] = wn[1]; nrm[i + 2] = wn[2];
      }
    }
    parts.push({ node: name, srcMat: matName, cls, pos, nrm, idx: Array.from(I) });
  }
}
console.log(`  parça: ${parts.length}  ·  üçgen: ${parts.reduce((s, p) => s + p.idx.length / 3, 0)}`);

const partsOf = (cls) => parts.filter((p) => p.cls === cls);
const bboxOfParts = (list) => {
  const b = emptyBox();
  for (const p of list) for (let i = 0; i < p.pos.length; i += 3) grow(b, [p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
  return b;
};

// -------------------------------------------------- R1: ekran normali → +Z
// UYARI: bu modelde ön cam poligonlarının SARIMI ters (alan-ağırlıklı normal
// gövdenin İÇİNE bakıyor). Bu yüzden yön, sarımdan değil "ekran merkezi −
// gövde merkezi" vektöründen alınır; sarım sadece doğrulama için basılır.
const screenParts = partsOf("Screen");
const bodyParts = partsOf("Body.tex");
if (!screenParts.length) { console.error("  !! Screen parçası yok"); process.exit(2); }

let windN = [0, 0, 0];
let windArea = 0;
for (const p of screenParts) {
  for (let t = 0; t + 2 < p.idx.length; t += 3) {
    const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
    const A = [p.pos[a], p.pos[a + 1], p.pos[a + 2]];
    const B = [p.pos[b], p.pos[b + 1], p.pos[b + 2]];
    const D = [p.pos[c], p.pos[c + 1], p.pos[c + 2]];
    const x = cross(sub(B, A), sub(D, A));
    windN = [windN[0] + x[0], windN[1] + x[1], windN[2] + x[2]];
    windArea += len(x) * 0.5;
  }
}
const flatness = len(windN) * 0.5 / (windArea || 1); // 1 = kusursuz düzlem
windN = norm(windN);
const sCtr0 = boxCtr(bboxOfParts(screenParts));
const bCtr0 = boxCtr(bboxOfParts(bodyParts));
const outDir = norm(sub(sCtr0, bCtr0)); // kaba dışa bakan yön (bbox merkez farkı)
// Ön cam DÜZLEMSEL (flatness≈1) → alan-ağırlıklı normal düzlemin TAM normali.
// Bbox merkez farkı ~0.9° sapmalı; onu kullanmak ekranı eğik bırakıyor ve
// engine'in screenshot düzlemi ekrana paralel oturmuyordu. Sarım bu modelde
// ters (normal gövdenin içine bakıyor) → dışa çevrilir.
let sn = outDir;
if (flatness > 0.98) {
  sn = dot(windN, outDir) < 0 ? windN.map((v) => -v) : windN;
  const err = Math.acos(Math.min(1, Math.abs(dot(sn, outDir)))) * 180 / Math.PI;
  console.log(`  ekran düzlemsel (flatness=${flatness.toFixed(4)}) → normal sarımdan alındı (bbox yöntemi ${err.toFixed(2)}° sapmalı)`);
} else {
  console.log(`  ekran düzlemsel DEĞİL (flatness=${flatness.toFixed(4)}) → bbox merkez farkı kullanıldı`);
}
console.log(`  ekran dış yön : ${sn.map((v) => v.toFixed(4)).join(", ")}`);

let R = rotBetween(sn, [0, 0, 1]);

// ------------------------------- R2: en küçük alanlı dikdörtgen ile uzun kenar +Y
{
  const pts = [];
  for (const p of screenParts)
    for (let i = 0; i < p.pos.length; i += 3) pts.push(applyM3(R, [p.pos[i], p.pos[i + 1], p.pos[i + 2]]));
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
  scan(0, Math.PI / 2, Math.PI / 720);
  scan(best.a - Math.PI / 720, best.a + Math.PI / 720, Math.PI / 72000);
  let R2 = axisAngle([0, 0, 1], best.a);
  if (best.w > best.h) R2 = mulM3(axisAngle([0, 0, 1], Math.PI / 2), R2);
  console.log(`  XY hizalama   : ${(best.a * 180 / Math.PI).toFixed(3)}°  (ekran dikdörtgeni ${best.w.toFixed(3)}×${best.h.toFixed(3)}, oran ${(Math.min(best.w, best.h) / Math.max(best.w, best.h)).toFixed(4)})`);
  R = mulM3(R2, R);
}

// -------------------------------------- R3: kamera adası ÜSTTE (+Y) olmalı
{
  const camY = boxCtr(bboxOfParts(partsOf("Glass").concat(partsOf("Flash"))))[1];
  const all = bboxOfParts(parts);
  const oy = boxCtr(all)[1];
  const camYr = applyM3(R, [0, camY, 0]); // sadece işaret için yeterli değil → tam vektör
  void camYr;
  const camCtrR = applyM3(R, boxCtr(bboxOfParts(partsOf("Glass").concat(partsOf("Flash")))));
  const allCtrR = applyM3(R, boxCtr(all));
  void oy;
  if (camCtrR[1] < allCtrR[1]) {
    console.log("  kameralar altta çıktı — Z ekseninde 180° çevriliyor");
    R = mulM3(axisAngle([0, 0, 1], Math.PI), R);
  }
}

// ------------------------------------------ R'yi uygula, merkezle, ölçekle
for (const p of parts) {
  for (let i = 0; i < p.pos.length; i += 3) {
    const q = applyM3(R, [p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
    p.pos[i] = q[0]; p.pos[i + 1] = q[1]; p.pos[i + 2] = q[2];
    if (p.nrm) {
      const n = applyM3(R, [p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]]);
      p.nrm[i] = n[0]; p.nrm[i + 1] = n[1]; p.nrm[i + 2] = n[2];
    }
  }
}

// ---------------------------------------------- kanonik uzayda node raporu
function reportNodes(title) {
  console.log(`  --- ${title} ---`);
  // referans: SADECE ana gövde node'u (tuşlar dahil edilirse taşma ölçülemez)
  const gov = bboxOfParts(parts.filter((p) => p.node === C.body));
  const byNode = new Map();
  for (const p of parts) {
    if (!byNode.has(p.node)) byNode.set(p.node, []);
    byNode.get(p.node).push(p);
  }
  for (const [node, list] of [...byNode.entries()].sort()) {
    const b = bboxOfParts(list);
    const s = boxSize(b), c = boxCtr(b);
    const outX = Math.max(b.max[0] - gov.max[0], gov.min[0] - b.min[0]);
    const outZ = Math.max(b.max[2] - gov.max[2], gov.min[2] - b.min[2]);
    console.log(`    ${node.padEnd(11)} ${list.map((p) => p.cls).join("+").padEnd(28)} size=[${f4(s)}] ctr=[${f4(c)}] xTaşma=${outX.toFixed(4)} zTaşma=${outZ.toFixed(4)}`);
  }
  console.log(`    ${"(gövde ref)".padEnd(11)} ${C.body.padEnd(28)} size=[${f4(boxSize(gov))}] ctr=[${f4(boxCtr(gov))}]`);
}
if (REPORT) reportNodes("kanonik (ölçeklenmemiş) node kutuları");

// ---------------------------------- yan tuşlar: gövdeden fazla taşıyorlarsa at
if (BUTTONS === "drop") {
  const before = parts.length;
  const gov = bboxOfParts(parts.filter((p) => p.node === C.body));
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!C.buttons.includes(parts[i].node)) continue;
    const b = bboxOfParts([parts[i]]);
    const outX = Math.max(b.max[0] - gov.max[0], gov.min[0] - b.min[0]);
    const rel = outX / boxSize(gov)[0];
    console.log(`  tuş ${parts[i].node}: xTaşma=${outX.toFixed(4)} (gövde genişliğinin %${(rel * 100).toFixed(2)}'i) → ${rel > BUTTON_OUT_MAX ? "ATILDI" : "tutuldu"}`);
    if (rel > BUTTON_OUT_MAX) parts.splice(i, 1);
  }
  console.log(`  tuş elemesi: ${before} → ${parts.length} parça`);
}
// "plate" node'u (Plane.029/036): gövde silüetinin içinde kalan düz levha.
// Kanonik raporda gövdenin dışına taşıyorsa at.
{
  const gov = bboxOfParts(bodyParts.filter((p) => p.node === C.body));
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].node !== C.plate) continue;
    const b = bboxOfParts([parts[i]]);
    const out = Math.max(b.max[0] - gov.max[0], gov.min[0] - b.min[0], b.max[1] - gov.max[1], gov.min[1] - b.min[1]);
    console.log(`  levha ${C.plate}: taşma=${out.toFixed(4)} → ${out > 0.002 ? "ATILDI" : "tutuldu"}`);
    if (out > 0.002) parts.splice(i, 1);
  }
}

// ------------------------------------------------ merkezle + yüksekliği 1'e
{
  const all = bboxOfParts(parts);
  const ctr = boxCtr(all);
  const h = boxSize(all)[1];
  const k = OUT_H / h;
  const SLIM = Number(flags.slim ?? 1);
  for (const p of parts) {
    for (let i = 0; i < p.pos.length; i += 3) {
      p.pos[i] = (p.pos[i] - ctr[0]) * k;
      p.pos[i + 1] = (p.pos[i + 1] - ctr[1]) * k;
      p.pos[i + 2] = (p.pos[i + 2] - ctr[2]) * k * SLIM;
    }
    if (p.nrm && SLIM !== 1) {
      for (let i = 0; i < p.nrm.length; i += 3) {
        p.nrm[i + 2] /= SLIM;
        const l = Math.hypot(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]) || 1;
        p.nrm[i] /= l; p.nrm[i + 1] /= l; p.nrm[i + 2] /= l;
      }
    }
  }
}

// ------------------------------------------------------------- doğrulama
const all = bboxOfParts(parts);
const d = boxSize(all);
const sBox = bboxOfParts(partsOf("Screen"));
const camBox = bboxOfParts(partsOf("Glass"));
const govBox = bboxOfParts(partsOf("Body.tex"));
// gövde kalınlığı: merkez bölgede ölç (kamera adası uçta)
let slab = d[2];
{
  let zmin = 1e30, zmax = -1e30;
  const rx = d[0] * 0.15, ry = d[1] * 0.15;
  for (const p of parts)
    for (let i = 0; i < p.pos.length; i += 3) {
      if (Math.abs(p.pos[i]) > rx || Math.abs(p.pos[i + 1]) > ry) continue;
      if (p.pos[i + 2] < zmin) zmin = p.pos[i + 2];
      if (p.pos[i + 2] > zmax) zmax = p.pos[i + 2];
    }
  if (zmax > zmin) slab = zmax - zmin;
}
if (REPORT) reportNodes("normalize edilmiş node kutuları");
console.log("  --- doğrulama ---");
console.log(`  bbox w,h,d       : ${f4(d)}`);
console.log(`  oran w/h         : ${(d[0] / d[1]).toFixed(4)}   (gerçek 17 Pro Max 0.4774)`);
console.log(`  oran d/h (gövde) : ${(slab / d[1]).toFixed(4)}   (gerçek 0.0535)`);
console.log(`  ekran bbox       : ${f4(boxSize(sBox))}  ctr z=${boxCtr(sBox)[2].toFixed(4)}`);
console.log(`  ekran/gövde alanı: ${((boxSize(sBox)[0] * boxSize(sBox)[1]) / (boxSize(govBox)[0] * boxSize(govBox)[1]) * 100).toFixed(1)}%`);
console.log(`  ekran ÖNDE (+Z)  : ${boxCtr(sBox)[2] > boxCtr(camBox)[2] ? "EVET" : "HAYIR ✗"}  (kamera z=${boxCtr(camBox)[2].toFixed(4)})`);
console.log(`  kamera ÜSTTE(+Y) : ${boxCtr(camBox)[1] > 0 ? "EVET" : "HAYIR ✗"}  (kamera y=${boxCtr(camBox)[1].toFixed(4)})`);
{
  // Ekranın önünde kalan başka geometri var mı? (island/bezel çıkıntısı →
  // engine screenshot düzlemini deler.)
  const zLimit = sBox.max[2];
  const offenders = new Map();
  for (const p of parts) {
    if (p.cls === "Screen") continue;
    const b = emptyBox();
    let n = 0;
    for (let i = 0; i < p.pos.length; i += 3)
      if (p.pos[i + 2] > zLimit + 1e-6) { n++; grow(b, [p.pos[i], p.pos[i + 1], p.pos[i + 2]]); }
    if (n) offenders.set(`${p.node}/${p.cls}`, { n, b });
  }
  if (!offenders.size) console.log("  ekran düzlemi önünde vertex: yok ✓");
  for (const [k2, v] of offenders)
    console.log(`  ekran düzlemi ÖNÜNDE: ${k2} vertex=${v.n} kutu=[${f4(boxSize(v.b))}] ctr=[${f4(boxCtr(v.b))}] (ekran maxZ=${zLimit.toFixed(4)})`);
}

// ------------------------------------------------------------------ yaz
if (DRY) { console.log("  (--dry: yazılmadı)"); process.exit(0); }

const out = new Document();
const ccExt = out.createExtension(KHRMaterialsClearcoat);
const buffer = out.createBuffer();
const outScene = out.createScene("iphone17promax");
const rootNode = out.createNode("iPhone17ProMax");
outScene.addChild(rootNode);

const byClass = new Map();
for (const p of parts) {
  if (!byClass.has(p.cls)) byClass.set(p.cls, []);
  byClass.get(p.cls).push(p);
}
for (const [cls, list] of byClass) {
  const spec = PBR[cls];
  const mat = out.createMaterial(cls)
    .setBaseColorFactor(spec.color)
    .setMetallicFactor(spec.metal)
    .setRoughnessFactor(spec.rough);
  if (spec.clearcoat) {
    mat.setExtension("KHR_materials_clearcoat", ccExt.createClearcoat()
      .setClearcoatFactor(spec.clearcoat)
      .setClearcoatRoughnessFactor(spec.ccRough ?? 0.2));
  }
  mat.setExtras({ sourceMaterial: [...new Set(list.map((p) => p.srcMat))].join(","), vitrinClass: cls });
  const pos = [], nrm = [], idx = [];
  let hasN = list.every((p) => p.nrm);
  for (const p of list) {
    const base = pos.length / 3;
    for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
    if (hasN) for (let i = 0; i < p.nrm.length; i++) nrm.push(p.nrm[i]);
    for (const ix of p.idx) idx.push(base + ix);
  }
  const prim = out.createPrimitive().setMaterial(mat).setAttribute(
    "POSITION",
    out.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer)
  );
  if (hasN) {
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    prim.setAttribute("NORMAL", out.createAccessor().setType("VEC3").setArray(new Float32Array(nrm)).setBuffer(buffer));
  }
  prim.setIndices(out.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer));
  const mesh = out.createMesh(cls).addPrimitive(prim);
  rootNode.addChild(out.createNode(cls).setMesh(mesh));
  console.log(`  bucket ${cls.padEnd(14)} üçgen=${String(idx.length / 3).padStart(6)}  node=${[...new Set(list.map((p) => p.node))].join(",")}`);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
await io.write(DST, out);
console.log(`  YAZILDI: ${path.relative(process.cwd(), DST)}  (${(fs.statSync(DST).size / 1048576).toFixed(2)} MB)`);
