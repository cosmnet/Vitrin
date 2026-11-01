"use client";

// STÜDYO KABUĞU — UI v3.
//
// Makro yerleşim (rapor §0, Framer/Rive/VEED/Magnific konverjansı):
//   üst bar 44px
//   ├ ikon rayı 60px (kalıcı iskelet)
//   ├ medya çekmecesi 240px — tuvalin ÜSTÜNE kayar, ASLA itmez
//   ├ tuval kuyusu (çökük, kenarlıksız) + yüzen alt araç adası
//   └ inspector 264px (2 sekme + katlanır bölümler)
//   alt film şeridi 190px
// Bölücüler sürüklenerek boyutlanır (localStorage: vitrin:ui:panels).
//
// Kısayollar (input/textarea/select/contenteditable odağında pasif):
//   ⌘K komut paleti · ⌘Z / ⇧⌘Z geri-ileri · ⌘D çoğalt · ⌘S kaydet ·
//   1-9 slayt seç · F sığdır · ok tuşları cihazı 2px (⇧ 20px) kaydırır ·
//   Esc paleti/diyaloğu kapatır.
// Kalıcılık: açılışta son proje otomatik yüklenir, düzenlemeler 2 sn
// debounce ile otomatik kaydedilir (üst barda ambient künye).

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/engine/types";
import { api } from "@/lib/client";
import { useStudio } from "@/store/studio";
import CommandPalette from "./CommandPalette";
import { ConfirmHost } from "./ConfirmDialog";
import Inspector from "./Inspector";
import LocQa from "./LocQa";
import MatrixExport from "./MatrixExport";
import LayerPanel from "./LayerPanel";
import DevicePanel from "./panels/DevicePanel";
import ScreensPanel from "./panels/ScreensPanel";
import TextPanel from "./panels/TextPanel";
import LibraryPanel from "./panels/LibraryPanel";
import { setLibraryTab } from "./panels/libraryTab";
import { DockColumn, DockResizer, FloatLayer, PanelRegistry, type PanelDef } from "./workspace/Dock";
import { focusPanel, useWorkspace, type PanelId } from "@/store/workspace";
import { PANEL_TITLES } from "./TopBar";
import Stage, { requestFitZoom } from "./Stage";
import Timeline from "./Timeline";
import TopBar from "./TopBar";
import { Divider, usePanelSizes } from "./panels";
import { loadFonts } from "@/engine/fonts";
import { Toasts } from "./toast";
import ProjectHub from "./ProjectHub";
import { writeProjectThumb } from "@/lib/projectThumb";
import {
  ExportDialog,
  GenerateDialog,
  IngestDialog,
  LocalizeDialog,
  SettingsDialog,
} from "./dialogs";
import { L } from "@/lib/i18n";

// R7/W5: "matrix" = diller × boyutlar matris export'u, "locqa" = lokalizasyon
// QA paneli. İkisi de ⌘K'da `Proje` grubunda ve matris diyaloğu QA'yı açar.
export type DialogName =
  | "generate"
  | "localize"
  | "export"
  | "matrix"
  | "locqa"
  | "projects"
  | "newproject"
  | "settings"
  | null;

const LAST_KEY = "vitrin:lastProjectId";

/** v1.0 panel kaydı — başlık, ikon ve içerik. Düzen store/workspace.ts'te. */
const PANELS: Record<PanelId, PanelDef> = {
  layers: { title: PANEL_TITLES.layers, icon: "layers", render: () => <LayerPanel /> },
  text: { title: PANEL_TITLES.text, icon: "type", render: () => <TextPanel /> },
  library: { title: PANEL_TITLES.library, icon: "grid", render: () => <LibraryPanel /> },
  scene: { title: PANEL_TITLES.scene, icon: "sun", render: () => <Inspector /> },
  device: { title: PANEL_TITLES.device, icon: "phone", render: () => <DevicePanel /> },
  screens: { title: PANEL_TITLES.screens, icon: "image", render: () => <ScreensPanel /> },
};

