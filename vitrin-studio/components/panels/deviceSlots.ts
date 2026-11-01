"use client";

// Cihaz yuvaları — Cihaz ve Ekranlar panelleri ile tuval AYNI "etkin cihaz"
// kavramını paylaşır: tuvalde seçili cihaz katmanı (device / device2 /
// device3) varsa o, yoksa panelde en son seçilen yuva.

import { create } from "zustand";
import { LAYOUTS } from "@/engine/layouts";
import { isDuoFormat, type DeviceOffset, type Format, type Slide } from "@/engine/types";
import { L } from "@/lib/i18n";
import { SHOT_FIELD, shotSlotCount, useStudio, type ShotSlot } from "@/store/studio";

const useSlotMemory = create<{ slot: ShotSlot; set: (s: ShotSlot) => void }>((set) => ({ slot: 1, set: (slot) => set({ slot }) }));

export const LAYER_OF: Record<ShotSlot, "device" | "device2" | "device3"> = { 1: "device", 2: "device2", 3: "device3" };
export const OFFSET_OF: Record<ShotSlot, "deviceOffset" | "device2Offset" | "device3Offset"> = { 1: "deviceOffset", 2: "device2Offset", 3: "device3Offset" };

export function slotOfLayer(id: string | null): ShotSlot | null {
  return id === "device" ? 1 : id === "device2" ? 2 : id === "device3" ? 3 : null;
}

/** Duo tek cihazlı düzende iki yuva = iç ve dış ekran (aynı gövde). */
export function isDuoScreenPair(slide: Slide | null, fmt: Format): boolean {
  return !!slide && isDuoFormat(fmt) && !LAYOUTS[slide.layout]?.device2;
}

export function slotLabel(slide: Slide | null, fmt: Format, n: ShotSlot): string {
  if (isDuoScreenPair(slide, fmt)) return n === 1 ? L("İç ekran", "Inner screen") : L("Dış ekran", "Outer screen");
  if (slide?.layout === "split-v" || slide?.layout === "split-h") return n === 1 ? L("1. görsel", "Image 1") : L("2. görsel", "Image 2");
  return L(`Cihaz ${n}`, `Device ${n}`);
}

/** Etkin yuva + seçici. Yuva sayısı düzenden okunur, fazlası kelepçelenir. */
export function useDeviceSlot(slide: Slide | null, fmt: Format) {
  const selectedLayerId = useStudio((s) => s.selectedLayerId);
  const remembered = useSlotMemory((s) => s.slot);
  const count = slide ? shotSlotCount(slide.layout, fmt) : 1;
  const fromCanvas = slotOfLayer(selectedLayerId);
  const raw = fromCanvas ?? remembered;
  const slot = (raw > count ? count : raw) as ShotSlot;
  const nos = (count === 3 ? [1, 2, 3] : count === 2 ? [1, 2] : [1]) as ShotSlot[];
  const pick = (n: ShotSlot) => {
    useSlotMemory.getState().set(n);
    // Duo'nun iç/dış ekranı aynı gövdedir; tuvalde ayrı katman yok.
    if (slide && !isDuoScreenPair(slide, fmt) && slide.layout !== "split-v" && slide.layout !== "split-h") useStudio.getState().setSelectedLayer(LAYER_OF[n]);
  };
  return { slot, count, nos, pick, fromCanvas: fromCanvas !== null };
}

export function shotOf(slide: Slide, n: ShotSlot): string | undefined {
  return slide[SHOT_FIELD[n]] as string | undefined;
}

export function offsetOf(slide: Slide, n: ShotSlot): DeviceOffset {
  return slide[OFFSET_OF[n]] ?? { x: 0, y: 0 };
}

export function rememberSlot(n: ShotSlot): void {
  useSlotMemory.getState().set(n);
}
