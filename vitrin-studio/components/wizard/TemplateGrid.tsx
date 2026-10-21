"use client";

// 4. adım — şablon galerisi. Nokta+isim DEĞİL: engine/thumbs.ts ile GERÇEK
// render edilmiş minik kartlar, üstelik örnek slaytta KULLANICININ KENDİ ilk
// eşleşen ekran görüntüsü basılı — kart bir swatch değil, gerçek önizleme.
//
// Kartlar yalnız görününce kuyruğa girer (IntersectionObserver) ve önbellek
// localStorage'da yaşadığı için sihirbaz ikinci açılışta anında dolu gelir.

import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  peekThumb,
  syncThumbRev,
  thumbAspectOf,
  thumbFor,
  THUMB_CSS,
  THUMB_H,
} from "@/engine/thumbs";
import {
  TEMPLATE_KATEGORILER,
  TEMPLATES,
  templateForFormat,
  type TemplateKategori,
} from "@/engine/templates";
import { getTheme } from "@/engine/themes";
import {
  FORMATS,
  formatOf,
  isTabletKind,
  kindOfFormat,
  type Format,
  type Slide,
} from "@/engine/types";
import { useStudio } from "@/store/studio";
import { L } from "@/lib/i18n";
import { isSplitScreen } from "@/engine/splitScreens";

import { Icon, useRenderRev } from "../ui";

function formatTag(format: Format): string { return FORMATS[format].label; }

function searchKey(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const TemplateCard = memo(function TemplateCard({
  id,
  name,
  hint,
  category,
  mode,
  sample,
  format,
  aspect,
  rev,
  on,
  onClick,
}: {
  id: string;
  name: string;
  hint?: string;
  category: string;
  mode: string;
  sample?: Slide;
  format: Format;
  aspect: number;
  rev: number;
  on: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  const [url, setUrl] = useState<string | null>(() => peekThumb("template", id, sample, format));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "40px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cached = peekThumb("template", id, sample, format);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    if (!seen) return;
    let dead = false;
    thumbFor("template", id, sample, format)
      .then((u) => {
        if (!dead) setUrl(u);
      })
      .catch(() => {
        /* motor hazır değilse kart iskelet kalır */
      });
    return () => {
      dead = true;
    };
  }, [id, sample, format, seen, rev]);

  return (
    <button
      ref={ref}
      type="button"
      className={`vt-card ${on ? "on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      title={hint || name}
    >
      <span className="vt-shot" style={{ width: Math.round(THUMB_H * aspect), height: THUMB_H }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} />
        ) : (
          <span className="vt-skel" style={{ width: "100%" }} />
        )}
      </span>
      <span className="vt-meta">
        <span className="vt-name">{name}</span>
        <span className="vt-tags">
          <i>{category}</i>
          <i>{mode}</i>
          <i>{formatTag(format)}</i>
        </span>
        {hint && <span className="vt-hint">{hint}</span>}
      </span>
    </button>
  );
});

export function TemplateGrid({
  value,
  onChange,
  sample,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Kullanıcının ilk eşleşen ekranından kurulmuş örnek slayt. */
  sample?: Slide;
}) {
  const [kat, setKat] = useState<TemplateKategori | "all">("all");
  const [query, setQuery] = useState("");
  const format = useStudio((s) => formatOf(s.project));
  const isTabletFormat = isTabletKind(kindOfFormat(format));
  const formatInfo = FORMATS[format];
  const aspect = thumbAspectOf(format);
  // renderRev köprüsü — render gövdesinde, çocuk efektlerinden önce (bkz. thumbs.ts).
  const rev = useRenderRev();
  syncThumbRev(rev);

  const eligible = useMemo(
    () => TEMPLATES.filter((t) => templateForFormat(t,format)),
    [format]
  );
  const categoryCounts = useMemo(
    () => new Map(TEMPLATE_KATEGORILER.map((k) => [k.id, k.id === "all" ? eligible.length : eligible.filter((t) => t.kategori === k.id).length])),
    [eligible]
  );
  const visible = useMemo(() => {
    const needle = searchKey(query.trim());
    return eligible.filter((t) => {
      if (kat !== "all" && t.kategori !== kat) return false;
      if (!needle) return true;
      const theme = getTheme(t.themeId);
      const category = TEMPLATE_KATEGORILER.find((k) => k.id === t.kategori)?.label ?? "";
      const mode = isSplitScreen(t.style(0)) ? L("Kırpma", "Crop") : (t.style(0).device?.mode ?? theme.device.mode) === "3d" ? "3d" : "2d";
      return searchKey(`${t.name} ${t.hint} ${category} ${theme.name} ${mode} ${formatTag(format)}`).includes(needle);
    });
  }, [eligible, kat, query, format]);

  return (
    <>
      <style>{THUMB_CSS}</style>
      <div className="wiz-template-tools">
        <label className="gallery-search wiz-template-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L("Şablon ara…", "Search templates…")}
            aria-label={L("Şablon ara", "Search templates")}
          />
        </label>
        <p className="gallery-format">
          <span>{L("Proje formatı", "Project format")}</span>
          <b>{formatTag(format)}</b>
          <small>{formatInfo.base.w} × {formatInfo.base.h} {L("tuval", "canvas")}</small>
          <small className="gallery-result-count">{L(`${visible.length} şablon`, `${visible.length} templates`)}</small>
        </p>
      </div>
      <div className="wiz-template-categories" role="tablist" aria-label={L("Şablon kategorileri", "Template categories")}>
        {TEMPLATE_KATEGORILER.filter(k=>k.id==="all" || (categoryCounts.get(k.id)??0)>0).map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kat === k.id}
            className={`seg-item ${kat === k.id ? "on" : ""}`}
            disabled={k.id !== "all" && categoryCounts.get(k.id) === 0}
            onClick={() => setKat(k.id)}
          >
            <span>{k.label}</span>
            <small>{categoryCounts.get(k.id) ?? 0}</small>
          </button>
        ))}
      </div>
      <div className={`vt-cards wiz-tpl ${format === "ipad-landscape" ? "is-landscape" : ""}`}>
        {visible.map((t) => {
          const theme = getTheme(t.themeId);
          const mode = isSplitScreen(t.style(0)) ? L("Kırpma", "Crop") : (t.style(0).device?.mode ?? theme.device.mode) === "3d" ? "3D" : "2D";
          const category = TEMPLATE_KATEGORILER.find((k) => k.id === t.kategori)?.label ?? t.kategori;
          return (
            <TemplateCard
              key={t.id}
              id={t.id}
              name={t.name}
              hint={t.hint}
              category={category}
              mode={mode}
              sample={sample}
              format={format}
              aspect={aspect}
              rev={rev}
              on={value === t.id}
              onClick={() => onChange(t.id)}
            />
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="note">
          {kat === "ipad" && !isTabletFormat
            ? L("iPad şablonları yalnız iPad biçimli projelerde gösterilir. Bu proje iPhone · 110:239 biçiminde.", "iPad templates only show in iPad-format projects. This project is iPhone · 110:239.")
            : L("Aramanla eşleşen şablon yok.", "No templates match your search.")}
        </p>
      )}
    </>
  );
}
