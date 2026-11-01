"use client";

// PROJE MERKEZİ — v1.0 (eski "Projeler" listesinin yerine).
//
//   Sol    Yeni proje: ad · cihaz/format · (ops.) ekran görüntülerini şimdi bırak
//   Sağ    Kart ızgarası: küçük resim, format, dil, slayt, son düzenleme
//          Arama · sıralama · format süzgeci · çoklu seçim (⇧ aralık, ⌘ tek tek)
//          Toplu: sil (ÇÖPE), çoğalt · Çöp kutusu: geri al / boşalt
//
// Silme artık geri alınabilir: dosyalar data/projects/.trash/ altına taşınır.

import { useEffect, useMemo, useRef, useState } from "react";
import { FORMATS, formatOf, isDuoFormat, uid, type Format, type Project } from "@/engine/types";
import { api } from "@/lib/client";
import { L } from "@/lib/i18n";
import { imageFiles, uploadScreenshot } from "@/lib/uploads";
import { useStudio } from "@/store/studio";
import { confirmUi } from "./ConfirmDialog";
import { FormatCards } from "./FormatPicker";
import { pushToast } from "./toast";
import { writeProjectThumb } from "@/lib/projectThumb";
import { Icon } from "./ui";

type Summary = { id: string; app: string; createdAt: string; updatedAt?: string; locales: string[]; format?: Format; slides?: number; shots?: number; bytes?: number; thumb?: boolean };
type Sort = "recent" | "name" | "created";
type Fam = "all" | "iphone" | "ipad" | "duo" | "other";

function famOf(f?: Format): Fam {
  const v = f ?? "iphone";
  if (v === "iphone") return "iphone";
  if (v.startsWith("ipad")) return "ipad";
  if (isDuoFormat(v)) return "duo";
  return "other";
}

function ago(iso?: string): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return L("şimdi", "now");
  if (m < 60) return L(`${m} dk önce`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`${h} sa önce`, `${h} h ago`);
  const days = Math.round(h / 24);
  if (days < 30) return L(`${days} gün önce`, `${days} d ago`);
  return iso.slice(0, 10);
}

