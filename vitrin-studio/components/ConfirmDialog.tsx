"use client";

// ONAY DİYALOĞU — tarayıcının window.confirm'ü UI v3 diline çevrilir.
//
// Kullanıcı şikâyeti: "uyarı ekranı Chrome'dan gelmesin, UI içinden gelsin".
// Bu dosya söz-tabanlı (promise) bir API verir; çağıran taraf yine tek satır:
//
//     if (!(await confirmUi({ message: "…" }))) return;
//
// Otobüs modül düzeyinde (toast.tsx ile aynı desen): herhangi bir bileşen
// store'a ya da context'e dokunmadan çağırabilir. Aynı anda iki istek gelirse
// KUYRUĞA girer, sırayla sorulur — hiçbir söz (promise) askıda kalmaz.
//
// Görsel: .overlay/.dialog iskeleti + dar sheet, sol 4px bant (Klein; danger
// ise tilki), mono künye başlık, kemik gövde, sağa yaslı ayak.
// Klavye: Esc = iptal · Enter = onay · Tab iki buton arasında kapanlı.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { L } from "@/lib/i18n";

export type ConfirmOpts = {
  /** Mono künye başlık (TAM CAPS'a CSS çevirir). Varsayılan: "ONAY". */
  title?: string;
  /** Gövde metni — kullanıcının okuyacağı asıl soru. */
  message: string;
  /** Onay butonu etiketi. Varsayılan: "Devam et". */
  okLabel?: string;
  /** İptal butonu etiketi. Varsayılan: "İptal". */
  cancelLabel?: string;
  /** Yıkıcı iş: bant tilkiye döner, onay butonu .btn.danger olur. */
  danger?: boolean;
};

type Req = ConfirmOpts & { id: number; resolve: (v: boolean) => void };

/* ---------- modül düzeyi otobüs ---------- */
let seq = 1;
let queue: Req[] = [];
const subs = new Set<() => void>();
const emit = (): void => {
  for (const f of subs) f();
};

/** Söz-tabanlı onay. `await` edilir; true = onaylandı. */
export function confirmUi(o: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...o, id: seq++, resolve }];
    emit();
  });
}

function useQueue(): Req[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => queue,
    () => queue
  );
}

/** Çıkış hareketi girişin 0.7 katı; hareket azaltmada kısa sabit. */
function exitMs(): number {
  if (typeof window === "undefined") return 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return 120;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--t-panel");
  const base = parseFloat(raw) || 320;
  return Math.round(base * 0.7);
}

/**
 * Tek sefer monte edilir (Studio.tsx). Kuyruğun başındaki isteği basar.
 */
export function ConfirmHost() {
  const q = useQueue();
  const req = q[0];
  const [closing, setClosing] = useState<boolean>(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);

  /** Cevabı ver: çıkış hareketini oynat, sonra kuyruğu ilerlet. */
  const answer = useCallback(
    (v: boolean) => {
      if (!req || doneRef.current) return;
      doneRef.current = true;
      setClosing(true);
      const r = req.resolve;
      window.setTimeout(() => {
        queue = queue.filter((x) => x.id !== req.id);
        emit();
        r(v);
      }, exitMs());
    },
    [req]
  );

  // Yeni istek geldiğinde durum sıfırlanır ve odak onay butonuna verilir.
  useEffect(() => {
    if (!req) return;
    doneRef.current = false;
    setClosing(false);
    const t = window.setTimeout(() => okRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Klavye — yakalama (capture) fazında, çünkü Studio'nun global Esc'i
  // arkadaki diyaloğu da kapatırdı.
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        answer(false);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        answer(true);
        return;
      }
      if (e.key === "Tab") {
        // İki butonluk kapan: odak dışarı sızmaz.
        e.preventDefault();
        e.stopPropagation();
        const on = document.activeElement === okRef.current;
        (on ? cancelRef.current : okRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req, answer]);

  if (!req) return null;

  const danger = !!req.danger;

  return (
    <div
      className={`overlay cnf-wrap${closing ? " out" : ""}`}
      onMouseDown={(e) => e.target === e.currentTarget && answer(false)}
    >
      <div
        className={`dialog cnf${danger ? " danger" : ""}${closing ? " out" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={req.title || L("Onay", "Confirm")}
      >
        <div className="dialog-inner">
          <h2>{req.title || L("Onay", "Confirm")}</h2>
          <p className="cnf-msg">{req.message}</p>
          <div className="foot">
            <button ref={cancelRef} type="button" className="btn ghost" onClick={() => answer(false)}>
              {req.cancelLabel || L("İptal", "Cancel")}
            </button>
            <button
              ref={okRef}
              type="button"
              className={danger ? "btn danger cnf-ok" : "btn primary"}
              onClick={() => answer(true)}
            >
              {req.okLabel || L("Devam et", "Continue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
