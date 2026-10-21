"use client";
import { useState } from "react";
import { FORMATS, EXPORT_SIZES, DUO_UPLOAD_NOTE, DUO_SCREENSHOT_SOURCE, formatOf, isDuoFormat, type Format } from "@/engine/types";
import { useStudio } from "@/store/studio";
import { Icon } from "./ui";
import { L } from "@/lib/i18n";

export function FormatCards({ value, onChange }: { value: Format; onChange: (f:Format)=>void }) {
  const family=isDuoFormat(value) ? "duo" : value.startsWith("ipad") ? "ipad" : "iphone";
  return <div className="format-picker">
    <div className="format-cards" role="group" aria-label={L("Cihaz ailesi", "Device family")}>
      {([['iphone','iPhone','phone'],['ipad','iPad','frame'],['duo','iPhone Duo','cube']] as const).map(([id,label,icon])=><button key={id} type="button" className={family===id?'on':''} aria-pressed={family===id} onClick={()=>onChange(id==='duo'?'iphone-duo':id)}><Icon name={icon} size={27}/><b>{label}</b><small>{id==='duo'?L('Katlanabilir', 'Foldable'):id==='ipad'?L('Büyük ekran', 'Large screen'):L('Klasik', 'Classic')}</small></button>)}
    </div>
    {family !== 'iphone' && <div className="visual-tabs" role="group" aria-label={L("Ekran ve yön", "Screen and orientation")}>
      {(family==='ipad'?['ipad','ipad-landscape']:['iphone-duo','iphone-duo-portrait','iphone-duo-cover','iphone-duo-cover-landscape']).map(f=><button key={f} type="button" className={value===f?'on':''} aria-pressed={value===f} onClick={()=>onChange(f as Format)}>{f==='ipad'?L('Portre', 'Portrait'):f==='ipad-landscape'?L('Yatay', 'Landscape'):f==='iphone-duo'?L('İç · yatay', 'Inner · landscape'):f==='iphone-duo-portrait'?L('İç · portre', 'Inner · portrait'):f==='iphone-duo-cover'?L('Dış · portre', 'Outer · portrait'):L('Dış · yatay', 'Outer · landscape')}</button>)}
    </div>}
    <p className="format-resolution">{EXPORT_SIZES[FORMATS[value].exportSize].w} × {EXPORT_SIZES[FORMATS[value].exportSize].h} px</p>
    {family === "duo" && <p className="note">{DUO_UPLOAD_NOTE} <a href={DUO_SCREENSHOT_SOURCE} target="_blank" rel="noreferrer">{L("Apple ölçüleri", "Apple sizes")}</a></p>}
  </div>;
}

export default function FormatPicker() {
  const [open,setOpen]=useState(false), project=useStudio(s=>s.project), format=formatOf(project), mutate=useStudio(s=>s.mutate);
  return <div className="format-control">
    <button className="format-trigger" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label={L("Cihaz ve çıktı biçimi", "Device and output format")}><Icon name={isDuoFormat(format)?'cube':format.startsWith('ipad')?'frame':'phone'} size={15}/><span>{isDuoFormat(format)?'iPhone Duo':format.startsWith('ipad')?'iPad':'iPhone'}</span><Icon name="chevron" size={12}/></button>
    {open && <><button className="popover-dismiss" aria-label={L("Cihaz seçicisini kapat", "Close device picker")} onClick={()=>setOpen(false)}/><div className="format-popover"><b>{L("Cihazını seç", "Choose your device")}</b><p>{L("İçerik korunur. Kadraj seçilen ekrana uyarlanır.", "Content is kept. The framing adapts to the selected screen.")}</p><FormatCards value={format} onChange={f=>mutate(p=>({...p,format:f}))}/><button className="btn wide" onClick={()=>setOpen(false)}>{L("Tamam", "Done")}</button></div></>}
  </div>;
}
