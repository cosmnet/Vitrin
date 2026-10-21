// ÖLÇÜM (R8/W1 · C34) — "önce ölç, sonra iyileştir".
//
// Neden ayrı, minik bir modül: performans iddiaları (klonu ucuzlattık, zemini
// önbelleğe aldık, kuyruk derinliği düştü) ancak SAYIYLA doğrulanır. Burası o
// sayıların tek toplandığı yer; UI'ya hiçbir şey basmaz (Stage künyesi YOK —
// ölçüm aracı, gösterge değil).
//
// Sözleşme (tarayıcı konsolu):
//   __vitrinPerf.table()      → console.table (ad · n · ort · en kötü · son)
//   __vitrinPerf.stats()      → düz nesne (kopyalanabilir, JSON'lanabilir)
//   __vitrinPerf.reset()      → sayaçları sıfırla (ölçüme temiz başla)
//   __vitrinPerf.disable()    → ölçümü kapat (mikro-yük bile istemiyorsan)
//   __vitrinPerf.enable()
//
// Maliyet: kayıt başına iki `performance.now()` + bir Map araması. Sürükleme
// karesinde ~0.001 ms; ölçtüğü şeyin yanında görünmez. Yine de `?perf=0` ile
// kapatılabilir.
//
// Adlandırma kuralı — nokta ile aile:
//   mutate            store.mutate toplam (klon + fn + set)
//   mutate.clone      yalnız structuredClone payı
//   render.total      renderSlide toplam            (engine/render.ts kablolar)
//   render.bg         zemin+fx payı                 (engine/render.ts kablolar)
//   thumb.render      film şeridi karesi
//   thumb.queue       kuyruk derinliği (ÖLÇÜT: adet, ms değil)

export type PerfStat = {
  /** kayıt sayısı */
  n: number;
  /** toplam (ms ya da birimsiz değer) */
  total: number;
  /** en kötü tek kayıt */
  max: number;
  /** son kayıt */
  last: number;
  /** birim — tabloda ayırt etmek için */
  unit: "ms" | "n";
};

const stats = new Map<string, PerfStat>();
let enabled = true;

/** Yüksek çözünürlüklü saat (SSR'da da güvenli). */
export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function perfEnabled(): boolean {
  return enabled;
}

export function setPerfEnabled(v: boolean): void {
  enabled = v;
}

function bump(name: string, value: number, unit: "ms" | "n"): void {
  if (!enabled) return;
  let s = stats.get(name);
  if (!s) {
    s = { n: 0, total: 0, max: 0, last: 0, unit };
    stats.set(name, s);
  }
  s.n++;
  s.total += value;
  s.last = value;
  if (value > s.max) s.max = value;
}

/** Süre kaydı (ms). */
export function perfAdd(name: string, ms: number): void {
  bump(name, ms, "ms");
}

/** Anlık değer kaydı (kuyruk derinliği gibi — ort/en kötü anlamlı). */
export function perfGauge(name: string, value: number): void {
  bump(name, value, "n");
}

/**
 * Ölçüm penceresi açar; dönen fonksiyon çağrılınca kaydı yazar.
 *   const end = perfSpan("render.total"); …; end();
 * Ölçüm kapalıyken de aynı imzayı döner (çağıran dallanmaz).
 */
export function perfSpan(name: string): () => void {
  if (!enabled) return noop;
  const t0 = nowMs();
  return () => perfAdd(name, nowMs() - t0);
}

function noop(): void {}

export type PerfRow = {
  n: number;
  ort: number;
  "en kötü": number;
  son: number;
  toplam: number;
  birim: "ms" | "n";
};

/** Tablo satırları — düz nesne (JSON'lanabilir, testten okunabilir). */
export function perfSnapshot(): Record<string, PerfRow> {
  const out: Record<string, PerfRow> = {};
  for (const [k, s] of [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = s.unit === "ms" ? 3 : 2;
    out[k] = {
      n: s.n,
      ort: Number((s.total / Math.max(1, s.n)).toFixed(r)),
      "en kötü": Number(s.max.toFixed(r)),
      son: Number(s.last.toFixed(r)),
      toplam: Number(s.total.toFixed(r)),
      birim: s.unit,
    };
  }
  return out;
}

export function perfReset(): void {
  stats.clear();
}

/* ------------------------------------------------------------------ *
   window köprüsü — konsoldan çağrılır, hiçbir bileşene bağlı değil.
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    __vitrinPerf?: {
      table: () => void;
      stats: () => Record<string, PerfRow>;
      reset: () => void;
      enable: () => void;
      disable: () => void;
      enabled: () => boolean;
    };
  }
}

if (typeof window !== "undefined") {
  // ?perf=0 → ölçümü kapat (varsayılan AÇIK; yük ihmal edilebilir).
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "0") enabled = false;
  } catch {
    /* location okunamadı — varsayılanda kal */
  }
  window.__vitrinPerf = {
    table: () => {
      const rows = perfSnapshot();
      if (Object.keys(rows).length === 0) {
        console.log("__vitrinPerf: kayıt yok (ölçüm %s)", enabled ? "açık" : "KAPALI");
        return;
      }
      console.table(rows);
    },
    stats: perfSnapshot,
    reset: perfReset,
    enable: () => setPerfEnabled(true),
    disable: () => setPerfEnabled(false),
    enabled: perfEnabled,
  };
}
