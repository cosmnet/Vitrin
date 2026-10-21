"use client";
import type { CameraPresetId } from "@/engine/types";
import { presetOrbit } from "@/engine/scene3d";
import { L } from "@/lib/i18n";

export default function CameraPicker({ cameras, value, onPick }: { cameras: {id:CameraPresetId;label:string}[]; value:CameraPresetId; onPick:(id:CameraPresetId)=>void }) {
  return <div className="camera-grid" role="group" aria-label={L("Kamera açıları", "Camera angles")}>{cameras.map(({id,label}) => {
    const o=presetOrbit(id), count=id==="fan3"||id==="stack3"?3:id==="pair"?2:1;
    const p=(x:number,y:number) => {
      const z=-x*Math.sin(o.theta);
      return `${40+x*Math.cos(o.theta)*18} ${27+(y*Math.sin(o.phi)+z*Math.cos(o.phi))*18}`;
    };
    const points=[[-.6,-1],[.6,-1],[.6,1],[-.6,1]].map(([x,y])=>p(x,y)).join(" ");
    return <button key={id} className={`camera-card ${value===id?"on":""}`} aria-pressed={value===id} aria-label={L(`Kamera: ${label}`, `Camera: ${label}`)} onClick={()=>onPick(id)}>
      <svg viewBox="0 0 80 54" aria-hidden="true">{Array.from({length:count},(_,i)=><g key={i} transform={`translate(${(i-(count-1)/2)*16} ${i*2})`}><polygon points={points} fill="currentColor" opacity={.2+i*.1} stroke="currentColor" strokeWidth="1.6"/><circle cx="40" cy="27" r="1.8" fill="currentColor"/></g>)}</svg>{label}
    </button>;
  })}</div>;
}
