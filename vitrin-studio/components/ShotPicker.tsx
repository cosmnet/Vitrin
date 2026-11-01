"use client";

// TUVAL ÜSTÜ EKRAN SEÇİCİ — v1.0. Tuvalde bir cihazın/ekranın üstüne çift
// tıklayınca imlecin yanında açılır: havuzdan tek tıkla değiştir ya da yeni
// dosya yükle. Sağdaki panele gidip yuva seçmeye gerek kalmaz.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { previewSrc } from "@/engine/media";
import { L } from "@/lib/i18n";
import { useStudio, type ShotSlot } from "@/store/studio";
import { Icon } from "./ui";
import { ingestScreenshotFiles, pickScreenshotFiles } from "./panels/shotActions";

export default function ShotPicker({ x, y, slideId, slot, label, onClose }: { x: number; y: number; slideId: string; slot: ShotSlot; label: string; onClose: () => void }) {
  const shots = useStudio((s) => s.project.screenshots);
  const current = useStudio((s) => {
    const sl = s.project.sets[s.project.activeLocale]?.slides.find((v) => v.id === slideId);
    return sl ? (slot === 1 ? sl.screenshot : slot === 2 ? sl.screenshot2 : sl.screenshot3) : undefined;
  });
  const [over, setOver] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const left = Math.min(x + 12, window.innerWidth - 330);
  const top = Math.min(Math.max(8, y - 40), window.innerHeight - 430);
  return createPortal(
    <>
      <button className="ws-menu-dismiss" aria-label={L("Kapat", "Close")} onClick={onClose} />
      <div
        className={`shot-picker ${over ? "over" : ""}`}
        style={{ left, top }}
        role="dialog"
        aria-label={L(`${label} için ekran seç`, `Choose screen for ${label}`)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void ingestScreenshotFiles(e.dataTransfer.files, { slideId, slot, force: true }).then((n) => n && onClose());
        }}
      >
        <div className="shot-picker-head">
          <Icon name="image" size={13} />
          <span>{label}</span>
          <button type="button" className="btn xs" onClick={() => (pickScreenshotFiles({ slideId, slot, force: true }, false), onClose())}>
            <Icon name="plus" size={11} />
            {L("Yükle", "Upload")}
          </button>
          {current && (
            <button type="button" className="btn xs ghost" title={L("Ekranı kaldır", "Clear screen")} onClick={() => (useStudio.getState().setSlideShot(slideId, slot, undefined), onClose())}>
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
        {shots.length === 0 ? (
          <p className="note" style={{ padding: "4px 12px 12px" }}>
            {L("Havuz boş — Yükle'ye bas ya da dosyayı buraya bırak.", "The pool is empty — press Upload or drop a file here.")}
          </p>
        ) : (
          <div className="pool-grid2">
            {shots.map((sh) => (
              <button
                key={sh.id}
                type="button"
                className={`pool-shot ${current === sh.dataUrl ? "on" : ""}`}
                title={sh.name}
                onClick={() => {
                  useStudio.getState().setSlideShot(slideId, slot, sh.dataUrl);
                  onClose();
                }}
              >
                <img src={previewSrc(sh.dataUrl)} alt={sh.name} loading="lazy" decoding="async" />
                <span className="pool-shot-name">{sh.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>,
    document.querySelector(".studio.pro") ?? document.body
  );
}
