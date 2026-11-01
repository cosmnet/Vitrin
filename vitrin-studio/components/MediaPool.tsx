"use client";

// MEDYA ÇEKMECESİ — 240px, tuvalin ÜSTÜNE kayar (Webflow kuralı: itmez,
// böylece tuval zoom'u hiç yeniden akmaz). Sekme seçimi soldaki ikon
// rayından gelir; çekmecenin kendi başlığı sadece adı, sayacı ve kapatma
// düğmesini taşır.
//
//   Ekranlar   → ham UI ekran görüntüleri (yükle · sil · aktif slaydın
//                1./2./3. ekran yuvasına ata — hedef yuva üstteki çiplerden,
//                sağ tık menüsü doğrudan yuva seçer)
//   Şablonlar  → hazır kurgu galerisi, kategori künyeleriyle
//   Görseller  → hazır zeminler · dokular · Wiro üretimleri
//
// Inspector'daki karşılıkları KALDIRILMADI — burası kütüphane, orası özellik.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { COLLECTIONS } from "@/engine/collections";
import { BRAND_ARTWORK, BRAND_COLLECTIONS, brandAsset } from "@/engine/brandThemes";
import { previewSrc } from "@/engine/media";
import { loadImage } from "@/engine/assets";
import { makeElement } from "@/engine/elements";
import {
  restyleSlides,
  templateForFormat,
  TEMPLATE_KATEGORILER,
  TEMPLATES,
  type Template,
  type TemplateKategori,
} from "@/engine/templates";
import { getTheme } from "@/engine/themes";
import { isSplitScreen } from "@/engine/splitScreens";
import {
  peekThumb,
  syncThumbRev,
  thumbAspectOf,
  thumbFor,
  THUMB_CSS,
  THUMB_H,
} from "@/engine/thumbs";
import {
  uid,
  formatOf,
  isDuoFormat,
  formatLabel,
  isTabletKind,
  kindOfFormat,
  type Background,
  type DeviceStyle2D,
  type Format,
  type Slide,
} from "@/engine/types";
import { filesToScreenshots } from "@/lib/client";
import { SHOT_FIELD, shotSlotCount, useStudio, type ShotSlot } from "@/store/studio";
import { confirmUi } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { Icon, refreshAssets, useAssets, useRenderRev, type AssetList } from "./ui";
import { pushToast } from "./toast";
import { imageFiles, uploadImage } from "@/lib/uploads";
import { L } from "@/lib/i18n";

/** Marka arka planının iPhone'da uygulanırken kullanılacak kırpması. */
const cropFor = (src: string) => BRAND_ARTWORK.find(a => a.crop && brandAsset(a.theme, a.id) === src)?.crop;

export type PoolTab = "shots" | "templates" | "images";

export const POOL_LABELS: Record<PoolTab, string> = {
  shots: L("Ekranlar", "Screens"),
  templates: L("Temalar", "Themes"),
  images: L("Görseller", "Images"),
};

function formatTag(format: Format): string { return formatLabel(format); }

