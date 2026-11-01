"use client";

// Panellerin ortak yardımcıları — aktif slayt, çoklu seçim farkında yama,
// senkron uyarısı ve dil sapma bandı. Eskiden hepsi Inspector'ın içindeydi;
// v1.0'da paneller ayrılınca tek yere toplandı.

import type { ReactNode } from "react";
import { splitPatch } from "@/engine/designsync";
import { getTheme } from "@/engine/themes";
import { formatOf, type Slide } from "@/engine/types";
import { L } from "@/lib/i18n";
import { fieldDrift, useStudio } from "@/store/studio";
import { Icon } from "../ui";
import { pushToast } from "../toast";

/** Senkron kapalıyken tasarım düzenlemesi uyarısı — dakikada en fazla bir kez. */
let lastSyncWarn = 0;
export function warnSyncOff(): void {
  const t = Date.now();
  if (t - lastSyncWarn < 60_000) return;
  lastSyncWarn = t;
  pushToast({
    msg: L("SENKRON KAPALI — bu değişiklik yalnız bu dile uygulandı", "SYNC OFF — this change was applied to this locale only"),
    action: { label: L("Senkronu aç", "Turn sync on"), run: () => useStudio.getState().setSyncDesign(true) },
  });
}

/** Aktif slayt + çoklu seçim farkında yazıcı. Slayt yoksa `slide` null. */
export function useActiveSlide() {
  const project = useStudio((s) => s.project);
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const selectedIds = useStudio((s) => s.selectedIds);
  const set = project.sets[project.activeLocale];
  const idx = set ? set.slides.findIndex((x) => x.id === activeSlideId) : -1;
  const slide: Slide | null = set ? set.slides[idx] ?? set.slides[0] ?? null : null;
  const theme = slide ? getTheme(slide.themeId) : null;
  const fmt = formatOf(project);
  const multi = selectedIds.length > 1;
  const up = (patch: Partial<Slide>, coalesceKey?: string) => {
    if (!slide) return;
    const st = useStudio.getState();
    if (st.project.syncDesign === false && Object.keys(splitPatch(patch).design).length) warnSyncOff();
    if (multi) {
      st.applyDesignToSelected(patch, {
        coalesceKey: `bulk:${selectedIds.length}:${Object.keys(patch).sort().join(",")}`,
      });
    } else {
      st.updateSlide(slide.id, patch, coalesceKey ? { coalesceKey } : undefined);
    }
  };
  return { project, set, slide, theme, fmt, idx: idx < 0 ? 0 : idx, multi, selectedIds, up };
}

export function DriftBand({ slide, fields }: { slide: Slide; fields: (keyof Slide)[] }) {
  const applyAll = useStudio((s) => s.applyDesignToAllLocales);
  const locales = useStudio((s) => Object.keys(s.project.sets).length);
  if (locales < 2) return null;
  const hit = fields.filter((f) => fieldDrift(slide, f));
  if (!hit.length) return null;
  return (
    <div className="drift-row" role="status">
      <Icon name="globe" size={11} />
      {L("Dillerden ayrıştı", "Diverged from other locales")}
      <button onClick={() => applyAll(slide.id)} title={L("Bu slaytın tasarımını tüm dillere bas", "Apply this slide's design to all locales")}>
        {L("temele dön", "revert to base")}
      </button>
    </div>
  );
}

export function PanelEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="insp-empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

/** Panel içi başlık şeridi — slayt no + ad + bağlam künyesi. */
export function SlideStrip({ idx, slide, tag }: { idx: number; slide: Slide; tag?: string }) {
  const multi = useStudio((s) => s.selectedIds.length);
  return (
    <>
      <div className="insp-slide">
        <span className="insp-no">{String(idx + 1).padStart(2, "0")}</span>
        <span className="insp-head" title={slide.headline || slide.frameLabel}>
          {slide.headline || slide.frameLabel || L("Başlıksız slayt", "Untitled slide")}
        </span>
        {tag && <span className="insp-tag">{tag}</span>}
      </div>
      {multi > 1 && (
        <div className="insp-multi">
          <Icon name="copy" size={11} />
          {L(`${multi} slayt seçili — düzenlemeler hepsine uygulanır`, `${multi} slides selected — edits apply to all of them`)}
        </div>
      )}
    </>
  );
}

/** Format bilgisi (projeyi okuyan küçük yardımcı). */
export function useFormat() {
  return formatOf(useStudio((s) => s.project));
}
