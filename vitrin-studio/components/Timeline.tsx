"use client";
import { formatOf } from "@/engine/types";

// FİLM ŞERİDİ (rapor §5) — Arcade'in "thumb + altında başlık çipi + sonda
// kesikli +" kalıbı, Krea'nın metin şeridi hizası.
//
//   · kart üstünde mono künye `01`…`09`
//   · AKTİF kart = üst kenarda 4px Klein bandı + 2px Klein çerçeve
//   · SEÇİLİ kart = 2px kemik dış hat + sol üstte kemik onay rozeti
//     (Klein bütçesi korunur: seçim asla Klein kullanmaz)
//   · sürükle-sırala: kalkan kart -1.5° + sert 4px mürekkep gölgesi
//     (blur YOK — brutalist), boşluk komşunun ortasını geçince açılır
//   · sonda kesikli `+`
//   · çevrilmemiş kopya (needsCopy) = amber köşe üçgeni
//
// AKTİF ≠ SEÇİLİ (C21): aktif, Inspector'ın GÖSTERDİĞİ tek slayttır; seçili,
// TOPLU İŞLEMİN hedefidir. İkisi de UI durumudur (store'da, proje DIŞINDA).
// Seçim boşken toplu işlemler aktif slayta düşer.
//
// Klavye (şerit odaktayken — kuyu odaktayken oklar CİHAZINDIR, C25):
//   ←/→ aktif slayt · ⇧+←/→ aralık büyüt · Home/End · ⌘A seç-tümü ·
//   Esc seçimi temizle · ⌫ seçiliyi sil · ⌘D seçiliyi çoğalt
// ⌘C/⌘V şerit odakta OLMASA da çalışır (diller arası akışta araya dil
// seçicisinin tıklanması giriyor) — yalnız metin alanlarında susar.
//
// Yıkıcı işlemler geri alınabilir: silme bant-toast bırakır.
// Yapısal işlemlerin "tüm diller" ikizleri sağdaki eylem grubunda.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { perfAdd, perfGauge } from "@/engine/perf";
import { renderThumb, slideSignature } from "@/engine/render";
import { enqueue, thumbQueueDepth } from "@/engine/thumbs";
import type { Slide } from "@/engine/types";
import { bulkTargetIds, copySlidesToClip, slideClipInfo, useStudio } from "@/store/studio";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { copyStyle, styleClip, styleClipLabel } from "./styleClip";
import { pushToast, pushUndoToast } from "./toast";
import { Icon, useRenderRev } from "./ui";
import { L } from "@/lib/i18n";

