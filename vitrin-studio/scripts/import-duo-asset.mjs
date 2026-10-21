import { promises as fs } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { Matrix4 } from "three";

const source = process.argv[2];
if (!source) throw new Error("kullanım: node scripts/import-duo-asset.mjs <apple_iphone_duo.glb>");
const output = path.resolve("public/assets/models");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await fs.mkdir(output, { recursive: true });
await fs.copyFile(source, path.join(output, "apple-iphone-duo-source.glb"));
for (const posture of ["open", "closed"]) {
  const doc = await io.read(source);
  const selected = doc.getRoot().listNodes().find(node => node.getName().startsWith(posture === "open" ? "Apple iPhone Duo_2" : "Apple iPhone Duo_1"));
  if (!selected) throw new Error(`Missing ${posture} body in source model`);
  const matrix = new Matrix4().fromArray(selected.getWorldMatrix());
  if (posture === "open") matrix.premultiply(new Matrix4().makeRotationZ(-Math.PI / 2));
  for (const parent of selected.listParents()) if (typeof parent.removeChild === "function") parent.removeChild(selected);
  selected.setMatrix(matrix.toArray());
  const scene = doc.createScene(`Apple iPhone Duo · ${posture}`).addChild(selected);
  for (const previous of doc.getRoot().listScenes()) if (previous !== scene) previous.dispose();
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(prune());
  const file = path.join(output, `apple-iphone-duo-${posture}.glb`);
  await io.write(file, doc);
  console.log(`${posture}: ${(await fs.stat(file)).size} bytes; original mesh and materials retained`);
}
