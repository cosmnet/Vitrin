import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Bin } from "./scene3dCore";
import type { DeviceStyle3D } from "./types";

// Original Vitrin parametric model, checked 2026-10-01 against:
// https://www.apple.com/iphone-duo/specs/
// Body dimensions and panel ratios are sourced; radii, hinge, buttons,
// cameras and bezels are visual approximations, not Apple's engineering mesh.
export const DUO_SPECS = {
  open: { width: 164.6, height: 117.8, depth: 5.2 },
  closed: { width: 84.1, height: 117.8, depth: 11.3 },
  inner: { width: 2670, height: 1878, ppi: 430 },
  outer: { width: 1398, height: 2034, ppi: 460 },
} as const;

/** Exterior corners only: the folding edge stays straight and continuous. */
function surface(w: number, h: number, r: number, half?: number): THREE.ShapeGeometry {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  const left = half !== 1 ? r : 0, right = half !== 0 ? r : 0;
  s.moveTo(x+left,y); s.lineTo(x+w-right,y);
  if(right) s.quadraticCurveTo(x+w,y,x+w,y+right);
  s.lineTo(x+w,y+h-right);
  if(right) s.quadraticCurveTo(x+w,y+h,x+w-right,y+h);
  s.lineTo(x+left,y+h);
  if(left) s.quadraticCurveTo(x,y+h,x,y+h-left);
  s.lineTo(x,y+left);
  if(left) s.quadraticCurveTo(x,y,x+left,y);
  s.closePath();
  return new THREE.ShapeGeometry(s, 18);
}

