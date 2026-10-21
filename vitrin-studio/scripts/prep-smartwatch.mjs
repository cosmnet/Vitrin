// Envato "3D Smartwatch" (Smart Watch.obj) → public/assets/models/smartwatch.glb
//
// Önce OBJ → GLB (obj2gltf; fbx2gltf bu projede çalışmıyor):
//   cd vendor/models-raw/smartwatch && npx obj2gltf -i "Smart Watch.obj" -o smartwatch-raw.glb
// Sonra bu script telefonlarla AYNI sözleşmeye getirir:
//   * ekran/kadran +Z'ye bakar, kayış ekseni +Y  (kaynak zaten böyle — doğrulanır)
//   * merkez orijinde, Y yüksekliği 1.0
//   * "Watch_Display" → "Screen"  (engine/scene3dCore.ts · findScreenMesh TAM
//     "Screen" adını arar; olmazsa prepareGlb null döner)
//   * diğer materyaller "Watch_*" olarak KALIR — engine'in upgradeMaterial()
//     kurallarının hiçbirine takılmaz, buradaki PBR nihai görünümü belirler.
//
// UI'ya BAĞLI DEĞİL: sadece asset olarak üretilir.
//
//   node scripts/prep-smartwatch.mjs [--dry]

import { NodeIO } from "@gltf-transform/core";
import { transformPrimitive } from "@gltf-transform/functions";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const SRC = path.resolve("vendor/models-raw/smartwatch/smartwatch-raw.glb");
const DST = path.resolve("public/assets/models/smartwatch.glb");
const OUT_H = 1;

// Kaynak Blender MTL'i her şeyi metal=0 veriyor (illum 2/3 → PBR'ye çevrilemez).
// Anlamlı PBR burada verilir.
const PBR = {
  Watch_Display:     { name: "Screen",            color: [0.006, 0.006, 0.008, 1], metal: 0.0, rough: 0.08 },
  Watch_Body:        { name: "Watch_Body",        color: [0.014, 0.014, 0.015, 1], metal: 0.85, rough: 0.30 },
  Watch_Body_Frame:  { name: "Watch_Body_Frame",  color: [0.006, 0.006, 0.007, 1], metal: 0.60, rough: 0.12 },
  Watch_Knob:        { name: "Watch_Knob",        color: [0.55, 0.55, 0.57, 1],    metal: 0.95, rough: 0.10 },
  Watch_Knob_List:   { name: "Watch_Knob_List",   color: [0.30, 0.30, 0.31, 1],    metal: 0.90, rough: 0.28 },
  Watch_Button:      { name: "Watch_Button",      color: [0.30, 0.30, 0.31, 1],    metal: 0.90, rough: 0.20 },
  Watch_Button_List: { name: "Watch_Button_List", color: [0.30, 0.30, 0.31, 1],    metal: 0.90, rough: 0.28 },
  Watch_Pin:         { name: "Watch_Pin",         color: [0.05, 0.05, 0.05, 1],    metal: 0.90, rough: 0.35 },
  Watch_Strap:       { name: "Watch_Strap",       color: [0.016, 0.015, 0.015, 1], metal: 0.0, rough: 0.62 },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const centerScaleM4 = (c, s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * c[0], -s * c[1], -s * c[2], 1];

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();
const scene = root.listScenes()[0];

// --- dünya dönüşümlerini geometriye bak, TRS'leri sıfırla
const prims = [];
const walk = (node) => {
  const mesh = node.getMesh();
  if (mesh) for (const p of mesh.listPrimitives()) prims.push({ prim: p, world: node.getWorldMatrix() });
  node.listChildren().forEach(walk);
};
scene.listChildren().forEach(walk);
for (const { prim, world } of prims) transformPrimitive(prim, world);
const reset = (n) => { n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); n.listChildren().forEach(reset); };
scene.listChildren().forEach(reset);

const bboxOf = (list) => {
  const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
  for (const { prim } of list) {
    const P = prim.getAttribute("POSITION").getArray();
    for (let i = 0; i < P.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (P[i + k] < min[k]) min[k] = P[i + k];
        if (P[i + k] > max[k]) max[k] = P[i + k];
      }
  }
  return { min, max, size: sub(max, min), ctr: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
};

const displayPrims = prims.filter(({ prim }) => prim.getMaterial()?.getName() === "Watch_Display");
if (!displayPrims.length) { console.error("!! Watch_Display bulunamadı"); process.exit(2); }

let box = bboxOf(prims);
const dBox = bboxOf(displayPrims);
console.log(`\n=== Smart Watch.obj → smartwatch.glb ===`);
console.log(`  ham bbox     : ${box.size.map((v) => v.toFixed(4)).join(", ")}`);
console.log(`  kadran bbox  : ${dBox.size.map((v) => v.toFixed(4)).join(", ")}  ctr=${dBox.ctr.map((v) => v.toFixed(4)).join(", ")}`);
console.log(`  kadran ÖNDE  : ${dBox.ctr[2] > box.ctr[2] ? "EVET (+Z)" : "HAYIR ✗"}`);
console.log(`  uzun eksen   : ${["X", "Y", "Z"][box.size.indexOf(Math.max(...box.size))]}  (kayış +Y olmalı)`);
console.log(`  kadran düz mü: kalınlık ${dBox.size[2].toFixed(5)} (≈0 = düz düzlem)`);

// --- merkezle + Y yüksekliğini 1.0'a ölçekle
const k = OUT_H / box.size[1];
for (const { prim } of prims) transformPrimitive(prim, centerScaleM4(box.ctr, k));
box = bboxOf(prims);
console.log(`  normalize    : ${box.size.map((v) => v.toFixed(4)).join(", ")}  merkez=${box.ctr.map((v) => v.toFixed(5)).join(", ")}`);

// --- materyal şeması
for (const mat of root.listMaterials()) {
  const spec = PBR[mat.getName()];
  if (!spec) { console.log(`  ! şemada yok: ${mat.getName()}`); continue; }
  const orig = mat.getName();
  mat.setName(spec.name)
    .setBaseColorFactor(spec.color)
    .setMetallicFactor(spec.metal)
    .setRoughnessFactor(spec.rough)
    .setExtras({ sourceMaterial: orig, vitrinClass: spec.name });
  if (orig !== spec.name) console.log(`  ${orig} → ${spec.name}`);
}
// findScreenMesh mesh ADINA da bakıyor — kadranı kendi node'una ayırmıyoruz
// (tek mesh), materyal adı "Screen" yeterli.

if (DRY) { console.log("  (--dry: yazılmadı)"); process.exit(0); }
fs.mkdirSync(path.dirname(DST), { recursive: true });
await io.write(DST, doc);
console.log(`  YAZILDI: ${path.relative(process.cwd(), DST)}  (${(fs.statSync(DST).size / 1048576).toFixed(2)} MB)`);
