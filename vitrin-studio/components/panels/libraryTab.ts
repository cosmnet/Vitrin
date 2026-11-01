"use client";

// Kütüphane panelinin etkin sekmesi — başka panellerden ("Temayı değiştir")
// doğrudan doğru sekmeye atlamak için paylaşılan küçük durum.

import { create } from "zustand";

export type LibraryTab = "templates" | "themes" | "backgrounds" | "stickers";

export const useLibraryTab = create<{ tab: LibraryTab; set: (t: LibraryTab) => void }>((set) => ({
  tab: "templates",
  set: (tab) => set({ tab }),
}));

export function setLibraryTab(t: LibraryTab): void {
  useLibraryTab.getState().set(t);
}
