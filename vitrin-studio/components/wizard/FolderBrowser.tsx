"use client";

// Gözat — sunucu güdümlü klasör tarayıcı (1. adım ve "Ekran klasörünü değiştir").
//
// Tarayıcının dosya seçicisi MUTLAK yol vermez; bu yüzden yol her zaman
// `GET /api/ingest?browse=<dir>` üzerinden gelir. Uç nokta salt `readdir`:
// dosya İÇERİĞİ okumaz, ev klasörünün dışına çıkmaz.
//
// Etkileşim:
//   · kırıntı (breadcrumb) → o klasöre git       (`parent`/`home` sunucudan)
//   · ▸ oku                → satırı YERİNDE aç (tembel alt istek)
//   · ad                   → klasörü SEÇ (yol kutusuna yazılır)
//   · ↳                    → klasörün İÇİNE gir (kırıntı kökü kayar)
//   · .md satırı           → tek dil seçimi (allowMd)

import { memo, useCallback, useEffect, useState } from "react";

import { api } from "@/lib/client";
import { L } from "@/lib/i18n";

import { Icon } from "../ui";
import type { BrowseDir, BrowseResult } from "./types";

/** `<parent>/<name>` — sunucu POSIX yolu döndürüyor, string birleştirme yeterli. */
const join = (dir: string, name: string): string =>
  dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;

function browse(dir: string): Promise<BrowseResult> {
  return api<BrowseResult>(`/api/ingest?browse=${encodeURIComponent(dir)}`);
}

function Badges({ d }: { d: BrowseDir }) {
  return (
    <>
      {d.hasMd && <span className="wiz-badge md">MD</span>}
      {d.imgCount > 0 && <span className="wiz-badge">{d.imgCount}</span>}
    </>
  );
}

/** Ağaçtaki tek klasör satırı — açılınca kendi çocuklarını çeker. */
const DirNode = memo(function DirNode({
  abs,
  dir,
  selected,
  allowMd,
  onSelect,
  onNavigate,
}: {
  abs: string;
  dir: BrowseDir;
  selected: string;
  allowMd?: boolean;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || kids || loading) return;
    setLoading(true);
    browse(abs)
      .then(setKids)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <div className={`wiz-node ${selected === abs ? "sel" : ""}`}>
        <button
          type="button"
          className={`wiz-caret ${dir.hasChildren ? "" : "empty"}`}
          onClick={toggle}
          aria-label={open ? L("Kapat", "Collapse") : L("Aç", "Expand")}
          aria-expanded={open}
        >
          <span style={{ display: "block", transform: open ? "rotate(90deg)" : "none" }}>
            <Icon name="chevron" size={12} />
          </span>
        </button>
        <button type="button" className="wiz-name" onClick={() => onSelect(abs)} title={abs}>
          {dir.name}
        </button>
        <Badges d={dir} />
        <button
          type="button"
          className="wiz-open"
          onClick={() => onNavigate(abs)}
          title={L("Bu klasörün içine gir", "Open this folder")}
        >
          ↳
        </button>
      </div>
      {open && (
        <div className="wiz-kids">
          {loading && <div className="wiz-empty">{L("Okunuyor…", "Reading…")}</div>}
          {err && <div className="wiz-empty">{err}</div>}
          {kids?.dirs.map((k) => (
            <DirNode
              key={k.name}
              abs={join(abs, k.name)}
              dir={k}
              selected={selected}
              allowMd={allowMd}
              onSelect={onSelect}
              onNavigate={onNavigate}
            />
          ))}
          {allowMd &&
            kids?.mdFiles.map((f) => (
              <div key={f} className={`wiz-node ${selected === join(abs, f) ? "sel" : ""}`}>
                <span className="wiz-caret empty" />
                <button
                  type="button"
                  className="wiz-name"
                  onClick={() => onSelect(join(abs, f))}
                  title={join(abs, f)}
                >
                  {f}
                </button>
                <span className="wiz-badge md">MD</span>
              </div>
            ))}
          {kids && !kids.dirs.length && !(allowMd && kids.mdFiles.length) && (
            <div className="wiz-empty">{L("Alt klasör yok.", "No subfolders.")}</div>
          )}
        </div>
      )}
    </>
  );
});

