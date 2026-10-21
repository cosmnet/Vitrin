"use client";
import { EXPORT_SIZES, FORMATS, formatOf } from "@/engine/types";

// ÜST BAR — 44px komuta şeridi (UI v3).
//
// Kural (rapor §0 + §7): solda `vitrin.` markası + proje/dil künyesi,
// sağda TEK Klein birincil buton, geri kalan HAYALET. "Kaydet" butonu
// YOK — otomatik kayıt ambient mono künye olarak görünür ("KAYDEDİLDİ ·
// 14:22"), asla toast. ⌘S hâlâ zorla kaydeder (kas hafızası) ama görsel
// bir yer kaplamaz.
//
// Klein sayacı: bu şeritte TEK bir Klein var — birincil aksiyon.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useStudio } from "@/store/studio";
import FormatPicker from "./FormatPicker";
import { Icon } from "./ui";
import type { DialogName } from "./Studio";
import { L } from "@/lib/i18n";

// R8/W3 — TEKERLEK ANLAMI DEĞİŞTİ (bkz. Stage.tsx başlığı, C3). Çıplak
// tekerlek artık tuvali KAYDIRIYOR; cihaz ölçeği ⌥'ya taşındı. Kas hafızası
// kırılan her jest bu listede ve kuyu künyesinde AYNI dalgada yazılmalı,
// yoksa değişiklik "bozuldu" gibi hissedilir.
export const SHORTCUTS: [string, string][] = [
  ["⌘K", L("Komut paleti", "Command palette")],
  ["⌘Z / ⇧⌘Z", L("Geri al / ileri al", "Undo / redo")],
  ["⌘D", L("Aktif slaytı çoğalt", "Duplicate active slide")],
  ["⌘S", L("Şimdi kaydet", "Save now")],
  ["1 – 9", L("Slayt seç", "Select slide")],
  ["F", L("Tuvali sığdır", "Fit canvas")],
  ["← ↑ → ↓", L("Cihazı 2px kaydır (⇧ ile 20px)", "Nudge device 2px (20px with ⇧)")],
  [L("Tekerlek", "Wheel"), L("Tuvali kaydır (trackpad iki parmak)", "Scroll canvas (two-finger trackpad)")],
  [L("⌘ + tekerlek", "⌘ + wheel"), L("İmleç altına zoom · pinch de aynı", "Zoom at cursor · pinch works too")],
  [L("⌥ + tekerlek", "⌥ + wheel"), L("Cihaz ölçeği", "Device scale")],
  [L("Boşluk + sürükle", "Space + drag"), L("Tuvali pan (orta tık da olur)", "Pan canvas (middle click works too)")],
  [L("Sağ tık", "Right click"), L("Tuval bağlam menüsü", "Canvas context menu")],
  ["Esc", L("Diyaloğu / paleti kapat", "Close dialog / palette")],
];

/* ---------------------------------------------------------------------------
   C35 — KAYIT KÜNYESİ SCRAMBLE

   "KAYDEDİLDİ · 14:32" künyesi kaydın BİTTİĞİ an 240ms boyunca rastgele mono
   karakterden hedefe oturur. Neden tam burada: bu künye zaten sessiz, mono ve
   bir VERİ ANIdır — cosm kurallarında asit rengi hakkının kullanılabileceği
   yer. Toast yok, hareket yok, yalnız harfler yerine oturuyor.

   Hareket azaltmada tek kare bile oynamaz: metin doğrudan yazılır.
   --------------------------------------------------------------------------- */
const GLYPHS = "▚▞▟▛0123456789ABCDEFXZ#%*";
const SCRAMBLE_MS = 240;

function Scramble({ text }: { text: string }) {
  const [out, setOut] = useState(text);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOut(text);
      setHot(false);
      return;
    }
    let raf = 0;
    let done = false;
    const t0 = performance.now();
    // Taban HEMEN yazılır. Sekme arka plandayken `requestAnimationFrame`
    // hiç koşmaz; taban olmasaydı künye BAYAT saati göstermeye devam ederdi
    // (otomatik kayıt kullanıcı başka sekmedeyken de tetikleniyor).
    setOut(text);
    setHot(true);
    const finish = () => {
      if (done) return;
      done = true;
      setOut(text);
      setHot(false);
    };
    // Emniyet: rAF hiç dönmezse (gizli sekme) künye asit renginde asılı kalmasın.
    const safety = setTimeout(finish, SCRAMBLE_MS + 160);
    const tick = () => {
      if (done) return;
      const p = Math.min(1, (performance.now() - t0) / SCRAMBLE_MS);
      // Soldan sağa oturur: `p` ilerledikçe sabitlenen karakter sayısı artar.
      const fixed = Math.floor(p * text.length);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        // Boşluk ve ayraç asla karışmasın — künyenin ritmi bozulmasın.
        if (i < fixed || c === " " || c === "·") s += c;
        else s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [text]);

  return <span className={`tb-amb${hot ? " scram" : ""}`}>{out}</span>;
}