function sizeOf(b?: number): string {
  if (!b) return "";
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

async function saveProject(p: Project): Promise<void> {
  await api("/api/projects", { project: p });
}

export default function ProjectHub({ close, startNew = false }: { close: () => void; startNew?: boolean }) {
  const current = useStudio((s) => s.project);
  const loadProject = useStudio((s) => s.loadProject);
  const newProject = useStudio((s) => s.newProject);
  const [list, setList] = useState<Summary[]>([]);
  const [trash, setTrash] = useState<Summary[]>([]);
  const [view, setView] = useState<"projects" | "trash">("projects");
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [fam, setFam] = useState<Fam>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Yeni proje formu
  const [name, setName] = useState(L("Yeni Uygulama", "New App"));
  const [format, setFormat] = useState<Format>("iphone");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const [a, b] = await Promise.all([api<{ projects: Summary[] }>("/api/projects"), api<{ projects: Summary[] }>("/api/projects?trash=1")]);
      setList(a.projects);
      setTrash(b.projects);
      setLoaded(true);
    } catch (e) {
      pushToast({ msg: String(e), kind: "err" });
    }
  };
  useEffect(() => {
    void refresh();
    if (startNew) setTimeout(() => nameRef.current?.select(), 60);
  }, [startNew]);

  // Küçük resmi olmayan projeler için sırayla üret (büyük dosyalar atlanır).
  const thumbing = useRef(false);
  useEffect(() => {
    if (!loaded || thumbing.current) return;
    const todo = list.filter((p) => !p.thumb && (p.bytes ?? 0) < 40 * 1024 * 1024).slice(0, 24);
    if (!todo.length) return;
    thumbing.current = true;
    let alive = true;
    (async () => {
      for (const p of todo) {
        if (!alive) break;
        try {
          const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
          if (await writeProjectThumb({ ...r.project, format: formatOf(r.project) }, true)) {
            setList((l) => l.map((x) => (x.id === p.id ? { ...x, thumb: true, updatedAt: x.updatedAt } : x)));
          }
        } catch {
          /* sıradakine geç */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loaded, list]);

  const source = view === "trash" ? trash : list;
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    let l = source.filter((p) => (fam === "all" || famOf(p.format) === fam) && (!needle || p.app.toLocaleLowerCase("tr").includes(needle) || p.locales.some((x) => x.toLowerCase().includes(needle))));
    if (sort === "name") l = [...l].sort((a, b) => a.app.localeCompare(b.app, "tr"));
    else if (sort === "created") l = [...l].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return l;
  }, [source, q, fam, sort]);
  const counts = useMemo(() => {
    const c: Record<Fam, number> = { all: source.length, iphone: 0, ipad: 0, duo: 0, other: 0 };
    for (const p of source) c[famOf(p.format)]++;
    return c;
  }, [source]);

  const open = async (p: Summary) => {
    if (view === "trash") return;
    try {
      const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
      loadProject(r.project);
      close();
    } catch (e) {
      pushToast({ msg: String(e), kind: "err" });
    }
  };

  const clickCard = (e: React.MouseEvent, p: Summary) => {
    if (e.shiftKey && anchor) {
      const ids = shown.map((x) => x.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(p.id)].sort((x, y) => x - y);
      setSel(new Set([...sel, ...ids.slice(a, b + 1)]));
      return;
    }
    if (e.metaKey || e.ctrlKey || sel.size > 0) {
      const next = new Set(sel);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      setSel(next);
      setAnchor(p.id);
      return;
    }
    void open(p);
  };

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
    setAnchor(id);
  };

  const trashIds = async (ids: string[]) => {
    if (!ids.length) return;
    const names = list.filter((p) => ids.includes(p.id)).map((p) => p.app);
    const activeHit = ids.includes(current.id);
    if (
      !(await confirmUi({
        title: ids.length === 1 ? L("Projeyi çöpe taşı", "Move project to trash") : L(`${ids.length} projeyi çöpe taşı`, `Move ${ids.length} projects to trash`),
        message:
          (ids.length === 1 ? `"${names[0]}"` : names.slice(0, 6).join(", ") + (names.length > 6 ? ` +${names.length - 6}` : "")) +
          L(" çöp kutusuna taşınacak. Çöpten geri alabilirsin.", " will be moved to the trash. You can restore them.") +
          (activeHit ? L(" Açık proje de aralarında; kapatılmayacak ama kayıt yeniden oluşur.", " The open project is included; it stays open and will be saved again.") : ""),
        okLabel: L("Çöpe taşı", "Move to trash"),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/projects?id=${ids.map(encodeURIComponent).join(",")}`, { method: "DELETE" });
      setSel(new Set());
      await refresh();
      pushToast({
        msg: L(`${ids.length} PROJE ÇÖPTE`, `${ids.length} PROJECT(S) IN TRASH`),
        action: {
          label: L("Geri al", "Undo"),
          run: () => void fetch(`/api/projects?restore=${ids.join(",")}`, { method: "POST" }).then(refresh),
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (ids: string[]) => {
    setBusy(true);
    try {
      await fetch(`/api/projects?restore=${ids.join(",")}`, { method: "POST" });
      setSel(new Set());
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const purge = async (ids?: string[]) => {
    const n = ids?.length ?? trash.length;
    if (!n) return;
    if (!(await confirmUi({ title: L("Kalıcı olarak sil", "Delete permanently"), message: L(`${n} proje kalıcı olarak silinecek. Bu geri alınamaz.`, `${n} project(s) will be deleted permanently. This cannot be undone.`), okLabel: L("Kalıcı sil", "Delete permanently"), danger: true }))) return;
    setBusy(true);
    try {
      await fetch(`/api/projects?purge=1${ids ? `&id=${ids.join(",")}` : ""}`, { method: "DELETE" });
      setSel(new Set());
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (ids: string[], toFormat?: Format) => {
    setBusy(true);
    try {
      for (const id of ids) {
        const r = await api<{ project: Project }>(`/api/projects?id=${id}`);
        const src = r.project;
        const label = toFormat && toFormat !== formatOf(src) ? FORMATS[toFormat].label : L("kopya", "copy");
        const app = `${src.app} (${label})`;
        const copy: Project = { ...structuredClone(src), id: uid(), app, createdAt: new Date().toISOString(), format: toFormat ?? formatOf(src) };
        copy.sets = Object.fromEntries(Object.entries(copy.sets).map(([code, set]) => [code, { ...set, app }]));
        await saveProject(copy);
      }
      setSel(new Set());
      await refresh();
      pushToast({ msg: L(`${ids.length} PROJE ÇOĞALTILDI`, `${ids.length} PROJECT(S) DUPLICATED`) });
    } catch (e) {
      pushToast({ msg: String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (p: Summary, value: string) => {
    const next = value.trim();
    setEditing(null);
    if (!next || next === p.app) return;
    setBusy(true);
    try {
      if (p.id === current.id) {
        useStudio.getState().setApp(next);
        await saveProject(useStudio.getState().project);
      } else {
        const r = await api<{ project: Project }>(`/api/projects?id=${p.id}`);
        const updated: Project = { ...r.project, app: next };
        updated.sets = Object.fromEntries(Object.entries(updated.sets).map(([code, set]) => [code, { ...set, app: next }]));
        await saveProject(updated);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const app = name.trim() || L("Yeni Uygulama", "New App");
    newProject(app, format);
    if (files.length) {
      // Bırakılan ekranlar: havuza yükle, her biri için bir slayt, sırayla ata.
      const st = useStudio.getState();
      st.setBusy(L(`${files.length} ekran yükleniyor…`, `Uploading ${files.length} screens…`));
      try {
        const shots = [];
        for (const f of files) shots.push(await uploadScreenshot(f));
        useStudio.getState().addScreenshots(shots);
        for (let i = 1; i < shots.length; i++) useStudio.getState().addSlide();
        const slides = useStudio.getState().project.sets[useStudio.getState().project.activeLocale]?.slides ?? [];
        shots.forEach((sh, i) => slides[i] && useStudio.getState().setSlideShot(slides[i].id, 1, sh.dataUrl));
        useStudio.getState().setActiveSlide(slides[0]?.id ?? null);
      } finally {
        useStudio.getState().setBusy(null);
      }
    }
    try {
      await saveProject(useStudio.getState().project);
    } catch {
      /* otomatik kayıt tekrar dener */
    }
    close();
  };

  const selIds = [...sel];
  return (
    <div className="overlay hub-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="hub" role="dialog" aria-label={L("Proje merkezi", "Project hub")}>
        {/* ------------------------- Yeni proje ------------------------- */}
        <form className="hub-new" onSubmit={create}>
          <h2>{L("Yeni proje", "New project")}</h2>
          <label className="field">
            {L("Uygulama adı", "App name")}
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} autoFocus={startNew} />
          </label>
          <FormatCards value={format} onChange={setFormat} />
          <div
            className={`drop-zone ${over ? "over" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.multiple = true;
              input.accept = "image/png,image/jpeg,image/webp";
              input.onchange = () => setFiles(imageFiles(input.files));
              input.click();
            }}
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
              setFiles(imageFiles(e.dataTransfer.files));
            }}
          >
            <Icon name="image" size={18} />
            <b>{files.length ? L(`${files.length} ekran hazır`, `${files.length} screens ready`) : L("Ekran görüntülerini bırak (ops.)", "Drop screenshots (optional)")}</b>
            <small>{files.length ? L("Her ekran kendi slaydına yerleşir", "Each screen gets its own slide") : L("Her biri bir slayt olur · sonra da eklenebilir", "Each becomes a slide · can be added later")}</small>
          </div>
          {files.length > 0 && (
            <button type="button" className="btn xs ghost" onClick={() => setFiles([])}>
              {L("Ekranları temizle", "Clear screens")}
            </button>
          )}
          <button type="submit" className="btn primary wide hub-create">
            <Icon name="plus" size={13} />
            {L("Projeyi oluştur", "Create project")}
          </button>
          <p className="note">{L("Tema ve kurgu için sonra Kütüphane › Şablonlar.", "Pick a theme and layout later in Library › Templates.")}</p>
        </form>

        {/* ------------------------- Kütüphane ------------------------- */}
        <section className="hub-main">
          <header className="hub-bar">
            <div className="hub-views">
              <button type="button" className={view === "projects" ? "on" : ""} onClick={() => (setView("projects"), setSel(new Set()))}>
                {L("Projeler", "Projects")} <em>{list.length}</em>
              </button>
              <button type="button" className={view === "trash" ? "on" : ""} onClick={() => (setView("trash"), setSel(new Set()))}>
                <Icon name="trash" size={12} /> {L("Çöp", "Trash")} <em>{trash.length}</em>
              </button>
            </div>
            <label className="hub-search">
              <Icon name="search" size={13} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Proje ya da dil ara…", "Search projects or languages…")} />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={L("Sıralama", "Sort")}>
              <option value="recent">{L("Son düzenlenen", "Recently edited")}</option>
              <option value="created">{L("Oluşturma tarihi", "Date created")}</option>
              <option value="name">{L("Ad", "Name")}</option>
            </select>
            <button type="button" className="tb-icbtn" onClick={close} aria-label={L("Kapat", "Close")} title={L("Kapat (Esc)", "Close (Esc)")}>
              <Icon name="x" size={15} />
            </button>
          </header>
          <div className="hub-filters">
            {(
              [
                ["all", L("Tümü", "All")],
                ["iphone", "iPhone"],
                ["ipad", "iPad"],
                ["duo", "iPhone Duo"],
                ["other", L("Yaratıcı", "Creative")],
              ] as const
            ).map(([f, t]) => (
              <button key={f} type="button" className={`chip ${fam === f ? "on" : ""}`} disabled={f !== "all" && !counts[f]} onClick={() => setFam(f)}>
                {t} <span className="gallery-chip-count">{counts[f]}</span>
              </button>
            ))}
            <span className="hub-sp" />
            {shown.length > 0 && (
              <button type="button" className="btn xs ghost" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((p) => p.id)))}>
                {sel.size === shown.length ? L("Seçimi kaldır", "Clear selection") : L("Tümünü seç", "Select all")}
              </button>
            )}
            {view === "trash" && trash.length > 0 && (
              <button type="button" className="btn xs danger" disabled={busy} onClick={() => void purge()}>
                {L("Çöpü boşalt", "Empty trash")}
              </button>
            )}
          </div>

          <div className="hub-grid">
            {loaded && shown.length === 0 && <p className="note hub-empty">{view === "trash" ? L("Çöp kutusu boş.", "The trash is empty.") : q ? L(`“${q}” ile eşleşen proje yok.`, `No project matches “${q}”.`) : L("Henüz proje yok — soldan bir tane oluştur.", "No projects yet — create one on the left.")}</p>}
            {shown.map((p) => {
              const on = sel.has(p.id);
              const f = (p.format ?? "iphone") as Format;
              const portrait = !["ipad-landscape", "iphone-duo", "iphone-duo-cover-landscape", "creative-header", "creative-search"].includes(f);
              return (
                <div key={p.id} className={`hub-card ${on ? "sel" : ""} ${p.id === current.id ? "active" : ""}`}>
                  <button type="button" className="hub-thumb" onClick={(e) => clickCard(e, p)} onDoubleClick={() => void open(p)} title={view === "trash" ? p.app : L(`${p.app} — aç · ⌘/⇧ ile seç`, `${p.app} — open · ⌘/⇧ to select`)}>
                    {p.thumb ? <img src={`/api/projects?thumb=${p.id}&v=${encodeURIComponent(p.updatedAt ?? "")}`} alt="" loading="lazy" className={portrait ? "p" : "l"} /> : <span className="hub-thumb-ph"><Icon name={famOf(f) === "ipad" ? "frame" : famOf(f) === "duo" ? "cube" : "phone"} size={26} /></span>}
                    {p.id === current.id && <span className="hub-badge">{L("AÇIK", "OPEN")}</span>}
                  </button>
                  <span
                    className={`hub-check ${on ? "on" : ""}`}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={L(`${p.app} seç`, `Select ${p.app}`)}
                    tabIndex={0}
                    onClick={() => toggle(p.id)}
                    onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle(p.id))}
                  >
                    {on && <Icon name="check" size={11} />}
                  </span>
                  <div className="hub-meta">
                    {editing === p.id ? (
                      <input
                        className="hub-rename"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void rename(p, draft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void rename(p, draft);
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <b title={p.app} onDoubleClick={() => view === "projects" && (setDraft(p.app), setEditing(p.id))}>
                        {p.app || L("Adsız", "Untitled")}
                      </b>
                    )}
                    <small>
                      {FORMATS[f]?.label ?? f} · {p.locales.length} {L("dil", "lang")} · {p.slides ?? "?"} {L("kare", "frames")}
                    </small>
                    <small className="dim">
                      {ago(p.updatedAt ?? p.createdAt)} · {sizeOf(p.bytes)}
                    </small>
                  </div>
                  <button type="button" className="hub-more" aria-label={L("Seçenekler", "Options")} onClick={(e) => setMenu({ id: p.id, x: e.clientX, y: e.clientY })}>
                    <Icon name="list" size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {sel.size > 0 && (
            <div className="hub-selbar">
              <b>{L(`${sel.size} seçili`, `${sel.size} selected`)}</b>
              <span className="hub-sp" />
              {view === "projects" ? (
                <>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => void duplicate(selIds)}>
                    <Icon name="copy" size={12} />
                    {L("Çoğalt", "Duplicate")}
                  </button>
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => void trashIds(selIds)}>
                    <Icon name="trash" size={12} />
                    {L("Çöpe taşı", "Move to trash")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => void restore(selIds)}>
                    <Icon name="undo" size={12} />
                    {L("Geri al", "Restore")}
                  </button>
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => void purge(selIds)}>
                    {L("Kalıcı sil", "Delete forever")}
                  </button>
                </>
              )}
              <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>
                {L("Vazgeç", "Cancel")}
              </button>
            </div>
          )}
        </section>

        {menu &&
          (() => {
            const p = source.find((x) => x.id === menu.id);
            if (!p) return null;
            const items: [string, () => void, boolean?][] =
              view === "trash"
                ? [
                    [L("Geri al", "Restore"), () => void restore([p.id])],
                    [L("Kalıcı sil…", "Delete forever…"), () => void purge([p.id]), true],
                  ]
                : [
                    [L("Aç", "Open"), () => void open(p)],
                    [L("Yeniden adlandır", "Rename"), () => (setDraft(p.app), setEditing(p.id))],
                    [L("Çoğalt", "Duplicate"), () => void duplicate([p.id])],
                    [L("iPhone kopyası", "iPhone copy"), () => void duplicate([p.id], "iphone")],
                    [L("iPad kopyası", "iPad copy"), () => void duplicate([p.id], "ipad")],
                    [L("iPhone Duo kopyası", "iPhone Duo copy"), () => void duplicate([p.id], "iphone-duo")],
                    [L("Çöpe taşı…", "Move to trash…"), () => void trashIds([p.id]), true],
                  ];
            return (
              <>
                <button className="ws-menu-dismiss" aria-label={L("Kapat", "Close")} onClick={() => setMenu(null)} />
                <div className="ws-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y + 4, window.innerHeight - items.length * 32 - 20) }} role="menu">
                  <p>{p.app}</p>
                  {items.map(([t, run, danger]) => (
                    <button key={t} role="menuitem" className={danger ? "danger" : ""} onClick={() => (setMenu(null), run())}>
                      {t}
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}
