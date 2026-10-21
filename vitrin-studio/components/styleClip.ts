"use client";

// Stil panosu — "Stili kopyala / Stili yapıştır" (tuval bağlam menüsü).
//
// Store'a girmiyor bilerek: pano bir OTURUM aracıdır, projenin parçası
// değildir (kaydedilmez, undo yığınına girmez). Kopyalanan şey slaytın
// TASARIM alanlarıdır — `pickDesign` ile alınır, yani metin/ekran/çelenk
// metni asla taşınmaz. Yapıştırma `updateSlide` ile yazılır; senkron
// açıksa fan-out kendiliğinden çalışır (tek ⌘Z hepsini geri alır).

import { pickDesign } from "@/engine/designsync";
import type { Slide } from "@/engine/types";

let clip: Partial<Slide> | null = null;
let label = "";
const subs = new Set<() => void>();

export function copyStyle(slide: Slide): void {
  clip = pickDesign(slide);
  label = slide.headline?.slice(0, 24) || "slayt";
  for (const f of subs) f();
}

export function styleClip(): Partial<Slide> | null {
  return clip ? structuredClone(clip) : null;
}

export function styleClipLabel(): string {
  return label;
}

export function subscribeStyleClip(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function styleClipRev(): boolean {
  return clip !== null;
}
