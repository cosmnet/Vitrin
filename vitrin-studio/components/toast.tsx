"use client";

// TOAST KURALLARI (rapor §7 — referans setinde hiçbir editör geri
// alınabilir bir işi toast'sız bırakmıyor, ama her şeyi de toast yapmıyor):
//
//   (a) Otomatik kayıt  → ÜST BARDA ambient mono künye, asla toast.
//   (b) Geri alınabilir yıkıcı iş → sol-alt BANT-TOAST + "GERİ AL ⌘Z" +
//       asit yeşili geri sayım çizgisi, 6 sn.
//   (c) Engelleyen hata → satır içi tilki bandı (bu dosyada değil).
//   (d) Uzun iş → ilerleme diyaloğu (dialogs.tsx'te kaldı).
//
// Yayın-abone otobüsü modül düzeyinde: herhangi bir bileşen store'a
// dokunmadan `pushToast` çağırabilir.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useStudio } from "@/store/studio";
import { Icon } from "./ui";
import { L } from "@/lib/i18n";

export type Toast = {
  id: number;
  /** TAM CAPS mono künye — cosm-voice. */
  msg: string;
  /** Verilirse sağda bir eylem butonu çıkar (ör. GERİ AL ⌘Z). */
  action?: { label: string; run: () => void };
  kind?: "info" | "err";
  /** ms — varsayılan 6000 (geri sayım çizgisi bu süreye kilitli). */
  ttl?: number;
};

let seq = 1;
let list: Toast[] = [];
const subs = new Set<() => void>();

function emit(): void {
  for (const f of subs) f();
}

export function pushToast(t: Omit<Toast, "id">): number {
  const id = seq++;
  list = [...list, { ...t, id }];
  emit();
  const ttl = t.ttl ?? 6000;
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export function dismissToast(id: number): void {
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  emit();
}

/** Geri alınabilir yıkıcı iş için hazır kalıp. */
export function pushUndoToast(msg: string): void {
  pushToast({
    msg,
    action: { label: L("Geri al ⌘Z", "Undo ⌘Z"), run: () => useStudio.getState().undo() },
  });
}

function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => list,
    () => list
  );
}

export function Toasts() {
  const toasts = useToasts();
  // Senkron künyesi store'da yaşıyor (engine/designsync summarizeNotes);
  // toast'a burada dönüşür ve kapatılınca store'dan temizlenir.
  const syncNote = useStudio((s) => s.lastSyncNote);
  const clearSyncNote = useStudio((s) => s.clearSyncNote);
  const [noteShown, setNoteShown] = useState<string | null>(null);

  useEffect(() => {
    if (!syncNote) {
      setNoteShown(null);
      return;
    }
    setNoteShown(syncNote);
    const t = setTimeout(() => {
      setNoteShown(null);
      clearSyncNote();
    }, 6000);
    return () => clearTimeout(t);
  }, [syncNote, clearSyncNote]);

  if (!toasts.length && !noteShown) return null;

  return (
    <div className="toasts" aria-live="polite">
      {noteShown && (
        <div className="toast" key="sync">
          <span className="msg">{noteShown}</span>
          <button
            className="act"
            onClick={() => {
              useStudio.getState().undo();
              setNoteShown(null);
              clearSyncNote();
            }}
          >
            {L("Geri al ⌘Z", "Undo ⌘Z")}
          </button>
          <button
            className="x"
            aria-label={L("Kapat", "Close")}
            onClick={() => {
              setNoteShown(null);
              clearSyncNote();
            }}
          >
            <Icon name="x" size={12} />
          </button>
          <span className="count" />
        </div>
      )}
      {toasts.map((t) => (
        <div className={`toast ${t.kind === "err" ? "err" : ""}`} key={t.id}>
          <span className="msg">{t.msg}</span>
          {t.action && (
            <button
              className="act"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="x" aria-label={L("Kapat", "Close")} onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={12} />
          </button>
          <span className="count" />
        </div>
      ))}
    </div>
  );
}