function searchKey(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slotTitle(layout: Slide["layout"] | undefined, slot: ShotSlot): string {
  if (layout === "split-v" || layout === "split-h") {
    return slot === 1 ? L("1. özellik (giriş)", "Feature 1 (intro)") : slot === 2 ? L("2. özellik (ana ekran)", "Feature 2 (home screen)") : L("3. özellik", "Feature 3");
  }
  return L(`${slot}. ekran`, `Screen ${slot}`);
}

export default function MediaPool({
  tab,
  width,
  onClose,
}: {
  tab: PoolTab;
  width: number;
  onClose: () => void;
}) {
  const project = useStudio((s) => s.project);
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const assets = useAssets();
  const set = project.sets[project.activeLocale];
  const slide: Slide | undefined = set?.slides.find((x) => x.id === activeSlideId) || set?.slides[0];

  const count =
    tab === "shots"
      ? project.screenshots.length
      : tab === "templates"
        ? TEMPLATES.filter(t=>templateForFormat(t,formatOf(project))).length
        : assets.bg.length + assets.textures.length + assets.generated.length + COLLECTIONS.length + BRAND_ARTWORK.filter(a=>!a.alpha).length;

  return (
    <aside className="drawer" style={{ width }} aria-label={POOL_LABELS[tab]}>
      <div className="drawer-head">
        <h2>{POOL_LABELS[tab]}</h2>
        <span className="drawer-cnt">{String(count).padStart(2, "0")}</span>
        <button className="tb-icbtn" onClick={onClose} title={L("Çekmeceyi kapat", "Close drawer")} aria-label={L("Kapat", "Close")}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="pool-body">
        {tab === "shots" && <p className="note pool-empty">{L("Ekran görüntüleri v1.0'da sağdaki Ekranlar panelinde.", "Screenshots live in the Screens panel on the right since v1.0.")}</p>}
        {tab === "templates" && <TemplatesTab />}
        {tab === "images" && <ImagesTab slide={slide} />}
      </div>
    </aside>
  );
}

/* ================================================================== *
   Şablonlar — eski galeri, davranış birebir
 * ================================================================== */

export function TemplatesTab() {
  const project = useStudio((s) => s.project);
  const mutate = useStudio((s) => s.mutate);
  const [kat, setKat] = useState<TemplateKategori | "all">("all");
  const [query, setQuery] = useState("");
  const format = formatOf(project);
  const isTabletFormat = isTabletKind(kindOfFormat(format));
  const aspect = thumbAspectOf(format);
  // Örnek slayt = aktif dilin ilk slaydı → şablon kartına kullanıcının KENDİ
  // ekranı basılır. Yoksa engine/thumbs.ts paketli örnek ekrana düşer.
  const sample = project.sets[project.activeLocale]?.slides[0];
  // renderRev köprüsü — render gövdesinde, çocuk efektlerinden önce.
  const rev = useRenderRev();
  syncThumbRev(rev);

  const eligible = useMemo(
    () => TEMPLATES.filter((t) => templateForFormat(t, format)),
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
      const mode = isSplitScreen(t.style(0)) ? "Kırpma" : (t.style(0).device?.mode ?? theme.device.mode) === "3d" ? "3D" : "2D";
      return searchKey(`${t.name} ${t.hint} ${category} ${theme.name} ${mode} ${formatTag(format)}`).includes(needle);
    });
  }, [eligible, kat, query, format]);

  // Tek slaytlık (henüz kurulmamış) sette şablonun kendi setini basar; dolu
  // sette metinlere dokunmadan sadece giysiyi değiştirir. (Eski davranış.)
  const applyTemplate = async (t: Template) => {
    const slides = project.sets[project.activeLocale]?.slides ?? [];
    const fresh = slides.length === 0 || slides.length===1 && !slides[0].screenshot && ["Başlık buraya", "Headline here"].includes(slides[0].headline);
    mutate((p) => {
      const s = p.sets[p.activeLocale];
      if (s) s.slides = fresh ? t.build() : restyleSlides(s.slides, t.id);
      return p;
    });
    // restyleSlides updateSlide'ı atladığı için senkron fan-out'u elle tetiklenir;
    // kapalıysa ya da taze kurulumsa (yeni designKey'ler eşleşmez) no-op.
    if (!fresh && useStudio.getState().project.syncDesign) {
      useStudio.getState().applyDesignToAllLocales();
    }
  };

  return (
    <>
      <div className="gallery-search pool-template-search">
        <Icon name="search" size={13} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={L("Şablon adı, tema veya açıklama ara…", "Search template name, theme or description…")}
          aria-label={L("Şablon ara", "Search templates")}
        />
      </div>
      <p className="gallery-format pool-template-format">
        <span>{L("Proje formatı", "Project format")}</span>
        <b>{formatTag(format)}</b>
        <small>{L(`${visible.length} / ${eligible.length} şablon`, `${visible.length} / ${eligible.length} templates`)}</small>
      </p>
      <div className="chips" style={{ marginBottom: 10 }}>
        {TEMPLATE_KATEGORILER.filter(k=>k.id==="all" || (categoryCounts.get(k.id)??0)>0).map((k) => (
          <button
            key={k.id}
            type="button"
            className={`chip k ${kat === k.id ? "on" : ""}`}
            disabled={k.id !== "all" && categoryCounts.get(k.id) === 0}
            aria-pressed={kat === k.id}
            onClick={() => setKat(k.id)}
          >
            {k.label}
            <small className="gallery-chip-count">{categoryCounts.get(k.id) ?? 0}</small>
          </button>
        ))}
      </div>
      <p className="note pool-note">
        {L("Tema ve kadraj birlikte uygulanır. Dolu sette metin ve ekranlar korunur; elle yapılan stil ayarları sıfırlanır.", "Theme and layout are applied together. In a populated set, text and screens are kept; manual style adjustments are reset.")}
      </p>
      {format === "iphone" && BRAND_COLLECTIONS.length > 0 && <a className="btn sm wide" style={{marginBottom:12}} href="/brand-themes">{L(`${BRAND_COLLECTIONS.map(c=>c.app).join(" · ")} özel serileri ↗`, `${BRAND_COLLECTIONS.map(c=>c.app).join(" · ")} custom series ↗`)}</a>}
      {/* Gerçek render önizleme kartları (engine/thumbs.ts) */}
      <style>{THUMB_CSS}</style>
      <div className="vt-cards c1">
        {visible.map((t) => (
          <PoolThumbCard
            key={t.id}
            id={t.id}
            name={t.family ? getTheme(t.themeId).name : t.name}
            hint={t.hint}
            category={TEMPLATE_KATEGORILER.find((k) => k.id === t.kategori)?.label ?? t.kategori}
            mode={isSplitScreen(t.style(0)) ? "Kırpma" : (t.style(0).device?.mode ?? getTheme(t.themeId).device.mode) === "3d" ? "3D" : "2D"}
            sample={sample}
            format={format}
            aspect={aspect}
            rev={rev}
            selected={!!t.family && sample?.themeId === t.themeId}
            onClick={() => applyTemplate(t)}
          />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="note pool-empty">
          {kat === "ipad" && !isTabletFormat
            ? L("iPad şablonları yalnız iPad biçimli projelerde gösterilir. Bu proje iPhone · 110:239 biçiminde.", "iPad templates are only shown in iPad-format projects. This project is iPhone · 110:239.")
            : L("Aramanla eşleşen şablon yok.", "No templates match your search.")}
        </p>
      )}
    </>
  );
}