const Frame = memo(function Frame({
  slide,
  index,
  active,
  selected,
  dragging,
  scrollRef,
  onPick,
  onDragStart,
  onMenu,
}: {
  slide: Slide;
  index: number;
  active: boolean;
  /** Toplu işlem hedefi mi? (aktiften BAĞIMSIZ — ikisi aynı anda olabilir) */
  selected: boolean;
  dragging: boolean;
  /** Şerit kaydırıcısı — IntersectionObserver kökü (yatay görünürlük). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Değiştirici tuşa göre aktif/seçim kararını Timeline verir. */
  onPick: (e: React.PointerEvent, id: string) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const removeSlide = useStudio((s) => s.removeSlide);
  const duplicateSlide = useStudio((s) => s.duplicateSlide);
  const canDelete = useStudio((s) => (s.project.sets[s.project.activeLocale]?.slides.length ?? 0) > 1);
  const thumbLocale = useStudio((s) => s.project.activeLocale);
  const thumbFormat = useStudio((s) => formatOf(s.project));
  const json = slideSignature(slide);
  const rev = useRenderRev(); // tema (overlay vb.) yerinde düzenlenince tazele

  /* --------------------------------------------------------------- *
     C29 — GÖRÜNÜR KART ÇİZİLİR, KUYRUKTAN GEÇEREK

     Eskiden: her slayt JSON'u değişince 220ms sonra N kart PARALEL
     `renderThumb(240)` çağırıyordu — 15 dil × N slaytlık şeritte şerit
     yatay kaydırıldığında ekran dışındaki kartlar da çiziliyordu.
     Şimdi: (a) IntersectionObserver ile yalnız görünen (± yarım ekran)
     kartlar çizilir, (b) çizim `engine/thumbs` kuyruğundan geçer (en fazla
     2 eşzamanlı, aralarda makro-görev → şerit kaydırma akıcı kalır),
     (c) aynı imza iki kez çizilmez: görüş alanına tekrar girmek yeniden
     render TETİKLEMEZ.
   * --------------------------------------------------------------- */
  const [visible, setVisible] = useState(false);
  const drawnRef = useRef<string | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true); // eski tarayıcı: eski davranışa düş
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setVisible(true);
        // Görünürden çıkınca `false`'a DÖNMÜYORUZ: çizilmiş kare DOM'da
        // kalır, geri gelince yeniden çizim gerekmez (titreme yok).
      },
      // 160px ≈ 2 kart ileri: kaydırırken kare hazır olsun ama ekran dışında
      // 10 kart boşuna çizilmesin (kart 64px + 8px boşluk).
      { root: scrollRef.current ?? null, rootMargin: "0px 160px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    if (!visible) return; // ekran dışı: sıraya bile girme
    const sig = `${json}|${rev}|${thumbLocale}|${thumbFormat}`;
    if (drawnRef.current === sig) return; // aynı kare zaten basılı
    let dead = false;
    const t = setTimeout(() => {
      void enqueue(async () => {
        if (dead || !hostRef.current) return;
        perfGauge("thumb.queue", thumbQueueDepth());
        const t0 = performance.now();
        try {
          const c = await renderThumb(slide, 240, true, thumbLocale, thumbFormat);
          perfAdd("thumb.render", performance.now() - t0);
          if (dead || !hostRef.current) return;
          hostRef.current.replaceChildren(c);
          drawnRef.current = sig;
        } catch {
          /* modüller hazır değilse sessiz geç */
        }
      });
    }, 220);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, rev, visible, thumbLocale, thumbFormat]);

  // Aktif kart her zaman görünür kalsın (1-9 kısayolu ve ⌘D için önemli).
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={cardRef}
      className={`tl-item ${active ? "on" : ""} ${selected ? "sel" : ""} ${dragging ? "drag" : ""}`}
      data-slide={slide.id}
      role="option"
      aria-selected={selected || active}
      onContextMenu={(e) => onMenu(e, slide.id)}
    >
      <span className="tl-no">{String(index + 1).padStart(2, "0")}</span>
      <div
        className={`frame ${active ? "on" : ""} ${selected ? "sel" : ""}`}
        onPointerDown={(e) => {
          onPick(e, slide.id);
          onDragStart(e, slide.id);
        }}
        title={slide.headline || slide.frameLabel}
      >
        <div className="frame-img" ref={hostRef} />
        {selected && (
          <span className="pick" title={L("Seçili (toplu işlem hedefi)", "Selected (bulk action target)")}>
            <Icon name="check" size={9} />
          </span>
        )}
        {slide.needsCopy && <span className="needs" title={L("Metin kaynak dilden kopyalandı", "Text copied from the source locale")} />}
        <span className="ops">
          <button
            title={L("Çoğalt (⌘D)", "Duplicate (⌘D)")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => (e.stopPropagation(), duplicateSlide(slide.id))}
          >
            <Icon name="copy" size={11} />
          </button>
          <button
            className="danger"
            title={L("Sil", "Delete")}
            disabled={!canDelete}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (!canDelete) return;
              removeSlide(slide.id);
              pushUndoToast(L("SLAYT SİLİNDİ", "SLIDE DELETED"));
            }}
          >
            <Icon name="trash" size={11} />
          </button>
        </span>
      </div>
      <span className="tl-cap">{slide.headline || slide.frameLabel || "—"}</span>
    </div>
  );
});

