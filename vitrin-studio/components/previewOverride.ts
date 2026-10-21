"use client";

// GEÇİCİ ÖNİZLEME KATMANI (R8/W3 · C11-C14)
//
// "Bir tema kartının üstüne gel → kuyudaki eser 150ms içinde o temaya bürünsün,
// çekilince geri dönsün." Bunun TEK kuralı var: **store'a hiçbir şey yazılmaz.**
// Yazılsaydı her hover bir `mutate` demek olurdu; o da bir geçmiş adımı, bir
// tasarım yayılımı (fan-out) ve 2 sn sonra bir `POST /api/projects` demek.
// Fareyi bir ızgaranın üstünden geçirmek projeyi 12 kez kaydederdi.
//
// Bu yüzden override store'un DIŞINDA, modül düzeyinde bir yayın-abone
// sayacında yaşar — `components/styleClip.ts` ve `ui.tsx`'teki `renderRev`
// ile aynı sınıf. Stage `usePreviewOverride()` ile abone olur; patch geldiğinde
// tuvalin ÜSTÜNE ayrı bir katmana taslak kare basar. Gerçek slayt nesnesine,
// `project`e, `past` yığınına dokunulmaz.
//
// Zamanlama (spesifikasyon):
//   · giriş 140ms gecikmeli — ızgaranın üstünden geçmek önizleme tetiklemez;
//   · zaten bir önizleme AÇIKSA kartlar arası geçiş 40ms — "önizleme modundayız",
//     kart değiştirmek anında hissedilir;
//   · çıkış 90ms — komşu karta geçerken araya gerçek slaytın tek karelik
//     "flaş"ı girmesin (pointerleave → pointerenter aynı karede gelir).

import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { Slide } from "@/engine/types";

/** Slaydın üzerine BİNDİRİLECEK alanlar. `undefined` değerler de ezer. */
export type PreviewPatch = Partial<Slide>;

export type PreviewEntry = {
  /** Kart kimliği — aynı kart iki kez tetiklemesin (`theme:sunset` gibi). */
  key: string;
  patch: PreviewPatch;
};

const ENTER_MS = 140;
const HOP_MS = 40;
const LEAVE_MS = 90;

let cur: PreviewEntry | null = null;
let enterT: ReturnType<typeof setTimeout> | null = null;
let leaveT: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const f of subs) f();
}

function clearTimers(): void {
  if (enterT) {
    clearTimeout(enterT);
    enterT = null;
  }
  if (leaveT) {
    clearTimeout(leaveT);
    leaveT = null;
  }
}

/** Karta girildi — gecikmeli önizleme kur. */
export function previewEnter(key: string, patch: PreviewPatch): void {
  clearTimers();
  if (cur?.key === key) return; // zaten bu kart gösteriliyor
  const delay = cur ? HOP_MS : ENTER_MS;
  enterT = setTimeout(() => {
    enterT = null;
    cur = { key, patch };
    emit();
  }, delay);
}

/**
 * Karttan çıkıldı. `key` verilirse yalnız O kartın önizlemesi kapatılır
 * (komşu karta geçişte yenisi zaten kurulmuştur).
 */
export function previewLeave(key?: string): void {
  if (enterT) {
    clearTimeout(enterT);
    enterT = null;
  }
  if (!cur) return;
  if (key && cur.key !== key) return;
  if (leaveT) clearTimeout(leaveT);
  leaveT = setTimeout(() => {
    leaveT = null;
    cur = null;
    emit();
  }, LEAVE_MS);
}

/** Anında kapat — tıklama (gerçek uygulama), Esc, panel kapanışı. */
export function previewClear(): void {
  clearTimers();
  if (!cur) return;
  cur = null;
  emit();
}

/**
 * C14 — TEK KANCA, ÜÇ IZGARA. Tema / kadraj / kamera kartları aynı üç olayı
 * bağlar; kart bileşenlerinin başka hiçbir şey bilmesi gerekmez.
 */
export function previewProps(
  key: string,
  patch: PreviewPatch
): {
  onPointerEnter: (e: ReactPointerEvent) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
} {
  return {
    onPointerEnter: (e) => {
      // Dokunmatikte hover yok: parmak "enter" üretir ama "leave" üretmez.
      if (e.pointerType === "touch") return;
      previewEnter(key, patch);
    },
    onPointerLeave: () => previewLeave(key),
    /**
     * Tıklamada önizleme KASITEN kaldırılmaz. Tıklama, önizlemenin gösterdiği
     * patch'in AYNISINI uygular; overlay'i hemen çekmek gerçek render'ın
     * yetişmesini (90ms + çizim) çıplak gözle izletirdi — yani "seçtim, bir an
     * eskisi geri geldi, sonra yenisi oturdu" hissi. Overlay ile altındaki kare
     * artık AYNI olduğu için bırakınca (pointerleave) fark edilmeden kaybolur.
     * Yalnız çapayı tazeleriz ki bekleyen bir giriş zamanlayıcısı kalmasın.
     */
    onPointerDown: () => previewEnter(key, patch),
  };
}

/** Stage aboneliği. Anlık görüntü referansı emit'ler arasında sabittir. */
export function usePreviewOverride(): PreviewEntry | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cur,
    () => null
  );
}

/* ------------------------------------------------------------------ *
   C13 — ÖNİZLEME KARESİ LRU'su

   Izgarada ileri-geri gezerken aynı temanın taslağı defalarca çizilirdi.
   Son 6 kare `ImageBitmap` olarak tutulur (dataURL değil: kodlama/çözme yok,
   `drawImage` doğrudan GPU'ya gider). Tahliye edilen bitmap `close()` ile
   serbest bırakılır — aksi hâlde her hover birkaç MB VRAM sızdırırdı.
   Desen `engine/thumbs.ts`'teki MEM_MAX ile aynı.
 * ------------------------------------------------------------------ */

const LRU_MAX = 6;
const frames = new Map<string, ImageBitmap>();

export function getPreviewFrame(key: string): ImageBitmap | null {
  const hit = frames.get(key);
  if (!hit) return null;
  frames.delete(key); // en son kullanılan sona taşınır
  frames.set(key, hit);
  return hit;
}

export function putPreviewFrame(key: string, bmp: ImageBitmap): void {
  const old = frames.get(key);
  if (old && old !== bmp) old.close();
  frames.set(key, bmp);
  while (frames.size > LRU_MAX) {
    const oldest = frames.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    frames.get(oldest)?.close();
    frames.delete(oldest);
  }
}
