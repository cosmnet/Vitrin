import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Box3, Vector3 } from "three";
import assert from "node:assert/strict";

globalThis.FileReader=class FileReader {
 readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
 readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result="data:application/octet-stream;base64,"+Buffer.from(value).toString("base64");this.onloadend?.();});}
};
const base=process.cwd(),tmp=await fs.mkdtemp(path.join(base,"scripts/.duo-runtime-"));
try {
 const source=await fs.readFile(path.join(base,"engine/duo.ts"),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const module=path.join(tmp,"duo.mjs");await fs.writeFile(module,js);
 const {buildDuo}=await import(pathToFileURL(module).href);
 // Verify the folding axis and screen mapping before saving production GLBs.
 // Both edges must share position AND UV at every angle; a gap/duplicated
 // center strip hides app content and is the principal regression to catch.
 for(const kind of ["foldable","foldable-portrait","foldable-cover","foldable-cover-landscape"]) {
  for(const angle of kind.includes("cover") ? [180] : [20,100,145,180]) {
   const bin={geos:[],mats:[],texes:[]},group=buildDuo({mode:"3d",kind,camera:"front",foldAngle:angle},null,bin);
   group.updateMatrixWorld(true);
   group.traverse(m=>{if(m.isMesh && m.name === "Duo display backing") {
    const local=new Box3().setFromBufferAttribute(m.geometry.getAttribute("position"));
    assert(local.max.z+m.position.z<m.userData.displayZ-.0001,`Backing stays behind display; no z-fighting ${kind}`);
   }});
   const screens=[];group.traverse(m=>{if(m.isMesh && m.name.startsWith("Duo inner display"))screens.push(m);});
   if(screens.length===2) for(const top of [false,true]) {
    const ends=screens.map((m,side)=>{
     const p=m.geometry.getAttribute("position"),uv=m.geometry.getAttribute("uv"),box=new Box3().setFromBufferAttribute(p);
     const x=side===0?box.max.x:box.min.x,y=top?box.max.y:box.min.y;
     let found=-1;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<1e-6&&Math.abs(p.getY(i)-y)<1e-6)found=i;
     assert(found>=0,`Straight hinge endpoint ${kind}`);
     return {point:m.localToWorld(new Vector3(p.getX(found),p.getY(found),0)),u:uv.getX(found),v:uv.getY(found)};
    });
    assert(ends[0].point.distanceTo(ends[1].point)<1e-6,`Continuous hinge ${kind} ${angle}`);
    assert(Math.abs(ends[0].u-ends[1].u)<1e-6&&Math.abs(ends[0].v-ends[1].v)<1e-6,`Continuous UV ${kind} ${angle}`);
   }
   if(angle===180) {
    const displayBox=new Box3();group.traverse(m=>{if(m.isMesh && m.name.includes("display") && m.name !== "Duo display backing")displayBox.expandByObject(m);});
    group.traverse(m=>{if(!m.isMesh||!m.name.includes("display")||m.name === "Duo display backing")return;
     const p=m.geometry.getAttribute("position"),uv=m.geometry.getAttribute("uv");
     for(let i=0;i<p.count;i++) {
      const world=m.localToWorld(new Vector3(p.getX(i),p.getY(i),0));
      const u=(world.x-displayBox.min.x)/(displayBox.max.x-displayBox.min.x),v=(world.y-displayBox.min.y)/(displayBox.max.y-displayBox.min.y);
      assert(Math.abs(u-uv.getX(i))<1e-5&&Math.abs(v-uv.getY(i))<1e-5,`Upright, unstretched texture ${kind}`);
     }
    });
    const height=new Box3().setFromObject(group).getSize(new Vector3()).y;
    assert(Math.abs(height-2.16)<.015,`Normalized body ${kind}`);
   }
   bin.geos.forEach(g=>g.dispose());bin.mats.forEach(m=>m.dispose());
  }
 }
 process.stdout.write("PASS: 4 orientations, 10 postures, continuous hinge/UV, upright textures, normalized body\n");
 for(const [name,kind,angle] of [["open","foldable",180],["book","foldable",145],["closed","foldable-cover",180]]){
  const bin={geos:[],mats:[],texes:[]},group=buildDuo({mode:"3d",kind,camera:"front",foldAngle:angle},null,bin);
  group.updateMatrixWorld(true);const buffer=await new GLTFExporter().parseAsync(group,{binary:true});
  const file=path.join(base,"public/assets/models",`iphone-duo-${name}.glb`);await fs.writeFile(file,new Uint8Array(buffer));
  process.stdout.write(`${name}: ${buffer.byteLength} bytes\n`);
  bin.geos.forEach(g=>g.dispose());bin.mats.forEach(m=>m.dispose());
 }
}finally{await fs.rm(tmp,{recursive:true,force:true});}
