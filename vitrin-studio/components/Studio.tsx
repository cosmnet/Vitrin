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
import Inspector, { type InspectorTab } from "./Inspector";
import LocQa from "./LocQa";
import MatrixExport from "./MatrixExport";
import MediaPool, { type PoolTab } from "./MediaPool";
import Rail from "./Rail";
import LayerPanel from "./LayerPanel";
import Stage, { requestFitZoom } from "./Stage";
import Timeline from "./Timeline";
import TopBar from "./TopBar";
import { Divider, usePanelSizes } from "./panels";
import { Toasts } from "./toast";
import {
  ExportDialog,
  GenerateDialog,
  IngestDialog,
  LocalizeDialog,
  ProjectsDialog,
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
  | "settings"
  | null;

const LAST_KEY = "vitrin:lastProjectId";
const DRAWER_KEY = "vitrin:ui:drawer";

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
  const [poolTab, setPoolTab] = useState<PoolTab>("templates");
  const [drawer, setDrawer] = useState(true);
  const [inspTab, setInspTab] = useState<InspectorTab>("design");
  const [sizes, setSizes] = usePanelSizes();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const layerPanelOpen = useStudio(s => s.layerPanelOpen);
  const rightVisible = !layerPanelOpen || settingsOpen;
  const shotCount = useStudio((s) => s.project.screenshots.length);

  // Çekmecenin açık/kapalı hâli oturumlar arası hatırlanır (ray kalıcı).
  useEffect(() => {
    if (isolated) return;
    try {
      const raw = localStorage.getItem(DRAWER_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { open?: boolean; tab?: PoolTab };
        if (v.tab && ["shots","templates","images"].includes(v.tab)) setPoolTab(v.tab);
        setDrawer(!!v.open);
      }
    } catch {
      /* localStorage kapalı olabilir */
    }
  }, []);
  useEffect(() => {
    if (isolated) return;
    try {
      localStorage.setItem(DRAWER_KEY, JSON.stringify({ open: drawer, tab: poolTab }));
    } catch {
      /* yoksay */
    }
  }, [drawer, poolTab]);

  /** Ray tıklaması: farklı sekme → aç ve geç · aynı sekme → kapat. */
  const pickTab = useCallback(
    (t: PoolTab) => {
      if (drawer && poolTab === t) {
        setDrawer(false);
        return;
      }
      useStudio.getState().setLayerPanelOpen(false);
      setPoolTab(t);
      setDrawer(true);
    },
    [drawer, poolTab]
  );
  const openDrawer = useCallback((t: PoolTab) => {
    useStudio.getState().setLayerPanelOpen(false);
    setPoolTab(t);
    setDrawer(true);
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
    <div className="studio">
      <TopBar
        openDialog={setDialog}
        openPalette={() => setPalette(true)}
        openImport={() => setMdOpen(true)}
      />
      {/* Film şeridi kısa pencerede tuvali boğmasın: 34vh tavanı. */}
      <div
        className="vs-body"
        style={{ gridTemplateRows: `1fr 6px min(${sizes.bottom}px, 34vh)` }}
      >
        <div
          className="vs-cols"
          style={{
            gridTemplateColumns: `var(--rail-w) minmax(320px, 1fr) ${rightVisible ? `6px ${sizes.right}px` : "0px 0px"}`,
          }}
        >
          <Rail
            tab={poolTab}
            open={drawer && !layerPanelOpen}
            layersOpen={layerPanelOpen}
            onLayers={() => { const st = useStudio.getState(); st.setLayerPanelTab("layers"); st.setLayerPanelOpen(!layerPanelOpen); }}
            onBackground={() => useStudio.getState().setSelectedLayer("background")}
            onPick={pickTab}
            onPalette={() => setPalette(true)}
            onSettings={() => setDialog("settings")}
            shotCount={shotCount}
          />
          <div
            className="vs-center"
            // Kuyu künyesi çekmece açıkken onun sağından başlasın diye
            // genişlik CSS değişkeni olarak aşağı geçirilir.
            style={{ ["--drawer-w" as string]: (drawer || layerPanelOpen) ? `${Math.max(layerPanelOpen ? 310 : 200, sizes.left)}px` : "0px" }}
          >
            {layerPanelOpen && <button className={`canvas-settings-toggle ${settingsOpen ? "on" : ""}`} aria-pressed={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>{L("Genel ayarlar", "General settings")}</button>}
            <Stage
              onImport={() => setMdOpen(true)}
              onTemplates={() => openDrawer("templates")}
              onStickers={() => openDrawer("images")}
            />
            {layerPanelOpen ? (
              <>
                <LayerPanel width={Math.max(310, sizes.left)} onClose={() => useStudio.getState().setLayerPanelOpen(false)} />
                <Divider axis="x" panel="left" className="drawer-grip" style={{ left: Math.max(310, sizes.left) - 3 }} value={Math.max(310, sizes.left)} onChange={v => setSizes({ left: v })} />
              </>
            ) : drawer && (
              <>
                <MediaPool tab={poolTab} width={sizes.left} onClose={() => setDrawer(false)} />
                <Divider
                  axis="x"
                  panel="left"
                  className="drawer-grip"
                  style={{ left: sizes.left - 3 }}
                  value={sizes.left}
                  onChange={(v) => setSizes({ left: v })}
                />
              </>
            )}
          </div>
          {rightVisible && <Divider
            axis="x"
            panel="right"
            value={sizes.right}
            invert
            onChange={(v) => setSizes({ right: v })}
          />
          }
          {rightVisible && <Inspector tab={inspTab} setTab={setInspTab} />}
        </div>
        <Divider
          axis="y"
          panel="bottom"
          value={sizes.bottom}
          invert
          onChange={(v) => setSizes({ bottom: v })}
        />
        <Timeline />
      </div>

      {dialog === "generate" && <GenerateDialog close={() => setDialog(null)} />}
      {dialog === "localize" && <LocalizeDialog close={() => setDialog(null)} />}
      {dialog === "export" && (
        <ExportDialog close={() => setDialog(null)} openMatrix={() => setDialog("matrix")} />
      )}
      {dialog === "matrix" && (
        <MatrixExport close={() => setDialog(null)} openQa={() => setDialog("locqa")} />
      )}
      {dialog === "locqa" && <LocQa close={() => setDialog(null)} />}
      {dialog === "projects" && <ProjectsDialog close={() => setDialog(null)} />}
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
  );
}
