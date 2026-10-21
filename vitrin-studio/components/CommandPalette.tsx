"use client";

// ⌘K KOMUT PALETİ (rapor §6).
//
// Kalıplar canlı referanslardan: Magnific'in gruplu sonuçları + mono kısayol
// ipuçları + alt lejant şeridi, Juicebox'ın dolu blok yerine 3px SOL BANDI,
// Vapi/StackAI'ın iki-parçalı satırları. Panel üstten %18'e demirli (hiçbiri
// ortalamıyor), 640px.
//
// Kapsam: şablon uygula · tema uygula · slayt ekle/çoğalt/sil · dil değiştir
// · kadraj değiştir · senkron aç/kapat · export · MD içe aktar · stüdyo ve
// landing bağlantıları. Alt listeler (şablon/tema/dil/kadraj) aynı pencerede
// "sayfa" olarak açılır — modal üstüne modal yok.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYOUTS } from "@/engine/layouts";
import { patchForTheme, restyleSlides, TEMPLATES } from "@/engine/templates";
import { THEMES } from "@/engine/themes";
import type { LayoutId } from "@/engine/types";
import { useStudio } from "@/store/studio";
import { confirmUi } from "./ConfirmDialog";
import type { DialogName } from "./Studio";
import { requestVideoTab } from "./dialogs";
import { pushUndoToast } from "./toast";
import { Icon, type IconName } from "./ui";
import { L } from "@/lib/i18n";

export type PaletteAction = {
  id: string;
  group: string;
  label: string;
  icon?: IconName;
  hint?: string;
  sub?: string;
  run: () => void;
};

type Page = "root" | "template" | "theme" | "locale" | "layout";

const LAYOUT_LABELS: Record<LayoutId, string> = {
  "text-top": L("Metin üstte", "Text on top"),
  "text-bottom": L("Metin altta", "Text at bottom"),
  "device-bleed-bottom": L("Hero — alttan taşar", "Hero — bleeds off bottom"),
  "device-bleed-top": L("Cihaz üstten taşar", "Device bleeds off top"),
  "text-overlay": L("Metin cihaz üstünde", "Text over device"),
  "badge-hero": L("Rozet + hero", "Badge + hero"),
  "split-diagonal": L("Diyagonal", "Diagonal"),
  "split-v": L("Bölünmüş (dikey)", "Split (vertical)"),
  "split-h": L("Bölünmüş (yatay)", "Split (horizontal)"),
  "duo-overlap": L("İkili — bindirmeli", "Duo — overlapping"),
  "duo-depth": L("İkili — derinlikli", "Duo — depth"),
  "duo-dutch": L("İkili — karşıt eğim", "Duo — opposing tilt"),
  "duo-hero-aside": L("İkili — kahraman + destek", "Duo — hero + support"),
  "duo-stagger": L("İkili — kaydırmalı, metin solda", "Duo — staggered, text on left"),
  "duo-bleed-sides": L("İkili — yanlardan taşan", "Duo — bleeding off sides"),
  "duo-editorial": L("İkili — editöryel, metin solda", "Duo — editorial, text on left"),
  "duo-pip": L("İkili — inset (resim içinde resim)", "Duo — inset (picture-in-picture)"),
  diptych: L("Çift kare — telefonsuz", "Dual frame — no phone"),
  "screen-card": L("Kart ekran — telefonsuz", "Card screen — no phone"),
  "pano-left": L("Panorama sol — sağdan taşar", "Panorama left — bleeds off right"),
  "pano-right": L("Panorama sağ — soldan taşar", "Panorama right — bleeds off left"),
  "wide-left": L("Yatay — metin solda", "Wide — text on left"),
  "wide-right": L("Yatay — metin sağda", "Wide — text on right"),
  "wide-hero": L("Yatay — tam ekran hero", "Wide — full-screen hero"),
  "trio-arc": L("Üçlü — yay", "Trio — arc"),
  "trio-stack": L("Üçlü — kademeli", "Trio — staggered"),
  "panorama-mid": L("Panorama orta", "Panorama center"),
};

