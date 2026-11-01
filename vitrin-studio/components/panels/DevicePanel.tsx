"use client";

// CİHAZ PANELİ — v1.0. Cihazla ilgili HER ŞEY tek yerde:
//
//   Görünüm   ekran · 2D · 3D, bu karede cihaz
//   Cihazlar  1/2/3 çipleri (tuval seçimiyle aynı), yuvanın ekranı
//   Duruş     iPhone Duo: açık/kapalı — çoklu karede CİHAZ BAŞINA
//   Konum     ölçek · X · Y · eğim (2D) · yatay dönüş + dikey eğim (3D)
//   Gövde     model, dosya, kasa rengi, kontur
//
// Eskiden bu ayarlar Inspector'da üç bölüme (iPhone Duo, Cihaz, Çoklu cihaz)
// ve sol katman paneline dağılmıştı; "Çoklu cihaz" bölümünün 3D dönüşü
// motorda hiç uygulanmıyordu. Artık tek panel, tek kaynak.

import { useSyncExternalStore } from "react";
import { LAYOUTS } from "@/engine/layouts";
import { listModels, modelFileOf, modelRegistryRev, subscribeModelRegistry, DEFAULT_MODEL_FILE, DEFAULT_TABLET_MODEL_FILE } from "@/engine/modelRegistry";
import { previewSrc } from "@/engine/media";
import { splitCropDefault } from "@/engine/splitScreens";
import {
  deviceStyleForFormat,
  duoPostureOfSlot,
  isDuoFormat,
  isTabletKind,
  kindOfFormat,
  type DeviceOffset,
  type DeviceStyle,
  type DeviceStyle2D,
  type DeviceStyle3D,
  type Slide,
} from "@/engine/types";
import { L } from "@/lib/i18n";
import { useStudio, type ShotSlot } from "@/store/studio";
import { focusPanel } from "@/store/workspace";
import { Advanced, Icon, Row, Section, Segmented, SliderRow, Swatches, Toggle } from "../ui";
import { pushToast } from "../toast";
import { DriftBand, PanelEmpty, SlideStrip, useActiveSlide } from "./common";
import { isDuoScreenPair, offsetOf, OFFSET_OF, shotOf, slotLabel, useDeviceSlot } from "./deviceSlots";
import { ingestScreenshotFiles, pickScreenshotFiles } from "./shotActions";

const BODY_COLORS = ["#3a3a3e", "#0e0e12", "#8e8e93", "#c9c4bb", "#f1efe9", "#1b2a4a", "#b8912f"];

