"use client";

// ÜST BAR — v1.0 menü çubuğu (After Effects / Photoshop düzeni).
//
//   [marka] Dosya Düzen Metin Pencere Yardım │ proje · dil · format · senkron
//   ………………………………………………………… kayıt künyesi · geri/ileri · [Dışa aktar]
//
// Eski sürümde aynı işlem dört yerde duruyordu (ghost butonlar, "Araçlar"
// menüsü, ray, ⌘K). Artık her komutun tek bir menü yeri var; ⌘K paleti
// kısayol olarak kalır.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useStudio } from "@/store/studio";
import { ALL_PANELS, panelLocation, useWorkspace, type PanelId } from "@/store/workspace";
import FormatPicker from "./FormatPicker";
import { Icon } from "./ui";
import type { DialogName } from "./Studio";
import { L } from "@/lib/i18n";
import { pushToast } from "./toast";

export const SHORTCUTS: [string, string][] = [
  ["⌘K", L("Komut paleti", "Command palette")],
  ["⌘O", L("Projeler", "Projects")],
  ["⌘E", L("Dışa aktar", "Export")],
  ["⌘Z / ⇧⌘Z", L("Geri al / ileri al", "Undo / redo")],
  ["⌘D", L("Aktif slaytı çoğalt", "Duplicate active slide")],
  ["⌘S", L("Şimdi kaydet", "Save now")],
  ["1 – 9", L("Slayt seç", "Select slide")],
  ["F", L("Tuvali sığdır", "Fit canvas")],
  ["T", L("Metin paneli", "Text panel")],
  ["← ↑ → ↓", L("Seçiliyi 2px kaydır (⇧ ile 20px)", "Nudge selection 2px (20px with ⇧)")],
  [L("Tekerlek", "Wheel"), L("Tuvali kaydır", "Scroll canvas")],
  [L("⌘ + tekerlek", "⌘ + wheel"), L("İmleç altına zoom", "Zoom at cursor")],
  [L("Orta tuş", "Middle button"), L("3D: seçili cihazı döndür · seçim yoksa kamera", "3D: turn selected device · camera if none")],
  [L("Boşluk + sürükle", "Space + drag"), L("Tuvali kaydır", "Pan canvas")],
  [L("Çift tık · ekran", "Double-click · screen"), L("Ekran görüntüsünü değiştir", "Replace screenshot")],
  ["Esc", L("Seçimi / diyaloğu kapat", "Clear selection / close dialog")],
];

export const PANEL_TITLES: Record<PanelId, string> = {
  layers: L("Katmanlar", "Layers"),
  text: L("Metin", "Text"),
  library: L("Kütüphane", "Library"),
  scene: L("Sahne", "Scene"),
  device: L("Cihaz", "Device"),
  screens: L("Ekranlar", "Screens"),
};

type MenuItem = { label: string; hint?: string; run: () => void; checked?: boolean; disabled?: boolean } | "sep";