/** Tuval seçimi → ilgili panel öne gelir (metin → Metin, cihaz → Cihaz…). */
function panelForLayer(id: string | null): PanelId | null {
  if (!id) return null;
  if (id === "headline" || id === "sub" || id === "badge") return "text";
  if (id === "device" || id === "device2" || id === "device3" || id.startsWith("screen:")) return "device";
  if (id.startsWith("element:") || id.startsWith("theme:")) {
    const st = useStudio.getState();
    const sl = st.project.sets[st.project.activeLocale]?.slides.find((x) => x.id === st.activeSlideId);
    const el = id.startsWith("element:") ? sl?.elements?.find((e) => e.id === id.slice(8)) : null;
    return el?.kind === "text" ? "text" : "layers";
  }
  return "layers";
}

/** Yazı yazılan bir alanda mıyız? (kısayollar orada susar) */
function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  return /^(input|textarea|select)$/i.test(t.tagName || "");
}

export default function Studio({ isolated = false }: { isolated?: boolean } = {}) {
  const [dialog, setDialog] = useState<DialogName>(null);
  const [mdOpen, setMdOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [sizes, setSizes] = usePanelSizes();
  const leftW = useWorkspace((s) => s.layout.leftW);
  const rightW = useWorkspace((s) => s.layout.rightW);
  const leftEmpty = useWorkspace((s) => s.layout.left.length === 0);
  const rightEmpty = useWorkspace((s) => s.layout.right.length === 0);
  const dragging = useWorkspace((s) => s.dragging);

  useEffect(() => {
    useWorkspace.getState().hydrate();
    void loadFonts();
  }, []);

  // Tuvalde seçilen katmanın paneli öne gelir.
  useEffect(
    () =>
      useStudio.subscribe((st, prev) => {
        if (st.selectedLayerId === prev.selectedLayerId || !st.selectedLayerId) return;
        const p = panelForLayer(st.selectedLayerId);
        if (p) focusPanel(p);
      }),
    []
  );

  const openDrawer = useCallback((t: "shots" | "templates" | "images") => {
    if (t === "shots") focusPanel("screens");
    else {
      setLibraryTab(t === "templates" ? "templates" : "backgrounds");
      focusPanel("library");
    }
  }, []);

  // -------------------------------------------------------------------------
  // Klavye kısayolları
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // ⌘K her yerde çalışır (yazarken de) — komut paleti girişi budur.
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.key === "Escape") {
        setDialog(null);
        setPalette(false);
        if (!isTyping(e.target)) useStudio.getState().setSelectedLayer(null);
        return;
      }
      if (isTyping(e.target)) return;

      const st = useStudio.getState();
      const set = st.project.sets[st.project.activeLocale];
      const slides = set?.slides ?? [];
      const activeId = st.activeSlideId || slides[0]?.id;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && !st.selectedLayerId) {
        e.preventDefault();
        if (activeId) st.duplicateSlide(activeId);
        return;
      }
      if (mod) return; // kalan ⌘/Ctrl kombinasyonları tarayıcının (⌘S TopBar'da)

      // 1-9 → slayt seç
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (slides[i]) {
          e.preventDefault();
          st.setActiveSlide(slides[i].id);
        }
        return;
      }

      // T → Metin paneli
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        focusPanel("text");
        return;
      }

      // F → tuvali sığdır
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        requestFitZoom();
        return;
      }

      // Ok tuşları → cihazı kaydır (yalnızca tuval odaktayken / odak boşken)
      const arrow: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const dir = arrow[e.key];
      if (dir && activeId && !st.selectedLayerId) {
        const el = document.activeElement as HTMLElement | null;
        const inViewer =
          !el || el === document.body || !!el.closest?.('[data-viewer="1"]');
        if (!inViewer) return;
        e.preventDefault();
        const step = e.shiftKey ? 20 : 2;
        const sl = slides.find((x) => x.id === activeId);
        const o = sl?.deviceOffset || { x: 0, y: 0 };
        st.updateSlide(activeId, {
          deviceOffset: { ...o, x: o.x + dir[0] * step, y: o.y + dir[1] * step },
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -------------------------------------------------------------------------
  // Açılışta otomatik yükleme: localStorage'daki son proje id'si → API;
  // bulunamazsa listedeki en yeni proje; hiç kayıt yoksa seed ile devam.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isolated) return;
    let cancelled = false;
    const tryLoad = async (id: string | null | undefined): Promise<boolean> => {
      if (!id) return false;
      try {
        const r = await api<{ project: Project }>(`/api/projects?id=${encodeURIComponent(id)}`);
        if (cancelled || !r.project) return false;
        useStudio.getState().loadProject(r.project);
        try {
          localStorage.setItem(LAST_KEY, String(r.project.id));
        } catch {}
        return true;
      } catch {
        return false; // bulunamadı/silinmiş — listeye düş
      }
    };
    (async () => {
      const requested = new URLSearchParams(window.location.search).get("project");
      if (await tryLoad(requested)) return;
      if (cancelled) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_KEY);
      } catch {}
      if (await tryLoad(last)) return;
      if (cancelled) return;
      try {
        const r = await api<{ projects: { id: string }[] }>("/api/projects");
        await tryLoad(r.projects?.[0]?.id);
      } catch {
        /* sunucuda hiç kayıt yok — seed proje kalır */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Otomatik kayıt: aynı projede içerik değişince 2 sn debounce ile POST.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isolated) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastId = useStudio.getState().project.id;
    const unsub = useStudio.subscribe((st, prev) => {
      if (st.savedAt !== prev.savedAt && st.savedAt) {
        try {
          localStorage.setItem(LAST_KEY, st.project.id);
        } catch {}
      }
      if (st.project === prev.project) return;
      if (st.project.id !== lastId) {
        lastId = st.project.id;
        try {
          localStorage.setItem(LAST_KEY, lastId);
        } catch {}
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        const project = useStudio.getState().project;
        try {
          await api("/api/projects", { project });
          try {
            localStorage.setItem(LAST_KEY, project.id);
          } catch {}
          useStudio.setState({ savedAt: new Date().toLocaleTimeString("tr") });
          void writeProjectThumb(project);
        } catch {
          /* sessiz — ⌘S ile zorlanabilir */
        }
      }, 2000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  return (
    <PanelRegistry.Provider value={PANELS}>
    <div className="studio pro">
      <TopBar openDialog={setDialog} openPalette={() => setPalette(true)} openImport={() => setMdOpen(true)} />
      <div className="vs-body" style={{ gridTemplateRows: `1fr 5px min(${sizes.bottom}px, 34vh)` }}>
        <div
          className="vs-cols ws-cols"
          style={{
            gridTemplateColumns: `${leftEmpty ? (dragging ? "56px 0px" : "0px 0px") : `${leftW}px 4px`} minmax(320px, 1fr) ${rightEmpty ? (dragging ? "0px 56px" : "0px 0px") : `4px ${rightW}px`}`,
          }}
        >
          <DockColumn side="left" />
          {!leftEmpty ? <DockResizer side="left" /> : <span />}
          <div className="vs-center" style={{ ["--drawer-w" as string]: "0px" }}>
            <Stage
              onImport={() => setMdOpen(true)}
              onTemplates={() => openDrawer("templates")}
              onStickers={() => {
                setLibraryTab("stickers");
                focusPanel("library");
              }}
            />
          </div>
          {!rightEmpty ? <DockResizer side="right" /> : <span />}
          <DockColumn side="right" />
        </div>
        <Divider axis="y" panel="bottom" value={sizes.bottom} invert onChange={(v) => setSizes({ bottom: v })} />
        <Timeline />
      </div>
      <FloatLayer />

      {dialog === "generate" && <GenerateDialog close={() => setDialog(null)} />}
      {dialog === "localize" && <LocalizeDialog close={() => setDialog(null)} />}
      {dialog === "export" && (
        <ExportDialog close={() => setDialog(null)} openMatrix={() => setDialog("matrix")} />
      )}
      {dialog === "matrix" && (
        <MatrixExport close={() => setDialog(null)} openQa={() => setDialog("locqa")} />
      )}
      {dialog === "locqa" && <LocQa close={() => setDialog(null)} />}
      {(dialog === "projects" || dialog === "newproject") && <ProjectHub close={() => setDialog(null)} startNew={dialog === "newproject"} />}
      {dialog === "settings" && <SettingsDialog close={() => setDialog(null)} />}
      {mdOpen && <IngestDialog close={() => setMdOpen(false)} />}
      {palette && (
        <CommandPalette
          close={() => setPalette(false)}
          openDialog={(d) => setDialog(d)}
          openImport={() => setMdOpen(true)}
          openDrawer={openDrawer}
        />
      )}
      <Toasts />
      <ConfirmHost />
    </div>
    </PanelRegistry.Provider>
  );
}