export default function DevicePanel() {
  const { project, slide, theme, fmt, idx, up } = useActiveSlide();
  useSyncExternalStore(subscribeModelRegistry, modelRegistryRev, () => 0);
  const { slot, nos, pick } = useDeviceSlot(slide, fmt);
  const setSlideShot = useStudio((s) => s.setSlideShot);
  const applyDesignToAllSlides = useStudio((s) => s.applyDesignToAllSlides);
  const patchDeviceAllSlides = useStudio((s) => s.patchDeviceAllSlides);

  if (!slide || !theme) {
    return <PanelEmpty title={L("Slayt yok", "No slide")}>{L("Film şeridinden bir slayt seç.", "Pick a slide from the filmstrip.")}</PanelEmpty>;
  }

  const duo = isDuoFormat(fmt);
  const tablet = isTabletKind(kindOfFormat(fmt));
  const dev: DeviceStyle = slide.device ?? theme.device;
  const dev2 = dev.mode === "2d" ? (dev as DeviceStyle2D) : null;
  const dev3 = dev.mode === "3d" ? (dev as DeviceStyle3D) : null;
  const upDev = (d: DeviceStyle) => up({ device: d });
  const layout = LAYOUTS[slide.layout];
  const split = !!layout?.splitPanels || slide.layout === "split-v" || slide.layout === "split-h";
  const multi = !!layout?.device2 && !split;
  const screenPair = isDuoScreenPair(slide, fmt);
  // Duo'nun iç/dış ekran çifti TEK gövdedir: konum her zaman 1. cihazdadır.
  const posSlot: ShotSlot = screenPair || split ? 1 : slot;
  const off = offsetOf(slide, posSlot);
  const offField = OFFSET_OF[posSlot];
  const setOff = (patch: Partial<DeviceOffset>) => {
    const next: DeviceOffset = { ...off, ...patch };
    const empty = !next.x && !next.y && (next.scale ?? 1) === 1 && !next.rotation && !next.yaw && !next.pitch && !next.posture;
    up({ [offField]: empty ? undefined : next } as Partial<Slide>, `dev:${slide.id}:${offField}:${Object.keys(patch).join()}`);
  };
  const mode = dev3 ? "3d" : dev2?.frame === "none" ? "screen" : "2d";
  const setMode = (m: "screen" | "2d" | "3d") => {
    if (m === "3d") upDev({ mode: "3d", model: "real", camera: duo ? "front" : "hero-right", duoPosture: duo ? (fmt.includes("cover") ? "closed" : "open") : undefined, env: "studio", shadow: true });
    else if (m === "2d") upDev({ mode: "2d", frame: "kontur", shadow: true });
    else upDev({ mode: "2d", frame: "none", cornerRadius: 72, shadow: !duo, reflection: false });
  };

  const posture = duoPostureOfSlot(dev, fmt, multi ? off : dev3 ? null : off);
  const setPosture = (p: "open" | "closed") => {
    // Çoklu karede yalnız seçili cihaz; tek cihazda 3D gövdenin kendisi.
    if (multi || !dev3) setOff({ posture: p === duoPostureOfSlot(dev, fmt, null) ? undefined : p });
    else upDev({ ...dev3, model: "real", duoPosture: p, kind: undefined });
  };

  const models = listModels({ kind: duo ? "foldable" : tablet ? "tablet" : ["phone", "prop"] });
  const preferred = tablet ? DEFAULT_TABLET_MODEL_FILE : DEFAULT_MODEL_FILE;
  const modelFile = models.find((m) => m.file === modelFileOf(dev3?.glb))?.file ?? models.find((m) => m.file === preferred)?.file ?? models[0]?.file;
  const hasGlb = models.length > 0;
  const resolvedModel = duo ? "real" : tablet && !hasGlb ? "kontur" : dev3?.model ?? "real";
  const src = shotOf(slide, slot);
  const label = slotLabel(slide, fmt, slot);

  return (
    <div className="panel-scroll">
      <SlideStrip idx={idx} slide={slide} tag={mode === "3d" ? "3D" : mode === "screen" ? L("Ekran", "Screen") : "2D"} />

      {/* ============================ GÖRÜNÜM ============================ */}
      <Section id="dev.view" title={L("Görünüm", "Appearance")} hint={slide.hideDevice ? L("gizli", "hidden") : undefined}>
        <DriftBand slide={slide} fields={["device", "hideDevice"]} />
        <Toggle checked={!slide.hideDevice} onChange={(v) => up({ hideDevice: v ? undefined : true })} label={L("Bu karede cihazı göster", "Show device in this frame")} />
        {!split && (
          <div className="mode-cards" role="radiogroup" aria-label={L("Cihaz görünümü", "Device appearance")}>
            {(
              [
                ["screen", L("Yalnız ekran", "Screen only"), "frame"],
                ["2d", L("2D silüet", "2D outline"), duo || tablet ? "frame" : "phone"],
                ["3d", L("3D gövde", "3D body"), "cube"],
              ] as const
            ).map(([m, t, ic]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`mode-card ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
                <Icon name={ic} size={18} />
                <span>{t}</span>
              </button>
            ))}
          </div>
        )}
        {split && <p className="note">{L("Bu düzen iki görseli kırpılmış panellere yerleştirir; gövde çizilmez.", "This layout places two images in cropped panels; no body is drawn.")}</p>}
      </Section>

      {/* ============================ CİHAZLAR ============================ */}
      <Section id="dev.slots" title={multi ? L("Cihazlar", "Devices") : screenPair ? L("Ekranlar", "Screens") : L("Ekran görüntüsü", "Screenshot")} hint={nos.length > 1 ? label : undefined}>
        {nos.length > 1 && (
          <div className="slot-chips" role="tablist">
            {nos.map((n) => {
              const s = shotOf(slide, n);
              return (
                <button key={n} type="button" role="tab" aria-selected={slot === n} className={`slot-chip ${slot === n ? "on" : ""}`} onClick={() => pick(n)} title={slotLabel(slide, fmt, n)}>
                  <span className="slot-chip-img">{s ? <img src={previewSrc(s)} alt="" /> : <Icon name="plus" size={12} />}</span>
                  <span>{slotLabel(slide, fmt, n)}</span>
                </button>
              );
            })}
          </div>
        )}
        <div
          className="shot-card"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.currentTarget.classList.add("over");
            }
          }}
          onDragLeave={(e) => e.currentTarget.classList.remove("over")}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("over");
            void ingestScreenshotFiles(e.dataTransfer.files, { slideId: slide.id, slot, force: true });
          }}
        >
          <span className="shot-card-img">{src ? <img src={previewSrc(src)} alt="" /> : <Icon name="image" size={20} />}</span>
          <span className="shot-card-meta">
            <b>{label}</b>
            <small>{src ? project.screenshots.find((x) => x.dataUrl === src)?.name || L("atandı", "assigned") : L("Boş · dosya bırak ya da yükle", "Empty · drop a file or upload")}</small>
            <span className="shot-card-ops">
              <button type="button" className="btn xs" onClick={() => pickScreenshotFiles({ slideId: slide.id, slot, force: true }, false)}>
                <Icon name="plus" size={11} />
                {L("Yükle", "Upload")}
              </button>
              <button type="button" className="btn xs" onClick={() => focusPanel("screens")}>
                <Icon name="grid" size={11} />
                {L("Havuzdan seç", "From pool")}
              </button>
              {src && (
                <button type="button" className="btn xs ghost" title={L("Temizle", "Clear")} onClick={() => setSlideShot(slide.id, slot, undefined)}>
                  <Icon name="x" size={11} />
                </button>
              )}
            </span>
          </span>
        </div>
        <p className="note">{L("İpucu: tuvalde ekranın üstüne çift tıkla ya da dosyayı doğrudan cihazın üstüne bırak.", "Tip: double-click the screen on the canvas, or drop a file right onto the device.")}</p>
      </Section>

      {/* ============================ DURUŞ (Duo) ============================ */}
      {duo && !split && (
        <Section id="dev.duo" title="iPhone Duo" hint={posture === "open" ? L("açık", "open") : L("kapalı", "closed")}>
          <Row label={multi ? L(`${label} gövdesi`, `${label} body`) : L("Gövde", "Body")}>
            <Segmented
              value={posture}
              options={[
                { value: "open", label: L("Açık", "Open") },
                { value: "closed", label: L("Kapalı", "Closed") },
              ]}
              onChange={setPosture}
            />
          </Row>
          {dev3 && (
            <Row label={L("Yön", "Orientation")}>
              {(() => {
                const kind = deviceStyleForFormat(dev3, fmt).kind;
                const closed = kind.includes("cover");
                return (
                  <Segmented
                    value={kind === "foldable" || kind === "foldable-cover-landscape" ? "landscape" : "portrait"}
                    options={[
                      { value: "landscape", label: L("Yatay", "Landscape") },
                      { value: "portrait", label: L("Dikey", "Portrait") },
                    ]}
                    onChange={(d) => upDev({ ...dev3, kind: closed ? (d === "landscape" ? "foldable-cover-landscape" : "foldable-cover") : d === "landscape" ? "foldable" : "foldable-portrait" })}
                  />
                );
              })()}
            </Row>
          )}
          {dev2 && dev2.frame !== "none" && !fmt.includes("cover") && <Toggle checked={dev2.duoCrease !== false} onChange={(v) => upDev({ ...dev2, duoCrease: v ? undefined : false })} label={L("Menteşe izi", "Hinge crease")} />}
          <p className="note">{multi ? L("Her cihaz kendi duruşunu taşır: biri açık, biri kapalı olabilir.", "Each device keeps its own posture: one can be open, another closed.") : L("Kapalı gövdede dış ekran görseli kullanılır.", "The closed body uses the outer screen image.")}</p>
        </Section>
      )}

      {/* ============================ KONUM ============================ */}
      {!split && (
        <Section id="dev.pos" title={L("Konum ve dönüş", "Position and rotation")} hint={multi ? label : undefined}>
          <DriftBand slide={slide} fields={[offField]} />
          <SliderRow label={L("Ölçek", "Scale")} defaultValue={100} value={Math.round((off.scale ?? 1) * 100)} min={10} max={600} onChange={(v) => setOff({ scale: v === 100 ? undefined : v / 100 })} format={(v) => `${v}%`} />
          <SliderRow label="X" defaultValue={0} value={Math.round(off.x)} min={-1200} max={1200} onChange={(v) => setOff({ x: v })} format={(v) => `${v}px`} />
          <SliderRow label="Y" defaultValue={0} value={Math.round(off.y)} min={-1200} max={1200} onChange={(v) => setOff({ y: v })} format={(v) => `${v}px`} />
          {dev3 ? (
            <>
              <SliderRow label={L("Yatay dönüş", "Turn")} defaultValue={0} value={Math.round(off.yaw ?? 0)} min={-180} max={180} onChange={(v) => setOff({ yaw: v || undefined })} format={(v) => `${v}°`} />
              <SliderRow label={L("Öne eğim", "Tilt")} defaultValue={0} value={Math.round(off.pitch ?? 0)} min={-80} max={80} onChange={(v) => setOff({ pitch: v || undefined })} format={(v) => `${v}°`} />
              <SliderRow label={L("Yatış", "Roll")} defaultValue={0} value={Math.round((off.rotation ?? 0) * 10) / 10} min={-45} max={45} step={0.5} onChange={(v) => setOff({ rotation: v || undefined })} format={(v) => `${v}°`} />
            </>
          ) : (
            <SliderRow label={L("Döndürme", "Rotation")} defaultValue={0} value={Math.round((off.rotation ?? 0) * 10) / 10} min={-180} max={180} step={0.5} onChange={(v) => setOff({ rotation: v || undefined })} format={(v) => `${v}°`} />
          )}
          <div className="btn-row">
            <button type="button" className="btn sm" disabled={!slide[offField]} onClick={() => up({ [offField]: undefined } as Partial<Slide>)}>
              <Icon name="reset" size={11} />
              {L("Sıfırla", "Reset")}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const n = applyDesignToAllSlides(["device", "deviceOffset", "device2Offset", "device3Offset", "hideDevice"], slide.id);
                pushToast({ msg: L(`Cihaz ayarı ${n} slayta uygulandı`, `Device settings applied to ${n} slides`) });
              }}
            >
              <Icon name="copy" size={11} />
              {L("Tüm slaytlara", "All slides")}
            </button>
          </div>
          {dev3 && (
            <p className="note">
              {multi
                ? L("Tuvalde bir cihazı seçip fare ORTA tuşuyla sürükle: yalnız o cihaz döner. Seçim yokken orta tuş kamerayı (hepsini) döndürür.", "Select a device on the canvas and drag with the MIDDLE mouse button: only that device turns. With nothing selected the middle button orbits the camera (all devices).")
                : L("Cihaz seçiliyken orta tuşla sürükle: cihaz kendi ekseninde döner. Seçim yokken kamera döner.", "With the device selected, middle-drag turns it on its own axis. With nothing selected the camera orbits.")}
            </p>
          )}
        </Section>
      )}

      {/* ============================ KIRPMA (split) ============================ */}
      {split && (
        <Section id="dev.crop" title={L("Kırpma", "Crop")} hint={label}>
          {(() => {
            const i = slot === 2 ? 1 : 0;
            const defaults = splitCropDefault(slide.layout);
            const crop = { ...defaults, ...slide.splitCrop?.[i] };
            const change = (key: "x" | "y" | "zoom", v: number) => {
              const next = [...(slide.splitCrop ?? [{}, {}])];
              next[i] = { ...next[i], [key]: v };
              up({ splitCrop: next });
            };
            return (
              <>
                <SliderRow label={L("Yakınlaştır", "Zoom")} value={Math.round(crop.zoom * 100)} defaultValue={defaults.zoom * 100} min={100} max={1200} onChange={(v) => change("zoom", v / 100)} format={(v) => `${v}%`} />
                <SliderRow label={L("Odak X", "Focus X")} value={Math.round(crop.x * 100)} defaultValue={50} min={0} max={100} onChange={(v) => change("x", v / 100)} format={(v) => `${v}%`} />
                <SliderRow label={L("Odak Y", "Focus Y")} value={Math.round(crop.y * 100)} defaultValue={35} min={0} max={100} onChange={(v) => change("y", v / 100)} format={(v) => `${v}%`} />
                <button type="button" className="btn sm wide" onClick={() => up({ splitCrop: undefined })}>
                  {L("Kırpmayı sıfırla", "Reset crop")}
                </button>
              </>
            );
          })()}
        </Section>
      )}

      {/* ============================ GÖVDE ============================ */}
      {!split && mode !== "screen" && (
        <Section id="dev.body" title={L("Gövde", "Body")} hint={dev3 ? (resolvedModel === "real" ? "GLB" : L("Kontur", "Outline")) : "2D"} defaultOpen={false}>
          {dev3 ? (
            <>
              {!duo && (
                <Row label="Model">
                  <Segmented
                    value={resolvedModel}
                    options={[
                      ...(hasGlb ? [{ value: "real" as const, label: L("Gerçek", "Real") }] : []),
                      { value: "kontur" as const, label: L("Kontur", "Outline") },
                    ]}
                    onChange={(m) => (m === "real" && modelFile ? upDev({ ...dev3, model: "real", glb: `/assets/models/${modelFile}` }) : upDev({ ...dev3, model: "kontur", glb: undefined }))}
                  />
                </Row>
              )}
              {resolvedModel === "real" && modelFile && !duo && (
                <div className="field">
                  <label>{L("Model dosyası", "Model file")}</label>
                  <select value={modelFile} onChange={(e) => upDev({ ...dev3, glb: `/assets/models/${e.target.value}` })}>
                    {models.map((m) => (
                      <option key={m.file} value={m.file}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>{L("Kasa rengi", "Body color")}</label>
                <Swatches value={dev3.bodyColor || "#3a3a3e"} colors={BODY_COLORS} onChange={(c) => upDev({ ...dev3, bodyColor: c })} />
              </div>
              {resolvedModel === "kontur" && (
                <Advanced id="dev.kontur" label={L("Kontur ayarları", "Outline settings")}>
                  <Row label={L("Kaplama", "Finish")}>
                    <Segmented value={dev3.finish ?? "metal"} options={[{ value: "metal", label: "Metal" }, { value: "clay", label: L("Mat", "Matte") }]} onChange={(f) => upDev({ ...dev3, finish: f })} />
                  </Row>
                  <SliderRow label={L("Kalınlık", "Thickness")} defaultValue={100} value={Math.round((dev3.konturWidth ?? 1) * 100)} min={20} max={160} onChange={(v) => upDev({ ...dev3, konturWidth: v / 100 })} format={(v) => `${v}%`} />
                  <SliderRow label={L("Derinlik", "Depth")} defaultValue={100} value={Math.round((dev3.konturDepth ?? 1) * 100)} min={5} max={160} onChange={(v) => upDev({ ...dev3, konturDepth: v / 100 })} format={(v) => `${v}%`} />
                  <Toggle checked={dev3.island !== false} onChange={(v) => upDev({ ...dev3, island: v ? undefined : false })} label="Dynamic Island" />
                </Advanced>
              )}
              <button
                type="button"
                className="btn sm wide"
                onClick={() => {
                  const n = patchDeviceAllSlides({
                    model: resolvedModel,
                    bodyColor: dev3.bodyColor,
                    ...(duo ? { duoPosture: dev3.duoPosture } : {}),
                    glb: resolvedModel === "real" && modelFile && !duo ? `/assets/models/${modelFile}` : undefined,
                  });
                  pushToast({ msg: L(`Gövde ${n} slayta uygulandı · tüm diller`, `Body applied to ${n} slides · all locales`) });
                }}
              >
                <Icon name="copy" size={11} />
                {L("Gövdeyi tüm slaytlara uygula", "Apply body to all slides")}
              </button>
            </>
          ) : (
            dev2 && (
              <>
                <Row label={L("Köşeler", "Corners")}>
                  <Segmented
                    value={dev2.cornerMode ?? "device"}
                    options={[
                      { value: "device", label: L("Cihaz", "Device") },
                      { value: "custom", label: L("Özel", "Custom") },
                    ]}
                    onChange={(cornerMode) => upDev({ ...dev2, cornerMode })}
                  />
                </Row>
                {dev2.cornerMode === "custom" && <SliderRow label={L("Yarıçap", "Radius")} defaultValue={180} value={dev2.cornerRadius ?? 180} min={0} max={400} onChange={(v) => upDev({ ...dev2, cornerRadius: v })} format={(v) => `${v}px`} />}
                <p className="note">{L("Gölge ve yansıma: Sahne › Işık.", "Shadow and reflection: Scene › Light.")}</p>
              </>
            )
          )}
        </Section>
      )}
    </div>
  );
}
