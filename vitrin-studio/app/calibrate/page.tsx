"use client";

// /calibrate — ekran dörtgeni kalibratörü (geliştirme aracı).
//
// Model seç → önden büyük render (ekran yerine PARLAK MAGENTA test deseni:
// düz magenta + 4px sarı çerçeve + köşe artıları) → ok tuşları/düğmelerle
// insetX/insetY/offsetX/offsetY/cornerRadiusRatio ayarla → 4× köşe kırpmaları
// magenta'nın bezel'e tam oturduğunu gösterince "Kaydet".
//
// Kaydet → POST /api/models-meta → public/assets/models/meta.json (+sürüm bump).
// Kalibrasyon runtime'da setScreenOverride ile anında devreye girer; GLB
// yeniden indirilmez (önbellek anahtarı sürümsüz).
//
// URL parametreleri (otomasyon için):
//   ?model=iphone-15promax.glb&ix=0.985&iy=0.992&ox=0&oy=0&cr=0.19&proof=1
//   proof=1 → yüklenince tam çözünürlük render + köşe şeridi
//   ~/Desktop/Vitrin/_calib/x/ altına basılır.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderDevice3D } from "@/engine/scene3d";
import { subscribeGlbProgress } from "@/engine/scene3dCore";
import {
  DEFAULT_SCREEN,
  listModels,
  registryScreen,
  reloadModelMeta,
  setScreenOverride,
  subscribeModelRegistry,
  type ModelEntry,
  type ScreenCalib,
} from "@/engine/modelRegistry";
import type { DeviceStyle3D } from "@/engine/types";

const FULL_W = 900;
const FULL_H = 1500;
const HALF = 0.5;
const BG = "#8a8a92"; // nötr gri — kenar/dikiş hataları burada belli olur
// Köşe penceresi ekranın genişliğine göre ölçeklenir (köşe yayı + iki düz kenar
// birlikte görünsün) ve 4× büyütülür.
const CROP_FRAC = 0.3; // magenta bbox genişliğinin oranı
const CROP_MIN = 70;
const CROP_MARGIN = 0.2; // pencerenin dış kenar payı (pencere boyu oranı)
const CROP_OUT = 320; // çıktı kenarı (px)

type Field = "insetX" | "insetY" | "offsetX" | "offsetY" | "cornerRadiusRatio";

const FIELDS: { id: Field; label: string; step: number; big: number }[] = [
  { id: "insetX", label: "insetX (genişlik)", step: 0.001, big: 0.01 },
  { id: "insetY", label: "insetY (yükseklik)", step: 0.001, big: 0.01 },
  { id: "offsetX", label: "offsetX (sağa +)", step: 0.001, big: 0.01 },
  { id: "offsetY", label: "offsetY (yukarı +)", step: 0.001, big: 0.01 },
  { id: "cornerRadiusRatio", label: "köşe yarıçapı", step: 0.005, big: 0.02 },
];

/* ------------------------------------------------------------------ *
   Magenta test deseni
 * ------------------------------------------------------------------ */

let _testImg: HTMLImageElement | null = null;

async function testPattern(): Promise<HTMLImageElement> {
  if (_testImg) return _testImg;
  const W = 1179;
  const H = 2556; // 15 Pro Max ekran oranı
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(0, 0, W, H);
  // 4px sarı çerçeve (kaynak piksel — render'da ~2px görünür)
  ctx.strokeStyle = "#ffe000";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  // köşe artıları
  ctx.strokeStyle = "#00ffd0";
  ctx.lineWidth = 6;
  const L = 120;
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [W, 0, -1, 1],
    [0, H, 1, -1],
    [W, H, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * 30);
    ctx.lineTo(x + sx * L, y + sy * 30);
    ctx.moveTo(x + sx * 30, y);
    ctx.lineTo(x + sx * 30, y + sy * L);
    ctx.stroke();
  }
  // orta çapraz — perspektif kontrolü
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, H);
  ctx.moveTo(W, 0);
  ctx.lineTo(0, H);
  ctx.stroke();
  // NOT: img.decode() KULLANMA — sekme/panel gizliyken Chrome decode'u erteliyor
  // ve promise hiç çözülmüyor (render sonsuza kadar asılı kalır). onload çalışır.
  const url = c.toDataURL("image/png");
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("test deseni yüklenemedi"));
    im.src = url;
  });
  _testImg = img;
  return img;
}