export default function Timeline() {
  const project = useStudio((s) => s.project);
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const selectedIds = useStudio((s) => s.selectedIds);
  const addSlide = useStudio((s) => s.addSlide);
  const addSlideAllLocales = useStudio((s) => s.addSlideAllLocales);
  const removeSlideAllLocales = useStudio((s) => s.removeSlideAllLocales);
  const duplicateSlide = useStudio((s) => s.duplicateSlide);
  const removeSlide = useStudio((s) => s.removeSlide);
  const moveSlide = useStudio((s) => s.moveSlide);
  const clearSelection = useStudio((s) => s.clearSelection);
  const set = project.sets[project.activeLocale];
  const slides = set?.slides ?? [];
  const activeId = activeSlideId || slides[0]?.id;
  const multi = Object.keys(project.sets).length > 1;
  const active = slides.find((s) => s.id === activeId);

  // Ölü id'ler (silinmiş slayt, dil değişimi) burada ayıklanır: seçim
  // durumunun kendisi asla "temizlenmek zorunda" değil, GÖRÜNÜMÜ süzülür.
  const selSet = useMemo(() => {
    const live = new Set(slides.map((s) => s.id));
    return new Set(selectedIds.filter((id) => live.has(id)));
  }, [selectedIds, slides]);
  const selCount = selSet.size;

  const stripRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  /* --------------------------------------------------------------- *
     Tık kararı — aktif ≠ seçili ayrımının tek yeri
       düz tık   : aktif ol; kart seçimin İÇİNDE DEĞİLSE seçimi temizle
                   (içindeyse seçim korunur → seçili blok sürüklenebilir)
       ⌘ / Ctrl  : seçime ekle-çıkar (çapayı da taşır)
       ⇧         : ÇAPADAN tıklanana kadar aralık
       sağ tık   : yalnız çapayı işaretler — menü kararını `onMenu` verir
   * --------------------------------------------------------------- */
  // Aralık ÇAPASI — UI'nin en yerel durumu (bileşen ömürlü ref).
  // Düz tık / ⌘ tık / düz ok çapayı taşır; ⇧ hamleleri ÇAPADAN ölçer.
  // Olmasaydı her ⇧+ok aktifi de taşıdığı için aralık büyümez, KAYARDI.
  const anchorRef = useRef<string | null>(null);

  const onPick = useCallback((e: React.PointerEvent, id: string) => {
    const st = useStudio.getState();
    stripRef.current?.focus({ preventScroll: true }); // C25: oklar şeride ait olsun
    // Sağ tık: menüyü açan jest seçim aritmetiği YAPMAZ, yalnız hedefi işaretler.
    if (e.button === 2) {
      anchorRef.current = id;
      return;
    }
    if (e.shiftKey) {
      st.selectRange(id, anchorRef.current ?? undefined);
      return;
    }
    anchorRef.current = id;
    if (e.metaKey || e.ctrlKey) {
      st.toggleSelected(id);
      return;
    }
    if (!st.selectedIds.includes(id)) st.clearSelection();
    st.setActiveSlide(id);
  }, []);

  /* --------------------------------------------------------------- *
     Pano (C23) — hedef `bulkTargetIds`: seçim varsa o, yoksa aktif slayt.
   * --------------------------------------------------------------- */
  const doCopy = useCallback((): number => {
    const st = useStudio.getState();
    const p = st.project;
    const list = p.sets[p.activeLocale]?.slides ?? [];
    const want = new Set(bulkTargetIds(st));
    const n = copySlidesToClip(
      list.filter((s) => want.has(s.id)),
      p.activeLocale
    );
    if (n) {
      pushToast({
        msg: L(`${String(n).padStart(2, "0")} SLAYT PANOYA · ${p.activeLocale.toUpperCase()}`, `${String(n).padStart(2, "0")} SLIDES COPIED · ${p.activeLocale.toUpperCase()}`),
        ttl: 2600,
      });
    }
    return n;
  }, []);

  const doPaste = useCallback((): number => {
    const r = useStudio.getState().pasteSlides();
    if (!r.inserted) return 0;
    const loc = useStudio.getState().project.activeLocale.toUpperCase();
    const parts = [L(`${String(r.inserted).padStart(2, "0")} SLAYT YAPIŞTIRILDI`, `${String(r.inserted).padStart(2, "0")} SLIDES PASTED`), loc];
    // Çakışan anahtar sayısı KÜNYEYE yazılır: kullanıcı hangi slaytların
    // diller arası bağını KAYBETTİĞİNİ (yeni satır açtığını) görsün.
    if (r.fresh) parts.push(L(`${r.fresh} YENİ ANAHTAR`, `${r.fresh} NEW KEYS`));
    pushUndoToast(parts.join(" · "));
    return r.inserted;
  }, []);

  /* Kart bağlam menüsü — sıralama okları, çoğalt/sil ve "tüm diller"
     ikizleri burada yaşar (kart 60px dar; hover'da yalnız iki eylem var).
     SEÇİM VARSA menü tamamen "N slayta uygula" diline geçer (C22): aynı
     jest, farklı ölçek — kullanıcı iki ayrı menü öğrenmez. */
  const menuItems = (id: string): MenuItem[] => {
    const st = useStudio.getState();
    const p = st.project;
    const list = p.sets[p.activeLocale]?.slides ?? [];
    const i = list.findIndex((s) => s.id === id);
    const sl = list[i];
    if (!sl) return [];
    const many = Object.keys(p.sets).length > 1;
    const clip = styleClip();
    const clipTheme = clip?.themeId;
    const board = slideClipInfo();
    const pasteLabel = board
      ? L(`Yapıştır · ${board.count} slayt (${board.locale.toUpperCase()})`, `Paste · ${board.count} slides (${board.locale.toUpperCase()})`)
      : L("Yapıştır", "Paste");
    const sel = st.selectionIds();

    // ---- ÇOKLU SEÇİM MENÜSÜ ----
    if (sel.length > 1 && sel.includes(id)) {
      const n = sel.length;
      return [
        { kind: "head", label: L(`${String(n).padStart(2, "0")} SLAYT SEÇİLİ`, `${String(n).padStart(2, "0")} SLIDES SELECTED`) },
        {
          kind: "item",
          label: L(`Tema yapıştır · ${n} slayta`, `Paste theme · ${n} slides`),
          icon: "palette",
          hint: clipTheme ? String(clipTheme).slice(0, 10) : undefined,
          disabled: !clipTheme,
          run: () => {
            const c = styleClip();
            if (!c?.themeId) return;
            const k = st.applyDesignToSelected({ themeId: c.themeId });
            pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYTA TEMA UYGULANDI`, `${String(k).padStart(2, "0")} SLIDES THEMED`));
          },
        },
        {
          kind: "item",
          label: L(`Stili yapıştır · ${n} slayta`, `Paste style · ${n} slides`),
          icon: "paste",
          hint: clip ? styleClipLabel().slice(0, 10) : undefined,
          disabled: !clip,
          run: () => {
            const c = styleClip();
            if (!c) return;
            const k = st.applyDesignToSelected(c);
            pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYTA STİL UYGULANDI`, `${String(k).padStart(2, "0")} SLIDES STYLED`));
          },
        },
        { kind: "sep" },
        {
          kind: "item",
          label: L(`Çoğalt · ${n} slayt`, `Duplicate · ${n} slides`),
          icon: "copy",
          hint: "⌘D",
          run: () => {
            const k = st.duplicateSelected();
            pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT ÇOĞALTILDI`, `${String(k).padStart(2, "0")} SLIDE DUPLICATED`));
          },
        },
        {
          kind: "item",
          label: L(`Sil · ${n} slayt`, `Delete · ${n} slides`),
          icon: "trash",
          danger: true,
          hint: "⌫",
          // Tümü seçiliyse silme yok: hiçbir dil boş kalmaz.
          disabled: n >= list.length,
          run: () => {
            const k = st.removeSelected();
            if (k) pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT SİLİNDİ`, `${String(k).padStart(2, "0")} SLIDE DELETED`));
          },
        },
        { kind: "sep" },
        { kind: "item", label: L(`Kopyala · ${n} slayt`, `Copy · ${n} slides`), icon: "copy", hint: "⌘C", run: doCopy },
        {
          kind: "item",
          label: pasteLabel,
          icon: "paste",
          hint: "⌘V",
          disabled: !board,
          run: doPaste,
        },
        { kind: "sep" },
        { kind: "item", label: L("Stili kopyala", "Copy style"), icon: "brush", run: () => copyStyle(sl) },
        {
          kind: "item",
          label: L("Seçimi temizle", "Clear selection"),
          icon: "x",
          hint: "Esc",
          run: () => st.clearSelection(),
        },
      ];
    }

    // ---- TEK KART MENÜSÜ ----
    return [
      { kind: "head", label: `${String(i + 1).padStart(2, "0")} · ${sl.headline?.slice(0, 18) || L("başlıksız", "untitled")}` },
      { kind: "item", label: L("Sola al", "Move left"), icon: "left", disabled: i <= 0, run: () => st.moveSlide(id, -1) },
      {
        kind: "item",
        label: L("Sağa al", "Move right"),
        icon: "right",
        disabled: i < 0 || i >= list.length - 1,
        run: () => st.moveSlide(id, 1),
      },
      { kind: "sep" },
      { kind: "item", label: L("Çoğalt", "Duplicate"), icon: "copy", hint: "⌘D", run: () => st.duplicateSlide(id) },
      {
        kind: "item",
        label: L("Sil", "Delete"),
        icon: "trash",
        danger: true,
        disabled: list.length <= 1,
        run: () => {
          st.removeSlide(id);
          pushUndoToast(L("SLAYT SİLİNDİ", "SLIDE DELETED"));
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: L("Tüm dillere ekle", "Add to all locales"),
        icon: "globe",
        disabled: !many,
        run: () => st.addSlideAllLocales(sl.designKey),
      },
      {
        kind: "item",
        label: L("Tüm dillerden sil", "Delete from all locales"),
        icon: "globe",
        danger: true,
        disabled: !many || list.length <= 1 || !sl.designKey,
        run: () => {
          if (!sl.designKey) return;
          st.removeSlideAllLocales(sl.designKey);
          pushUndoToast(L("SLAYT TÜM DİLLERDEN SİLİNDİ", "SLIDE DELETED FROM ALL LOCALES"));
        },
      },
      { kind: "sep" },
      { kind: "item", label: L("Kopyala", "Copy"), icon: "copy", hint: "⌘C", run: doCopy },
      { kind: "item", label: pasteLabel, icon: "paste", hint: "⌘V", disabled: !board, run: doPaste },
      { kind: "sep" },
      { kind: "item", label: L("Stili kopyala", "Copy style"), icon: "brush", run: () => copyStyle(sl) },
      {
        kind: "item",
        label: clip ? L(`Stili yapıştır · ${styleClipLabel()}`, `Paste style · ${styleClipLabel()}`) : L("Stili yapıştır", "Paste style"),
        icon: "paste",
        disabled: !clip,
        run: () => {
          const c = styleClip();
          if (c) st.updateSlide(id, c);
        },
      },
    ];
  };

  /* --------------------------------------------------------------- *
     Sürükle-sırala: komşunun ORTASINI geçince tek adım kaydır.
     moveSlide zaten senkron sırası (syncOrder) çalıştırıyor, yani
     15 dil aynı mutate içinde yeniden diziliyor — tek ⌘Z.
   * --------------------------------------------------------------- */
  const dragRef = useRef<{ id: string; x: number; moved: boolean } | null>(null);

  // memo(Frame)'in işe yaraması için iki geri çağrı da SABİT kimlikte olmalı;
  // yoksa şeritteki her yeniden çizimde 15 kart birden yeniden render olur.
  const onDragStart = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    dragRef.current = { id, x: e.clientX, moved: false };
  }, []);

  const onMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    // Seçimin DIŞINDAKİ bir karta sağ tık = hedefi değiştirmek: seçim düşer,
    // menü tek-kart diline geçer. Seçim İÇİNDEyse hiçbir şeye dokunulmaz
    // (bir grubu sağ tıklamak grubu bozmamalı).
    const st = useStudio.getState();
    if (!st.selectedIds.includes(id)) {
      st.clearSelection();
      st.setActiveSlide(id);
    }
    setMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  /* --------------------------------------------------------------- *
     C25 — ŞERİT KLAVYESİ

     Öncelik sözleşmesi: oklar KUYU odaktayken cihazın/öğenin (Stage +
     Studio `[data-viewer]` guard'ı), ŞERİT odaktayken slaytındır. İki
     tarafın koşulu ayrık olduğu için `stopImmediatePropagation` gerekmez.
     Tek istisna ⌘D: seçim çokluysa Studio'nun tekil çoğaltması susturulur
     (Timeline bir ÇOCUK, dinleyicisi Studio'nunkinden ÖNCE bağlanır —
     Stage'in ok-nudge'da kullandığı aynı sıra sözleşmesi).
   * --------------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStudio.getState();
      const p = st.project;
      const list = p.sets[p.activeLocale]?.slides ?? [];
      if (!list.length) return;
      const mod = e.metaKey || e.ctrlKey;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(input|textarea)$/i.test(el.tagName || ""));
      const inStrip = !!el && !!stripRef.current && stripRef.current.contains(el);

      // ⌘C / ⌘V şerit odağı ARAMAZ: diller arası akış "kopyala → dil
      // seçicisini tıkla → yapıştır" ve o tık odağı <select>'e taşır.
      // Metin alanında ve sayfada gerçek metin seçimi varken susar
      // (orası tarayıcının kopyalaması).
      if (mod && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
        if (typing) return;
        const txt = window.getSelection?.();
        if (txt && !txt.isCollapsed) return;
        if (doCopy()) e.preventDefault();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && (e.key === "v" || e.key === "V")) {
        if (typing) return;
        if (doPaste()) e.preventDefault();
        return;
      }

      if (!inStrip || typing) return; // buradan aşağısı YALNIZ şerit odakta

      if (mod && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        st.selectAllSlides();
        return;
      }
      if (mod && (e.key === "d" || e.key === "D")) {
        if (st.selectionIds().length < 2) return; // tekil ⌘D Studio'nun
        e.preventDefault();
        e.stopImmediatePropagation();
        const k = st.duplicateSelected();
        pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT ÇOĞALTILDI`, `${String(k).padStart(2, "0")} SLIDE DUPLICATED`));
        return;
      }
      if (mod) return;

      const cur = st.activeSlideId ?? list[0].id;
      const idx = Math.max(0, list.findIndex((x) => x.id === cur));
      const go = (j: number): void => {
        const t = list[Math.max(0, Math.min(list.length - 1, j))];
        if (!t) return;
        e.preventDefault();
        // ⇧ = aralığı ÇAPADAN büyüt · düz = seçimi topla ve çapayı taşı
        if (e.shiftKey) st.selectRange(t.id, anchorRef.current ?? cur);
        else {
          anchorRef.current = t.id;
          st.clearSelection();
          st.setActiveSlide(t.id);
        }
      };
      if (e.key === "ArrowLeft") return go(idx - 1);
      if (e.key === "ArrowRight") return go(idx + 1);
      if (e.key === "Home") return go(0);
      if (e.key === "End") return go(list.length - 1);
      if (e.key === "Escape") {
        st.clearSelection();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (!st.selectionIds().length) return; // seçim yoksa kaza silme yok
        e.preventDefault();
        const k = st.removeSelected();
        if (k) pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT SİLİNDİ`, `${String(k).padStart(2, "0")} SLIDE DELETED`));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doCopy, doPaste]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x) < 6) return;
      if (!d.moved) {
        d.moved = true;
        setDragId(d.id);
        document.body.style.cursor = "grabbing";
      }
      const strip = stripRef.current;
      if (!strip) return;
      const items = Array.from(strip.querySelectorAll<HTMLElement>("[data-slide]"));
      const me = items.findIndex((el) => el.dataset.slide === d.id);
      if (me < 0) return;
      const left = items[me - 1];
      const right = items[me + 1];
      if (left) {
        const r = left.getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          moveSlide(d.id, -1);
          return;
        }
      }
      if (right) {
        const r = right.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2) moveSlide(d.id, 1);
      }
    };
    const onUp = () => {
      if (dragRef.current) document.body.style.cursor = "";
      dragRef.current = null;
      setDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moveSlide]);

  return (
    <section className="timeline">
      {/* ŞERİT GERÇEKTEN KAYSIN — C29'un ön koşulu.
          `.vs-body` ızgara hücresi ve `.timeline` varsayılan `min-width:auto`
          taşıdığı için 12+ slaytta şerit KAYMIYOR, bunun yerine TÜM stüdyo
          düzeni yatayda büyüyordu (1440px pencerede belge 2964px). O yüzden
          `overflow-x:auto` hiç devreye girmiyor, IntersectionObserver de
          kırpacak bir şey bulamıyordu. Üç bildirim bunu düzeltir.
          (engine/thumbs.ts THUMB_CSS deseni: kural, sahibi olan bileşenin
          yanında yaşar; globals.css'e taşınabilir.) */}
      <style>{".vs-body{min-width:0}.timeline{min-width:0}.tl-strip{min-width:0}"}</style>
      <div className="tl-head">
        <span className="tl-title">{L(L("Film şeridi", "Filmstrip"), "Filmstrip")}</span>
        <span className="tl-meta">
          {String(slides.length).padStart(2, "0")} {L("SLAYT", "SLIDES")} · {project.activeLocale.toUpperCase()}
        </span>
        {selCount > 0 && (
          <span className="tl-sel" title={L("Toplu işlem hedefi — sağ tık menüsü seçime uyar", "Bulk action target — the right-click menu applies to the selection")}>
            {String(selCount).padStart(2, "0")} {L("SEÇİLİ", "SELECTED")}
            <button onClick={() => clearSelection()} title={L("Seçimi temizle (Esc)", "Clear selection (Esc)")}>
              <Icon name="x" size={9} />
            </button>
          </span>
        )}
        <span className="phead-sp" />
        <button className="btn xs" onClick={addSlide} title={L("Bu dile yeni slayt ekle", "Add a new slide to this locale")}>
          <Icon name="plus" size={11} />
          {L("Slayt", "Slide")}
        </button>
        {multi && (
          <button
            className="btn xs"
            onClick={() => addSlideAllLocales(active?.designKey)}
            title={L("Aynı slaytı TÜM dillere ekle (aynı designKey, metin kopya)", "Add the same slide to ALL locales (same designKey, text copied)")}
          >
            <Icon name="globe" size={11} />
            {L("Tüm dillere", "All locales")}
          </button>
        )}
        {/* Seçim varsa bu iki düğme SEÇİME uyar — menüyle aynı semantik. */}
        <button
          className="btn xs"
          onClick={() => {
            if (selCount > 1) {
              const k = useStudio.getState().duplicateSelected();
              pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT ÇOĞALTILDI`, `${String(k).padStart(2, "0")} SLIDE DUPLICATED`));
            } else if (activeId) duplicateSlide(activeId);
          }}
          title={selCount > 1 ? L(`Seçili ${selCount} slaytı çoğalt`, `Duplicate ${selCount} selected slides`) : L("Aktif slaytı çoğalt (⌘D)", "Duplicate active slide (⌘D)")}
        >
          <Icon name="copy" size={11} />
          {selCount > 1 ? L(`Çoğalt ${selCount}`, `Duplicate ${selCount}`) : L("Çoğalt", "Duplicate")}
        </button>
        <button
          className="btn xs danger"
          onClick={() => {
            if (selCount > 1) {
              const k = useStudio.getState().removeSelected();
              if (k) pushUndoToast(L(`${String(k).padStart(2, "0")} SLAYT SİLİNDİ`, `${String(k).padStart(2, "0")} SLIDE DELETED`));
              return;
            }
            if (!activeId) return;
            removeSlide(activeId);
            pushUndoToast(L("SLAYT SİLİNDİ", "SLIDE DELETED"));
          }}
          disabled={slides.length <= 1 || (selCount > 1 && selCount >= slides.length)}
          title={selCount > 1 ? L(`Seçili ${selCount} slaytı sil`, `Delete ${selCount} selected slides`) : L("Aktif slaytı bu dilden sil", "Delete active slide from this locale")}
        >
          <Icon name="trash" size={11} />
          {selCount > 1 ? L(`Sil ${selCount}`, `Delete ${selCount}`) : L("Sil", "Delete")}
        </button>
        {multi && (
          <button
            className="btn xs danger"
            onClick={() => {
              if (!active?.designKey) return;
              removeSlideAllLocales(active.designKey);
              pushUndoToast(L("SLAYT TÜM DİLLERDEN SİLİNDİ", "SLIDE DELETED FROM ALL LOCALES"));
            }}
            disabled={slides.length <= 1 || !active?.designKey}
            title={L("Bu slaytı TÜM dillerden sil", "Delete this slide from ALL locales")}
          >
            {L("Tüm dillerden", "From all locales")}
          </button>
        )}
      </div>
      {/* Şerit ODAKLANABİLİR (C25): oklar/Home/End/⌘A buraya aitse buradan
          okunur. Boşluğa tık seçimi temizler — tuvalde aynı jest için
          store'daki `clearSlideSelection()` dışa açık (Stage kablolaması). */}
      <div
        className="tl-strip"
        ref={stripRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={L("Film şeridi", "Filmstrip")}
        onPointerDown={(e) => {
          stripRef.current?.focus({ preventScroll: true });
          if (!(e.target as HTMLElement).closest("[data-slide]")) clearSelection();
        }}
      >
        {slides.map((sl, i) => (
          <Frame
            key={sl.id}
            slide={sl}
            index={i}
            active={sl.id === activeId}
            selected={selSet.has(sl.id)}
            dragging={dragId === sl.id}
            scrollRef={stripRef}
            onPick={onPick}
            onDragStart={onDragStart}
            onMenu={onMenu}
          />
        ))}
        <div className="tl-item">
          <span className="tl-no">+</span>
          <button className="frame add" onClick={addSlide} title={L("Yeni slayt ekle", "Add new slide")}>
            <Icon name="plus" size={16} />
          </button>
          <span className="tl-cap">{L("yeni", "new")}</span>
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id)}
          close={() => setMenu(null)}
        />
      )}
    </section>
  );
}
