"use client";

// METİN PANELİ — v1.0. Metinle ilgili HER ŞEY tek pencerede:
//
//   Metinler    başlık · alt yazı · rozet · serbest metinler (tuvalle senkron)
//   + Ekle      hazır metin stilleri (başlık, alt başlık, etiket, el yazısı, rakam)
//   İçerik      metin + zengin işaret araç çubuğu (vurgu, el yazısı, bant, büyük, alt çizgi)
//   Karakter    font (canlı önizleme), ağırlık, boyut, italik
//   Paragraf    hiza, harf dönüşümü, satır ve harf aralığı
//   Renk        renk, opaklık, zengin parça renkleri
//   Efekt       gölge, kontur
//   Yerleşim    X · Y · genişlik · döndürme, tema konumuna dön
//
// Eskiden tipografi sağ panelde, metin içeriği/konumu sol katman panelinde,
// serbest metin üçüncü bir yerde ("Öğeler") düzenleniyordu.

import { useEffect, useRef } from "react";
import { layerBox, layerElement, patchLayerElement, textFramePatch, editorLayout, themeElements } from "@/engine/editor";
import { EL_TEXT_BASE, makeElement } from "@/engine/elements";
import { FONT_FAMILIES } from "@/engine/fonts";
import { baseOf, uid, type Slide, type SlideElement, type TextStyle } from "@/engine/types";
import { L } from "@/lib/i18n";
import { useStudio } from "@/store/studio";
import { Advanced, Icon, Row, Section, SliderRow, Swatches, Toggle } from "../ui";
import { pushToast } from "../toast";
import { DriftBand, PanelEmpty, useActiveSlide } from "./common";
import { IconSeg, NumberInput } from "./controls";
import FontPicker, { hasItalic, weightsOf } from "./FontPicker";

type Target = { kind: "headline" | "sub" } | { kind: "element"; layerId: string } | { kind: "badge" };

function targetOf(slide: Slide, layerId: string | null): Target {
  if (layerId === "headline" || layerId === "sub") return { kind: layerId };
  if (layerId === "badge") return { kind: "badge" };
  const el = layerElement(slide, layerId);
  if (el?.kind === "text" && layerId) return { kind: "element", layerId };
  return { kind: "headline" };
}

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "XLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi", 700: "Bold", 800: "XBold", 900: "Black" };

const PRESETS: { id: string; label: string; hint: string }[] = [
  { id: "title", label: L("Başlık", "Heading"), hint: L("Büyük, kalın", "Large, bold") },
  { id: "subtitle", label: L("Alt başlık", "Subheading"), hint: L("Orta, sakin", "Medium, calm") },
  { id: "label", label: L("Etiket", "Label"), hint: L("KÜÇÜK · ARALIKLI", "SMALL · SPACED") },
  { id: "hand", label: L("El yazısı", "Handwritten"), hint: "Caveat" },
  { id: "number", label: L("Büyük rakam", "Big number"), hint: "4.9 ★" },
  { id: "body", label: L("Gövde", "Body"), hint: L("Paragraf", "Paragraph") },
];

