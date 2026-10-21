"use client";

import { useEffect, useRef, useState } from "react";
import { loadImage } from "@/engine/assets";
import { editorLayers, editorLayout, layerBox, layerElement, patchLayerElement, textFramePatch } from "@/engine/editor";
import { BLEND_LABELS, EL_TEXT_BASE, makeElement, reorderElement } from "@/engine/elements";
import { FONT_FAMILIES } from "@/engine/fonts";
import { drawEditedImage, imageFilter } from "@/engine/imageEdit";
import { isSplitScreen, splitCropDefault } from "@/engine/splitScreens";
import { getTheme } from "@/engine/themes";
import { baseOf, clamp, deviceStyleForFormat, formatOf, isDuoFormat, isDevice3D, uid, type ImageCrop, type ImageFx, type Slide, type SlideElement, type TextStyle } from "@/engine/types";
import { beginUndoGesture, endUndoGesture, useStudio } from "@/store/studio";
import { Icon, PanelTabs, Row, Segmented, SliderRow, Swatches } from "./ui";
import { L } from "@/lib/i18n";

function NumberField({ label, value, change, min = -100000, max = 100000 }: { label: string; value: number; change: (value: number) => void; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const number = Number(draft.replace(",", "."));
    if (draft.trim() && Number.isFinite(number)) change(clamp(number, min, max));
    else setDraft(String(value));
  };
  return <label className="lp-number"><span>{label}</span><input aria-label={label} type="text" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }} /></label>;
}