/**
 * Şablon kartı — engine/thumbs.ts'in ürettiği gerçek minyatür + künye.
 * Yalnız GÖRÜNEN kart kuyruğa girer; önbellek localStorage'da yaşadığı için
 * sekmeye ikinci girişte ızgara anında dolu gelir.
 */
const PoolThumbCard = memo(function PoolThumbCard({
  id,
  name,
  hint,
  category,
  mode,
  sample,
  format,
  aspect,
  rev,
  selected = false,
  onClick,
}: {
  id: string;
  name: string;
  hint?: string;
  category: string;
  mode: "2D" | "3D" | "Kırpma";
  sample?: Slide;
  format: Format;
  aspect: number;
  rev: number;
  selected?: boolean;
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
      className={`vt-card row ${selected ? "on" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
      title={`${hint || name} · ${category} · ${mode === "Kırpma" ? L("Kırpma", "Crop") : mode} · ${formatTag(format)}`}
    >
      <span className="vt-shot" style={{ width: Math.round(108 * aspect), height: 108 }}>
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
          <i>{mode === "Kırpma" ? L("Kırpma", "Crop") : mode}</i>
          <i>{formatTag(format)}</i>
        </span>
        {hint && <span className="vt-hint">{hint}</span>}
      </span>
    </button>
  );
});

/* ================================================================== *
   Görseller — zeminler · dokular · Wiro üretimleri
 * ================================================================== */

const IMAGE_GROUPS: { key: "bg" | "textures" | "generated"; label: string; alpha: number }[] = [
  { key: "bg", label: L("Hazır zeminler", "Preset backgrounds"), alpha: 0.2 },
  { key: "textures", label: L("Dokular", "Textures"), alpha: 0.12 },
  { key: "generated", label: L("Üretilenler", "Generated"), alpha: 0.25 },
];

export function ImagesTab({ slide, only }: { slide?: Slide; only?: "bg" | "stickers" }) {
  const assets = useAssets();
  const updateSlide = useStudio((s) => s.updateSlide);
  const [modeRaw, setMode] = useState<"bg" | "stickers">("bg");
  const mode = only ?? modeRaw;
  const [query,setQuery] = useState("");
  const bg: Background | null = slide ? slide.background ?? getTheme(slide.themeId).background : null;
  const currentSrc = bg && bg.kind === "image" ? bg.src : null;

  const apply = (src: string, alpha: number) => {
    if (!slide) return;
    updateSlide(slide.id, {
      background: { kind: "image", src, overlayColor: "#000", overlayAlpha: alpha, ...(cropFor(src) && formatOf(useStudio.getState().project) === "iphone" ? { crop: cropFor(src) } : {}) },
    });
  };

  const total = IMAGE_GROUPS.reduce((n, g) => n + assets[g.key].length, 0);

  return (
    <>
      {/* Zemin ↔ Sticker: aynı çekmecenin iki içeriği. Sticker bir ZEMİN
          değil, slaytın üstüne oturan serbest ÖĞEDİR — ayrı bir dil. */}
      {!only && <div className="chips" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`chip k ${mode === "bg" ? "on" : ""}`}
          onClick={() => setMode("bg")}
        >
          {L("Zeminler", "Backgrounds")}
        </button>
        <button
          type="button"
          className={`chip k ${mode === "stickers" ? "on" : ""}`}
          onClick={() => setMode("stickers")}
        >
          {L("Sticker", "Stickers")}
        </button>
      </div>}
      {mode === "stickers" && <StickersPane slide={slide} />}
      {mode === "bg" && (
      <>
      <div className="pool-head">
        <span className="pool-count">{L("Zemin kütüphanesi", "Background library")}</span>
        {slide?.background && (
          <button
            className="btn xs"
            onClick={() => updateSlide(slide.id, { background: undefined })}
          >
            <Icon name="reset" size={11} />
            {L("Temaya dön", "Back to theme")}
          </button>
        )}
      </div>
      <label className="gallery-search"><Icon name="search" size={14}/><input type="search" aria-label={L("Arka plan ara", "Search backgrounds")} placeholder={L("Arka plan ara…", "Search backgrounds…")} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {BRAND_COLLECTIONS.map(c => {
        const artwork = BRAND_ARTWORK.filter(a => a.theme === c.id && !a.alpha && searchKey(c.app+" "+a.label).includes(searchKey(query)));
        return artwork.length ? <section className="pool-sec" key={c.id}><h4>{c.app} <em>{L("Özel seri", "Custom series")}</em></h4><div className="collection-backgrounds">{artwork.map(a => <button key={a.id} className={`collection-bg ${currentSrc===brandAsset(c.id,a.id)?'on':''}`} onClick={()=>apply(brandAsset(c.id,a.id),0)} aria-label={L(`${c.app} ${a.label} arka planı`, `${c.app} ${a.label} background`)}><img src={`/assets/brand-previews/${a.id}.webp`} alt={a.label} loading="lazy" decoding="async"/><span><b>{a.label}</b><small>{L(`${c.app} için üretildi`, `Made for ${c.app}`)}</small></span></button>)}</div></section> : null;
      })}
      <section className="pool-sec"><h4>{L("Yeni koleksiyon", "New collection")} <em>GPT Image</em></h4><div className="collection-backgrounds">
        {COLLECTIONS.filter(c=>searchKey(c.name+" "+c.description).includes(searchKey(query))).map(c=><button key={c.id} className={`collection-bg ${currentSrc===`/assets/collections/${c.id}.webp`?'on':''}`} onClick={()=>apply(`/assets/collections/${c.id}.webp`,0)} aria-label={L(`${c.name} arka planı`, `${c.name} background`)}><img src={previewSrc(`/assets/collections/${c.id}.webp`)} alt={c.name} loading="lazy" decoding="async"/><span><b>{c.name}</b><small>{c.description}</small></span></button>)}
      </div></section>
      {IMAGE_GROUPS.map((g) => {
        const files = assets[g.key].filter(f=>searchKey(f).includes(searchKey(query)));
        if (!files.length) return null;
        const dir = g.key === "bg" ? "bg" : g.key;
        return (
          <section key={g.key} className="pool-sec">
            <h4>
              {g.label}
              <em>{files.length}</em>
            </h4>
            <div className="img-grid">
              {files.map((f) => {
                const src = `/assets/${dir}/${f}`;
                return (
                  <button
                    key={f}
                    className={`img-card ${currentSrc === src ? "on" : ""}`}
                    onClick={() => apply(src, g.alpha)}
                    title={f}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewSrc(src)} alt={f} loading="lazy" decoding="async" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {total === 0 && <p className="note pool-empty">{L("Henüz görsel yok.", "No images yet.")}</p>}
      </>
      )}
    </>
  );
}

/* ================================================================== *
   Sticker ızgarası (R8/W2) — /api/assets `stickers` + `pale/` alt klasörü.

   Tıklama slaytın MERKEZİNE 320 BASE px genişliğinde bir `sticker` ÖĞESİ
   ekler; yükseklik asset'in gerçek en/boy oranından gelir (kutu gerdiğinde
   görüntü ezilmesin). Yeni öğe seçili gelir → Inspector "Öğeler" bölümü ve
   tuval çerçevesi anında açılır.

   Sürükle-bırak: Stage'e bırakma noktası da destekleniyor (dataTransfer
   ile sticker yolu taşınır); ızgara kartları `draggable`.
 * ================================================================== */

export function StickersPane({ slide }: { slide?: Slide }) {
  const assets = useAssets();
  const updateSlide = useStudio((s) => s.updateSlide);
  const setSelected = useStudio((s) => s.setSelectedElement);
  // Finder'dan bırakılan ya da "Ekle" ile seçilen görseller kütüphaneye
  // (stickers/yuklenen/) kaydolur ve "Yüklediklerin" bölümünde en üstte çıkar.
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFiles = async (list: FileList | null) => {
    const picked = imageFiles(list);
    if (!picked.length) return;
    try {
      await Promise.all(picked.map(uploadImage));
      await refreshAssets();
      pushToast({ msg: L(`${picked.length} GÖRSEL KÜTÜPHANEDE · TIKLA YA DA TUVALE SÜRÜKLE`, `${picked.length} IMAGE(S) IN LIBRARY · CLICK OR DRAG TO CANVAS`) });
    } catch (err) {
      pushToast({ msg: L(`GÖRSEL EKLENEMEDİ · ${err instanceof Error ? err.message : err}`, `IMAGE NOT ADDED · ${err instanceof Error ? err.message : err}`), kind: "err" });
    }
  };
  // `AssetList` kit tipinde `stickers` yok; JSON'da geliyor (ui.tsx spread'i
  // bilinmeyen anahtarları korur). Kit'e dokunmadan okunur.
  // R14: sticker'lar + MARKA varlıkları (public/assets/brand/<uygulama>/) tek
  // ızgarada. Marka dosyaları "brand:" önekiyle taşınır ki kaynak yolu doğru
  // kurulsun; kart etiketi uygulama klasörünü gösterir ("uygulama/mark.png").
  const files = useMemo(() => {
    const a = assets as AssetList & { stickers?: string[]; brand?: string[] };
    const isImg = (f: string) => /\.(png|webp|jpg|jpeg)$/i.test(f);
    const st = (a.stickers ?? []).filter(isImg);
    const backgroundPaths = new Set(BRAND_ARTWORK.filter(a=>!a.alpha).map(a=>`${a.theme}/${a.id}.webp`));
    const br = (a.brand ?? []).filter(f=>isImg(f) && !backgroundPaths.has(f)).map((f) => `brand:${f}`);
    return [...br, ...st];
  }, [assets]);

  const srcOf = (file: string) =>
    file.startsWith("brand:") ? `/assets/brand/${file.slice(6)}` : `/assets/stickers/${file}`;
  const uploads = files.filter((f) => f.startsWith("yuklenen/"));
  const poses = BRAND_ARTWORK.filter(a=>a.alpha);
  const curatedPaths = new Set(poses.map(a=>`brand:${a.theme}/${a.id}.webp`));

  const add = async (file: string) => {
    if (!slide) return;
    const src = srcOf(file);
    const img = await loadImage(src);
    const w = 320;
    const h = img && img.width ? Math.round((w * img.height) / img.width) : w;
    const el = makeElement("sticker", uid(), { src, w, h });
    updateSlide(slide.id, { elements: [...(slide.elements ?? []), el] });
    setSelected(el.id);
  };

  return (
    <>
      <div className="pool-head">
        <span className="pool-count">{L("Sticker", "Stickers")}</span>
        <em style={{ color: "var(--ink-4)", fontStyle: "normal", fontSize: 10 }}>
          {String(files.length).padStart(2, "0")}
        </em>
        <button className="btn xs" onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={11} />
          {L("Ekle", "Add")}
        </button>
      </div>
      <div
        className={`drop compact ${over ? "over" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void onFiles(e.dataTransfer.files); }}
      >
        {L("Görsel bırak: kütüphaneye eklenir", "Drop images: added to the library")}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <p className="note pool-note">
        {L("Tıkla: slaytın ortasına ekler. Tuvale sürükle: bıraktığın yere ekler. Finder'dan dosyayı doğrudan tuvale de bırakabilir, ⌘V ile yapıştırabilirsin.", "Click to add to the center of the slide. Drag to the canvas to drop it there. You can also drop files from Finder onto the canvas or paste with ⌘V.")}
      </p>
      {uploads.length > 0 && <section className="pool-sec"><h4>{L("Yüklediklerin", "Your uploads")} <em>{uploads.length}</em></h4><div className="img-grid">{uploads.map((f) => (
        <button key={f} className="img-card" style={{ background: "repeating-conic-gradient(#e4e7ee 0 25%, #f5f6f9 0 50%) 0 0 / 14px 14px" }} onClick={() => add(f)} title={f.slice("yuklenen/".length)} draggable onDragStart={(e) => e.dataTransfer.setData("text/vitrin-sticker", f)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={srcOf(f)} alt={f} loading="lazy" decoding="async" />
        </button>
      ))}</div></section>}
      {BRAND_COLLECTIONS.filter(c=>poses.some(a=>a.theme===c.id)).map(c=>{const own=poses.filter(a=>a.theme===c.id);return <section key={c.id} className="pool-sec"><h4>{c.app} <em>{L(`${own.length} özgün poz`, `${own.length} original poses`)}</em></h4><div className="img-grid">{own.map(a=>{
        const file=`brand:${a.theme}/${a.id}.webp`;
        return <button key={a.id} className="img-card" onClick={()=>add(file)} title={a.label} aria-label={`${c.app} ${a.label}`} draggable onDragStart={e=>e.dataTransfer.setData("text/vitrin-sticker",file)}><img src={`/assets/brand-previews/${a.id}.webp`} alt={a.label} loading="lazy" decoding="async"/></button>;
      })}</div></section>;})}
      <div className="img-grid">
        {files.filter(f=>!curatedPaths.has(f) && !f.startsWith("yuklenen/")).map((f) => (
          <button
            key={f}
            className="img-card"
            onClick={() => add(f)}
            title={f.startsWith("brand:") ? L(`Marka · ${f.slice(6)}`, `Brand · ${f.slice(6)}`) : f}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/vitrin-sticker", f)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewSrc(srcOf(f))} alt={f} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {files.length === 0 && <p className="note pool-empty">{L("Henüz sticker yok.", "No stickers yet.")}</p>}
    </>
  );
}
