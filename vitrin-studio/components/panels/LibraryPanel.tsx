"use client";

// KÜTÜPHANE PANELİ — v1.0. Hazır içeriğin tek evi:
//   Şablonlar (tema + kadraj seti) · Temalar · Zeminler · Sticker
// Eskiden temalar hem soldaki çekmecede hem sağdaki "Sahne" sekmesindeydi.

import { patchForTheme } from "@/engine/templates";
import { L } from "@/lib/i18n";
import { ThemeCards } from "../Inspector";
import { ImagesTab, TemplatesTab } from "../MediaPool";
import { useActiveSlide } from "./common";
import { useLibraryTab, type LibraryTab } from "./libraryTab";

const TABS: { id: LibraryTab; label: string }[] = [
  { id: "templates", label: L("Şablonlar", "Templates") },
  { id: "themes", label: L("Temalar", "Themes") },
  { id: "backgrounds", label: L("Zeminler", "Backgrounds") },
  { id: "stickers", label: L("Sticker", "Stickers") },
];

export default function LibraryPanel() {
  const tab = useLibraryTab((s) => s.tab);
  const setTab = useLibraryTab((s) => s.set);
  const { slide, set, fmt, up, project } = useActiveSlide();
  return (
    <div className="panel-scroll">
      <div className="sub-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="pool-body">
        {tab === "templates" && <TemplatesTab />}
        {tab === "themes" && slide && (
          <ThemeCards sample={set?.slides[0]} value={slide.themeId} format={fmt} onPick={(id) => up(patchForTheme(slide, id, project.format ?? "iphone"))} />
        )}
        {tab === "backgrounds" && <ImagesTab slide={slide ?? undefined} only="bg" />}
        {tab === "stickers" && <ImagesTab slide={slide ?? undefined} only="stickers" />}
      </div>
    </div>
  );
}