export function CropControls({ src, w, h, crop, change, defaultFit = "cover", fx }: { src?: string; w: number; h: number; crop?: ImageCrop; change: (crop: ImageCrop | undefined) => void; defaultFit?: ImageCrop["fit"]; fx?: ImageFx }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number; spanX: number; spanY: number } | null>(null);
  const [ready, setReady] = useState(0);
  const previewW = 272, previewH = Math.min(230, Math.max(90, previewW * h / Math.max(w, 1)));
  useEffect(() => {
    let alive = true; image.current = null;
    if (src) void loadImage(src).then(img => { if (alive) { image.current = img; setReady(n => n + 1); } });
    return () => { alive = false; };
  }, [src]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d"), img = image.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, previewW, previewH);
    if (img) { ctx.filter = imageFilter(fx, previewW / Math.max(w, 1)); drawEditedImage(ctx, img, 0, 0, previewW, previewH, crop, defaultFit); }
  }, [ready, crop, previewH, defaultFit, fx, w]);
  const patch = (part: Partial<ImageCrop>) => change({ ...crop, ...part });
  return <div className="lp-crop">
    <div className="lp-crop-preview" style={{ aspectRatio: `${previewW} / ${previewH}` }}>
      <canvas aria-label={L("Kırpma önizlemesi; görseli sürükleyerek odağı değiştir", "Crop preview; drag the image to change the focus")} width={previewW} height={previewH} ref={canvas}
        onPointerDown={e => {
          const img = image.current; if (!img) return;
          const rect = e.currentTarget.getBoundingClientRect(), fit = crop?.fit ?? defaultFit;
          const ratio = fit === "contain" ? Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight) : Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
          const zoom = crop?.zoom ?? 1;
          drag.current = { x: e.clientX, y: e.clientY, focusX: crop?.x ?? .5, focusY: crop?.y ?? .5, spanX: (fit === "stretch" ? rect.width : img.naturalWidth * ratio) * zoom - rect.width, spanY: (fit === "stretch" ? rect.height : img.naturalHeight * ratio) * zoom - rect.height };
          e.currentTarget.setPointerCapture(e.pointerId); beginUndoGesture();
        }}
        onPointerMove={e => {
          const d = drag.current; if (!d) return;
          patch({ x: Math.abs(d.spanX) > 1 ? clamp(d.focusX - (e.clientX - d.x) * (crop?.flipX ? -1 : 1) / d.spanX, 0, 1) : d.focusX, y: Math.abs(d.spanY) > 1 ? clamp(d.focusY - (e.clientY - d.y) * (crop?.flipY ? -1 : 1) / d.spanY, 0, 1) : d.focusY });
        }}
        onPointerUp={() => { drag.current = null; endUndoGesture(); }} onPointerCancel={() => { drag.current = null; endUndoGesture(); }} />
      <div className="lp-crop-grid" aria-hidden="true"><i/><i/><i/><i/></div>
    </div>
    <p className="note">{L("Görseli bu alanda sürükleyerek kırpmayı ayarla.", "Drag the image in this area to adjust the crop.")}</p>
    <Row label={L("Yerleştirme", "Fit")}><Segmented value={crop?.fit ?? defaultFit ?? "cover"} options={[{ value: "cover", label: L("Doldur", "Fill") }, { value: "contain", label: L("Sığdır", "Fit") }, { value: "stretch", label: L("Esnet", "Stretch") }]} onChange={fit => patch({ fit })} /></Row>
    <SliderRow label={L("Kırpma zoom", "Crop zoom")} value={Math.round((crop?.zoom ?? 1) * 100)} min={10} max={1200} defaultValue={100} onChange={v => patch({ zoom: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <SliderRow label={L("Yatay odak", "Horizontal focus")} value={Math.round((crop?.x ?? .5) * 100)} min={0} max={100} defaultValue={50} onChange={v => patch({ x: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <SliderRow label={L("Dikey odak", "Vertical focus")} value={Math.round((crop?.y ?? .5) * 100)} min={0} max={100} defaultValue={50} onChange={v => patch({ y: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <div className="lp-actions"><button className={`btn sm ${crop?.flipX ? "on" : ""}`} aria-pressed={!!crop?.flipX} onClick={() => patch({ flipX: !crop?.flipX })}>{L("Yatay çevir", "Flip horizontal")}</button><button className={`btn sm ${crop?.flipY ? "on" : ""}`} aria-pressed={!!crop?.flipY} onClick={() => patch({ flipY: !crop?.flipY })}>{L("Dikey çevir", "Flip vertical")}</button></div>
    <button className="btn sm wide" onClick={() => change(undefined)}><Icon name="reset" size={12}/>{L("Kırpmayı sıfırla", "Reset crop")}</button>
  </div>;
}

function ImageEffects({ fx, change }: { fx?: ImageFx; change: (fx: ImageFx | undefined) => void }) {
  const patch = (part: Partial<ImageFx>) => change({ ...fx, ...part });
  return <>
    <SliderRow label={L("Bulanıklık", "Blur")} value={fx?.blur ?? 0} min={0} max={160} defaultValue={0} onChange={blur => patch({ blur })} format={v => `${v}px`} />
    <SliderRow label={L("Parlaklık", "Brightness")} value={Math.round((fx?.brightness ?? 1) * 100)} min={0} max={300} defaultValue={100} onChange={v => patch({ brightness: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <SliderRow label={L("Kontrast", "Contrast")} value={Math.round((fx?.contrast ?? 1) * 100)} min={0} max={300} defaultValue={100} onChange={v => patch({ contrast: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <SliderRow label={L("Doygunluk", "Saturation")} value={Math.round((fx?.sat ?? 1) * 100)} min={0} max={300} defaultValue={100} onChange={v => patch({ sat: v / 100 })} format={v => L(`%${v}`, `${v}%`)} />
    <button className="btn sm wide" onClick={() => change(undefined)}>{L("Görsel efektlerini sıfırla", "Reset image effects")}</button>
  </>;
}

function TextControls({ text, style, changeText, changeStyle, accent }: { text: string; style: TextStyle; changeText: (text: string) => void; changeStyle: (style: Partial<TextStyle>) => void; accent: string }) {
  return <>
    <div className="field"><label>{L("Metin", "Text")}</label><textarea aria-label={L("Seçili metin", "Selected text")} rows={3} value={text} onChange={e => changeText(e.target.value)}/></div>
    <div className="field"><label>{L("Yazı tipi", "Font")}</label><select aria-label={L("Seçili metin fontu", "Selected text font")} value={style.fontFamily} onChange={e => changeStyle({ fontFamily: e.target.value })}>{FONT_FAMILIES.map(f => <option key={f.family} value={f.family}>{f.label}</option>)}</select></div>
    <div className="lp-geometry"><NumberField label={L("Yazı boyutu", "Font size")} value={style.sizePx} min={8} max={1000} change={sizePx => changeStyle({ sizePx })}/><NumberField label={L("Kalınlık", "Weight")} value={style.weight} min={100} max={900} change={weight => changeStyle({ weight })}/></div>
    <Row label={L("Hiza", "Align")}><Segmented value={style.align ?? "left"} options={[{ value: "left", label: L("Sol", "Left") }, { value: "center", label: L("Orta", "Center") }, { value: "right", label: L("Sağ", "Right") }]} onChange={align => changeStyle({ align })}/></Row>
    <SliderRow label={L("Satır aralığı", "Line height")} value={style.lineHeight ?? 1.1} min={.6} max={3} step={.02} onChange={lineHeight => changeStyle({ lineHeight })}/>
    <SliderRow label={L("Harf aralığı", "Letter spacing")} value={style.letterSpacing ?? 0} min={-10} max={40} step={.5} onChange={letterSpacing => changeStyle({ letterSpacing })}/>
    <Row label={L("Renk", "Color")}><Swatches value={style.color} colors={[accent, "#ffffff", "#0b0b0d", "#f7efdc"]} onChange={color => changeStyle({ color })}/></Row>
    <button className={`btn sm wide ${style.style === "italic" ? "on" : ""}`} aria-pressed={style.style === "italic"} onClick={() => changeStyle({ style: style.style === "italic" ? "normal" : "italic" })}><i>{L("İtalik", "Italic")}</i></button>
  </>;
}

export default function LayerPanel({ width, onClose }: { width: number; onClose: () => void }) {
  const project = useStudio(s => s.project), activeId = useStudio(s => s.activeSlideId);
  const selectedId = useStudio(s => s.selectedLayerId), cropEditing = useStudio(s => s.cropEditing);
  const tab = useStudio(s => s.layerPanelTab);
  const setTab = useStudio(s => s.setLayerPanelTab);
  const [aspectLock, setAspectLock] = useState(true);
  const [dragLayer, setDragLayer] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const replaceImage = useRef(false);
  const scaleBase = useRef<{ id: string | null; w: number; h: number }>({ id: null, w: 1, h: 1 });
  const slide = project.sets[project.activeLocale]?.slides.find(s => s.id === activeId) ?? project.sets[project.activeLocale]?.slides[0];
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [selectedId, tab]);
  if (!slide) return null;
  const fmt = formatOf(project), B = baseOf(fmt), theme = getTheme(slide.themeId);
  const layers = editorLayers(slide), layer = layers.find(l => l.id === selectedId);
  const element = layerElement(slide, selectedId), box = layerBox(slide, selectedId, fmt, project.activeLocale);
  if (element && scaleBase.current.id !== `${slide.id}:${selectedId}`) scaleBase.current = { id: `${slide.id}:${selectedId}`, w: element.w, h: element.h };
  const up = (patch: Partial<Slide>) => useStudio.getState().updateSlide(slide.id, patch, { coalesceKey: `layer:${slide.id}:${selectedId}:${Object.keys(patch).join()}` });
  const select = (id: string) => useStudio.getState().setSelectedLayer(id);
  const patch = (part: Partial<SlideElement>) => { if (selectedId) up(patchLayerElement(slide, selectedId, part)); };
  const addText = () => {
    const el = makeElement("text", uid(), { cx: B.w / 2, cy: B.h / 2, w: B.w * .7, text: L("Yeni metin", "New text"), accent: theme.headline.color });
    el.style = { ...theme.sub, sizePx: 64 }; up({ elements: [...(slide.elements ?? []), el] }); select(`element:${el.id}`);
  };
  const fileChanged = async (file?: File) => {
    if (!file) return;
    const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    if (replaceImage.current && element) patch({ src });
    else if (replaceImage.current && selectedId === "background") up({ background: { kind: "image", src } });
    else {
      const img = await loadImage(src), w = B.w * .65, h = img ? w * img.naturalHeight / img.naturalWidth : w;
      const el = makeElement("image", uid(), { src, cx: B.w / 2, cy: B.h / 2, w, h }); el.name = file.name;
      up({ elements: [...(slide.elements ?? []), el] }); select(`element:${el.id}`);
    }
    replaceImage.current = false;
  };
  const visibility = (id: string, key: "hidden" | "locked") => {
    const el = layerElement(slide, id);
    if (el) up(patchLayerElement(slide, id, { [key]: !el[key] }));
    else if (id === "device" && key === "hidden") up({ hideDevice: !slide.hideDevice });
    else up({ layerStates: { ...slide.layerStates, [id]: { ...slide.layerStates?.[id], [key]: !slide.layerStates?.[id]?.[key] } } });
  };
  const rename = (name: string) => {
    if (element) patch({ name });
    else if (selectedId) up({ layerStates: { ...slide.layerStates, [selectedId]: { ...slide.layerStates?.[selectedId], name } } });
  };
  const moveLayer = (id: string, destination: string) => {
    if (!id.startsWith("element:") || !destination.startsWith("element:") || id === destination) return;
    const list = [...(slide.elements ?? [])], from = list.findIndex(e => e.id === id.slice(8)), target = list.find(e => e.id === destination.slice(8));
    if (from < 0 || !target) return;
    const [el] = list.splice(from, 1); list.splice(list.findIndex(e => e.id === target.id) + 1, 0, { ...el, z: target.z }); up({ elements: list });
  };
  const geometry = element && box ? <>
    <div className="lp-section-title">{L("Konum ve boyut", "Position and size")}<button className={`tb-icbtn ${aspectLock ? "on" : ""}`} title={L("En boy oranını koru", "Lock aspect ratio")} aria-label={L("En boy oranını koru", "Lock aspect ratio")} aria-pressed={aspectLock} onClick={() => setAspectLock(v => !v)}><Icon name="link" size={14}/></button></div>
    <div className="lp-geometry">
      <NumberField label="X" value={element.x} change={x => patch({ x })}/><NumberField label="Y" value={element.y} change={y => patch({ y })}/>
      <NumberField label={L("Genişlik", "Width")} value={element.w} min={24} max={B.w * 12} change={w => patch({ w, ...(aspectLock ? { h: Math.round(element.h * w / element.w) } : {}) })}/>
      <NumberField label={L("Yükseklik", "Height")} value={element.h} min={24} max={B.h * 12} change={h => patch({ h, ...(aspectLock ? { w: Math.round(element.w * h / element.h) } : {}) })}/>
    </div>
    <SliderRow label={L("Öğe ölçeği", "Element scale")} value={Math.round(element.w / scaleBase.current.w * 100)} min={10} max={800} defaultValue={100} onChange={v => {
      const scale = v / 100, w = Math.max(24, scaleBase.current.w * scale), h = Math.max(24, scaleBase.current.h * scale);
      patch({ x: element.x + (element.w - w) / 2, y: element.y + (element.h - h) / 2, w, h });
    }} format={v => L(`%${v}`, `${v}%`)}/>
    <SliderRow label={L("Döndürme", "Rotation")} value={element.rotation ?? 0} min={-180} max={180} defaultValue={0} onChange={rotation => patch({ rotation })} format={v => `${v}°`}/>
    <SliderRow label={L("Opaklık", "Opacity")} value={Math.round((element.opacity ?? 1) * 100)} min={0} max={100} defaultValue={100} onChange={v => patch({ opacity: v / 100 })} format={v => L(`%${v}`, `${v}%`)}/>
    <Row label={L("Sıra", "Order")}><Segmented value={element.z ?? "over"} options={[{ value: "under", label: L("Cihaz arkası", "Behind device") }, { value: "over", label: L("Önde", "In front") }]} onChange={z => patch({ z })}/></Row>
    {selectedId?.startsWith("element:") && <div className="lp-actions"><button className="btn sm" onClick={() => up({ elements: reorderElement(slide.elements, element.id, "front") })}>{L("En öne", "Bring to front")}</button><button className="btn sm" onClick={() => up({ elements: reorderElement(slide.elements, element.id, "back") })}>{L("En arkaya", "Send to back")}</button></div>}
  </> : null;
  const bg = slide.background ?? theme.background;
  const isText = selectedId === "headline" || selectedId === "sub";
  const splitIndex = selectedId?.startsWith("screen:") ? Number(selectedId.slice(7)) : -1;
  return <aside className="drawer layer-drawer" style={{ width }} aria-label={L("Katman düzenleyici", "Layer editor")}>
    <div className="drawer-head"><Icon name="layers" size={17}/><h2>{L("Katmanlar", "Layers")}</h2><span className="drawer-cnt">{layers.length}</span><button className="tb-icbtn" title={L("Düzenleyiciyi kapat", "Close editor")} aria-label={L("Düzenleyiciyi kapat", "Close editor")} onClick={onClose}><Icon name="x" size={15}/></button></div>
    <PanelTabs value={tab} tabs={[{ id: "edit", label: L("Düzenle", "Edit") }, { id: "layers", label: L("Katmanlar", "Layers") }]} onChange={setTab}/>
    <div className="lp-add"><button className="btn sm" onClick={addText}><Icon name="text" size={13}/>{L("Metin ekle", "Add text")}</button><button className="btn sm" onClick={() => { replaceImage.current = false; fileInput.current?.click(); }}><Icon name="image" size={13}/>{L("Görsel ekle", "Add image")}</button></div>
    <input type="file" ref={fileInput} accept="image/*" hidden onChange={e => { void fileChanged(e.target.files?.[0]); e.target.value = ""; }}/>
    <div className="lp-scroll" ref={scroll}>
      {tab === "layers" || !layer ? <>
        <p className="lp-help">{L("Katmanı seç, tuvalde taşı ve köşelerinden büyüt. Üstteki satır, en üstteki katmandır.", "Select a layer, move it on the canvas and resize it from its corners. The top row is the topmost layer.")}</p>
        <div className="lp-layer-list" role="list" aria-label={L("Slayt katmanları", "Slide layers")}>{layers.map(item => <div key={item.id} role="listitem" className={`lp-layer ${selectedId === item.id ? "on" : ""} ${item.hidden ? "muted" : ""}`} draggable={item.id.startsWith("element:")} onDragStart={() => setDragLayer(item.id)} onDragOver={e => { if (dragLayer) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragLayer) moveLayer(dragLayer, item.id); setDragLayer(null); }} onDragEnd={() => setDragLayer(null)}>
          <button className="lp-layer-pick" aria-label={L(`Katman seç: ${item.label}`, `Select layer: ${item.label}`)} onClick={() => select(item.id)}><span className="lp-layer-thumb">{item.src ? <img src={item.src} alt=""/> : <Icon name={item.type === "text" ? "text" : item.type === "device" ? "phone" : item.type === "background" ? "palette" : "frame"} size={16}/>}</span><span><b>{item.label}</b><small>{item.theme ? L("Tema öğesi", "Theme element") : item.type === "background" ? L("Zemin", "Background") : item.type === "text" ? L("Serbest metin", "Free text") : item.type === "device" ? L("Mockup", "Mockup") : L("Görsel / öğe", "Image / element")}</small></span></button>
          <button className="tb-icbtn" title={item.hidden ? L("Katmanı göster", "Show layer") : L("Katmanı gizle", "Hide layer")} aria-label={L(`${item.hidden ? "Göster" : "Gizle"}: ${item.label}`, `${item.hidden ? "Show" : "Hide"}: ${item.label}`)} aria-pressed={!!item.hidden} onClick={() => visibility(item.id, "hidden")}><Icon name={item.hidden ? "eyeOff" : "eye"} size={14}/></button>
          <button className="tb-icbtn" title={item.locked ? L("Kilidi aç", "Unlock") : L("Katmanı kilitle", "Lock layer")} aria-label={L(`${item.locked ? "Kilidi aç" : "Kilitle"}: ${item.label}`, `${item.locked ? "Unlock" : "Lock"}: ${item.label}`)} aria-pressed={!!item.locked} style={{ opacity: item.locked ? 1 : .4 }} onClick={() => visibility(item.id, "locked")}><Icon name="lock" size={13}/></button>
        </div>)}</div>
        <button className="btn sm wide lp-bg-button" onClick={() => select("background")}><Icon name="palette" size={13}/>{L("Arka planı düzenle", "Edit background")}</button>
      </> : <>
        <div className="lp-selection-head"><span className="lp-eyebrow">{layer.type === "background" ? L("ARKA PLAN", "BACKGROUND") : layer.type === "text" ? L("METİN", "TEXT") : layer.type === "device" ? L("CİHAZ", "DEVICE") : L("GÖRSEL / ÖĞE", "IMAGE / ELEMENT")}</span><input aria-label={L("Katman adı", "Layer name")} value={layer.label} onChange={e => rename(e.target.value)}/><button className="tb-icbtn" title={L("Tüm katmanları göster", "Show all layers")} aria-label={L("Tüm katmanları göster", "Show all layers")} onClick={() => setTab("layers")}><Icon name="list" size={15}/></button></div>
        {layer.locked && <button className="lp-locked" onClick={() => visibility(layer.id, "locked")}><Icon name="lock" size={13}/>{L("Katman kilitli · düzenlemek için aç", "Layer locked · unlock to edit")}</button>}
        <fieldset className="lp-fields" disabled={!!layer.locked}>
          {geometry}
          {element?.kind === "text" && <><h3 className="lp-section-title">{L("Metin düzenle", "Edit text")}</h3><TextControls text={element.text ?? ""} style={{ ...EL_TEXT_BASE, ...element.style }} changeText={text => patch({ text })} changeStyle={style => patch({ style: { ...element.style, ...style } })} accent={theme.accent}/></>}
          {element && (element.kind === "image" || element.kind === "sticker") && <>
            <div className="lp-section-title">{L("Görsel", "Image")}<button className="btn xs" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Değiştir", "Replace")}</button></div>
            <button className={`btn sm wide ${cropEditing ? "on" : ""}`} aria-pressed={cropEditing} onClick={() => useStudio.getState().setCropEditing(!cropEditing)}><Icon name="crop" size={14}/>{cropEditing ? L("Kırpmayı bitir", "Done cropping") : L("Tuvalde kırp", "Crop on canvas")}</button>
            <CropControls src={element.src} w={element.w} h={element.h} crop={element.crop} fx={element.imageFx} defaultFit={element.kind === "sticker" ? "stretch" : "cover"} change={crop => patch({ crop })}/>
            <h3 className="lp-section-title">{L("Görsel efektleri", "Image effects")}</h3><ImageEffects fx={element.imageFx} change={imageFx => patch({ imageFx })}/>
            <Row label={L("Karışım", "Blend")}><select aria-label={L("Katman karışım modu", "Layer blend mode")} value={element.blend ?? ""} onChange={e => patch({ blend: (e.target.value || undefined) as SlideElement["blend"] })}>{BLEND_LABELS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}</select></Row>
          </>}
          {element && !["image", "sticker", "text"].includes(element.kind) && <><Row label={L("Dolgu", "Fill")}><Swatches value={element.style?.fill ?? theme.accent} colors={[theme.accent, "#ffffff", "#0b0b0d"]} onChange={fill => patch({ style: { ...element.style, fill } })}/></Row><SliderRow label={L("Köşe", "Corner")} value={element.style?.radius ?? 0} min={0} max={500} onChange={radius => patch({ style: { ...element.style, radius } })}/>{element.kind === "glass" && <SliderRow label={L("Cam blur", "Glass blur")} value={element.style?.blur ?? 28} min={0} max={160} onChange={blur => patch({ style: { ...element.style, blur } })}/>}</>}
          {isText && box && <>
            <h3 className="lp-section-title">{L("Serbest yerleşim", "Free placement")}</h3>
            <div className="lp-geometry">{(["x", "y", "w"] as const).map(key => <NumberField key={key} label={key === "w" ? L("Metin genişliği", "Text width") : key.toUpperCase()} value={box[key]} min={key === "w" ? 24 : -100000} change={v => up(textFramePatch(slide, selectedId as "headline" | "sub", { x: box.x, y: box.y, w: box.w, rotation: box.rotation, [key]: v }))}/>)}</div>
            <SliderRow label={L("Metin dönüşü", "Text rotation")} value={box.rotation ?? 0} min={-180} max={180} onChange={rotation => up(textFramePatch(slide, selectedId as "headline" | "sub", { x: box.x, y: box.y, w: box.w, rotation }))} format={v => `${v}°`}/>
            <TextControls text={slide[selectedId as "headline" | "sub"] ?? ""} style={{ ...theme[selectedId === "headline" ? "headline" : "sub"], align: editorLayout(slide, fmt).text.align, ...slide[selectedId === "headline" ? "headlineStyle" : "subStyle"] }} changeText={text => up({ [selectedId!]: text })} changeStyle={style => up({ [selectedId === "headline" ? "headlineStyle" : "subStyle"]: { ...slide[selectedId === "headline" ? "headlineStyle" : "subStyle"], ...style } })} accent={theme.accent}/>
            <button className="btn sm wide" onClick={() => up({ textBoxes: { ...slide.textBoxes, [selectedId!]: undefined } })}>{L("Tema konumuna dön", "Back to theme position")}</button>
          </>}
          {selectedId === "background" && <>
            {bg.kind === "image" ? <><button className="btn sm wide" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Arka plan görselini değiştir", "Replace background image")}</button><button className={`btn sm wide ${cropEditing ? "on" : ""}`} onClick={() => useStudio.getState().setCropEditing(!cropEditing)}>{cropEditing ? L("Kırpmayı bitir", "Done cropping") : L("Arka planı tuvalde kırp", "Crop background on canvas")}</button><CropControls src={bg.src} w={B.w} h={B.h} crop={bg.imageCrop} change={imageCrop => up({ background: { ...bg, imageCrop } })}/><Row label={L("Renk kaplama", "Color overlay")}><Swatches value={bg.overlayColor ?? theme.accent} colors={[theme.accent, "#ffffff", "#0b0b0d"]} onChange={overlayColor => up({ background: { ...bg, overlayColor } })}/></Row><SliderRow label={L("Kaplama oranı", "Overlay amount")} value={Math.round((bg.overlayAlpha ?? 0) * 100)} min={0} max={100} onChange={v => up({ background: { ...bg, overlayAlpha: v / 100 } })}/></> : <><p className="note">{bg.kind === "solid" ? L("Düz renk zemin", "Solid color background") : L("Temanın renk / doku zemini", "Theme color / texture background")}</p>{bg.kind === "solid" && <Row label={L("Zemin rengi", "Background color")}><Swatches value={bg.color} colors={[theme.accent, "#ffffff", "#0b0b0d", "#f7efdc"]} onChange={color => up({ background: { kind: "solid", color } })}/></Row>}<button className="btn sm wide" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Arka plana görsel ekle", "Add image to background")}</button></>}
            <h3 className="lp-section-title">{L("Arka plan efektleri", "Background effects")}</h3>
            <SliderRow label={L("Arka plan blur", "Background blur")} value={slide.bgFx?.blur ?? 0} min={0} max={160} defaultValue={0} onChange={blur => up({ bgFx: { ...slide.bgFx, blur } })} format={v => `${v}px`}/>
            <SliderRow label={L("Karartma", "Dim")} value={Math.round((slide.bgFx?.dim ?? 0) * 100)} min={0} max={80} defaultValue={0} onChange={v => up({ bgFx: { ...slide.bgFx, dim: v / 100 } })} format={v => L(`%${v}`, `${v}%`)}/>
            <SliderRow label={L("Zemin doygunluğu", "Background saturation")} value={Math.round((slide.bgFx?.sat ?? 1) * 100)} min={0} max={300} defaultValue={100} onChange={v => up({ bgFx: { ...slide.bgFx, sat: v / 100 } })} format={v => L(`%${v}`, `${v}%`)}/>
            <button className="btn sm wide" onClick={() => up({ bgFx: undefined })}>{L("Arka plan efektlerini sıfırla", "Reset background effects")}</button>
          </>}
          {splitIndex >= 0 && box && <>
            <h3 className="lp-section-title">{L("Ekran kırpması", "Screen crop")}</h3>
            <CropControls src={splitIndex === 0 ? slide.screenshot : slide.screenshot2} w={box.w} h={box.h} crop={{ ...splitCropDefault(slide.layout), ...slide.splitCrop?.[splitIndex] }} change={crop => { const next = [...(slide.splitCrop ?? [])]; next[splitIndex] = crop ?? {}; up({ splitCrop: next }); }}/>
          </>}
          {(selectedId === "device" || selectedId === "device2" || selectedId === "device3") && <>
            <h3 className="lp-section-title">{L("Cihaz yerleşimi", "Device placement")}</h3>
            {(() => { const field = selectedId === "device3" ? "device3Offset" : selectedId === "device2" ? "device2Offset" : "deviceOffset", off = slide[field] ?? { x: 0, y: 0 }, dev = slide.device ?? theme.device; return <>
              <SliderRow label={L("Cihaz ölçeği", "Device scale")} value={Math.round((off.scale ?? 1) * 100)} min={10} max={600} defaultValue={100} onChange={v => up({ [field]: { ...off, scale: v / 100 } })} format={v => L(`%${v}`, `${v}%`)}/>
              <div className="lp-geometry"><NumberField label={L("Cihaz X", "Device X")} value={off.x} change={x => up({ [field]: { ...off, x } })}/><NumberField label={L("Cihaz Y", "Device Y")} value={off.y} change={y => up({ [field]: { ...off, y } })}/></div>
              {!isDevice3D(dev) && <SliderRow label={L("Cihaz dönüşü", "Device rotation")} value={off.rotation ?? 0} min={-180} max={180} onChange={rotation => up({ [field]: { ...off, rotation } })} format={v => `${v}°`}/>}
              {isDuoFormat(fmt) && isDevice3D(dev) && <>
                <h3 className="lp-section-title">{L("iPhone Duo gövdesi", "iPhone Duo body")}</h3>
                <Segmented value={dev.duoPosture ?? (fmt.includes("cover") ? "closed" : "open")} options={[{ value: "open", label: L("Açık", "Open") }, { value: "closed", label: L("Kapalı", "Closed") }]} onChange={duoPosture => up({ device: { ...dev, model: "real", duoPosture } })}/>
                {(() => { const kind = deviceStyleForFormat(dev, fmt).kind, closed = kind.includes("cover"); return <Row label={L("Cihaz yönü", "Device orientation")}><Segmented value={kind === "foldable" || kind === "foldable-cover-landscape" ? "landscape" : "portrait"} options={[{ value: "landscape", label: L("Yatay", "Landscape") }, { value: "portrait", label: L("Dikey", "Portrait") }]} onChange={direction => up({ device: { ...dev, kind: closed ? direction === "landscape" ? "foldable-cover-landscape" : "foldable-cover" : direction === "landscape" ? "foldable" : "foldable-portrait" } })}/></Row>; })()}
                <p className="note">{L("Ekran görselinin tamamı oranı korunarak sığdırılır.", "The whole screenshot is fitted, keeping its aspect ratio.")}</p>
                <p className="note">{L("Apple iPhone Duo · zhe_kan · verilen GLB modeli", "Apple iPhone Duo · zhe_kan · supplied GLB model")}</p>
              </>}
              <button className="btn sm wide" onClick={() => up({ [field]: undefined })}>{L("Cihaz konumunu sıfırla", "Reset device position")}</button>
            </>; })()}
          </>}
        </fieldset>
        {element && <div className="lp-footer"><button className="btn sm" onClick={() => { const copy = { ...structuredClone(element), id: uid(), name: L(`${layer.label} kopya`, `${layer.label} copy`), x: element.x + 40, y: element.y + 40 }; up({ elements: [...(slide.elements ?? []), copy] }); select(`element:${copy.id}`); }}><Icon name="copy" size={12}/>{L("Çoğalt", "Duplicate")}</button><button className="btn sm" onClick={() => { if (selectedId?.startsWith("theme:")) patch({ hidden: true }); else up({ elements: slide.elements?.filter(e => e.id !== element.id) }); useStudio.getState().setSelectedLayer(null); setTab("layers"); }}><Icon name="trash" size={12}/>{L("Sil", "Delete")}</button></div>}
      </>}
    </div>
  </aside>;
}
