"use client";
import { useEffect, useState } from "react";
import { getLayoutForFormat, LAYOUTS } from "@/engine/layouts";
import { deviceAspectOf, kindOfFormat, baseOf, type Format, type LayoutId } from "@/engine/types";
import { splitFrames } from "@/engine/splitScreens";
import { previewProps } from "./previewOverride";
import { L } from "@/lib/i18n";

const LABELS: Record<LayoutId, string> = {
  "text-top":L("Başlık üstte", "Headline on top"), "text-bottom":L("Başlık altta", "Headline at bottom"), "device-bleed-bottom":L("Büyük cihaz", "Large device"), "device-bleed-top":L("Üstten taşan", "Bleeding off top"), "text-overlay":L("Üst üste", "Overlapping"), "badge-hero":L("Rozetli", "With badge"), "split-diagonal":L("Diyagonal", "Diagonal"), "screen-card":L("Ekran kartı", "Screen card"), "pano-left":L("Panorama sol", "Panorama left"), "pano-right":L("Panorama sağ", "Panorama right"), "wide-left":L("Metin solda", "Text on left"), "wide-right":L("Metin sağda", "Text on right"), "wide-hero":L("Geniş sahne", "Wide scene"), "panorama-mid":L("Panorama orta", "Panorama center"), "split-v":L("İki sütun", "Two columns"), "split-h":L("İki kare", "Two frames"), "duo-overlap":L("Bindirmeli", "Overlapping"), "duo-depth":L("Derinlikli", "Depth"), "duo-dutch":L("Karşıt açı", "Opposing angles"), "duo-hero-aside":L("Ana + detay", "Main + detail"), "duo-stagger":L("Kademeli", "Staggered"), "duo-bleed-sides":L("Yanlardan taşan", "Bleeding off sides"), "duo-editorial":L("Yan sütun", "Side column"), "duo-pip":L("İç içe", "Picture-in-picture"), "diptych":L("Çift ekran", "Dual screen"), "trio-arc":L("Üçlü yay", "Trio arc"), "trio-stack":L("Üçlü sıra", "Trio row"),
};

export function LayoutPreview({ id, format }: { id: LayoutId; format: Format }) {
  const layout=getLayoutForFormat(id,format), b=baseOf(format), ratio=b.w/b.h;
  const H=90, W=H*ratio, x=(130-W)/2, ar=deviceAspectOf(kindOfFormat(format));
  const boxes=[layout.device,layout.device2,layout.device3].filter(Boolean);
  return <svg viewBox="0 0 130 100" aria-hidden="true" className="layout-preview">
    <defs><clipPath id={`lp-${id}-${format}`}><rect x={x} y="5" width={W} height={H} rx="4"/></clipPath></defs>
    <rect x={x} y="5" width={W} height={H} rx="4" fill="var(--layout-paper)"/>
    <g clipPath={`url(#lp-${id}-${format})`}>
      {layout.splitPanels ? splitFrames(id,format).map((p,i) => <rect key={i} x={x+p.x/b.w*W} y={5+p.y/b.h*H} width={p.w/b.w*W} height={p.h/b.h*H} rx="3" fill="var(--layout-device)"/>) : boxes.map((box,i) => {
        if(!box) return null; const h=box.scale*H,w=h*ar,cx=x+box.cx*W,cy=5+box.cy*H;
        return <g key={i} transform={`rotate(${(box.rotation||0)*180/Math.PI} ${cx} ${cy})`}><rect x={cx-w/2} y={cy-h/2} width={w} height={h} rx="3" fill="var(--layout-device)" opacity={1-i*.17}/><rect x={cx-w/2+2} y={cy-h/2+3} width={Math.max(1,w-4)} height={Math.max(1,h-6)} rx="2" fill="var(--layout-screen)"/></g>;
      })}
      <rect x={x+layout.text.x*W} y={5+layout.text.y*H} width={layout.text.w*W} height="4" rx="2" fill="var(--layout-ink)"/>
      <rect x={x+layout.text.x*W} y={12+layout.text.y*H} width={layout.text.w*W*.62} height="2.5" rx="1" fill="var(--layout-ink)" opacity=".5"/>
    </g>
  </svg>;
}

export default function LayoutPicker({ value, format, onPick }: { value: LayoutId; format: Format; onPick:(id:LayoutId)=>void }) {
  const [more,setMore]=useState(false);
  const [group,setGroup]=useState<"single"|"multi"|"panorama">(LAYOUTS[value].device2 ? "multi" : value.startsWith("pano") ? "panorama" : "single");
  useEffect(() => { setGroup(LAYOUTS[value].device2 ? "multi" : value.startsWith("pano") ? "panorama" : "single"); }, [value]);
  const ids=(Object.keys(LAYOUTS) as LayoutId[]).filter(id => group === "multi" ? !!LAYOUTS[id].device2 : group === "panorama" ? id.startsWith("pano") : !LAYOUTS[id].device2 && !id.startsWith("pano"));
  return <div className="layout-picker">
    <div className="visual-tabs" role="tablist" aria-label={L("Yerleşim türü", "Layout type")}>
      {([['single',L('Tek ekran', 'Single screen')],['multi',L('Çoklu ekran', 'Multi screen')],['panorama',L('Panorama', 'Panorama')]] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={group===id} onClick={()=>{setGroup(id);setMore(false);}}>{label}</button>)}
    </div>
    <div className="layout-grid" role="group" aria-label={L("Görsel yerleşimler", "Visual layouts")}>
      {(more?ids:ids.includes(value)&&ids.indexOf(value)>5?[...ids.slice(0,5),value]:ids.slice(0,6)).map(id => <button key={id} type="button" className={`layout-card ${value===id?'on':''}`} aria-label={L(`Yerleşim: ${LABELS[id]}`, `Layout: ${LABELS[id]}`)} aria-pressed={value===id} onClick={()=>onPick(id)} {...previewProps(`layout:${id}`,{layout:id})}>
        <LayoutPreview id={id} format={format}/><span>{LABELS[id]}</span>
        {LAYOUTS[id].device2 && <i>{LAYOUTS[id].device3 ? '3' : '2'}</i>}
      </button>)}
    </div>
    {ids.length>6 && <button className="layout-more" onClick={()=>setMore(!more)}>{more?L("Daha az göster", "Show less"):L(`${ids.length-6} yerleşim daha göster`, `Show ${ids.length-6} more layouts`)}</button>}
  </div>;
}