export default function TextPanel() {
  const { slide, theme, fmt, up, project } = useActiveSlide();
  const selectedLayerId = useStudio((s) => s.selectedLayerId);
  const setSelectedLayer = useStudio((s) => s.setSelectedLayer);
  const applyDesignToAllSlides = useStudio((s) => s.applyDesignToAllSlides);
  const area = useRef<HTMLTextAreaElement>(null);

  // Metin seçilince içerik alanı hazır olsun (tuvalde tıkla → yaz).
  useEffect(() => {
    if (selectedLayerId === "headline" || selectedLayerId === "sub" || selectedLayerId?.startsWith("element:")) area.current?.focus({ preventScroll: true });
  }, [selectedLayerId]);

  if (!slide || !theme) return <PanelEmpty title={L("Slayt yok", "No slide")}>{L("Önce bir slayt seç.", "Pick a slide first.")}</PanelEmpty>;

  const B = baseOf(fmt);
  const target = targetOf(slide, selectedLayerId);
  const layoutAlign = editorLayout(slide, fmt).text.align;
  const freeTexts = [...(slide.elements ?? []).filter((e) => e.kind === "text").map((e) => ({ id: `element:${e.id}`, el: e })), ...themeElements(slide).filter((e) => e.kind === "text").map((e) => ({ id: `theme:${e.id}`, el: e }))];

  // --- Hedefe göre okuma/yazma -------------------------------------------
  let text = "";
  let style: TextStyle;
  let setText: (t: string) => void;
  let patchStyle: (p: Partial<TextStyle>) => void;
  let resetStyle: (() => void) | null = null;
  let element: SlideElement | null = null;
  const styleKey = target.kind === "headline" ? "headlineStyle" : "subStyle";

  if (target.kind === "headline" || target.kind === "sub") {
    const base = { ...theme[target.kind === "headline" ? "headline" : "sub"], align: layoutAlign };
    const over = slide[styleKey];
    style = { ...base, ...over } as TextStyle;
    text = slide[target.kind] ?? "";
    setText = (t) => up({ [target.kind]: t } as Partial<Slide>, `txt:${slide.id}:${target.kind}`);
    patchStyle = (p) => up({ [styleKey]: { ...(slide[styleKey] ?? {}), ...p } } as Partial<Slide>, `sty:${slide.id}:${styleKey}:${Object.keys(p).join()}`);
    resetStyle = over ? () => up({ [styleKey]: undefined } as Partial<Slide>) : null;
  } else if (target.kind === "element") {
    element = layerElement(slide, target.layerId);
    const el = element!;
    style = { ...EL_TEXT_BASE, ...el.style } as TextStyle;
    text = el.text ?? "";
    setText = (t) => up(patchLayerElement(slide, target.layerId, { text: t }), `txt:${slide.id}:${target.layerId}`);
    patchStyle = (p) => up(patchLayerElement(slide, target.layerId, { style: { ...el.style, ...p } }), `sty:${slide.id}:${target.layerId}:${Object.keys(p).join()}`);
  } else {
    style = { ...theme.sub, align: layoutAlign };
    text = slide.badge ?? "";
    setText = (t) => up({ badge: t || undefined }, `txt:${slide.id}:badge`);
    patchStyle = () => {};
  }

  const box = target.kind === "badge" ? null : layerBox(slide, target.kind === "element" ? target.layerId : target.kind, fmt, project.activeLocale);
  const setFrame = (p: Partial<{ x: number; y: number; w: number; rotation: number }>) => {
    if (!box) return;
    if (target.kind === "element") up(patchLayerElement(slide, target.layerId, p), `geo:${slide.id}:${target.layerId}`);
    else if (target.kind === "headline" || target.kind === "sub") up(textFramePatch(slide, target.kind, { x: box.x, y: box.y, w: box.w, rotation: box.rotation, ...p }), `geo:${slide.id}:${target.kind}`);
  };

  // --- Zengin işaretler ----------------------------------------------------
  const wrap = (mark: string) => {
    const ta = area.current;
    const a = ta?.selectionStart ?? text.length;
    const b = ta?.selectionEnd ?? text.length;
    const inner = text.slice(a, b) || L("metin", "text");
    const next = text.slice(0, a) + mark + inner + mark + text.slice(b);
    setText(next);
    if (!style.rich) patchStyle({ rich: true });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(a + 1, a + 1 + inner.length);
    });
  };

  // --- Yeni metin --------------------------------------------------------
  const add = (preset: string) => {
    const h = theme.headline;
    const s = theme.sub;
    const presets: Record<string, Partial<TextStyle> & { text: string; w: number }> = {
      title: { text: L("Yeni başlık", "New heading"), w: B.w * 0.8, fontFamily: h.fontFamily, weight: h.weight, sizePx: Math.round(h.sizePx * 0.85), color: h.color, lineHeight: 1.05, letterSpacing: h.letterSpacing },
      subtitle: { text: L("Kısa bir açıklama", "A short description"), w: B.w * 0.74, fontFamily: s.fontFamily, weight: s.weight, sizePx: s.sizePx, color: s.color, lineHeight: 1.3 },
      label: { text: L("YENİ ÖZELLİK", "NEW FEATURE"), w: B.w * 0.6, fontFamily: s.fontFamily, weight: 600, sizePx: 34, color: theme.accent, letterSpacing: 6, transform: "uppercase" },
      hand: { text: L("tam da bu!", "just this!"), w: B.w * 0.5, fontFamily: "Caveat", weight: 600, sizePx: 88, color: theme.accent },
      number: { text: "4.9 ★", w: B.w * 0.7, fontFamily: h.fontFamily, weight: 800, sizePx: 220, color: h.color, lineHeight: 1 },
      body: { text: L("Uygulamanın bu ekranı neden önemli? Bir iki cümleyle anlat.", "Why does this screen matter? Tell it in a sentence or two."), w: B.w * 0.72, fontFamily: s.fontFamily, weight: 400, sizePx: 44, color: s.color, lineHeight: 1.4, align: "left" },
    };
    const { text: t, w, ...st } = presets[preset] ?? presets.title;
    const el = makeElement("text", uid(), { cx: B.w / 2, cy: B.h * 0.5, w, text: t });
    el.h = Math.round((st.sizePx ?? 56) * (st.lineHeight ?? 1.2) * 1.6);
    el.style = { align: "center", ...st };
    el.name = PRESETS.find((p) => p.id === preset)?.label;
    up({ elements: [...(slide.elements ?? []), el] });
    setSelectedLayer(`element:${el.id}`);
  };

  const weights = weightsOf(style.fontFamily);
  const sh = style.shadow;
  const isBadge = target.kind === "badge";
  const fontInfo = FONT_FAMILIES.find((f) => f.family === style.fontFamily);

  return (
    <div className="panel-scroll">
      {/* ---------------- Metinler ---------------- */}
      <div className="text-list" role="listbox" aria-label={L("Slayttaki metinler", "Texts on the slide")}>
        {(
          [
            ["headline", L("Başlık", "Headline"), slide.headline],
            ["sub", L("Alt yazı", "Subtitle"), slide.sub],
            ["badge", L("Rozet", "Badge"), slide.badge],
          ] as const
        ).map(([id, lb, content]) => (
          <button key={id} type="button" role="option" aria-selected={target.kind === id} className={`text-item ${target.kind === id ? "on" : ""}`} onClick={() => (id === "badge" ? useStudio.setState({ selectedLayerId: "badge", selectedElementId: null }) : setSelectedLayer(id))}>
            <Icon name="type" size={13} />
            <b>{lb}</b>
            <small>{content?.trim() || L("boş", "empty")}</small>
          </button>
        ))}
        {freeTexts.map(({ id, el }) => (
          <button key={id} type="button" role="option" aria-selected={target.kind === "element" && target.layerId === id} className={`text-item ${target.kind === "element" && target.layerId === id ? "on" : ""}`} onClick={() => setSelectedLayer(id)}>
            <Icon name="text" size={13} />
            <b>{el.name || L("Metin", "Text")}</b>
            <small>{el.text?.trim() || L("boş", "empty")}</small>
          </button>
        ))}
      </div>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="preset" onClick={() => add(p.id)} title={L(`${p.label} ekle`, `Add ${p.label}`)}>
            <Icon name="plus" size={11} />
            <span>{p.label}</span>
            <small>{p.hint}</small>
          </button>
        ))}
      </div>

      {/* ---------------- İçerik ---------------- */}
      <Section id="txt.content" title={L("İçerik", "Content")} hint={target.kind === "element" ? element?.name || L("serbest", "free") : target.kind === "badge" ? L("rozet", "badge") : target.kind === "headline" ? L("başlık", "headline") : L("alt yazı", "subtitle")}>
        <DriftBand slide={slide} fields={target.kind === "element" ? ["elements"] : ["headlineStyle", "subStyle", "textBoxes"]} />
        <textarea ref={area} className="text-area" rows={isBadge ? 1 : 3} value={text} placeholder={isBadge ? L("YENİ · 4.9 ★", "NEW · 4.9 ★") : L("Metni yaz…", "Type the text…")} onChange={(e) => setText(e.target.value)} />
        {!isBadge && (
          <div className="rich-bar" role="toolbar" aria-label={L("Zengin metin", "Rich text")}>
            <button type="button" title={L("Vurgu rengi  *metin*", "Accent color  *text*")} onClick={() => wrap("*")}>
              <b style={{ color: style.accentColor ?? theme.accent }}>A</b>
            </button>
            <button type="button" title={L("El yazısı  _metin_", "Handwriting  _text_")} onClick={() => wrap("_")}>
              <i style={{ fontFamily: "Caveat, cursive", fontSize: 15 }}>a</i>
            </button>
            <button type="button" title={L("Bant  ~metin~", "Band  ~text~")} onClick={() => wrap("~")}>
              <span className="rb-band">ab</span>
            </button>
            <button type="button" title={L("Büyük  ^metin^", "Big  ^text^")} onClick={() => wrap("^")}>
              <b style={{ fontSize: 15 }}>A</b>
              <small>a</small>
            </button>
            <button type="button" title={L("Altı çizili  =metin=", "Underline  =text=")} onClick={() => wrap("=")}>
              <u>U</u>
            </button>
            <span className="rich-sp" />
            <Toggle checked={!!style.rich} onChange={(v) => patchStyle({ rich: v || undefined })} label={L("Zengin", "Rich")} />
          </div>
        )}
        {isBadge && <p className="note">{L("Rozet, temanın rozet stilini kullanır.", "The badge uses the theme's badge style.")}</p>}
      </Section>

      {!isBadge && (
        <>
          {/* ---------------- Karakter ---------------- */}
          <Section id="txt.char" title={L("Karakter", "Character")} hint={`${style.sizePx}px`}>
            <FontPicker value={style.fontFamily} sample={text.split("\n")[0]} onChange={(fontFamily) => patchStyle({ fontFamily, weight: weightsOf(fontFamily).includes(style.weight) ? style.weight : weightsOf(fontFamily).reduce((a, b) => (Math.abs(b - style.weight) < Math.abs(a - style.weight) ? b : a)) })} />
            {fontInfo && !fontInfo.turkish && <p className="note warn">{L("Bu ailede ş/ğ/İ eksik — Türkçe metinde yedek font görünür.", "This family lacks ş/ğ/İ — Turkish text falls back.")}</p>}
            <div className="weight-row" role="radiogroup" aria-label={L("Ağırlık", "Weight")}>
              {weights.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={style.weight === w} className={style.weight === w ? "on" : ""} style={{ fontFamily: `"${style.fontFamily}", var(--sans)`, fontWeight: w }} onClick={() => patchStyle({ weight: w })} title={`${w}`}>
                  {WEIGHT_NAMES[w] ?? w}
                </button>
              ))}
              <button type="button" className={`it ${style.style === "italic" ? "on" : ""}`} aria-pressed={style.style === "italic"} title={hasItalic(style.fontFamily) ? L("İtalik", "Italic") : L("İtalik (eğik yüz yok — tarayıcı eğer)", "Italic (no true italic — slanted)")} onClick={() => patchStyle({ style: style.style === "italic" ? undefined : "italic" })}>
                <i>I</i>
              </button>
            </div>
            <SliderRow label={L("Boyut", "Size")} value={Math.round(style.sizePx)} min={12} max={400} onChange={(sizePx) => patchStyle({ sizePx })} format={(v) => `${v}px`} />
          </Section>

          {/* ---------------- Paragraf ---------------- */}
          <Section id="txt.para" title={L("Paragraf", "Paragraph")}>
            <div className="para-row">
              <IconSeg
                label={L("Hiza", "Align")}
                value={(style.align ?? "center") as "left" | "center" | "right"}
                onChange={(align) => patchStyle({ align })}
                options={[
                  { value: "left", label: <AlignIcon a="left" />, title: L("Sola", "Left") },
                  { value: "center", label: <AlignIcon a="center" />, title: L("Ortaya", "Center") },
                  { value: "right", label: <AlignIcon a="right" />, title: L("Sağa", "Right") },
                ]}
              />
              <IconSeg
                label={L("Harf dönüşümü", "Case")}
                value={style.transform ?? "none"}
                onChange={(transform) => patchStyle({ transform: transform === "none" ? undefined : transform })}
                options={[
                  { value: "none", label: "Aa", title: L("Olduğu gibi", "As typed") },
                  { value: "uppercase", label: "AA", title: L("BÜYÜK HARF", "UPPERCASE") },
                  { value: "lowercase", label: "aa", title: L("küçük harf", "lowercase") },
                  { value: "capitalize", label: "Ab", title: L("Her Kelime Büyük", "Title Case") },
                ]}
              />
            </div>
            <SliderRow label={L("Satır aralığı", "Line height")} defaultValue={1.1} value={Math.round((style.lineHeight ?? 1.1) * 100) / 100} min={0.6} max={2.4} step={0.02} onChange={(lineHeight) => patchStyle({ lineHeight })} format={(v) => `×${v}`} />
            <SliderRow label={L("Harf aralığı", "Tracking")} defaultValue={0} value={style.letterSpacing ?? 0} min={-12} max={40} step={0.5} onChange={(letterSpacing) => patchStyle({ letterSpacing })} format={(v) => `${v}px`} />
          </Section>

          {/* ---------------- Renk ---------------- */}
          <Section id="txt.color" title={L("Renk", "Color")}>
            <Swatches value={toHex(style.color)} colors={["#ffffff", "#0b0b0d", theme.accent, theme.headline.color, "#9aa0ae", "#f7efdc"]} onChange={(color) => patchStyle({ color })} />
            <SliderRow label={L("Opaklık", "Opacity")} defaultValue={100} value={Math.round((style.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => patchStyle({ opacity: v === 100 ? undefined : v / 100 })} format={(v) => `${v}%`} />
            {style.rich && (
              <Advanced id="txt.rich" label={L("Zengin parça renkleri", "Rich part colors")}>
                <Row label={L("Vurgu", "Accent")}>
                  <Swatches value={toHex(style.accentColor ?? theme.accent)} colors={[theme.accent, "#ffffff", "#0b0b0d", "#ff2d55", "#2f6bff"]} onChange={(accentColor) => patchStyle({ accentColor })} />
                </Row>
                <Row label={L("El yazısı", "Hand")}>
                  <Swatches value={toHex(style.handColor ?? style.accentColor ?? theme.accent)} colors={[theme.accent, "#ffffff", "#0b0b0d", "#ffcc00"]} onChange={(handColor) => patchStyle({ handColor })} />
                </Row>
                <div className="field">
                  <label>{L("El yazısı fontu", "Hand font")}</label>
                  <select value={style.handFamily ?? "Caveat"} onChange={(e) => patchStyle({ handFamily: e.target.value })}>
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.family} value={f.family}>
                        {f.family}
                      </option>
                    ))}
                  </select>
                </div>
                <SliderRow label={L("El yazısı boyu", "Hand scale")} defaultValue={1.15} value={style.handScale ?? 1.15} min={0.6} max={2.5} step={0.05} onChange={(handScale) => patchStyle({ handScale })} format={(v) => `×${v}`} />
                <Row label={L("Bant", "Band")}>
                  <Swatches value={toHex(style.bandColor ?? theme.accent)} colors={[theme.accent, "#ffffff", "#0b0b0d", "#c6ff3a"]} onChange={(bandColor) => patchStyle({ bandColor })} />
                </Row>
                <Row label={L("Bant yazısı", "Band text")}>
                  <Swatches value={toHex(style.bandTextColor ?? "#ffffff")} colors={["#ffffff", "#0b0b0d", theme.accent]} onChange={(bandTextColor) => patchStyle({ bandTextColor })} />
                </Row>
                <SliderRow label={L("Büyük kat", "Big scale")} defaultValue={1.9} value={style.bigScale ?? 1.9} min={1.1} max={4} step={0.05} onChange={(bigScale) => patchStyle({ bigScale })} format={(v) => `×${v}`} />
                <Row label={L("Alt çizgi", "Underline")}>
                  <Swatches value={toHex(style.underlineColor ?? style.accentColor ?? theme.accent)} colors={[theme.accent, "#ffffff", "#0b0b0d"]} onChange={(underlineColor) => patchStyle({ underlineColor })} />
                </Row>
              </Advanced>
            )}
          </Section>

          {/* ---------------- Efekt ---------------- */}
          <Section id="txt.fx" title={L("Efekt", "Effects")} hint={[sh ? L("gölge", "shadow") : "", style.strokeWidth ? L("kontur", "stroke") : ""].filter(Boolean).join(" · ") || undefined} defaultOpen={false}>
            <Toggle checked={!!sh} onChange={(v) => patchStyle({ shadow: v ? { color: "#00000080", blur: 24, dx: 0, dy: 8 } : undefined })} label={L("Gölge", "Shadow")} />
            {sh && (
              <>
                <Row label={L("Renk", "Color")}>
                  <Swatches value={toHex(sh.color.slice(0, 7))} colors={["#000000", "#ffffff", theme.accent, "#1b2a4a"]} onChange={(c) => patchStyle({ shadow: { ...sh, color: c + (sh.color.length === 9 ? sh.color.slice(7) : "80") } })} />
                </Row>
                <SliderRow label={L("Yoğunluk", "Strength")} defaultValue={50} value={Math.round((parseInt(sh.color.slice(7, 9) || "80", 16) / 255) * 100)} min={0} max={100} onChange={(v) => patchStyle({ shadow: { ...sh, color: sh.color.slice(0, 7) + Math.round((v / 100) * 255).toString(16).padStart(2, "0") } })} format={(v) => `${v}%`} />
                <SliderRow label={L("Yumuşaklık", "Blur")} defaultValue={24} value={sh.blur} min={0} max={160} onChange={(blur) => patchStyle({ shadow: { ...sh, blur } })} format={(v) => `${v}px`} />
                <SliderRow label="X" defaultValue={0} value={sh.dx} min={-80} max={80} onChange={(dx) => patchStyle({ shadow: { ...sh, dx } })} format={(v) => `${v}px`} />
                <SliderRow label="Y" defaultValue={8} value={sh.dy} min={-80} max={80} onChange={(dy) => patchStyle({ shadow: { ...sh, dy } })} format={(v) => `${v}px`} />
              </>
            )}
            <Toggle checked={!!style.strokeWidth} onChange={(v) => patchStyle(v ? { strokeWidth: 4, strokeColor: style.strokeColor ?? "#000000" } : { strokeWidth: undefined })} label={L("Kontur", "Stroke")} />
            {!!style.strokeWidth && (
              <>
                <Row label={L("Renk", "Color")}>
                  <Swatches value={toHex(style.strokeColor ?? "#000000")} colors={["#000000", "#ffffff", theme.accent]} onChange={(strokeColor) => patchStyle({ strokeColor })} />
                </Row>
                <SliderRow label={L("Kalınlık", "Width")} defaultValue={4} value={style.strokeWidth} min={1} max={40} onChange={(strokeWidth) => patchStyle({ strokeWidth })} format={(v) => `${v}px`} />
              </>
            )}
          </Section>

          {/* ---------------- Yerleşim ---------------- */}
          {box && (
            <Section id="txt.frame" title={L("Yerleşim", "Placement")} hint={`${Math.round(box.w)}px`} defaultOpen={false}>
              <div className="num-grid">
                <NumberInput label="X" value={Math.round(box.x)} onChange={(x) => setFrame({ x })} />
                <NumberInput label="Y" value={Math.round(box.y)} onChange={(y) => setFrame({ y })} />
                <NumberInput label={L("En", "W")} value={Math.round(box.w)} min={40} max={B.w * 4} onChange={(w) => setFrame({ w })} />
                <NumberInput label="°" value={Math.round((box.rotation ?? 0) * 10) / 10} min={-180} max={180} step={0.5} onChange={(rotation) => setFrame({ rotation })} />
              </div>
              <div className="btn-row">
                <button type="button" className="btn sm" onClick={() => setFrame({ x: (B.w - box.w) / 2 })}>
                  {L("Yatay ortala", "Center H")}
                </button>
                {(target.kind === "headline" || target.kind === "sub") && slide.textBoxes?.[target.kind] && (
                  <button type="button" className="btn sm" onClick={() => up({ textBoxes: { ...slide.textBoxes, [target.kind]: undefined } })}>
                    <Icon name="reset" size={11} />
                    {L("Tema konumu", "Theme position")}
                  </button>
                )}
              </div>
              <p className="note">{L("Tuvalde metni sürükle; çift tıkla yerinde yaz. Ok tuşları da çalışır.", "Drag the text on the canvas; double-click to type in place.")}</p>
            </Section>
          )}

          <div className="panel-foot">
            {resetStyle && (
              <button type="button" className="btn sm" onClick={resetStyle}>
                <Icon name="reset" size={11} />
                {L("Temaya dön", "Back to theme")}
              </button>
            )}
            {(target.kind === "headline" || target.kind === "sub") && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const n = applyDesignToAllSlides([styleKey], slide.id);
                  pushToast({ msg: L(`${target.kind === "headline" ? "Başlık" : "Alt yazı"} stili ${n} slayta uygulandı`, `${target.kind === "headline" ? "Headline" : "Subtitle"} style applied to ${n} slides`) });
                }}
              >
                <Icon name="copy" size={11} />
                {L("Stili tüm slaytlara", "Style to all slides")}
              </button>
            )}
            {element && target.kind === "element" && target.layerId.startsWith("element:") && (
              <button
                type="button"
                className="btn sm danger"
                onClick={() => {
                  up({ elements: (slide.elements ?? []).filter((e) => e.id !== element!.id) });
                  setSelectedLayer(null);
                }}
              >
                <Icon name="trash" size={11} />
                {L("Metni sil", "Delete text")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AlignIcon({ a }: { a: "left" | "center" | "right" }) {
  const x = (w: number) => (a === "left" ? 4 : a === "right" ? 20 - w : 12 - w / 2);
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      {[16, 10, 14].map((w, i) => (
        <path key={i} d={`M${x(w)} ${7 + i * 5}h${w}`} />
      ))}
    </svg>
  );
}

function toHex(c: string): string {
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  if (/^#([0-9a-f]{8})$/i.test(c)) return c.slice(0, 7);
  if (/^#([0-9a-f]{3})$/i.test(c)) return "#" + c.slice(1).split("").map((ch) => ch + ch).join("");
  return "#ffffff";
}