export default function TopBar({
  openDialog,
  openPalette,
  openImport,
}: {
  openDialog: (d: DialogName) => void;
  openPalette: () => void;
  /** MD içe aktarma sihirbazı — kabuk sahibi (Studio) açar. */
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
  const [help, setHelp] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setToolsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolsOpen]);
  const helpRef = useRef<HTMLDivElement>(null);

  const locales = Object.keys(project.sets);
  const format = formatOf(project);
  const formatInfo = FORMATS[format];
  const exportSize = EXPORT_SIZES[formatInfo.exportSize];
  const aspectLabel = format === "ipad" ? "3:4" : format === "ipad-landscape" ? "4:3" : "110:239";
  // Tasarım senkronu: alan eski projelerde yok → yokluk AÇIK sayılır.
  const syncOn = project.syncDesign !== false;
  const lockCount = Object.values(project.designLocks ?? {}).reduce((n, l) => n + l.length, 0);
  const slideCount = project.sets[project.activeLocale]?.slides.length ?? 0;
  // Birincil aksiyon bağlama göre: henüz kurulmamış proje → İÇE AKTAR,
  // kurulmuş proje → EXPORT. Ekranda her zaman TEK Klein buton olur.
  const primaryIsImport = slideCount <= 1 && project.screenshots.length === 0;

  useEffect(() => {
    if (!help) return;
    const onDown = (e: MouseEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelp(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [help]);

  // ⌘S — görünmez ama korunan kısayol (buton kaldırıldı, davranış kalmadı değil)
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      try {
        await api("/api/projects", { project: useStudio.getState().project });
        useStudio.setState({ savedAt: new Date().toLocaleTimeString("tr") });
      } catch {
        /* otomatik kayıt zaten tekrar deneyecek */
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const newLocale = () => {
    const code = window.prompt(L("Dil kodu (ör. en, de, ar):", "Language code (e.g. en, de, ar):"));
    if (code) addLocale(code.trim().toLowerCase());
  };

  return (
    <header className="topbar grain">
      <span className="tb-mark">
        vitrin<i>.</i>
      </span>

      <span className="tb-rule" />

      {/* Proje künyesi — ad düzenlenir, ok proje kütüphanesini açar */}
      <div className="tb-proj">
        <input
          className="appname"
          value={project.app}
          onChange={(e) => setApp(e.target.value)}
          placeholder={L("uygulama adı", "app name")}
          aria-label={L("Uygulama adı", "App name")}
        />
        <button
          className="tb-icbtn"
          onClick={() => openDialog("projects")}
          title={L("Projeler", "Projects")}
          aria-label={L("Projeler", "Projects")}
        >
          <Icon name="chevron" size={13} />
        </button>
      </div>

      <span className="tb-rule" />

      {/* Dil */}
      <div className="tb-proj" title={L("Aktif dil", "Active locale")}>
        <select
          className="locale-sel"
          value={project.activeLocale}
          onChange={(e) => setLocale(e.target.value)}
          aria-label={L("Dil seç", "Select locale")}
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <span className="kunye">{L(`${locales.length} DİL`, `${locales.length} LOCALES`)}</span>
        <FormatPicker/>
        <button className="tb-icbtn" onClick={newLocale} title={L("Dil ekle", "Add locale")} aria-label={L("Dil ekle", "Add locale")}>
          <Icon name="plus" size={12} />
        </button>
      </div>

      {/* Tasarım senkronu — diller arası bir karar, dilin yanında durur */}
      <button
        className={`sync-chip ${syncOn ? "on" : ""}`}
        onClick={() => setSyncDesign(!syncOn)}
        aria-pressed={syncOn}
        title={L("Tasarım değişiklikleri tüm dillere yayılır; metin ve ekranlar dilde kalır", "Design changes propagate to all locales; text and screens stay per locale")}
      >
        <i className="dot" />
        {L("Tasarım", "Design")} {syncOn ? L("senkron", "synced") : L("yerel", "local")}
        {lockCount > 0 && <span className="lock">· {lockCount} {L("KİLİT", "LOCKS")}</span>}
      </button>

      <div style={{ display: "flex", gap: 2, flex: "none" }}>
        <button
          className="tb-icbtn"
          onClick={undo}
          disabled={!canUndo}
          title={L("Geri al (⌘Z)", "Undo (⌘Z)")}
          aria-label={L("Geri al", "Undo")}
        >
          <Icon name="undo" size={14} />
        </button>
        <button
          className="tb-icbtn"
          onClick={redo}
          disabled={!canRedo}
          title={L("İleri al (⇧⌘Z)", "Redo (⇧⌘Z)")}
          aria-label={L("İleri al", "Redo")}
        >
          <Icon name="redo" size={14} />
        </button>
      </div>

      <div className="spacer" />

      {busy ? (
        <span className="tb-amb busy">
          <i className="sp" />
          {busy}
        </span>
      ) : (
        savedAt && <Scramble text={`${L("KAYDEDİLDİ", "SAVED")} · ${savedAt.slice(0, 5)}`} />
      )}

      <button className="btn ghost k" onClick={openPalette} title={L("Komut paleti (⌘K)", "Command palette (⌘K)")}>
        <Icon name="search" size={13} />
        <span className="lbl">{L("Komut", "Command")}</span>
        <em className="cnt">⌘K</em>
      </button>

      {!primaryIsImport && (
        <button className="btn ghost k" onClick={() => openImport()} title={L("MD klasöründen içe aktar", "Import from MD folder")}>
          <span className="lbl">{L("İçe aktar", "Import")}</span>
        </button>
      )}
      <button className="btn ghost k" onClick={() => openDialog("localize")} title={L("Lokalize et", "Localize")}>
        <span className="lbl">{L("Lokalize", "Localize")}</span>
      </button>
      <button className="btn ghost k" onClick={() => openDialog("generate")} title={L("Otomatik plan (Art Director)", "Auto plan (Art Director)")}>
        <span className="lbl">{L("Üret", "Generate")}</span>
      </button>
      {primaryIsImport && (
        <button className="btn ghost k" onClick={() => openDialog("export")} title={L("PNG'leri dışa aktar", "Export PNGs")}>
          <span className="lbl">{L("Dışa aktar", "Export")}</span>
        </button>
      )}

      {/* TEK Klein birincil aksiyon */}
      {primaryIsImport ? (
        <button className="btn primary k" onClick={() => openImport()}>
          {L("İçe aktar", "Import")}
        </button>
      ) : (
        <button className="btn primary k" onClick={() => openDialog("export")}>
          {L("Dışa aktar", "Export")}
        </button>
      )}

      <div className="tb-tools">
        <button className="btn tools-trigger" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(!toolsOpen)}><Icon name="list" size={14}/>{L("Araçlar", "Tools")}</button>
        {toolsOpen && <><button className="tools-dismiss" aria-label={L("Araçları kapat", "Close tools")} onClick={()=>setToolsOpen(false)}/><div className="tools-menu" role="menu">
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openImport();}}>{L("Ekranları içe aktar", "Import screens")} <small>{L("MD ve görsel klasörü", "MD and image folder")}</small></button>
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openDialog("localize");}}>{L("Metinleri çevir", "Translate texts")} <small>{L("Seçtiğin dillere çevir, her dil ayrı sekme", "Translate into chosen languages, each in its own tab")}</small></button>
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openDialog("generate");}}>{L("Otomatik set oluştur", "Auto-generate set")} <small>{L("Ekranlarından bir anlatı hazırla", "Build a narrative from your screens")}</small></button>
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openDialog("matrix");}}>{L("Toplu dışa aktar", "Batch export")} <small>{L("Diller, boyutlar ve seçili slaytlar", "Locales, sizes and selected slides")}</small></button>
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openDialog("locqa");}}>{L("Dil ve taşma kontrolü", "Locale and overflow check")} <small>{L("Yayınlamadan önce son kontrol", "Final check before publishing")}</small></button>
          <button role="menuitem" onClick={()=>{setToolsOpen(false);openDialog("settings");}}>{L("Ayarlar", "Settings")} <small>{L("API anahtarları ve sürüm", "API keys and version")}</small></button>
        </div></>}
      </div>
      <div className="tb-help" ref={helpRef}>
        <button
          className={`tb-icbtn ${help ? "on" : ""}`}
          onClick={() => setHelp((h) => !h)}
          title={L("Klavye kısayolları", "Keyboard shortcuts")}
          aria-label={L("Klavye kısayolları", "Keyboard shortcuts")}
        >
          <Icon name="list" size={14} />
        </button>
        {help && (
          <div className="help-pop">
            <h4>{L("Kısayollar", "Shortcuts")}</h4>
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="help-row">
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </header>
  );
}
