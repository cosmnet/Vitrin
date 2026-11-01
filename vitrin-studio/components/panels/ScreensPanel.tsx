"use client";

// EKRANLAR PANELİ — v1.0. Ekran görüntüsü havuzunun TEK evi (soldaki eski
// "Ekranlar" çekmecesi ve Inspector'daki ikinci ızgara kaldırıldı).
//
//   Hedef     hangi cihaza atanacak — tuvaldeki seçimle aynı
//   Yükleme   bırak / seç; tercihler: seçili cihaza ata, slaytlara dağıt
//   Havuz     tıkla = ata · sağ tık = yuva seç / sil · sürükle = tuvaldeki cihaza

import { useMemo, useState } from "react";
import { previewSrc } from "@/engine/media";
import { L } from "@/lib/i18n";
import { useStudio, type ShotSlot } from "@/store/studio";
import { confirmUi } from "../ConfirmDialog";
import { ContextMenu } from "../ContextMenu";
import { Icon, Toggle } from "../ui";
import { PanelEmpty, useActiveSlide } from "./common";
import { shotOf, slotLabel, useDeviceSlot } from "./deviceSlots";
import { ingestScreenshotFiles, pickScreenshotFiles, useUploadPrefs } from "./shotActions";

export const SHOT_DRAG_TYPE = "text/vitrin-shot";

