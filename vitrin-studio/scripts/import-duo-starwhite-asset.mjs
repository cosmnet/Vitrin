// iPhone Duo "Star White" (Sketchfab, extraakash, Free Standard) → two static GLBs.
//
//   node scripts/import-duo-starwhite-asset.mjs <apple_iphone_duo_fold_star_white.glb>
//
// The source is rigged: its "open-close" clip runs from flat open (t = 0) to fully
// closed (t = 2 s) on two hinge bones. Vitrin clones device sources, and cloned
// SkinnedMeshes lose their skeleton, so each posture is baked here: the clip is
// sampled into the bones, every skinned vertex is moved into place and the skin,
// clip and weights are dropped. Meshes, materials and textures are otherwise kept.
//
// Output lands in public/assets/models as iphone-duo-starwhite-{open,closed}.glb.
// The Standard licence does not allow passing the model on as-is, so the files
// stay on this machine (private/assets-exclude.txt keeps them out of releases).
import { promises as fs } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { Matrix3, Matrix4, Vector3 } from "three";

const source = process.argv[2];
if (!source) throw new Error("kullanım: node scripts/import-duo-starwhite-asset.mjs <apple_iphone_duo_fold_star_white.glb>");
const output = path.resolve("public/assets/models");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const POSTURES = { open: 0, closed: Infinity };

/** Keyframe value at `t`, clamped to the clip; linear between keys (normalised for rotations). */
function sample(channel, t) {
  const sampler = channel.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  const n = values.length / times.length, at = i => Array.from(values.slice(i * n, i * n + n));
  if (t <= times[0]) return at(0);
  if (t >= times[times.length - 1] || sampler.getInterpolation() === "STEP") {
    let i = times.length - 1;
    while (i > 0 && times[i] > t) i--;
    return at(i);
  }
  let i = 0;
  while (times[i + 1] < t) i++;
  const k = (t - times[i]) / (times[i + 1] - times[i]), a = at(i), b = at(i + 1);
  const mixed = a.map((v, j) => v + (b[j] - v) * k);
  if (channel.getTargetPath() !== "rotation") return mixed;
  const len = Math.hypot(...mixed);
  return mixed.map(v => v / len);
}

/** Moves every skinned vertex to where the posed skeleton puts it, then drops the skin. */
function bakeSkins(doc) {
  const buffer = doc.getRoot().listBuffers()[0];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const inverse = skin.getInverseBindMatrices()?.getArray();
    const joints = skin.listJoints().map((joint, i) => {
      const bind = inverse ? new Matrix4().fromArray(Array.from(inverse.slice(i * 16, i * 16 + 16))) : new Matrix4();
      return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(bind);
    });
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION"), normal = prim.getAttribute("NORMAL"), tangent = prim.getAttribute("TANGENT");
      const jointIndex = prim.getAttribute("JOINTS_0"), weight = prim.getAttribute("WEIGHTS_0");
      if (!position || !jointIndex || !weight) continue;
      const count = position.getCount();
      const positions = new Float32Array(count * 3), normals = normal && new Float32Array(count * 3), tangents = tangent && new Float32Array(count * 4);
      const p = [], q = [], j = [], w = [], m = new Matrix4(), rot = new Matrix3(), v = new Vector3();
      for (let i = 0; i < count; i++) {
        jointIndex.getElement(i, j); weight.getElement(i, w);
        const e = new Array(16).fill(0);
        for (let k = 0; k < 4; k++) if (w[k]) joints[j[k]].elements.forEach((x, idx) => { e[idx] += x * w[k]; });
        m.fromArray(e); rot.setFromMatrix4(m);
        position.getElement(i, p); v.fromArray(p).applyMatrix4(m); v.toArray(positions, i * 3);
        if (normals) { normal.getElement(i, q); v.fromArray(q).applyMatrix3(rot).normalize(); v.toArray(normals, i * 3); }
        if (tangents) { tangent.getElement(i, q); v.set(q[0], q[1], q[2]).applyMatrix3(rot).normalize(); v.toArray(tangents, i * 4); tangents[i * 4 + 3] = q[3]; }
      }
      prim.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer));
      if (normals) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer));
      if (tangents) prim.setAttribute("TANGENT", doc.createAccessor().setType("VEC4").setArray(tangents).setBuffer(buffer));
      prim.setAttribute("JOINTS_0", null).setAttribute("WEIGHTS_0", null);
    }
    // glTF ignores a skinned node's own transform; the baked vertices are already in scene space.
    node.setSkin(null).setMatrix(new Matrix4().toArray());
    for (const parent of node.listParents()) if (parent !== scene && typeof parent.removeChild === "function") parent.removeChild(node);
    if (!scene.listChildren().includes(node)) scene.addChild(node);
  }
}

await fs.mkdir(output, { recursive: true });
for (const [posture, at] of Object.entries(POSTURES)) {
  const doc = await io.read(source);
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode(), value = sample(channel, at);
      if (channel.getTargetPath() === "translation") target.setTranslation(value);
      else if (channel.getTargetPath() === "rotation") target.setRotation(value);
      else if (channel.getTargetPath() === "scale") target.setScale(value);
    }
  }
  bakeSkins(doc);
  for (const animation of doc.getRoot().listAnimations()) animation.dispose();
  for (const skin of doc.getRoot().listSkins()) skin.dispose();
  await doc.transform(prune());
  const file = path.join(output, `iphone-duo-starwhite-${posture}.glb`);
  await io.write(file, doc);
  console.log(`${posture}: ${(await fs.stat(file)).size} bytes`);
}