function Menu({ id, label, items, open, setOpen }: { id: string; label: string; items: MenuItem[]; open: string | null; setOpen: (id: string | null) => void }) {
  return (
    <div className="mb-item">
      <button type="button" className={`mb-btn ${open === id ? "on" : ""}`} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} onMouseEnter={() => open && open !== id && setOpen(id)}>
        {label}
      </button>
      {open === id && (
        <div className="mb-menu" role="menu">
          {items.map((it, i) =>
            it === "sep" ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(null);
                  it.run();
                }}
              >
                <span className="mb-check">{it.checked ? <Icon name="check" size={12} /> : null}</span>
                <span className="mb-label">{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function TopBar({
  openDialog,
  openPalette,
  openImport,
}: {
  openDialog: (d: DialogName) => void;
  openPalette: () => void;
  openImport: () => void;
}) {
  const project = useStudio((s) => s.project);
  const busy = useStudio((s) => s.busy);
  const savedAt = useStudio((s) => s.savedAt);
  const setApp = useStudio((s) => s.setApp);
  const setLocale = useStudio((s) => s.setLocale);
  const addLocale = useStudio((s) => s.addLocale);
  const setSyncDesign = useStudio((s) => s.setSyncDesign);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const layout = useWorkspace((s) => s.layout);
  const [menu, setMenu] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const locales = Object.keys(project.sets);
  const syncOn = project.syncDesign !== false;
  const lockCount = Object.values(project.designLocks ?? {}).reduce((n, l) => n + l.length, 0);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const save = async () => {
    try {
      await api("/api/projects", { project: useStudio.getState().project });
      useStudio.setState({ savedAt: new Date().toLocaleTimeString("tr") });
    } catch {
      /* otomatik kayıt zaten tekrar deneyecek */
    }
  };

  // ⌘S kaydet · ⌘O projeler · ⌘E dışa aktar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        openDialog("newproject");
        return;
      }
      if (k === "s") {
        e.preventDefault();
        void save();
      } else if (k === "o") {
        e.preventDefault();
        openDialog("projects");
      } else if (k === "e" && !e.shiftKey) {
        e.preventDefault();
        openDialog("export");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDialog]);

  const newLocale = () => {
    const code = window.prompt(L("Dil kodu (ör. en, de, ar):", "Language code (e.g. en, de, ar):"));
    if (code) addLocale(code.trim().toLowerCase());
  };

  const revealExports = async () => {
    try {
      const r = await api<{ dir: string }>(`/api/export?reveal=1&app=${encodeURIComponent(project.app)}`, undefined, "GET");
      pushToast({ msg: L(`KLASÖR AÇILDI · ${r.dir}`, `FOLDER OPENED · ${r.dir}`) });
    } catch (e) {
      pushToast({ msg: String(e), kind: "err" });
    }
  };

  const ws = useWorkspace.getState();
  const panelItems: MenuItem[] = ALL_PANELS.map((p) => {
    const loc = panelLocation(layout, p);
    return { label: PANEL_TITLES[p], checked: !!loc, run: () => (loc ? ws.close(p) : ws.focus(p)) };
  });

  return (
    <header className="topbar" ref={barRef}>
      <span className="tb-mark" title="Vitrin 1.0">
        vitrin<i>.</i>
      </span>
      <nav className="menubar" aria-label={L("Menü", "Menu")}>
        <Menu
          id="file"
          label={L("Dosya", "File")}
          open={menu}
          setOpen={setMenu}
          items={[
            { label: L("Yeni proje…", "New project…"), hint: "⌥⌘N", run: () => openDialog("newproject") },
            { label: L("Projeler…", "Projects…"), hint: "⌘O", run: () => openDialog("projects") },
            "sep",
            { label: L("Ekran klasöründen içe aktar…", "Import from screen folder…"), run: openImport },
            "sep",
            { label: L("Dışa aktar…", "Export…"), hint: "⌘E", run: () => openDialog("export") },
            { label: L("Toplu dışa aktar (diller × boyutlar)…", "Batch export (locales × sizes)…"), run: () => openDialog("matrix") },
            { label: L("Çıktı klasörünü Finder'da aç", "Reveal output folder in Finder"), run: () => void revealExports() },
            "sep",
            { label: L("Kaydet", "Save"), hint: "⌘S", run: () => void save() },
          ]}
        />
        <Menu
          id="edit"
          label={L("Düzen", "Edit")}
          open={menu}
          setOpen={setMenu}
          items={[
            { label: L("Geri al", "Undo"), hint: "⌘Z", disabled: !canUndo, run: undo },
            { label: L("İleri al", "Redo"), hint: "⇧⌘Z", disabled: !canRedo, run: redo },
            "sep",
            { label: L("Slaytı çoğalt", "Duplicate slide"), hint: "⌘D", run: () => { const st = useStudio.getState(); const id = st.activeSlideId ?? st.project.sets[st.project.activeLocale]?.slides[0]?.id; if (id) st.duplicateSlide(id); } },
            { label: L("Yeni slayt", "New slide"), run: () => useStudio.getState().addSlide() },
            "sep",
            { label: L("Komut paleti", "Command palette"), hint: "⌘K", run: openPalette },
          ]}
        />
        <Menu
          id="lang"
          label={L("Dil", "Language")}
          open={menu}
          setOpen={setMenu}
          items={[
            { label: L("Metinleri çevir…", "Translate texts…"), run: () => openDialog("localize") },
            { label: L("Dil ve taşma kontrolü…", "Locale & overflow check…"), run: () => openDialog("locqa") },
            { label: L("Dil ekle…", "Add language…"), run: newLocale },
            "sep",
            { label: L("Otomatik set kur (Art Director)…", "Auto-build set (Art Director)…"), run: () => openDialog("generate") },
          ]}
        />
        <Menu
          id="window"
          label={L("Pencere", "Window")}
          open={menu}
          setOpen={setMenu}
          items={[...panelItems, "sep", { label: L("Çalışma alanını sıfırla", "Reset workspace"), run: () => ws.reset() }]}
        />
        <Menu
          id="help"
          label={L("Yardım", "Help")}
          open={menu}
          setOpen={setMenu}
          items={[
            { label: L("Klavye kısayolları", "Keyboard shortcuts"), run: () => setHelp(true) },
            { label: L("Ayarlar…", "Settings…"), run: () => openDialog("settings") },
          ]}
        />
      </nav>

      <span className="tb-rule" />

      <div className="tb-proj">
        <button type="button" className="tb-icbtn" onClick={() => openDialog("projects")} title={L("Projeler (⌘O)", "Projects (⌘O)")} aria-label={L("Projeler", "Projects")}>
          <Icon name="folder" size={14} />
        </button>
        <input className="appname" value={project.app} onChange={(e) => setApp(e.target.value)} placeholder={L("uygulama adı", "app name")} aria-label={L("Uygulama adı", "App name")} />
      </div>

      <div className="tb-proj" title={L("Aktif dil", "Active locale")}>
        <select className="locale-sel" value={project.activeLocale} onChange={(e) => setLocale(e.target.value)} aria-label={L("Dil seç", "Select locale")}>
          {locales.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <span className="kunye">{locales.length}</span>
      </div>
      <FormatPicker />
      <button
        className={`sync-chip ${syncOn ? "on" : ""}`}
        onClick={() => setSyncDesign(!syncOn)}
        aria-pressed={syncOn}
        title={L("Tasarım değişiklikleri tüm dillere yayılır; metin ve ekranlar dilde kalır", "Design changes propagate to all locales; text and screens stay per locale")}
      >
        <i className="dot" />
        {syncOn ? L("Senkron", "Synced") : L("Yerel", "Local")}
        {lockCount > 0 && <span className="lock">· {lockCount}</span>}
      </button>

      <div className="spacer" />

      {busy ? (
        <span className="tb-amb busy">
          <i className="sp" />
          {busy}
        </span>
      ) : (
        savedAt && <span className="tb-amb">{L("Kaydedildi", "Saved")} · {savedAt.slice(0, 5)}</span>
      )}

      <div className="tb-undo">
        <button className="tb-icbtn" onClick={undo} disabled={!canUndo} title={L("Geri al (⌘Z)", "Undo (⌘Z)")} aria-label={L("Geri al", "Undo")}>
          <Icon name="undo" size={14} />
        </button>
        <button className="tb-icbtn" onClick={redo} disabled={!canRedo} title={L("İleri al (⇧⌘Z)", "Redo (⇧⌘Z)")} aria-label={L("İleri al", "Redo")}>
          <Icon name="redo" size={14} />
        </button>
      </div>

      <button className="btn primary" onClick={() => openDialog("export")} title={L("Dışa aktar (⌘E)", "Export (⌘E)")}>
        <Icon name="download" size={13} />
        {L("Dışa aktar", "Export")}
      </button>

      {help && (
        <>
          <button className="ws-menu-dismiss" aria-label={L("Kapat", "Close")} onClick={() => setHelp(false)} />
          <div className="help-pop" role="dialog" aria-label={L("Kısayollar", "Shortcuts")}>
            <h4>{L("Kısayollar", "Shortcuts")}</h4>
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="help-row">
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