/* ------------------------------------------------------------------ *
   Piksel yardımcıları
 * ------------------------------------------------------------------ */

type Rect = { x0: number; y0: number; x1: number; y1: number };

function emptyRect(): Rect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

function rectValid(r: Rect): boolean {
  return r.x1 > r.x0 && r.y1 > r.y0;
}

/** Kanvasta bir predicate'e uyan piksellerin bbox'ı. */
function scanBox(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  hit: (r: number, g: number, b: number, a: number) => boolean
): Rect {
  const box = emptyRect();
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (!hit(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }
  return box;
}

const isMagenta = (r: number, g: number, b: number, a: number) =>
  a > 128 && r > 140 && b > 140 && g < 110;

/* ------------------------------------------------------------------ *
   Sayfa
 * ------------------------------------------------------------------ */

export default function Calibrate() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [file, setFile] = useState<string>("");
  const [cal, setCal] = useState<ScreenCalib>({ ...DEFAULT_SCREEN });
  const [field, setField] = useState<Field>("offsetX");
  const [half, setHalf] = useState(true);
  const [status, setStatus] = useState("hazır");
  const [busy, setBusy] = useState(false);
  const [screenRect, setScreenRect] = useState<Rect | null>(null);
  // GLB indirme ilerlemesi — Stage'deki yükleme çipiyle aynı kaynak.
  const [dl, setDl] = useState("");
  useEffect(
    () =>
      subscribeGlbProgress((p) =>
        setDl(p.active > 0 ? `${p.file ?? ""} · %${Math.round(p.ratio * 100)}` : "")
      ),
    []
  );

  const mainRef = useRef<HTMLCanvasElement>(null);
  const cornerRefs = [
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
  ];
  /** Son tam çözünürlük render'ı — köşe kırpmaları ve kanıt basımı için. */
  const fullRef = useRef<HTMLCanvasElement | null>(null);
  const genRef = useRef(0);
  const calRef = useRef(cal);
  calRef.current = cal;
  const fileRef = useRef(file);
  fileRef.current = file;

  // --- Defter + URL parametreleri
  useEffect(() => {
    const sync = () => setModels(listModels({ includeHidden: true }));
    sync();
    const un = subscribeModelRegistry(sync);
    (async () => {
      await reloadModelMeta();
      const all = listModels({ includeHidden: true });
      setModels(all);
      const q = new URLSearchParams(window.location.search);
      const want = q.get("model");
      const first =
        (want && all.find((m) => m.file === want)?.file) ||
        all.find((m) => m.kind === "phone")?.file ||
        all[0]?.file ||
        "";
      const base = registryScreen(first);
      const numOf = (k: string, d: number) => {
        const v = Number(q.get(k));
        return q.has(k) && Number.isFinite(v) ? v : d;
      };
      setFile(first);
      setCal({
        insetX: numOf("ix", base.insetX),
        insetY: numOf("iy", base.insetY),
        offsetX: numOf("ox", base.offsetX),
        offsetY: numOf("oy", base.offsetY),
        cornerRadiusRatio: numOf("cr", base.cornerRadiusRatio),
      });
      if (q.get("proof") === "1") setHalf(false);
    })();
    return () => {
      un();
      // sayfadan çıkarken canlı override'ı bırakma — stüdyo kayıtlı değeri görsün
      if (fileRef.current) setScreenOverride(fileRef.current, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Model değişince o modelin kayıtlı değerlerini yükle.
  const pickModel = useCallback((f: string) => {
    setScreenOverride(fileRef.current, null);
    setFile(f);
    const base = registryScreen(f);
    setCal({
      insetX: base.insetX,
      insetY: base.insetY,
      offsetX: base.offsetX,
      offsetY: base.offsetY,
      cornerRadiusRatio: base.cornerRadiusRatio,
    });
  }, []);

  const style: DeviceStyle3D = useMemo(
    () => ({
      mode: "3d",
      model: "real",
      glb: file ? `/assets/models/${file}` : undefined,
      camera: "front",
      env: "soft",
      shadow: false,
      reflection: false,
    }),
    [file]
  );

  /* ---------------- render ---------------- */

  // renderDevice3D tek paylaşımlı WebGLRenderer kullanıyor — eşzamanlı çağrılar
  // birbirinin buffer'ını ezer. Tüm render'lar tek kuyrukta sıraya girer.
  const lockRef = useRef<Promise<unknown>>(Promise.resolve());
  const serialize = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = lockRef.current.then(job, job);
    lockRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const renderOnce = useCallback(
    (scale: number, withScreen = true): Promise<HTMLCanvasElement | null> =>
      serialize(async () => {
      if (!file) return null;
      setScreenOverride(file, calRef.current);
      const W = Math.round(FULL_W * scale);
      const H = Math.round(FULL_H * scale);
      const img = withScreen ? await testPattern() : null;
      const layer = await renderDevice3D({
        screenshot: img,
        style: {
          ...style,
          glb: `/assets/models/${file}`,
        },
        width: W,
        height: H,
        box: { cx: W / 2, cy: H * 0.5, h: H * 0.9 },
      });
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(layer, 0, 0);
      return out;
      }),
    [file, style, serialize]
  );

  const paintCorners = useCallback(
    (full: HTMLCanvasElement) => {
      const ctx = full.getContext("2d");
      if (!ctx) return;
      const { width: W, height: H } = full;
      const d = ctx.getImageData(0, 0, W, H).data;
      const box = scanBox(d, W, H, isMagenta);
      if (!rectValid(box)) {
        setScreenRect(null);
        return;
      }
      setScreenRect(box);
      // Pencere: köşe yayı + iki düz kenar birlikte görünsün diye bbox köşesi
      // pencerenin DIŞ köşesine yakın konumlanır (CROP_MARGIN kadar dışarıda).
      const S = Math.max(CROP_MIN, Math.round((box.x1 - box.x0) * CROP_FRAC));
      const m = Math.round(S * CROP_MARGIN);
      // [srcX, srcY, bbox köşesinin pencere içindeki konumu]
      const wins: [number, number, number, number][] = [
        [box.x0 - m, box.y0 - m, m, m], // sol-üst
        [box.x1 + m - S, box.y0 - m, S - m, m], // sağ-üst
        [box.x0 - m, box.y1 + m - S, m, S - m], // sol-alt
        [box.x1 + m - S, box.y1 + m - S, S - m, S - m], // sağ-alt
      ];
      const k = CROP_OUT / S;
      wins.forEach(([sx, sy, ax, ay], i) => {
        const c = cornerRefs[i].current;
        if (!c) return;
        c.width = CROP_OUT;
        c.height = CROP_OUT;
        const cc = c.getContext("2d");
        if (!cc) return;
        cc.imageSmoothingEnabled = false;
        cc.fillStyle = "#000";
        cc.fillRect(0, 0, c.width, c.height);
        cc.drawImage(full, Math.round(sx), Math.round(sy), S, S, 0, 0, c.width, c.height);
        // magenta bbox kenar çizgileri — düzlemin nominal dörtgeni
        cc.strokeStyle = "rgba(0,255,255,0.45)";
        cc.lineWidth = 1;
        cc.beginPath();
        cc.moveTo(Math.round(ax * k) + 0.5, 0);
        cc.lineTo(Math.round(ax * k) + 0.5, c.height);
        cc.moveTo(0, Math.round(ay * k) + 0.5);
        cc.lineTo(c.width, Math.round(ay * k) + 0.5);
        cc.stroke();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const draw = useCallback(
    async (scale: number) => {
      const my = ++genRef.current;
      const out = await renderOnce(scale);
      if (!out || my !== genRef.current) return;
      const dst = mainRef.current;
      if (dst) {
        dst.width = out.width;
        dst.height = out.height;
        dst.getContext("2d")?.drawImage(out, 0, 0);
      }
      if (scale === 1) {
        fullRef.current = out;
        paintCorners(out);
      }
    },
    [renderOnce, paintCorners]
  );

  // Değer/model değişince: önce hızlı (yarım) render, 600ms sonra tam.
  useEffect(() => {
    if (!file) return;
    let dead = false;
    const t1 = setTimeout(() => {
      if (!dead) void draw(half ? HALF : 1);
    }, 40);
    const t2 = setTimeout(() => {
      if (!dead && half) void draw(1);
    }, 620);
    return () => {
      dead = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, cal.insetX, cal.insetY, cal.offsetX, cal.offsetY, cal.cornerRadiusRatio, half]);

  /* ---------------- klavye ---------------- */

  const nudge = useCallback((f: Field, dir: number, big: boolean) => {
    const spec = FIELDS.find((x) => x.id === f)!;
    const d = (big ? spec.big : spec.step) * dir;
    setCal((c) => ({
      ...c,
      [f]: Number((((c[f] as number) ?? 0) + d).toFixed(5)),
    }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"))
        return;
      const big = e.shiftKey;
      // Alt: inset çifti, Alt'sız: ofset çifti (aktif alan seçimi de var)
      const pair: [Field, Field] = e.altKey ? ["insetX", "insetY"] : ["offsetX", "offsetY"];
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          nudge(pair[0], -1, big);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudge(pair[0], 1, big);
          break;
        case "ArrowUp":
          e.preventDefault();
          nudge(pair[1], 1, big);
          break;
        case "ArrowDown":
          e.preventDefault();
          nudge(pair[1], -1, big);
          break;
        case "[":
          nudge("cornerRadiusRatio", -1, big);
          break;
        case "]":
          nudge("cornerRadiusRatio", 1, big);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge]);

  /* ---------------- kaydet ---------------- */

  const save = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setStatus("kaydediliyor…");
    try {
      const res = await fetch("/api/models-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, screen: calRef.current }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; entry?: { version?: number } };
      if (!res.ok || !j.ok) throw new Error(j.error || "kayıt hatası");
      await reloadModelMeta();
      setScreenOverride(file, null);
      setModels(listModels({ includeHidden: true }));
      setStatus(`kaydedildi — ${file} v${j.entry?.version ?? "?"}`);
    } catch (e) {
      setStatus(`HATA: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [file]);

  /* ---------------- otomatik öner ---------------- */

  const autoSuggest = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setStatus("analiz ediliyor…");
    try {
      const withPlane = await renderOnce(1, true);
      const noPlane = await renderOnce(1, false);
      if (!withPlane || !noPlane) throw new Error("render alınamadı");
      const W = withPlane.width;
      const H = withPlane.height;
      const a = withPlane.getContext("2d")!.getImageData(0, 0, W, H).data;
      const b = noPlane.getContext("2d")!.getImageData(0, 0, W, H).data;

      const planeBox = scanBox(a, W, H, isMagenta);
      if (!rectValid(planeBox)) throw new Error("magenta düzlem bulunamadı");

      // Cam açıklığı: düzlemsiz render'da, düzlem bölgesinin yakın çevresinde
      // KOYU pikseller (cihazın kendi cam yüzeyi). Arama penceresi: düzlem
      // kutusunun %12 dışına kadar.
      const padX = (planeBox.x1 - planeBox.x0) * 0.14;
      const padY = (planeBox.y1 - planeBox.y0) * 0.14;
      const sx0 = Math.max(0, Math.floor(planeBox.x0 - padX));
      const sx1 = Math.min(W - 1, Math.ceil(planeBox.x1 + padX));
      const sy0 = Math.max(0, Math.floor(planeBox.y0 - padY));
      const sy1 = Math.min(H - 1, Math.ceil(planeBox.y1 + padY));
      const glass = emptyRect();
      for (let y = sy0; y <= sy1; y++) {
        for (let x = sx0; x <= sx1; x++) {
          const i = (y * W + x) * 4;
          if (b[i + 3] < 200) continue;
          const lum = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
          if (lum > 62) continue;
          if (x < glass.x0) glass.x0 = x;
          if (x > glass.x1) glass.x1 = x;
          if (y < glass.y0) glass.y0 = y;
          if (y > glass.y1) glass.y1 = y;
        }
      }
      if (!rectValid(glass)) throw new Error("cam açıklığı bulunamadı");

      const pw = planeBox.x1 - planeBox.x0;
      const ph = planeBox.y1 - planeBox.y0;
      const gw = glass.x1 - glass.x0;
      const gh = glass.y1 - glass.y0;
      const c = calRef.current;
      // px → oran: pw px, rawW*insetX modele karşılık gelir.
      const dOx = (((glass.x0 + glass.x1) / 2 - (planeBox.x0 + planeBox.x1) / 2) * c.insetX) / pw;
      // ekran y'si aşağı artar; offsetY yukarı +
      const dOy = -(((glass.y0 + glass.y1) / 2 - (planeBox.y0 + planeBox.y1) / 2) * c.insetY) / ph;
      const next: ScreenCalib = {
        insetX: Number((c.insetX * (gw / pw)).toFixed(4)),
        insetY: Number((c.insetY * (gh / ph)).toFixed(4)),
        offsetX: Number((c.offsetX + dOx).toFixed(4)),
        offsetY: Number((c.offsetY + dOy).toFixed(4)),
        cornerRadiusRatio: c.cornerRadiusRatio,
      };
      setCal(next);
      setStatus(
        `öneri: düzlem ${pw.toFixed(0)}×${ph.toFixed(0)}px → cam ${gw.toFixed(0)}×${gh.toFixed(0)}px · ` +
          `inset ${next.insetX}/${next.insetY} · ofset ${next.offsetX}/${next.offsetY} (kaba — ok tuşlarıyla doğrula)`
      );
    } catch (e) {
      setStatus(`öneri başarısız: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [file, renderOnce]);

  /* ---------------- kanıt bas ---------------- */

  const exportProof = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setStatus("kanıt basılıyor…");
    try {
      let full = fullRef.current;
      if (!full || full.width !== FULL_W) {
        full = await renderOnce(1);
        if (!full) throw new Error("render alınamadı");
        fullRef.current = full;
        paintCorners(full);
      }
      // köşe şeridi: 4 kırpma yan yana + etiket
      const cw = CROP_OUT;
      const strip = document.createElement("canvas");
      strip.width = cw * 4 + 5 * 12;
      strip.height = cw + 76;
      const sc = strip.getContext("2d")!;
      sc.fillStyle = "#111116";
      sc.fillRect(0, 0, strip.width, strip.height);
      const names = ["sol-üst", "sağ-üst", "sol-alt", "sağ-alt"];
      cornerRefs.forEach((r, i) => {
        const c = r.current;
        if (!c) return;
        const x = 12 + i * (cw + 12);
        sc.drawImage(c, x, 46);
        sc.fillStyle = "#e9e9f2";
        sc.font = "20px ui-monospace, monospace";
        sc.fillText(names[i], x + 4, 34);
      });
      sc.fillStyle = "#9aa";
      sc.font = "18px ui-monospace, monospace";
      const c0 = calRef.current;
      sc.fillText(
        `${file}  ix=${c0.insetX} iy=${c0.insetY} ox=${c0.offsetX} oy=${c0.offsetY} cr=${c0.cornerRadiusRatio}`,
        12,
        strip.height - 18
      );

      const base = file.replace(/\.glb$/i, "");
      const images = [
        { file: `${base}-full.png`, dataUrl: full.toDataURL("image/png") },
        { file: `${base}-corners.png`, dataUrl: strip.toDataURL("image/png") },
      ];
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: "_calib", locale: "x", images }),
      });
      const j = (await res.json()) as { path?: string; error?: string };
      setStatus(j.error ? `HATA: ${j.error}` : `kanıt basıldı → ${j.path}`);
    } catch (e) {
      setStatus(`kanıt hatası: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [file, renderOnce, paintCorners]);

  // proof=1 → yüklenince otomatik bas (otomasyon)
  const autoProofDone = useRef(false);
  useEffect(() => {
    if (autoProofDone.current || !file) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("proof") !== "1") return;
    autoProofDone.current = true;
    // Tam çözünürlük render'ı bitene kadar bekle (sabit gecikme değil).
    let dead = false;
    (async () => {
      for (let i = 0; i < 60 && !dead; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (fullRef.current) break;
      }
      if (!dead) await exportProof();
    })();
    return () => {
      dead = true;
    };
  }, [file, exportProof]);

  /* ---------------- görünüm ---------------- */

  const label = models.find((m) => m.file === file)?.label ?? file;
  const saved = file ? registryScreen(file) : DEFAULT_SCREEN;
  const dirty = FIELDS.some(
    (f) => Math.abs(((cal[f.id] as number) ?? 0) - ((saved[f.id] as number) ?? 0)) > 1e-6
  );

  return (
    <div style={S.page}>
      <aside style={S.side}>
        <h1 style={S.h1}>Ekran kalibratörü</h1>
        <p style={S.note}>
          Magenta test deseni ekranın tamamını kaplamalı: köşe kırpmalarında{" "}
          <b style={{ color: "#ff5ce0" }}>magenta</b> bezel'e değmeli — gri boşluk YOK, bezel'in
          üstüne taşma YOK.
        </p>

        <label style={S.lbl}>Model</label>
        <select
          value={file}
          onChange={(e) => pickModel(e.target.value)}
          style={S.select}
          disabled={busy}
        >
          {models.map((m) => (
            <option key={m.file} value={m.file}>
              {m.label} — {m.file} (v{m.version})
            </option>
          ))}
        </select>

        <div style={S.hr} />

        {FIELDS.map((f) => (
          <div key={f.id} style={S.row}>
            <button
              type="button"
              style={{ ...S.mini, ...(field === f.id ? S.miniOn : null) }}
              onClick={() => setField(f.id)}
              title="aktif alan"
            >
              {field === f.id ? "●" : "○"}
            </button>
            <span style={S.rowLbl}>{f.label}</span>
            <button style={S.step} onClick={() => nudge(f.id, -1, false)} disabled={busy}>
              −
            </button>
            <code style={S.val}>{((cal[f.id] as number) ?? 0).toFixed(4)}</code>
            <button style={S.step} onClick={() => nudge(f.id, 1, false)} disabled={busy}>
              +
            </button>
            <button style={S.stepBig} onClick={() => nudge(f.id, -1, true)} disabled={busy}>
              −−
            </button>
            <button style={S.stepBig} onClick={() => nudge(f.id, 1, true)} disabled={busy}>
              ++
            </button>
          </div>
        ))}

        <p style={S.keys}>
          Ok tuşları: <b>ofset</b> (⌥ basılı → <b>inset</b>) · ⇧ = ×10 adım · <b>[ ]</b> = köşe
          yarıçapı
        </p>

        <div style={S.hr} />

        <div style={S.btnRow}>
          <button style={S.btn} onClick={() => void autoSuggest()} disabled={busy || !file}>
            otomatik öner
          </button>
          <button
            style={S.btn}
            onClick={() => setCal({ ...DEFAULT_SCREEN })}
            disabled={busy}
            title="varsayılana dön"
          >
            sıfırla
          </button>
        </div>
        <div style={S.btnRow}>
          <button style={S.btn} onClick={() => setHalf((h) => !h)} disabled={busy}>
            {half ? "tam çözünürlük" : "hızlı (yarım)"}
          </button>
          <button style={S.btn} onClick={() => void draw(1)} disabled={busy}>
            yenile
          </button>
        </div>
        <div style={S.btnRow}>
          <button style={S.btn} onClick={() => void exportProof()} disabled={busy || !file}>
            kanıt bas (_calib)
          </button>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: dirty ? 1 : 0.55 }}
            onClick={() => void save()}
            disabled={busy || !file}
          >
            Kaydet
          </button>
        </div>

        <pre style={S.status}>{dl ? `model indiriliyor: ${dl}\n${status}` : status}</pre>
        <pre style={S.json}>
          {JSON.stringify(
            { file, screen: { ...cal } },
            null,
            2
          )}
        </pre>
        {screenRect && (
          <p style={S.note}>
            magenta bbox: {(screenRect.x1 - screenRect.x0).toFixed(0)}×
            {(screenRect.y1 - screenRect.y0).toFixed(0)} px @ ({screenRect.x0.toFixed(0)},
            {screenRect.y0.toFixed(0)})
          </p>
        )}
      </aside>

      <main style={S.main}>
        <div style={S.stageWrap}>
          <canvas ref={mainRef} style={S.canvas} />
        </div>
        <div style={S.strip}>
          {["sol-üst", "sağ-üst", "sol-alt", "sağ-alt"].map((n, i) => (
            <figure key={n} style={S.fig}>
              <figcaption style={S.cap}>
                {n}
              </figcaption>
              <canvas ref={cornerRefs[i]} style={S.crop} />
            </figure>
          ))}
        </div>
        <p style={S.footer}>
          {label} · {half ? "yarım çözünürlük" : "tam çözünürlük"} · köşe kırpmaları her zaman tam
          çözünürlükten
        </p>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Stil — bu sayfa geliştirme aracı; globals.css'e dokunmamak için inline.
 * ------------------------------------------------------------------ */

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "grid",
    gridTemplateColumns: "372px 1fr",
    minHeight: "100vh",
    background: "#0b0b0f",
    color: "#e9e9f2",
    font: `12px ${mono}`,
  },
  side: {
    padding: "18px 16px",
    borderRight: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.02)",
    overflowY: "auto",
    maxHeight: "100vh",
  },
  h1: { font: `600 15px ${mono}`, margin: "0 0 8px" },
  note: { color: "#9a9ab0", lineHeight: 1.5, margin: "0 0 12px" },
  lbl: { display: "block", color: "#9a9ab0", margin: "8px 0 4px" },
  select: {
    width: "100%",
    padding: "7px 8px",
    background: "#15151c",
    color: "#e9e9f2",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    font: `12px ${mono}`,
  },
  hr: { height: 1, background: "rgba(255,255,255,0.09)", margin: "14px 0" },
  row: { display: "flex", alignItems: "center", gap: 4, margin: "0 0 7px" },
  rowLbl: { flex: 1, color: "#c3c3d4", fontSize: 11 },
  mini: {
    width: 18,
    height: 18,
    padding: 0,
    background: "transparent",
    color: "#6d6d86",
    border: "none",
    cursor: "pointer",
  },
  miniOn: { color: "#8b5cf6" },
  val: {
    width: 62,
    textAlign: "right",
    color: "#ffd479",
    fontSize: 11,
  },
  step: {
    width: 22,
    height: 22,
    background: "#1b1b24",
    color: "#e9e9f2",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    cursor: "pointer",
    font: `12px ${mono}`,
  },
  stepBig: {
    width: 26,
    height: 22,
    background: "#15151c",
    color: "#9a9ab0",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 6,
    cursor: "pointer",
    font: `10px ${mono}`,
  },
  keys: { color: "#6d6d86", lineHeight: 1.6, margin: "10px 0 0" },
  btnRow: { display: "flex", gap: 8, margin: "0 0 8px" },
  btn: {
    flex: 1,
    padding: "8px 10px",
    background: "#1b1b24",
    color: "#e9e9f2",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    cursor: "pointer",
    font: `12px ${mono}`,
  },
  btnPrimary: {
    background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
    color: "#0b0b0f",
    fontWeight: 700,
    border: "none",
  },
  status: {
    margin: "10px 0 0",
    padding: 8,
    background: "#15151c",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    color: "#9fe8b0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 11,
  },
  json: {
    margin: "8px 0 0",
    padding: 8,
    background: "#15151c",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    color: "#c3c3d4",
    fontSize: 11,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    padding: 18,
    overflowY: "auto",
    maxHeight: "100vh",
  },
  stageWrap: {
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 12,
    overflow: "hidden",
    background: "#000",
  },
  canvas: { display: "block", height: "min(66vh, 900px)", width: "auto" },
  strip: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" },
  fig: { margin: 0 },
  cap: { color: "#9a9ab0", fontSize: 11, marginBottom: 4 },
  crop: {
    display: "block",
    width: 250,
    height: 250,
    imageRendering: "pixelated",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    background: "#000",
  },
  footer: { color: "#6d6d86" },
};
