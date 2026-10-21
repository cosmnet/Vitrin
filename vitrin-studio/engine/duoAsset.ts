import * as THREE from "three";
import type { DeviceStyle3D } from "./types";
import type { Bin } from "./scene3dCore";

export const DUO_ASSET_CREDIT = 'Apple iPhone Duo by zhe_kan · CC-BY-NC-SA-4.0';

export function duoPostureOf(style: DeviceStyle3D): "open" | "closed" {
  return style.duoPosture ?? (style.kind?.includes("cover") ? "closed" : "open");
}
export function duoAssetUrl(style: DeviceStyle3D): string {
  return `/assets/models/apple-iphone-duo-${duoPostureOf(style)}.glb`;
}

/** Contain the complete screenshot; ClampToEdge fills the small panel margins. */
function displayUV(raw: ArrayLike<number>, rectAspect: number, tex: THREE.Texture | null | undefined): THREE.BufferAttribute {
  const im = tex?.image as { width?: number; height?: number } | undefined;
  const imageAspect = im?.width && im?.height ? im.width / im.height : rectAspect;
  const su = Math.max(1, rectAspect / imageAspect), sv = Math.max(1, imageAspect / rectAspect);
  const uv = Float32Array.from(raw);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = .5 + (raw[i] - .5) * su;
    uv[i + 1] = .5 + (raw[i + 1] - .5) * sv;
  }
  return new THREE.BufferAttribute(uv, 2);
}

/** Use the downloaded display's exact geometry; never estimate or stretch the bezel. */
export function prepareDuoAsset(src: THREE.Group, style: DeviceStyle3D, screenTex: THREE.Texture | null, bin: Bin, outerTex?: THREE.Texture | null): THREE.Group {
  const root = src.clone(true), posture = duoPostureOf(style);
  if (style.kind === "foldable-portrait" && posture === "open" || style.kind === "foldable-cover-landscape" && posture === "closed") root.rotateZ(Math.PI / 2);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
  const scale = 2.16 / bounds.getSize(new THREE.Vector3()).y;
  root.position.sub(center);
  const normalized = new THREE.Group(); normalized.add(root); normalized.scale.setScalar(scale);
  const wrap = new THREE.Group(); wrap.add(normalized); wrap.updateMatrixWorld(true);
  const displays: { mesh: THREE.Mesh; outer: boolean; box: THREE.Box3 }[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    const original = Array.isArray(object.material) ? object.material[0] : object.material;
    if (original.name === "Screen.001" || original.name === "Screen.002") displays.push({ mesh: object, outer: original.name === "Screen.002", box: new THREE.Box3().setFromObject(object) });
    // Transparent source glass uses transmission; screenshot glass must not obscure the app.
    if (original.name === "Glass_screen") object.visible = false;
    if (style.bodyColor && original.name.startsWith("Frame_")) {
      const material = original.clone() as THREE.MeshStandardMaterial;
      material.color.set(style.bodyColor); object.material = material; bin.mats.push(material);
    }
  });
  for (const { mesh, outer, box } of displays) {
    const tex = posture === "closed" ? screenTex : outer ? outerTex : screenTex;
    const geometry = mesh.geometry.clone();
    const positions = geometry.getAttribute("position"), raw = new Float32Array(positions.count * 2);
    const size = box.getSize(new THREE.Vector3());
    const rectAspect = size.x / size.y;
    for (let i = 0; i < positions.count; i++) {
      const world = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      let u = (world.x - box.min.x) / Math.max(size.x, .000001), v = (world.y - box.min.y) / Math.max(size.y, .000001);
      if (outer && posture === "open") u = 1 - u;
      raw[i * 2] = u; raw[i * 2 + 1] = v;
    }
    geometry.setAttribute("uv", displayUV(raw, rectAspect, tex));
    mesh.geometry = geometry; bin.geos.push(geometry);
    // The asset includes a stock phone picture. Never present it as app UI when
    // a screenshot is missing or fails to load.
    const material = new THREE.MeshBasicMaterial({ map: tex ?? null, color: tex ? "#ffffff" : "#08090c", side: THREE.DoubleSide, toneMapped: false });
    mesh.material = material; bin.mats.push(material);
    mesh.name = outer ? "Duo asset outer display" : "Duo asset inner display";
    Object.assign(mesh.userData, { duoDisplay: posture === "closed" || !outer ? "primary" : "outer", duoUv: Array.from(raw), rectAspect });
  }
  Object.assign(wrap.userData, { modelSource: duoAssetUrl(style), attribution: DUO_ASSET_CREDIT, posture });
  return wrap;
}

/** Refit each clone's original display UVs for its own screenshot. */
export function retargetDuoAssetScreen(phone: THREE.Object3D, tex: THREE.Texture, bin: Bin): void {
  phone.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.duoDisplay !== "primary") return;
    const material = (object.material as THREE.MeshBasicMaterial).clone();
    material.map = tex; material.color.set("#ffffff"); material.needsUpdate = true; object.material = material; bin.mats.push(material);
    const geometry = object.geometry.clone(), raw = object.userData.duoUv as number[], rectAspect = object.userData.rectAspect as number;
    geometry.setAttribute("uv", displayUV(raw, rectAspect, tex)); object.geometry = geometry; bin.geos.push(geometry);
  });
}