export function FolderBrowser({
  start,
  allowMd,
  selected = "",
  onSelect,
}: {
  /** Açılışta gidilecek klasör; boşsa ev klasörü. */
  start?: string;
  /** true → `.md` dosyaları da seçilebilir (tek dil içe aktarma). */
  allowMd?: boolean;
  /** Şu an seçili yol — satır vurgusu için. */
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const [dir, setDir] = useState(start ?? "");
  const [res, setRes] = useState<BrowseResult | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const go = useCallback((path: string) => {
    setDir(path);
  }, []);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setErr("");
    browse(dir)
      .then((r) => {
        if (!dead) setRes(r);
      })
      .catch((e: unknown) => {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [dir]);

  // Kırıntılar: ev klasörünün ALTINDAKİ parçalar (üstü zaten gezilemiyor).
  const crumbs: { label: string; path: string }[] = [];
  if (res) {
    crumbs.push({ label: "~", path: res.home });
    if (res.path.startsWith(res.home) && res.path !== res.home) {
      const rest = res.path.slice(res.home.length).replace(/^\//, "");
      let acc = res.home;
      for (const part of rest.split("/")) {
        acc = join(acc, part);
        crumbs.push({ label: part, path: acc });
      }
    }
  }

  /**
   * Hızlı erişim. Gezinme zaten ev klasörünün altına kilitli, o yüzden yolları
   * `home`'dan türetmek yeterli — sunucudan ek alan istemeye gerek yok.
   * Var olmayan klasöre basılırsa gezgin "okunamadı" der, zarar yok.
   */
  const quick = res
    ? [
        { label: L("Masaüstü", "Desktop"), path: join(res.home, "Desktop") },
        { label: L("Belgeler", "Documents"), path: join(res.home, "Documents") },
        { label: L("İndirilenler", "Downloads"), path: join(res.home, "Downloads") },
      ]
    : [];

  return (
    <div className="wiz-browser">
      {quick.length > 0 && (
        <div className="wiz-quick">
          {quick.map((s) => (
            <button
              key={s.path}
              type="button"
              className={res?.path === s.path ? "on" : undefined}
              onClick={() => go(s.path)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="wiz-crumbs">
        {res?.parent && (
          <button type="button" onClick={() => go(res.parent as string)} title={L("Bir üst klasör", "Parent folder")}>
            ↑
          </button>
        )}
        {crumbs.map((c, i) => (
          <span key={c.path} style={{ display: "contents" }}>
            {i > 0 && <span>/</span>}
            <button type="button" onClick={() => go(c.path)}>
              {c.label}
            </button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => onSelect(res?.path ?? dir)} title={L("Bu klasörü kullan", "Use this folder")}>
          {L("bu klasörü seç", "select this folder")}
        </button>
      </div>

      <div className="wiz-tree">
        {loading && <div className="wiz-empty">{L("Okunuyor…", "Reading…")}</div>}
        {err && (
          <div className="wiz-empty">
            {err}{" "}
            <button type="button" className="btn sm" onClick={() => go("")}>
              {L("Ev klasörüne dön", "Back to home folder")}
            </button>
          </div>
        )}
        {res?.dirs.map((d) => (
          <DirNode
            key={d.name}
            abs={join(res.path, d.name)}
            dir={d}
            selected={selected}
            allowMd={allowMd}
            onSelect={onSelect}
            onNavigate={go}
          />
        ))}
        {allowMd &&
          res?.mdFiles.map((f) => (
            <div key={f} className={`wiz-node ${selected === join(res.path, f) ? "sel" : ""}`}>
              <span className="wiz-caret empty" />
              <button
                type="button"
                className="wiz-name"
                onClick={() => onSelect(join(res.path, f))}
                title={join(res.path, f)}
              >
                {f}
              </button>
              <span className="wiz-badge md">MD</span>
            </div>
          ))}
        {res && !loading && !res.dirs.length && !(allowMd && res.mdFiles.length) && (
          <div className="wiz-empty">{L("Bu klasörde alt klasör yok — kırıntıdan geri çıkabilirsin.", "No subfolders here — use the breadcrumbs to go back.")}</div>
        )}
        {res?.truncated && <div className="wiz-empty">{L("Liste kırpıldı (ilk 300 klasör).", "List truncated (first 300 folders).")}</div>}
      </div>
    </div>
  );
}
