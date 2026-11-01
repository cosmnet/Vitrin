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
import { Icon, Row, Segmented, SliderRow, Swatches } from "./ui";
import { focusPanel } from "@/store/workspace";
import { uploadImage } from "@/lib/uploads";
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

const SHAPES: { kind: "rect" | "pill" | "glass" | "line" | "arrow"; label: string }[] = [
  { kind: "rect", label: L("Kutu", "Box") },
  { kind: "pill", label: L("Hap", "Pill") },
  { kind: "glass", label: L("Cam", "Glass") },
  { kind: "line", label: L("Çizgi", "Line") },
  { kind: "arrow", label: L("Ok", "Arrow") },
];

// v1.0 — KATMANLAR paneli. Liste HER ZAMAN görünür; altında seçili katmanın
// özellikleri. Metin ve cihaz katmanları kendi panellerinde düzenlenir
// (Metin / Cihaz) — burada yalnız yönlendirme düğmesi kalır, aynı ayar iki
// yerde durmaz.
export default function LayerPanel(_legacy: { width?: number; onClose?: () => void } = {}) {
  const project = useStudio(s => s.project), activeId = useStudio(s => s.activeSlideId);
  const selectedId = useStudio(s => s.selectedLayerId), cropEditing = useStudio(s => s.cropEditing);
  const [aspectLock, setAspectLock] = useState(true);
  const [dragLayer, setDragLayer] = useState<string | null>(null);
  const [shapes, setShapes] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceImage = useRef(false);
  const scaleBase = useRef<{ id: string | null; w: number; h: number }>({ id: null, w: 1, h: 1 });
  const slide = project.sets[project.activeLocale]?.slides.find(s => s.id === activeId) ?? project.sets[project.activeLocale]?.slides[0];
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
  const addShape = (kind: (typeof SHAPES)[number]["kind"]) => {
    const el = makeElement(kind, uid(), { cx: B.w / 2, cy: B.h / 2, accent: theme.accent });
    up({ elements: [...(slide.elements ?? []), el] }); select(`element:${el.id}`); setShapes(false);
  };
  const fileChanged = async (file?: File) => {
    if (!file) return;
    const src = await uploadImage(file).catch(() => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }));
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
    <SliderRow label={L("Ölçek", "Scale")} value={Math.round(element.w / scaleBase.current.w * 100)} min={10} max={800} defaultValue={100} onChange={v => {
      const scale = v / 100, w = Math.max(24, scaleBase.current.w * scale), h = Math.max(24, scaleBase.current.h * scale);
      patch({ x: element.x + (element.w - w) / 2, y: element.y + (element.h - h) / 2, w, h });
    }} format={v => `${v}%`}/>
    <SliderRow label={L("Döndürme", "Rotation")} value={element.rotation ?? 0} min={-180} max={180} defaultValue={0} onChange={rotation => patch({ rotation })} format={v => `${v}°`}/>
    <SliderRow label={L("Opaklık", "Opacity")} value={Math.round((element.opacity ?? 1) * 100)} min={0} max={100} defaultValue={100} onChange={v => patch({ opacity: v / 100 })} format={v => `${v}%`}/>
    <Row label={L("Sıra", "Order")}><Segmented value={element.z ?? "over"} options={[{ value: "under", label: L("Cihaz arkası", "Behind device") }, { value: "over", label: L("Önde", "In front") }]} onChange={z => patch({ z })}/></Row>
    {selectedId?.startsWith("element:") && <div className="lp-actions"><button className="btn sm" onClick={() => up({ elements: reorderElement(slide.elements, element.id, "front") })}>{L("En öne", "Bring to front")}</button><button className="btn sm" onClick={() => up({ elements: reorderElement(slide.elements, element.id, "back") })}>{L("En arkaya", "Send to back")}</button></div>}
  </> : null;
  const bg = slide.background ?? theme.background;
  const isText = selectedId === "headline" || selectedId === "sub" || element?.kind === "text";
  const isDevice = selectedId === "device" || selectedId === "device2" || selectedId === "device3";
  const splitIndex = selectedId?.startsWith("screen:") ? Number(selectedId.slice(7)) : -1;
  return <div className="layers-panel" aria-label={L("Katmanlar", "Layers")}>
    <div className="lp-add">
      <button className="btn sm" onClick={addText}><Icon name="text" size={13}/>{L("Metin", "Text")}</button>
      <button className="btn sm" onClick={() => { replaceImage.current = false; fileInput.current?.click(); }}><Icon name="image" size={13}/>{L("Görsel", "Image")}</button>
      <button className={`btn sm ${shapes ? "on" : ""}`} aria-expanded={shapes} onClick={() => setShapes(v => !v)}><Icon name="frame" size={13}/>{L("Şekil", "Shape")}</button>
    </div>
    {shapes && <div className="lp-shapes">{SHAPES.map(sh => <button key={sh.kind} className="chip" onClick={() => addShape(sh.kind)}>+ {sh.label}</button>)}</div>}
    <input type="file" ref={fileInput} accept="image/*" hidden onChange={e => { void fileChanged(e.target.files?.[0]); e.target.value = ""; }}/>
    <div className="lp-layer-list" role="list" aria-label={L("Slayt katmanları", "Slide layers")}>{layers.map(item => <div key={item.id} role="listitem" className={`lp-layer ${selectedId === item.id ? "on" : ""} ${item.hidden ? "muted" : ""}`} draggable={item.id.startsWith("element:")} onDragStart={() => setDragLayer(item.id)} onDragOver={e => { if (dragLayer) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragLayer) moveLayer(dragLayer, item.id); setDragLayer(null); }} onDragEnd={() => setDragLayer(null)}>
      <button className="lp-layer-pick" aria-label={L(`Katman seç: ${item.label}`, `Select layer: ${item.label}`)} onClick={() => select(item.id)}><span className="lp-layer-thumb">{item.src ? <img src={item.src} alt=""/> : <Icon name={item.type === "text" ? "text" : item.type === "device" ? "phone" : item.type === "background" ? "palette" : "frame"} size={14}/>}</span><span><b>{item.label}</b><small>{item.theme ? L("Tema öğesi", "Theme element") : item.type === "background" ? L("Zemin", "Background") : item.type === "text" ? L("Metin", "Text") : item.type === "device" ? L("Cihaz", "Device") : L("Görsel / öğe", "Image / element")}</small></span></button>
      <button className="tb-icbtn" title={item.hidden ? L("Katmanı göster", "Show layer") : L("Katmanı gizle", "Hide layer")} aria-label={L(`${item.hidden ? "Göster" : "Gizle"}: ${item.label}`, `${item.hidden ? "Show" : "Hide"}: ${item.label}`)} aria-pressed={!!item.hidden} onClick={() => visibility(item.id, "hidden")}><Icon name={item.hidden ? "eyeOff" : "eye"} size={14}/></button>
      <button className="tb-icbtn" title={item.locked ? L("Kilidi aç", "Unlock") : L("Katmanı kilitle", "Lock layer")} aria-label={L(`${item.locked ? "Kilidi aç" : "Kilitle"}: ${item.label}`, `${item.locked ? "Unlock" : "Lock"}: ${item.label}`)} aria-pressed={!!item.locked} style={{ opacity: item.locked ? 1 : .35 }} onClick={() => visibility(item.id, "locked")}><Icon name="lock" size={13}/></button>
    </div>)}</div>
    {layer && <div className="lp-props">
      <div className="lp-selection-head"><span className="lp-eyebrow">{layer.type === "background" ? L("ARKA PLAN", "BACKGROUND") : layer.type === "text" ? L("METİN", "TEXT") : layer.type === "device" ? L("CİHAZ", "DEVICE") : L("GÖRSEL / ÖĞE", "IMAGE / ELEMENT")}</span><input aria-label={L("Katman adı", "Layer name")} value={layer.label} onChange={e => rename(e.target.value)}/><button className="tb-icbtn" title={L("Seçimi kaldır", "Deselect")} aria-label={L("Seçimi kaldır", "Deselect")} onClick={() => useStudio.getState().setSelectedLayer(null)}><Icon name="x" size={14}/></button></div>
      {layer.locked && <button className="lp-locked" onClick={() => visibility(layer.id, "locked")}><Icon name="lock" size={13}/>{L("Katman kilitli · düzenlemek için aç", "Layer locked · unlock to edit")}</button>}
      {isText && <button className="btn sm wide jump" onClick={() => focusPanel("text")}><Icon name="type" size={13}/>{L("Metin panelinde düzenle", "Edit in Text panel")}</button>}
      {isDevice && <button className="btn sm wide jump" onClick={() => focusPanel("device")}><Icon name="phone" size={13}/>{L("Cihaz panelinde düzenle", "Edit in Device panel")}</button>}
      <fieldset className="lp-fields" disabled={!!layer.locked}>
        {!isText && geometry}
        {element && (element.kind === "image" || element.kind === "sticker") && <>
          <div className="lp-section-title">{L("Görsel", "Image")}<button className="btn xs" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Değiştir", "Replace")}</button></div>
          <button className={`btn sm wide ${cropEditing ? "on" : ""}`} aria-pressed={cropEditing} onClick={() => useStudio.getState().setCropEditing(!cropEditing)}><Icon name="crop" size={14}/>{cropEditing ? L("Kırpmayı bitir", "Done cropping") : L("Tuvalde kırp", "Crop on canvas")}</button>
          <CropControls src={element.src} w={element.w} h={element.h} crop={element.crop} fx={element.imageFx} defaultFit={element.kind === "sticker" ? "stretch" : "cover"} change={crop => patch({ crop })}/>
          <h3 className="lp-section-title">{L("Görsel efektleri", "Image effects")}</h3><ImageEffects fx={element.imageFx} change={imageFx => patch({ imageFx })}/>
          <Row label={L("Karışım", "Blend")}><select aria-label={L("Katman karışım modu", "Layer blend mode")} value={element.blend ?? ""} onChange={e => patch({ blend: (e.target.value || undefined) as SlideElement["blend"] })}>{BLEND_LABELS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}</select></Row>
        </>}
        {element && !["image", "sticker", "text"].includes(element.kind) && <>
          <h3 className="lp-section-title">{L("Şekil", "Shape")}</h3>
          {element.kind !== "line" && element.kind !== "arrow" && <Row label={L("Dolgu", "Fill")}><Swatches value={element.style?.fill && element.style.fill !== "none" ? element.style.fill : theme.accent} colors={[theme.accent, "#ffffff", "#0b0b0d", "#ff2d55", "#2f6bff"]} onChange={fill => patch({ style: { ...element.style, fill } })}/></Row>}
          <Row label={L("Kontur", "Stroke")}><Swatches value={element.style?.stroke ?? theme.accent} colors={[theme.accent, "#ffffff", "#0b0b0d"]} onChange={stroke => patch({ style: { ...element.style, stroke } })}/></Row>
          <SliderRow label={L("Kontur kalınlığı", "Stroke width")} value={element.style?.strokeW ?? 0} min={0} max={64} defaultValue={0} onChange={strokeW => patch({ style: { ...element.style, strokeW } })} format={v => `${v}px`}/>
          {(element.kind === "rect" || element.kind === "glass") && <SliderRow label={L("Köşe", "Corner")} value={element.style?.radius ?? 0} min={0} max={500} onChange={radius => patch({ style: { ...element.style, radius } })} format={v => `${v}px`}/>}
          {element.kind === "glass" && <>
            <SliderRow label={L("Cam bulanıklığı", "Glass blur")} value={element.style?.blur ?? 28} min={0} max={160} onChange={blur => patch({ style: { ...element.style, blur } })} format={v => `${v}px`}/>
            <SliderRow label={L("Cam tonu", "Glass tint")} value={Math.round((element.style?.tintAlpha ?? .12) * 100)} min={0} max={80} onChange={v => patch({ style: { ...element.style, tintAlpha: v / 100 } })} format={v => `${v}%`}/>
            <Row label={L("Ton rengi", "Tint color")}><Swatches value={element.style?.tint || "#ffffff"} colors={["#ffffff", "#0b1026", "#002FA7", "#f4520b"]} onChange={tint => patch({ style: { ...element.style, tint } })}/></Row>
          </>}
          {(element.kind === "rect" || element.kind === "pill") && <button className="btn sm wide" onClick={() => patch({ style: { ...element.style, fill: element.style?.fill === "none" ? theme.accent : "none" } })}>{element.style?.fill === "none" ? L("Dolguyu geri getir", "Restore fill") : L("Yalnız kontur", "Stroke only")}</button>}
          <Row label={L("Karışım", "Blend")}><select aria-label={L("Katman karışım modu", "Layer blend mode")} value={element.blend ?? ""} onChange={e => patch({ blend: (e.target.value || undefined) as SlideElement["blend"] })}>{BLEND_LABELS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}</select></Row>
        </>}
        {selectedId === "background" && <>
          {bg.kind === "image" ? <><button className="btn sm wide" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Arka plan görselini değiştir", "Replace background image")}</button><button className={`btn sm wide ${cropEditing ? "on" : ""}`} onClick={() => useStudio.getState().setCropEditing(!cropEditing)}>{cropEditing ? L("Kırpmayı bitir", "Done cropping") : L("Arka planı tuvalde kırp", "Crop background on canvas")}</button><CropControls src={bg.src} w={B.w} h={B.h} crop={bg.imageCrop} change={imageCrop => up({ background: { ...bg, imageCrop } })}/></> : <button className="btn sm wide" onClick={() => { replaceImage.current = true; fileInput.current?.click(); }}>{L("Arka plana görsel koy", "Use an image as background")}</button>}
          <button className="btn sm wide jump" onClick={() => focusPanel("scene")}><Icon name="palette" size={13}/>{L("Renk, gradyan ve efektler: Sahne", "Colors, gradient and effects: Scene")}</button>
        </>}
        {splitIndex >= 0 && box && <>
          <h3 className="lp-section-title">{L("Ekran kırpması", "Screen crop")}</h3>
          <CropControls src={splitIndex === 0 ? slide.screenshot : slide.screenshot2} w={box.w} h={box.h} crop={{ ...splitCropDefault(slide.layout), ...slide.splitCrop?.[splitIndex] }} change={crop => { const next = [...(slide.splitCrop ?? [])]; next[splitIndex] = crop ?? {}; up({ splitCrop: next }); }}/>
        </>}
      </fieldset>
      {element && !isText && <div className="lp-footer"><button className="btn sm" onClick={() => { const copy = { ...structuredClone(element), id: uid(), name: L(`${layer.label} kopya`, `${layer.label} copy`), x: element.x + 40, y: element.y + 40 }; up({ elements: [...(slide.elements ?? []), copy] }); select(`element:${copy.id}`); }}><Icon name="copy" size={12}/>{L("Çoğalt", "Duplicate")}</button><button className="btn sm danger" onClick={() => { if (selectedId?.startsWith("theme:")) patch({ hidden: true }); else up({ elements: slide.elements?.filter(e => e.id !== element.id) }); useStudio.getState().setSelectedLayer(null); }}><Icon name="trash" size={12}/>{L("Sil", "Delete")}</button></div>}
    </div>}
    {!layer && <p className="lp-help">{L("Tuvalde ya da listede bir katman seç. Metin → Metin paneli, cihaz → Cihaz paneli otomatik açılır.", "Select a layer on the canvas or in the list. Text opens the Text panel, devices open the Device panel.")}</p>}
  </div>;
}
