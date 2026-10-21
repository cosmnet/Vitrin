"use client";

import { useEffect, useState } from "react";
import { BRAND_COLLECTIONS, type BrandThemeId } from "@/engine/brandThemes";
import { makeBrandDraft } from "@/engine/brandProjects";
import { getTemplate } from "@/engine/templates";
import { api } from "@/lib/client";
import { ensureSlideFonts } from "@/engine/fonts";
import { getTheme } from "@/engine/themes";
import { L } from "@/lib/i18n";

export default function BrandThemes() {
  const [busy,setBusy] = useState<string>(), [error,setError] = useState(""), [overview,setOverview] = useState(false), [tabletPick,setTabletPick] = useState<"iphone"|"ipad">("iphone");
  useEffect(()=>{for(const c of BRAND_COLLECTIONS)void ensureSlideFonts({...getTemplate(c.templateId).build(1)[0],headline:"Aa",sub:"Aa"},getTheme(c.id));},[]);
  async function open(id: BrandThemeId, format: "iphone" | "ipad" = "iphone") {
    setBusy(id);setError("");
    try {
      const project=makeBrandDraft(id,format);
      await api("/api/projects", { project });
      window.location.href=`/studio?project=${project.id}`;
    } catch(e) { setError(String(e));setBusy(undefined); }
  }
  return <main className={`brand-gallery${overview?" overview":""}`}>
    <style>{`
      .brand-gallery{position:fixed;inset:0;overflow:auto;background:#f7f7f5;color:#171a21;padding:32px 4vw 60px;font-family:var(--font-sans),sans-serif}
      .brand-gallery *{box-sizing:border-box}.brand-nav{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px;border-bottom:1px solid #dedfdf;padding-bottom:16px}.brand-nav a{color:inherit}.brand-links{display:flex;gap:18px}.brand-links a{text-decoration:none;color:#657080}
      .brand-intro{margin:30px 0 35px;max-width:760px}.brand-intro span{font-size:11px;letter-spacing:2px;color:#67707c}.brand-intro h1{font-size:clamp(28px,4vw,48px);letter-spacing:-2px;margin:8px 0 12px;font-weight:600}.brand-intro p{font-size:14px;color:#657080;line-height:1.6;margin:0}
      .brand-series{padding-top:24px;border-top:1px solid #dedfdf;margin-top:34px}.brand-series-head{display:flex;justify-content:space-between;gap:16px;align-items:center}.brand-series h2{font-size:20px;margin:0 0 7px;letter-spacing:-.5px}.brand-series-head p{font-size:12px;color:#657080;margin:0}.brand-open{background:#002fa7;border:0;color:white;padding:12px 18px;border-radius:100px;font-size:12px;cursor:pointer;white-space:nowrap}.brand-open:disabled{opacity:.5}.brand-frames{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0 14px}.brand-frame{margin:0}.brand-frame img{width:100%;display:block;border-radius:8px;background:#eceff3;aspect-ratio:1320/2868;box-shadow:0 2px 9px #1111}.brand-frame figcaption{font-size:10px;color:#657080;display:flex;gap:6px;margin-top:10px;line-height:1.3}.brand-frame figcaption b{font-weight:500;font-variant-numeric:tabular-nums}.brand-type{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap;margin-top:18px}.brand-type em{font-style:normal;font-size:29px;letter-spacing:-.8px}.brand-type small{font-size:11px;color:#67707c}.brand-gallery button:focus-visible,.brand-gallery a:focus-visible{outline:3px solid #9db8ff;outline-offset:4px}
      .brand-view{background:none;border:1px solid #d9dcdf;border-radius:20px;padding:7px 12px;color:#344052;font-size:11px;cursor:pointer}.brand-mini-type{display:none}
      .brand-gallery.overview{padding-top:16px;padding-bottom:16px}.overview .brand-intro,.overview .brand-type{display:none}.overview .brand-series{display:grid;grid-template-columns:340px 1fr;align-items:center;gap:20px;margin-top:12px;padding-top:12px}.overview .brand-series-head{display:block}.overview .brand-series h2{font-size:19px}.overview .brand-series-head p{max-width:310px;line-height:1.5}.overview .brand-open{margin-top:12px;padding:9px 15px}.overview .brand-frames{overflow:auto;display:flex;justify-content:flex-end;gap:16px;margin:0}.overview .brand-frame{width:78px;min-width:0;flex:0 0 78px}.overview .brand-frame img{width:78px;height:170px}.overview .brand-frame figcaption{font-size:9px;margin-top:7px;min-height:24px}.overview .brand-mini-type{display:block;margin-top:9px;font-size:26px;letter-spacing:-.7px}.brand-mini-type small{font-family:var(--sans),sans-serif;font-size:10px;letter-spacing:0;margin-left:12px;color:#67707c}
      .overview .brand-frame{width:70px;flex-basis:70px}.overview .brand-frame img{width:70px;height:152px}
      @media(max-width:680px){.brand-gallery{padding:22px 18px}.brand-frames{overflow:auto;display:flex;scroll-snap-type:x mandatory}.brand-frame{min-width:42%;scroll-snap-align:start}.brand-series-head{align-items:flex-start}.brand-open{padding:10px 12px}.brand-type{gap:12px}.overview .brand-series{display:block}.overview .brand-frames{justify-content:flex-start;margin-top:12px}.overview .brand-mini-type{display:none}}
    `}</style>
    <nav className="brand-nav"><b>{L("vitrin. / ÖZEL SERİLER", "vitrin. / CUSTOM SERIES")}</b><div className="brand-links">{BRAND_COLLECTIONS.map(c=><a key={c.id} href={`#${c.id}`}>{c.app}</a>)}</div><button className="brand-view" aria-pressed={overview} onClick={()=>setOverview(!overview)}>{overview?L("Detaylı görünüm", "Detailed view"):L("Genel bakış", "Overview")}</button><a href="/studio">{L("Stüdyoya dön ↗", "Back to Studio ↗")}</a></nav>
    <header className="brand-intro"><span>{L(`${BRAND_COLLECTIONS.length} UYGULAMA · ${BRAND_COLLECTIONS.length} AYRI DÜNYA`, `${BRAND_COLLECTIONS.length} APPS · ${BRAND_COLLECTIONS.length} SEPARATE WORLDS`)}</span><h1>{L("Markanın kendi vitrini.", "A showcase of the brand's own.")}</h1><p>{L("Her uygulamanın kendi tipografisi, zeminleri ve kareleri. Tipografi, metinler ve cihazlar düzenlenebilir.", "Each app has its own type, backgrounds and frames. Typography, copy and devices stay editable.")}</p></header>
    {error&&<p role="alert">{error}</p>}
    {BRAND_COLLECTIONS.map(c=><section className="brand-series" id={c.id} key={c.id}>
      <div className="brand-series-head"><div><h2>{c.name}</h2><p>{c.description}</p><span className="brand-mini-type" style={{fontFamily:c.font,fontWeight:c.headlineWeight}}>Aa · {c.app}<small>{c.font}</small></span>{c.ipadTemplateId&&<div style={{display:"flex",gap:6,marginTop:10}}>{(["iphone","ipad"] as const).map(f=><button key={f} className="brand-view" aria-pressed={tabletPick===f} style={tabletPick===f?{borderColor:"#002fa7",color:"#002fa7"}:undefined} onClick={()=>setTabletPick(f)}>{f==="ipad"?"iPad":"iPhone"}</button>)}</div>}</div><div><button className="brand-open" disabled={!!busy} onClick={()=>open(c.id,c.ipadTemplateId?tabletPick:"iphone")}>{busy===c.id?L("Açılıyor…", "Opening…"):!!c.ipadTemplateId&&tabletPick==="ipad"?L("iPad taslağı aç ↗", "Open iPad draft ↗"):L("Yeni taslak aç ↗", "Open new draft ↗")}</button></div></div>
      <div className="brand-frames">{getTemplate(c.ipadTemplateId&&tabletPick==="ipad"?c.ipadTemplateId:c.templateId).build().map((s,i)=><figure className="brand-frame" key={`${tabletPick}-${i}`}><img src={`/assets/brand-frames/${c.id}${!!c.ipadTemplateId&&tabletPick==="ipad"?"-ipad":""}-${String(i+1).padStart(2,"0")}.webp`} alt={`${c.app} ${s.frameLabel}`} style={!!c.ipadTemplateId&&tabletPick==="ipad"?{aspectRatio:"3/4",height:overview?94:undefined}:undefined} loading="lazy" decoding="async"/><figcaption><b>{String(i+1).padStart(2,"0")}</b>{s.frameLabel}{s.hideDevice?L(" · Telefonsuz", " · No phone"):""}</figcaption></figure>)}</div>
      <div className="brand-type"><em style={{fontFamily:c.font,fontWeight:c.headlineWeight}}>Aa · {c.app}</em><small>{L(`Başlık: ${c.font} · Alt yazı: ${c.bodyFont}`, `Headline: ${c.font} · Subtitle: ${c.bodyFont}`)}</small><small>{c.hint ?? L("Tipografi örneği · boş taslak", "Typography sample · blank draft")}</small></div>
    </section>)}
  </main>;
}