export default function ScreensPanel() {
  const { project, slide, fmt } = useActiveSlide();
  const { slot, nos, pick } = useDeviceSlot(slide, fmt);
  const setSlideShot = useStudio((s) => s.setSlideShot);
  const removeScreenshot = useStudio((s) => s.removeScreenshot);
  const fanOutShot = useStudio((s) => s.fanOutShot);
  const swapSlideShots = useStudio((s) => s.swapSlideShots);
  const prefs = useUploadPrefs();
  const [over, setOver] = useState(false);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; src: string } | null>(null);

  const shots = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return needle ? project.screenshots.filter((s) => s.name.toLocaleLowerCase("tr").includes(needle)) : project.screenshots;
  }, [project.screenshots, q]);

  if (!slide) return <PanelEmpty title={L("Slayt yok", "No slide")}>{L("Önce bir slayt seç.", "Pick a slide first.")}</PanelEmpty>;

  /** Görselin kullanıldığı slayt sayısı (aktif dil). */
  const usage = (src: string) => project.sets[project.activeLocale]?.slides.filter((s) => s.screenshot === src || s.screenshot2 === src || s.screenshot3 === src).length ?? 0;
  const assigned = (src: string) => nos.filter((n) => shotOf(slide, n) === src);
  const locales = Object.keys(project.sets).length;

  return (
    <div className="panel-scroll pad">
      {/* ---------------- Hedef ---------------- */}
      <div className="pane-label">{L("Hedef", "Target")}</div>
      <div className="slot-chips" role="tablist">
        {nos.map((n) => {
          const s = shotOf(slide, n);
          return (
            <button key={n} type="button" role="tab" aria-selected={slot === n} className={`slot-chip ${slot === n ? "on" : ""}`} onClick={() => pick(n)}>
              <span className="slot-chip-img">{s ? <img src={previewSrc(s)} alt="" /> : <Icon name="plus" size={12} />}</span>
              <span>{slotLabel(slide, fmt, n)}</span>
              {s && (
                <i
                  className="slot-chip-x"
                  role="button"
                  aria-label={L("Temizle", "Clear")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlideShot(slide.id, n, undefined);
                  }}
                >
                  <Icon name="x" size={9} />
                </i>
              )}
            </button>
          );
        })}
      </div>
      {nos.length > 1 && slot > 1 && shotOf(slide, slot) && (
        <button type="button" className="btn sm wide" onClick={() => swapSlideShots(slide.id, 1, slot)}>
          <Icon name="rotate" size={11} />
          {L(`${slotLabel(slide, fmt, slot)} ↔ ${slotLabel(slide, fmt, 1)} yer değiştir`, `Swap ${slotLabel(slide, fmt, slot)} ↔ ${slotLabel(slide, fmt, 1)}`)}
        </button>
      )}

      {/* ---------------- Yükleme ---------------- */}
      <div className="pane-label">{L("Yükle", "Upload")}</div>
      <div
        className={`drop-zone ${over ? "over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => pickScreenshotFiles({ slideId: slide.id, slot })}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pickScreenshotFiles({ slideId: slide.id, slot })}
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
          void ingestScreenshotFiles(e.dataTransfer.files, { slideId: slide.id, slot });
        }}
      >
        <Icon name="download" size={20} />
        <b>{L("Ekran görüntülerini bırak", "Drop screenshots")}</b>
        <small>{L("ya da tıkla · PNG, JPG, WEBP", "or click · PNG, JPG, WEBP")}</small>
      </div>
      <div className="pref-box">
        <Toggle checked={prefs.assign} onChange={(v) => prefs.set({ assign: v })} label={L(`Yüklenince ${slotLabel(slide, fmt, slot)}'e ata`, `Assign to ${slotLabel(slide, fmt, slot)} on upload`)} />
        <Toggle checked={prefs.distribute} onChange={(v) => prefs.set({ distribute: v })} label={L("Çok dosyayı sıradaki slaytlara dağıt", "Spread multiple files across next slides")} />
      </div>

      {/* ---------------- Havuz ---------------- */}
      <div className="pane-label row">
        <span>
          {L("Havuz", "Pool")} <em>{project.screenshots.length}</em>
        </span>
        {project.screenshots.length > 8 && (
          <input className="pane-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Ara…", "Search…")} aria-label={L("Ekran ara", "Search screens")} />
        )}
      </div>
      {project.screenshots.length === 0 ? (
        <p className="note">{L("Havuz boş. Yukarıya dosya bırak ya da tuvaldeki cihazın üstüne sürükle.", "The pool is empty. Drop files above or onto a device on the canvas.")}</p>
      ) : (
        <div className="pool-grid2">
          {shots.map((sh) => {
            const at = assigned(sh.dataUrl);
            const used = usage(sh.dataUrl);
            return (
              <button
                key={sh.id}
                type="button"
                className={`pool-shot ${at.includes(slot) ? "on" : at.length ? "on2" : ""}`}
                title={L(`${sh.name} — tıkla: ${slotLabel(slide, fmt, slot)} · sağ tık: seçenekler · sürükle: tuvaldeki cihaza`, `${sh.name} — click: ${slotLabel(slide, fmt, slot)} · right click: options · drag: onto a device`)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(SHOT_DRAG_TYPE, sh.dataUrl)}
                onClick={() => setSlideShot(slide.id, slot, sh.dataUrl)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id: sh.id, src: sh.dataUrl });
                }}
              >
                <img src={previewSrc(sh.dataUrl)} alt={sh.name} loading="lazy" decoding="async" />
                <span className="pool-shot-name">{sh.name}</span>
                {at.length > 0 && (
                  <span className="pool-shot-tags">
                    {at.map((n) => (
                      <i key={n}>{n}</i>
                    ))}
                  </span>
                )}
                {used > 0 && !at.length && <span className="pool-shot-used">{used}×</span>}
              </button>
            );
          })}
        </div>
      )}

      {locales > 1 && (
        <>
          <p className="note">
            <Icon name="globe" size={10} /> {L(`${project.activeLocale} görselleri — seçim diğer dillere kendi dosyasıyla yayılır.`, `${project.activeLocale} images — the selection spreads to other locales with their own file.`)}
          </p>
          <button type="button" className="btn sm wide" onClick={() => nos.forEach((n) => fanOutShot(slide.id, n))}>
            <Icon name="globe" size={11} />
            {L(`Bu slaydın ekranlarını ${locales - 1} dile yeniden yay`, `Re-spread this slide's screens to ${locales - 1} locales`)}
          </button>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          close={() => setMenu(null)}
          items={[
            { kind: "head", label: L("Ata", "Assign") },
            ...nos.map((n) => ({
              kind: "item" as const,
              label: slotLabel(slide, fmt, n as ShotSlot),
              icon: "phone" as const,
              hint: shotOf(slide, n) === menu.src ? L("atanmış", "assigned") : undefined,
              run: () => setSlideShot(slide.id, n, menu.src),
            })),
            { kind: "sep" },
            {
              kind: "item",
              label: L("Havuzdan kaldır", "Remove from pool"),
              icon: "trash",
              danger: true,
              run: async () => {
                const n = usage(menu.src);
                if (n && !(await confirmUi({ title: L("Ekranı kaldır", "Remove screen"), message: L(`Bu görsel ${n} slaytta kullanılıyor. Havuzdan kaldırılsın mı? (Slaytlardaki atama kalır.)`, `This image is used on ${n} slides. Remove it from the pool? (Assignments stay.)`), okLabel: L("Kaldır", "Remove"), danger: true })))
                  return;
                removeScreenshot(menu.id);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