function norm(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c");
}

export default function CommandPalette({
  close,
  openDialog,
  openImport,
  openDrawer,
}: {
  close: () => void;
  openDialog: (d: NonNullable<DialogName>) => void;
  openImport: () => void;
  openDrawer: (t: "shots" | "templates" | "images") => void;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const project = useStudio((s) => s.project);

  const actions = useMemo<PaletteAction[]>(() => {
    const st = useStudio.getState();
    const p = st.project;
    const set = p.sets[p.activeLocale];
    const slides = set?.slides ?? [];
    const activeId = st.activeSlideId || slides[0]?.id;
    const active = slides.find((s) => s.id === activeId);
    const multi = Object.keys(p.sets).length > 1;
    const syncOn = p.syncDesign !== false;

    if (page === "template") {
      return TEMPLATES.map((t) => ({
        id: `tpl.${t.id}`,
        group: L("Şablonlar", "Templates"),
        label: t.name,
        sub: t.hint,
        icon: "layers" as IconName,
        run: async () => {
          const fresh = slides.length === 0;
          const message = fresh
            ? L(`"${t.name}" şablonundan ${t.defaultCount} slaytlık örnek set kurulacak (${p.activeLocale}). Devam edilsin mi?`, `A ${t.defaultCount}-slide sample set will be built from the "${t.name}" template (${p.activeLocale}). Continue?`)
            : L(`${p.activeLocale} dilindeki ${slides.length} slaytta metinler ve ekran görüntüleri korunacak. Tema ve kadraj "${t.name}" ile değişecek; özel cihaz, arka plan, yazı stili ve konum ayarları sıfırlanacak. Devam edilsin mi?`, `In the ${slides.length} slides of ${p.activeLocale}, texts and screenshots will be kept. Theme and layout will change to "${t.name}"; custom device, background, text style and position settings will be reset. Continue?`);
          if (!(await confirmUi({ title: L("Şablon uygula", "Apply template"), message, okLabel: L("Devam et", "Continue") }))) return;
          st.mutate((pp) => {
            const s = pp.sets[pp.activeLocale];
            if (s) s.slides = fresh ? t.build() : restyleSlides(s.slides, t.id);
            return pp;
          });
          if (!fresh && useStudio.getState().project.syncDesign) {
            useStudio.getState().applyDesignToAllLocales();
          }
          pushUndoToast(L(`ŞABLON UYGULANDI · ${t.name.toUpperCase()}`, `TEMPLATE APPLIED · ${t.name.toUpperCase()}`));
        },
      }));
    }
    if (page === "theme") {
      return THEMES.map((t) => ({
        id: `thm.${t.id}`,
        group: L("Temalar", "Themes"),
        label: t.name,
        icon: "palette" as IconName,
        sub: active?.themeId === t.id ? L("şu an", "current") : undefined,
        run: () => {
          if (!activeId) return;
          const sel = useStudio.getState().selectionIds();
          if (sel.length > 1) {
            st.mutate(p=> { const set=p.sets[p.activeLocale]; if(set) set.slides=set.slides.map(s=>sel.includes(s.id)?{...s,...patchForTheme(s,t.id,p.format??"iphone")}:s); return p; });
            if (p.syncDesign !== false) useStudio.getState().applyDesignToAllLocales();
            pushUndoToast(L(`TEMA UYGULANDI · ${sel.length} SLAYT`, `THEME APPLIED · ${sel.length} SLIDES`));
          } else {
            const current = p.sets[p.activeLocale]?.slides.find(s=>s.id===activeId);
            if (current) st.updateSlide(activeId, patchForTheme(current,t.id,p.format??"iphone"));
          }
        },
      }));
    }
    if (page === "locale") {
      return Object.keys(p.sets).map((l) => ({
        id: `loc.${l}`,
        group: L("Diller", "Locales"),
        label: l.toUpperCase(),
        icon: "globe" as IconName,
        sub: L(`${p.sets[l].slides.length} slayt`, `${p.sets[l].slides.length} slides`),
        hint: l === p.activeLocale ? L("aktif", "active") : undefined,
        run: () => st.setLocale(l),
      }));
    }
    if (page === "layout") {
      return (Object.keys(LAYOUTS) as LayoutId[]).map((l) => ({
        id: `lay.${l}`,
        group: L("Kadrajlar", "Layouts"),
        label: LAYOUT_LABELS[l],
        icon: "grid" as IconName,
        hint: active?.layout === l ? L("aktif", "active") : undefined,
        run: () => activeId && st.updateSlide(activeId, { layout: l }),
      }));
    }

    return [
      {
        id: "slide.add",
        group: L("Slayt", "Slide"),
        label: L("Slayt ekle", "Add slide"),
        icon: "plus",
        run: () => st.addSlide(),
      },
      {
        id: "slide.addall",
        group: L("Slayt", "Slide"),
        label: L("Slaytı tüm dillere ekle", "Add slide to all locales"),
        icon: "globe",
        sub: multi ? undefined : L("tek dil", "single locale"),
        run: () => st.addSlideAllLocales(active?.designKey),
      },
      {
        id: "slide.dup",
        group: L("Slayt", "Slide"),
        label:
          useStudio.getState().selectionIds().length > 1
            ? L(`Seçili ${useStudio.getState().selectionIds().length} slaytı çoğalt`, `Duplicate ${useStudio.getState().selectionIds().length} selected slides`)
            : L("Aktif slaytı çoğalt", "Duplicate active slide"),
        icon: "copy",
        hint: "⌘D",
        run: () => {
          const sel = useStudio.getState().selectionIds();
          if (sel.length > 1) useStudio.getState().duplicateSelected();
          else if (activeId) st.duplicateSlide(activeId);
        },
      },
      {
        id: "slide.del",
        group: L("Slayt", "Slide"),
        label:
          useStudio.getState().selectionIds().length > 1
            ? L(`Seçili ${useStudio.getState().selectionIds().length} slaytı sil`, `Delete ${useStudio.getState().selectionIds().length} selected slides`)
            : L("Aktif slaytı sil", "Delete active slide"),
        icon: "trash",
        run: () => {
          const sel = useStudio.getState().selectionIds();
          if (sel.length > 1) {
            useStudio.getState().removeSelected();
            pushUndoToast(L(`${sel.length} SLAYT SİLİNDİ`, `${sel.length} SLIDES DELETED`));
            return;
          }
          if (!activeId || slides.length <= 1) return;
          st.removeSlide(activeId);
          pushUndoToast(L("SLAYT SİLİNDİ", "SLIDE DELETED"));
        },
      },
      {
        id: "slide.layout",
        group: L("Slayt", "Slide"),
        label: L("Kadrajı değiştir…", "Change layout…"),
        icon: "grid",
        hint: "→",
        run: () => {
          setPage("layout");
          setQ("");
          setI(0);
        },
      },

      {
        id: "des.template",
        group: L("Tasarım", "Design"),
        label: L("Şablon uygula…", "Apply template…"),
        icon: "layers",
        hint: "→",
        run: () => {
          setPage("template");
          setQ("");
          setI(0);
        },
      },
      {
        id: "des.theme",
        group: L("Tasarım", "Design"),
        label: L("Tema uygula…", "Apply theme…"),
        icon: "palette",
        hint: "→",
        run: () => {
          setPage("theme");
          setQ("");
          setI(0);
        },
      },
      {
        id: "des.applyall",
        group: L("Tasarım", "Design"),
        label: L("Tasarımı tüm dillere uygula", "Apply design to all locales"),
        icon: "globe",
        run: () => st.applyDesignToAllLocales(activeId || undefined),
      },
      {
        // R9: "bu slaytın tasarımı" → aktif dildeki TÜM slaytlar + tüm diller.
        id: "des.applyallslides",
        group: L("Tasarım", "Design"),
        label: L("Tasarımı tüm slaytlara uygula", "Apply design to all slides"),
        icon: "copy",
        sub: L("bu slaytın giysisi · her slayt, her dil", "this slide's styling · every slide, every locale"),
        run: () => {
          const n = st.applyDesignToAllSlides(undefined, activeId || undefined);
          pushUndoToast(L(`${String(n).padStart(2, "0")} SLAYTA UYGULANDI`, `APPLIED TO ${String(n).padStart(2, "0")} SLIDES`));
        },
      },
      {
        id: "des.sync",
        group: L("Tasarım", "Design"),
        label: syncOn ? L("Senkronu kapat", "Turn sync off") : L("Senkronu aç", "Turn sync on"),
        icon: "rotate",
        sub: syncOn ? L("şu an açık", "currently on") : L("şu an kapalı", "currently off"),
        run: () => st.setSyncDesign(!syncOn),
      },

      {
        id: "loc.switch",
        group: L("Dil", "Locale"),
        label: L("Dil değiştir…", "Switch locale…"),
        icon: "globe",
        hint: "→",
        run: () => {
          setPage("locale");
          setQ("");
          setI(0);
        },
      },
      {
        id: "loc.add",
        group: L("Dil", "Locale"),
        label: L("Yeni dil ekle", "Add new locale"),
        icon: "plus",
        run: () => {
          const code = window.prompt(L("Dil kodu (ör. en, de, ar):", "Language code (e.g. en, de, ar):"));
          if (code) st.addLocale(code.trim().toLowerCase());
        },
      },
      {
        id: "loc.translate",
        group: L("Dil", "Locale"),
        label: L("Lokalize et (çeviri)", "Localize (translate)"),
        icon: "globe",
        run: () => openDialog("localize"),
      },

      {
        id: "prj.import",
        group: L("Proje", "Project"),
        label: L("MD içe aktar", "Import MD"),
        icon: "download",
        run: openImport,
      },
      {
        id: "prj.export",
        group: L("Proje", "Project"),
        label: L("Export — PNG bas", "Export — render PNGs"),
        icon: "download",
        run: () => openDialog("export"),
      },
      {
        id: "prj.export.video",
        group: L("Proje", "Project"),
        label: L("Video export…", "Video export…"),
        icon: "film",
        sub: L("app preview · 886×1920 · 15-30 sn", "app preview · 886×1920 · 15-30 s"),
        run: () => {
          // Export diyaloğu VİDEO sekmesinde açılsın (tek atımlık bayrak).
          requestVideoTab();
          openDialog("export");
        },
      },
      {
        id: "prj.export.matrix",
        group: L("Proje", "Project"),
        label: L("Matris export…", "Matrix export…"),
        icon: "grid",
        sub: multi ? L(`${Object.keys(p.sets).length} dil × 3 boyut`, `${Object.keys(p.sets).length} locales × 3 sizes`) : L("diller × boyutlar", "locales × sizes"),
        run: () => openDialog("matrix"),
      },
      {
        id: "prj.export.qa",
        group: L("Proje", "Project"),
        label: L("Lokalizasyon QA…", "Localization QA…"),
        icon: "globe",
        sub: L("tofu · taşma · eksik çeviri · RTL", "tofu · overflow · missing translation · RTL"),
        run: () => openDialog("locqa"),
      },
      {
        id: "prj.generate",
        group: L("Proje", "Project"),
        label: L("Otomatik plan üret", "Generate auto plan"),
        icon: "sparkle",
        run: () => openDialog("generate"),
      },
      {
        id: "prj.projects",
        group: L("Proje", "Project"),
        label: L("Projeler", "Projects"),
        icon: "folder",
        run: () => openDialog("projects"),
      },
      {
        id: "prj.settings",
        group: L("Proje", "Project"),
        label: L("Ayarlar", "Settings"),
        icon: "sliders",
        sub: L("API anahtarları · sürüm", "API keys · version"),
        run: () => openDialog("settings"),
      },
      {
        id: "prj.shots",
        group: L("Proje", "Project"),
        label: L("Ekran çekmecesini aç", "Open screens drawer"),
        icon: "image",
        run: () => openDrawer("shots"),
      },
      {
        id: "prj.undo",
        group: L("Proje", "Project"),
        label: L("Geri al", "Undo"),
        icon: "undo",
        hint: "⌘Z",
        run: () => st.undo(),
      },

      {
        id: "nav.studio",
        group: L("Bağlantı", "Links"),
        label: L("Stüdyo", "Studio"),
        icon: "link",
        sub: "/studio",
        run: () => {
          window.location.href = "/studio";
        },
      },
      {
        id: "nav.landing",
        group: L("Bağlantı", "Links"),
        label: L("Landing", "Landing"),
        icon: "link",
        sub: "/",
        run: () => {
          window.location.href = "/";
        },
      },
    ];
    // project bağımlılığı: aktif slayt/dil değişince eylem etiketleri tazelensin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, project, openDialog, openImport, openDrawer]);

  const shown = useMemo(() => {
    if (!q.trim()) return actions;
    const n = norm(q.trim());
    return actions.filter(
      (a) => norm(a.label).includes(n) || norm(a.group).includes(n) || norm(a.sub || "").includes(n)
    );
  }, [q, actions]);

  useEffect(() => {
    setI(0);
  }, [q, page]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const runAt = (n: number) => {
    const a = shown[n];
    if (!a) return;
    const isPage = a.hint === "→";
    a.run();
    if (!isPage) close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((v) => Math.min(shown.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(i);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (page !== "root") {
        setPage("root");
        setQ("");
      } else close();
    } else if (e.key === "Backspace" && !q && page !== "root") {
      e.preventDefault();
      setPage("root");
    }
  };

  if (typeof document === "undefined") return null;

  let lastGroup = "";
  return createPortal(
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-label={L("Komut paleti", "Command palette")}>
        <div className="pal-in">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            placeholder={
              page === "root"
                ? L("komut ara — şablon, tema, dil, export…", "search commands — template, theme, locale, export…")
                : page === "template"
                  ? L("şablon ara…", "search templates…")
                  : page === "theme"
                    ? L("tema ara…", "search themes…")
                    : page === "locale"
                      ? L("dil ara…", "search locales…")
                      : L("kadraj ara…", "search layouts…")
            }
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="esc">{page === "root" ? "ESC" : L("← GERİ", "← BACK")}</span>
        </div>
        <div className="pal-list" ref={listRef}>
          {shown.length === 0 && <p className="pal-empty">{L("Eşleşen komut yok.", "No matching commands.")}</p>}
          {shown.map((a, n) => {
            const head = a.group !== lastGroup ? a.group : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {head && <div className="pal-group">{head}</div>}
                <button
                  data-i={n}
                  className={`pal-row ${n === i ? "on" : ""}`}
                  onMouseEnter={() => setI(n)}
                  onClick={() => runAt(n)}
                >
                  <span className="ic">{a.icon && <Icon name={a.icon} size={14} />}</span>
                  <span className="lbl">{a.label}</span>
                  {a.sub && <span className="sub">{a.sub}</span>}
                  {a.hint && <span className="hint">{a.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot">
          <span>{L("↑↓ gezin", "↑↓ navigate")}</span>
          <span>{L("↵ seç", "↵ select")}</span>
          <span>{L("esc kapat", "esc close")}</span>
          <span className="sp" />
          <span>{String(shown.length).padStart(2, "0")} {L("komut", "commands")}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
