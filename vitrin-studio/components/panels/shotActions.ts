"use client";

// Ekran görüntüsü yükleme/atama — Ekranlar paneli, Cihaz paneli ve tuvale
// sürükle-bırak AYNI yoldan geçer.

import { create } from "zustand";
import { L } from "@/lib/i18n";
import { imageFiles, uploadScreenshot } from "@/lib/uploads";
import { shotSlotCount, useStudio, type ShotSlot } from "@/store/studio";
import { formatOf } from "@/engine/types";
import { pushToast } from "../toast";

/** Yükleme tercihleri — kullanıcı ayarı; proje JSON'una girmez. */
export type UploadPrefs = {
  /** Tek dosya: yüklenince etkin cihaza ata. */
  assign: boolean;
  /** Çok dosya: aktif slayttan başlayarak sıradaki slaytlara dağıt. */
  distribute: boolean;
};

const PREF_KEY = "vitrin:ui:upload-prefs";
function readPrefs(): UploadPrefs {
  try {
    return { assign: true, distribute: true, ...(JSON.parse(localStorage.getItem(PREF_KEY) || "{}") as Partial<UploadPrefs>) };
  } catch {
    return { assign: true, distribute: true };
  }
}

export const useUploadPrefs = create<UploadPrefs & { set: (p: Partial<UploadPrefs>) => void }>((set, get) => ({
  ...(typeof window === "undefined" ? { assign: true, distribute: true } : readPrefs()),
  set: (p) => {
    set(p);
    const { assign, distribute } = { ...get(), ...p };
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ assign, distribute }));
    } catch {
      /* yoksay */
    }
  },
}));

/**
 * Dosyaları havuza yükler ve tercihe göre yerleştirir:
 *   · `slot` verilmişse (cihaza bırakma) ilk dosya o cihaza KESİN atanır
 *   · birden çok dosya + dağıt açık → aynı yuva sıradaki slaytlara
 * Dönüş: havuza eklenen kayıt sayısı.
 */
export async function ingestScreenshotFiles(list: FileList | File[] | null, opts: { slideId?: string; slot?: ShotSlot; force?: boolean } = {}): Promise<number> {
  const files = imageFiles(list);
  if (!files.length) return 0;
  const st0 = useStudio.getState();
  st0.setBusy(L(`${files.length} ekran yükleniyor…`, `Uploading ${files.length} screen(s)…`));
  try {
    const shots = [];
    for (const f of files) shots.push(await uploadScreenshot(f));
    const st = useStudio.getState();
    st.addScreenshots(shots);
    const prefs = useUploadPrefs.getState();
    const slot = opts.slot ?? 1;
    const slides = st.project.sets[st.project.activeLocale]?.slides ?? [];
    const startId = opts.slideId ?? st.activeSlideId ?? slides[0]?.id;
    const start = Math.max(0, slides.findIndex((s) => s.id === startId));
    if (opts.force || prefs.assign) {
      if (shots.length === 1 || !prefs.distribute) {
        const sl = slides[start];
        if (sl) st.setSlideShot(sl.id, Math.min(slot, shotSlotCount(sl.layout, formatOf(st.project))) as ShotSlot, shots[0].dataUrl);
      } else {
        shots.forEach((sh, i) => {
          const sl = slides[start + i];
          if (sl) st.setSlideShot(sl.id, Math.min(slot, shotSlotCount(sl.layout, formatOf(st.project))) as ShotSlot, sh.dataUrl);
        });
      }
    }
    pushToast({
      msg:
        shots.length === 1
          ? L("EKRAN EKLENDİ", "SCREEN ADDED")
          : L(`${shots.length} EKRAN EKLENDİ${prefs.distribute ? " · SLAYTLARA DAĞITILDI" : ""}`, `${shots.length} SCREENS ADDED${prefs.distribute ? " · DISTRIBUTED" : ""}`),
    });
    return shots.length;
  } catch (e) {
    pushToast({ msg: L(`YÜKLENEMEDİ · ${e instanceof Error ? e.message : e}`, `UPLOAD FAILED · ${e instanceof Error ? e.message : e}`), kind: "err" });
    return 0;
  } finally {
    useStudio.getState().setBusy(null);
  }
}

/** Gizli dosya seçiciyi açar (panellerdeki "Yükle" düğmeleri). */
export function pickScreenshotFiles(opts: { slideId?: string; slot?: ShotSlot; force?: boolean } = {}, multiple = true): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.multiple = multiple;
  input.onchange = () => void ingestScreenshotFiles(input.files, opts);
  input.click();
}