export function buildDuo(style: DeviceStyle3D, tex: THREE.Texture | null, bin: Bin, outerTex?: THREE.Texture | null): THREE.Group {
  const root = new THREE.Group(); root.name = "Vitrin Duo parametric";
  const cover = style.kind === "foldable-cover" || style.kind === "foldable-cover-landscape";
  const rotated = style.kind === "foldable-portrait" || style.kind === "foldable-cover-landscape";
  const H = 2.16, unit = H / DUO_SPECS.open.height;
  const W = (cover ? DUO_SPECS.closed.width : DUO_SPECS.open.width) * unit;
  const D = DUO_SPECS.open.depth * unit, frontZ = D/2+.008;
  const color = style.bodyColor || "#cdd1d9";
  const metal = new THREE.MeshPhysicalMaterial({ color, metalness: .88, roughness: .31, clearcoat: .3 });
  const black = new THREE.MeshStandardMaterial({ color: "#08090c", roughness: .29, metalness: .2 });
  let rightShell = root, leftShell = root;
  bin.mats.push(metal, black);
  function slab(w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Group, x: number, z: number) {
    const geo = new RoundedBoxGeometry(w,h,1,8,Math.min(w,h)*.055); geo.scale(1,1,d);
    const m = new THREE.Mesh(geo,mat); m.position.set(x,0,z); parent.add(m); bin.geos.push(geo); return m;
  }
  function screen(parent: THREE.Group, w: number, h: number, x: number, z: number, texture: THREE.Texture | null, half?: number, back = false) {
    const geo = surface(w,h,.065,half), uv = geo.getAttribute("uv"), pos = geo.getAttribute("position");
    const image = texture?.image as { width?: number; height?: number } | undefined;
    // Rotate UVs opposite to the model so the supplied screenshot stays upright.
    // Coordinates come from the entire panel before splitting, never per-pane crop.
    const panelAspect = back || cover ? DUO_SPECS.outer.width/DUO_SPECS.outer.height : DUO_SPECS.inner.width/DUO_SPECS.inner.height;
    const rectAspect = rotated && !back ? 1/panelAspect : panelAspect;
    const imageAspect = image?.width && image?.height ? image.width/image.height : rectAspect;
    for (let i=0;i<uv.count;i++) {
      let u=(pos.getX(i)+w/2)/w, v=(pos.getY(i)+h/2)/h;
      if (half !== undefined) u=(u+half)/2;
      if (rotated && !back) [u,v]=[1-v,u];
      if (imageAspect>rectAspect) u=.5+(u-.5)*rectAspect/imageAspect;
      else v=.5+(v-.5)*imageAspect/rectAspect;
      uv.setXY(i,u,v);
    }
    const mat = new THREE.MeshBasicMaterial({map:texture,color:texture ? "#ffffff" : "#161b23",toneMapped:false});
    const m = new THREE.Mesh(geo,mat); m.name=back || cover ? "Duo outer display" : `Duo inner display ${half ?? 0}`;
    m.position.set(x,0,z); if(back) m.rotation.y=Math.PI; parent.add(m);
    bin.geos.push(geo); bin.mats.push(mat);
  }
  if(cover) {
    const separation=(DUO_SPECS.closed.depth-DUO_SPECS.open.depth)*unit;
    slab(W,H,D,metal,root,0,0); slab(W,H,D,metal,root,0,-separation);
    const sh=DUO_SPECS.outer.height/DUO_SPECS.outer.ppi*25.4*unit;
    const sw=DUO_SPECS.outer.width/DUO_SPECS.outer.ppi*25.4*unit;
    const backing=slab(W-.035,H-.035,.008,black,root,0,D/2+.003);
    backing.name="Duo display backing";backing.userData.displayZ=frontZ;
    screen(root,sw,sh,0,frontZ,tex);
    const hingeGeo=new THREE.CylinderGeometry(.021,.021,H-.13,20);
    const hinge=new THREE.Mesh(hingeGeo,metal); hinge.position.set(-W/2+.025,0,-separation/2); root.add(hinge);bin.geos.push(hingeGeo);
  } else {
    const angle=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(style.foldAngle ?? 180,20,180));
    const bend=(Math.PI-angle)/2;
    const sh=DUO_SPECS.inner.height/DUO_SPECS.inner.ppi*25.4*unit;
    const sw=DUO_SPECS.inner.width/DUO_SPECS.inner.ppi*25.4*unit;
    for(const i of [0,1]) {
      const pivot=new THREE.Group(), sign=i===0 ? -1 : 1, x=sign*W/4;
      if(i===0) leftShell=pivot; else rightShell=pivot;
      root.add(pivot);pivot.rotation.y=-sign*bend; pivot.position.z=frontZ;
      // The hinge axis lies on the inner display plane. The two screen edges
      // share the exact same position at every opening angle.
      slab(W/2-.003,H,D,metal,pivot,x,-frontZ);
      const backing=slab(W/2-.015,H-.035,.008,black,pivot,x,-.008);
      backing.name="Duo display backing";backing.userData.displayZ=0;
      screen(pivot,sw/2,sh,sign*sw/4,0,tex,i);
      if(i===1 && outerTex) {
        const outerH=DUO_SPECS.outer.height/DUO_SPECS.outer.ppi*25.4*unit;
        const outerW=DUO_SPECS.outer.width/DUO_SPECS.outer.ppi*25.4*unit;
        screen(pivot,outerW,outerH,x,-frontZ-D/2-.008,outerTex,undefined,true);
      }
    }
    const geo=new THREE.CylinderGeometry(.018,.018,H-.14,20);
    const hinge=new THREE.Mesh(geo,metal);hinge.position.z=-D*.35;root.add(hinge);bin.geos.push(geo);
    root.userData.foldAngle=THREE.MathUtils.radToDeg(angle);
  }
  const buttonGeo=new THREE.BoxGeometry(.013,.15,.026), button=new THREE.Mesh(buttonGeo,metal);
  button.position.set(W/2+.003,.33,cover ? 0 : -frontZ);rightShell.add(button);bin.geos.push(buttonGeo);
  const portGeo=new THREE.BoxGeometry(.12,.008,.035), port=new THREE.Mesh(portGeo,black);
  port.position.set(cover ? .15 : W/4,-H/2-.001,cover ? 0 : -frontZ);rightShell.add(port);bin.geos.push(portGeo);
  for (const dx of [-.09,.09]) {
    const lensGeo=new THREE.CylinderGeometry(.059,.059,.022,24);
    const lens=new THREE.Mesh(lensGeo,black);lens.rotation.x=Math.PI/2;
    lens.position.set(cover ? W/2-.27+dx : -W/2+.27+dx,H/2-.20,cover?-(DUO_SPECS.closed.depth-DUO_SPECS.open.depth/2)*unit-.011:-frontZ-D/2-.011);
    leftShell.add(lens);bin.geos.push(lensGeo);
  }
  if(rotated) {root.rotation.z=Math.PI/2; root.scale.setScalar(H/W);}
  const metadata={modelSource:"parametric:iphone-duo-v2",reference:"https://www.apple.com/iphone-duo/specs/",referenceChecked:"2026-10-01",approximateDetails:["corners","hinge","bezel","cameras","buttons"]};
  Object.assign(root.userData,metadata);
  const container = new THREE.Group(); container.add(root); Object.assign(container.userData,metadata); return container;
}
