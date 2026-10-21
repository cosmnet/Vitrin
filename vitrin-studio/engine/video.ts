// APP PREVIEW VIDEO export — R8 / Wave-5 (PLAN-R8 §F1).
//
// NEDEN BÖYLE
// -----------
// App Store "app preview" slotu statik screenshot'tan çok daha sıkı:
//   · portre 886×1920 (6.9″/6.5″/6.3″/6.1″ ORTAK slot) — 1080×1920 YANLIŞ
//     slottur ve sessizce reddedilir; iPad 13″ = 1200×1600
//   · 15–30 sn, ≤30 fps ve SABİT kare hızı
//   · H.264 **High Profile Level 4.0** (`avc1.640028`) — Baseline/Main/HEVC yok
//   · .mp4 + faststart (moov başta), YUV 4:2:0
//   · SESSİZ olsa bile **AAC-LC stereo ses kanalı ZORUNLU** (kanalsız yükleme
//     reddedilir — bu maddeyi atlayan her ev yapımı export'un takıldığı yer)
//
// Bu yüzden `MediaRecorder` KULLANILMAZ: VBR üretir, kare düşürür, WebM/VP8
// verir. Doğru yol WebCodecs `VideoEncoder`/`AudioEncoder` + `mp4-muxer`:
// kare kare, gerçek zamandan bağımsız (offline), tam kontrollü.
//
// DETERMİNİZM
// Motorda `Date.now()`/`Math.random()` yok, gren seed'li — `renderSlide` aynı
// slayt + aynı orbit için BİT-BİT aynı kareyi verir. Video export bu yüzden
// "ekran kaydı" değil, gerçek bir render kuyruğu: kare başına ~100-150 ms
// (886×1920, SS=2) → 16 sn'lik makara ≈ 60-75 sn. Kabul edilebilir.
//
// ORBIT SÖZLEŞMESİ — SPEC'TEN SAPMA (bilerek)
// PLAN-R8 taslağı `device:{...dev, camera:"custom", orbit}` diyor. Motorda
// `resolveOrbit(style, preset)` orbit'e camera "custom" OLMASA DA öncelik
// veriyor (scene3dCore.ts:174). `camera:"custom"` yazmak preset'i de
// değiştirir; `PRESETS.custom` tek cihazlıdır, roll'ü farklıdır — yani
// `stack3`/`fan3`/`pair` makarada ÜÇ telefonu KAYBEDERDİ. Doğrusu preset'i
// olduğu gibi bırakıp yalnız orbit'i yazmak: `{...dev, orbit}`.

import { L } from "@/lib/i18n";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

import { renderSlide } from "./render";
import { presetOf, resolveOrbit } from "./scene3dCore";
import { getTheme } from "./themes";
import {
  VIDEO_FPS,
  VIDEO_MAX_SEC,
  VIDEO_MIN_SEC,
  VIDEO_SIZES,
  isDevice3D,
  type DeviceStyle,
  type DeviceStyle3D,
  type Orbit,
  type SetPlan,
  type Slide,
  type VideoSizeId,
} from "./types";

/* ------------------------------------------------------------------ *
   1. Kodlayıcı sözleşmesi — store gereksinimlerinin birebir karşılığı
 * ------------------------------------------------------------------ */

/** H.264 High Profile Level 4.0. Store başka profil kabul etmiyor. */
export const VIDEO_CODEC = "avc1.640028";
/** AAC-LC. `mp4a.40.2` = MPEG-4 Audio, object type 2 (LC). */
export const AUDIO_CODEC = "mp4a.40.2";
export const AUDIO_RATE = 44100;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 128_000;

/**
 * 12 Mbit/s, SABİT hız (CBR).
 *
 * Level 4.0 High profile tavanı 20 Mbit/s (16000 kbps × 1.25); 12 Mbps hem
 * bu tavanın rahat altında hem de 886×1920'de bant/gradyan bozulması
 * bırakmayacak kadar bol. `bitrateMode:"constant"` VBR tepe noktalarını
 * engeller — store doğrulayıcısı ani tepe gördüğünde "değişken kare hızı"
 * şüphesiyle geri çevirebiliyor. 30 sn × 12 Mbps ≈ 45 MB, 500 MB sınırının
 * çok altında.
 */
export const VIDEO_BITRATE = 12_000_000;

/** Anahtar kare aralığı — 60 kare = 2 sn. */
export const KEYFRAME_EVERY = 60;

/** Kare süresi (µs). 30 fps ⇒ 33333 µs; toplam kayma kare başına <1 µs. */
export const FRAME_DUR_US = 33333;

/** Bir video karesine düşen ses örneği: 44100/30 = 1470 (TAM sayı). */
const SAMPLES_PER_FRAME = AUDIO_RATE / VIDEO_FPS;

export function videoEncoderConfig(sizeId: VideoSizeId): VideoEncoderConfig {
  const s = VIDEO_SIZES[sizeId];
  return {
    codec: VIDEO_CODEC,
    width: s.w,
    height: s.h,
    framerate: VIDEO_FPS,
    bitrate: VIDEO_BITRATE,
    bitrateMode: "constant",
    latencyMode: "quality",
    // avcC (length-prefixed) — muxer'ın istediği biçim. Annex-B mux edilemez.
    avc: { format: "avc" },
  };
}

export function audioEncoderConfig(): AudioEncoderConfig {
  return {
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: AUDIO_BITRATE,
  };
}

export type SupportReport = {
  ok: boolean;
  video: boolean;
  audio: boolean;
  /** Türkçe, kullanıcıya gösterilebilir tek satır. Sorun yoksa boş. */
  error: string;
  /** Tarayıcının geri verdiği (belki düzeltilmiş) config — künye için. */
  videoConfig?: VideoEncoderConfig;
};

/**
 * Render'a girmeden ÖNCE sorulur. `isConfigSupported` yoksa ya da High 4.0'a
 * hayır diyorsa kullanıcı 2 dakikayı çöpe atmadan öğrenir.
 */
export async function checkVideoSupport(sizeId: VideoSizeId): Promise<SupportReport> {
  const has =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === "function" &&
    typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder === "function";
  if (!has) {
    return {
      ok: false,
      video: false,
      audio: false,
      error:
        L("Bu tarayıcıda WebCodecs (VideoEncoder/AudioEncoder) yok. Video export Chrome ya da Edge gerektirir — Safari ve Firefox'ta H.264 kodlaması sunulmuyor.", "This browser has no WebCodecs (VideoEncoder/AudioEncoder). Video export requires Chrome or Edge — Safari and Firefox do not offer H.264 encoding."),
    };
  }
  const vcfg = videoEncoderConfig(sizeId);
  let video = false;
  let audio = false;
  let out: VideoEncoderConfig | undefined;
  try {
    const r = await VideoEncoder.isConfigSupported(vcfg);
    video = !!r.supported;
    out = r.config;
  } catch {
    video = false;
  }
  try {
    const r = await AudioEncoder.isConfigSupported(audioEncoderConfig());
    audio = !!r.supported;
  } catch {
    audio = false;
  }
  const parts: string[] = [];
  if (!video) {
    parts.push(
      L(`H.264 High Profile Level 4.0 (${VIDEO_CODEC}) ${VIDEO_SIZES[sizeId].w}×${VIDEO_SIZES[sizeId].h} kodlaması desteklenmiyor. App Store başka profil kabul etmediği için düşük profile inilmiyor.`, `H.264 High Profile Level 4.0 (${VIDEO_CODEC}) ${VIDEO_SIZES[sizeId].w}×${VIDEO_SIZES[sizeId].h} encoding is not supported. The App Store accepts no other profile, so it does not fall back to a lower profile.`)
    );
  }
  if (!audio) {
    parts.push(
      L(`AAC-LC (${AUDIO_CODEC}) ses kodlaması desteklenmiyor. Sessiz de olsa ses kanalı ZORUNLU — kanalsız mp4 yüklenemez.`, `AAC-LC (${AUDIO_CODEC}) audio encoding is not supported. An audio track is REQUIRED even if silent — an mp4 without one cannot be uploaded.`)
    );
  }
  return { ok: video && audio, video, audio, error: parts.join(" "), videoConfig: out };
}

/* ------------------------------------------------------------------ *
   2. Kamera hareketi presetleri

   Kullanıcı ham orbit girmez — bir HAREKET seçer. Hareketin iki ucu
   slaytın KENDİ kamerasından türetilir, bu yüzden makaranın son karesi
   (drift-right hariç) still export'la aynı kadrajdır: "video ile
   screenshot'ım tutmuyor" sorunu doğmadan kapanır.
 * ------------------------------------------------------------------ */

export type MoveId = "orbit-slow" | "push-in" | "drift-right" | "reveal-up" | "static" | "ken-burns";

export const MOVES: {
  id: MoveId;
  label: string;
  hint: string;
  /** 3D kamera hareketi mi (2D cihazda anlamsız)? */
  camera: boolean;
  /** Son kare slaytın still hâliyle birebir aynı mı? */
  endsAtStill: boolean;
}[] = [
  { id: "orbit-slow", label: L("Yavaş yörünge", "Slow orbit"), hint: L("θ −0.12 → mevcut", "θ −0.12 → current"), camera: true, endsAtStill: true },
  { id: "push-in", label: L("İçeri yaklaş", "Push in"), hint: L("mesafe 1.15× → 1×", "distance 1.15× → 1×"), camera: true, endsAtStill: true },
  { id: "drift-right", label: L("Sağa süzül", "Drift right"), hint: "θ −0.08 → +0.08", camera: true, endsAtStill: false },
  { id: "reveal-up", label: L("Yukarı açıl", "Reveal up"), hint: L("φ +0.18 → mevcut", "φ +0.18 → current"), camera: true, endsAtStill: true },
  { id: "static", label: L("Sabit", "Static"), hint: L("hareket yok", "no motion"), camera: false, endsAtStill: true },
  { id: "ken-burns", label: "Ken Burns", hint: L("1.03× → 1× yumuşak", "1.03× → 1× smooth"), camera: false, endsAtStill: true },
];

export const MOVE_IDS = MOVES.map((m) => m.id);

export function isMoveId(v: unknown): v is MoveId {
  return typeof v === "string" && (MOVE_IDS as string[]).includes(v);
}

/** 3D olmayan slayt için varsayılan hareket ken-burns, 3D için orbit-slow. */
export function defaultMove(dev: DeviceStyle): MoveId {
  return isDevice3D(dev) ? "orbit-slow" : "ken-burns";
}

const EASE: Record<"inout" | "out", (t: number) => number> = {
  // cubic in-out — başta ve sonda sıfır hız: "kamera operatörü" hissi
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // cubic out — hemen başlar, sona doğru yumuşar
  out: (t) => 1 - Math.pow(1 - t, 3),
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  return {
    theta: lerp(a.theta, b.theta, t),
    phi: lerp(a.phi, b.phi, t),
    distance: lerp(a.distance, b.distance, t),
    targetY: lerp(a.targetY ?? 0, b.targetY ?? 0, t),
  };
}

/** Hareketin iki ucu — slaytın MEVCUT orbit'i (`cur`) referans alınır. */
function moveRange(move: MoveId, cur: Orbit): { from: Orbit; to: Orbit } {
  switch (move) {
    case "orbit-slow":
      return { from: { ...cur, theta: cur.theta - 0.12 }, to: { ...cur } };
    case "push-in":
      return { from: { ...cur, distance: cur.distance * 1.15 }, to: { ...cur } };
    case "drift-right":
      return { from: { ...cur, theta: cur.theta - 0.08 }, to: { ...cur, theta: cur.theta + 0.08 } };
    case "reveal-up":
      // φ + = kamera yukarıdan bakar. Yüksekten başlayıp mevcut kadraja
      // inmek ekranı "açar" — bitiş still ile aynı.
      return { from: { ...cur, phi: cur.phi + 0.18 }, to: { ...cur } };
    default:
      return { from: { ...cur }, to: { ...cur } };
  }
}

/* ------------------------------------------------------------------ *
   3. Shot / Reel
 * ------------------------------------------------------------------ */

export type Shot = {
  slide: Slide;
  durSec: number;
  from: Orbit;
  to: Orbit;
  ease: "inout" | "out";
  /** Sondaki N saniye `to`da bekler — son kare still ile aynı kalsın diye. */
  hold?: number;
  /**
   * SPEC ÜSTÜ EK: kamera hareketi olmayan slaytlarda (2D cihaz, "static",
   * "ken-burns") tek render alınır ve kare kare 2D ölçekle "Ken Burns"
   * yapılır. `from`>`to` seçildi: son kare 1.00× yani still ile PİKSEL
   * eşdeğeri. Ucuz (tek render) ama profesyonel duruyor.
   */
  zoom?: { from: number; to: number };
  /** Künye/UI için — hangi preset'ten türedi. */
  move: MoveId;
};

export type Reel = {
  sizeId: VideoSizeId;
  fps: 30;
  shots: Shot[];
};

export function shotFrames(shot: Shot, fps = VIDEO_FPS): number {
  return Math.max(1, Math.round(shot.durSec * fps));
}

export function reelFrames(reel: Reel): number {
  return reel.shots.reduce((n, s) => n + shotFrames(s, reel.fps), 0);
}

export function reelDuration(reel: Reel): number {
  return reelFrames(reel) / reel.fps;
}

/** Store 15–30 sn istiyor. Dışındaysa Türkçe uyarı döner. */
export function validateDuration(sec: number): string {
  if (sec < VIDEO_MIN_SEC) {
    return L(`Toplam ${sec.toFixed(1)} sn — App Store en az ${VIDEO_MIN_SEC} sn istiyor. Süreleri artır.`, `Total ${sec.toFixed(1)} s — the App Store requires at least ${VIDEO_MIN_SEC} s. Increase the durations.`);
  }
  if (sec > VIDEO_MAX_SEC) {
    return L(`Toplam ${sec.toFixed(1)} sn — App Store en fazla ${VIDEO_MAX_SEC} sn kabul ediyor. Süreleri kıs ya da slayt çıkar.`, `Total ${sec.toFixed(1)} s — the App Store accepts at most ${VIDEO_MAX_SEC} s. Shorten the durations or remove a slide.`);
  }
  return "";
}

/** Slaytın efektif cihaz stili (tema override'ı çözülmüş). */
export function deviceOf(slide: Slide): DeviceStyle {
  return slide.device ?? getTheme(slide.themeId).device;
}

/** Slaytın MEVCUT (still) orbit'i — 3D değilse ön kamera varsayılanı. */
export function currentOrbit(dev: DeviceStyle): Orbit {
  if (!isDevice3D(dev)) return { ...presetOf("front").orbit };
  return resolveOrbit(dev as DeviceStyle3D, presetOf(dev.camera));
}

export const DEFAULT_SHOT_SEC = 3;

/** Bir slayttan çekim üretir — `slide.videoShot` yoksa akıllı varsayılan. */
export function shotFor(slide: Slide): Shot {
  const dev = deviceOf(slide);
  const vs = slide.videoShot;
  const durSec = Math.max(0.5, Math.min(30, Number(vs?.durSec ?? DEFAULT_SHOT_SEC)));
  let move: MoveId = isMoveId(vs?.move) ? vs.move : defaultMove(dev);
  // 2D cihazda kamera hareketi diye bir şey yok — sessizce Ken Burns'e düş.
  if (!isDevice3D(dev) && MOVES.find((m) => m.id === move)?.camera) move = "ken-burns";

  const cur = currentOrbit(dev);
  const { from, to } = moveRange(move, cur);
  const zoom = move === "ken-burns" ? { from: 1.03, to: 1 } : undefined;
  const hold = vs?.hold != null ? Math.max(0, Math.min(durSec - 0.2, Number(vs.hold))) : undefined;

  return {
    slide,
    durSec,
    from,
    to,
    ease: move === "push-in" ? "out" : "inout",
    hold,
    zoom,
    move,
  };
}

export function buildReel(
  plan: SetPlan,
  opts: { sizeId: VideoSizeId; indexes?: number[] }
): Reel {
  const picked =
    opts.indexes && opts.indexes.length
      ? opts.indexes.filter((i) => i >= 0 && i < plan.slides.length)
      : plan.slides.map((_, i) => i);
  return {
    sizeId: opts.sizeId,
    fps: VIDEO_FPS,
    shots: picked.map((i) => shotFor(plan.slides[i])),
  };
}

/* ------------------------------------------------------------------ *
   4. Kare üretimi
 * ------------------------------------------------------------------ */

/** Shot'ta gerçek bir kamera hareketi var mı? (yoksa TEK render yeter) */
function isStaticShot(shot: Shot): boolean {
  const a = shot.from;
  const b = shot.to;
  return (
    Math.abs(a.theta - b.theta) < 1e-6 &&
    Math.abs(a.phi - b.phi) < 1e-6 &&
    Math.abs(a.distance - b.distance) < 1e-6 &&
    Math.abs((a.targetY ?? 0) - (b.targetY ?? 0)) < 1e-6
  );
}

function orbitKey(o: Orbit): string {
  return `${o.theta.toFixed(5)}|${o.phi.toFixed(5)}|${o.distance.toFixed(5)}|${(o.targetY ?? 0).toFixed(5)}`;
}

/** Arka plan sekmesinde KISILMAYAN makro-görev (headless-export ile aynı). */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/* ------------------------------------------------------------------ *
   5. renderReel — makara → mp4 Blob
 * ------------------------------------------------------------------ */

export type VideoPhase = "hazırlık" | "kare" | "kapanış";

export type VideoProgress = {
  phase: VideoPhase;
  frame: number;
  totalFrames: number;
  shot: number;
  totalShots: number;
  current: string;
  /** Şu ana kadarki ortalama kare süresi (ms) — künye. */
  msPerFrame: number;
};

export type RenderReelOpts = {
  locale?: string;
  onProgress?: (p: VideoProgress) => void;
  /** Her kareden ÖNCE sorulur. true ⇒ dur ve HİÇBİR ŞEY döndürme (çöpe at). */
  shouldCancel?: () => boolean;
};

export type ReelResult = {
  /** İptal edildiyse null — yarım dosya diye bir şey YOK. */
  blob: Blob | null;
  cancelled: boolean;
  frames: number;
  durSec: number;
  width: number;
  height: number;
  msPerFrame: number;
  codec: string;
  bitrate: number;
};

/**
 * Makarayı kare kare basar, H.264 + sessiz AAC-LC olarak mux'lar, `.mp4`
 * Blob'u döner. GERÇEK ZAMANLI DEĞİLDİR: her kare tam kalitede render
 * edilir, bu yüzden 16 sn'lik makara ~1 dk sürer.
 */
export async function renderReel(reel: Reel, opts: RenderReelOpts = {}): Promise<ReelResult> {
  const size = VIDEO_SIZES[reel.sizeId];
  const W = size.w;
  const H = size.h;
  const fps = reel.fps;
  const totalFrames = reelFrames(reel);
  const totalShots = reel.shots.length;

  const base: ReelResult = {
    blob: null,
    cancelled: false,
    frames: totalFrames,
    durSec: totalFrames / fps,
    width: W,
    height: H,
    msPerFrame: 0,
    codec: VIDEO_CODEC,
    bitrate: VIDEO_BITRATE,
  };

  const support = await checkVideoSupport(reel.sizeId);
  if (!support.ok) throw new Error(support.error);

  opts.onProgress?.({
    phase: "hazırlık",
    frame: 0,
    totalFrames,
    shot: 0,
    totalShots,
    current: L("kodlayıcı kuruluyor", "setting up encoder"),
    msPerFrame: 0,
  });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    // ZORUNLU: sessiz de olsa stereo AAC-LC parça.
    audio: { codec: "aac", numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_RATE },
    // moov dosyanın BAŞINDA = faststart.
    fastStart: "in-memory",
    firstTimestampBehavior: "strict",
  });

  let encodeError: Error | null = null;
  const fail = (e: unknown) => {
    if (!encodeError) encodeError = e instanceof Error ? e : new Error(String(e));
  };

  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  venc.configure(videoEncoderConfig(reel.sizeId));

  /**
   * SES KUYRUĞU KIRPMASI — store için önemli.
   *
   * AAC 1024 örneklik bloklarla kodlar; son blok her zaman videonun son
   * karesini AŞAR (+ kodlayıcı dolgusu). Kırpılmazsa 30.0 sn'lik bir makara
   * 30.09 sn süren bir DOSYA olur ve App Store'un "en fazla 30 sn" kontrolüne
   * takılabilir. Bu yüzden BİTİŞİ video süresini geçen bloklar mux'a hiç
   * girmez: sessiz ses parçası birkaç milisaniye KISA kalır (zararsız),
   * dosya süresi = video süresi olur. En az bir blok her zaman korunur —
   * boş ses trakı olan mp4 de reddedilir.
   */
  const audioLimitUs = Math.round((totalFrames * 1e6) / fps);
  let audioChunks = 0;
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      const end = chunk.timestamp + (chunk.duration ?? 0);
      if (audioChunks > 0 && end > audioLimitUs) return;
      audioChunks++;
      muxer.addAudioChunk(chunk, meta);
    },
    error: fail,
  });
  aenc.configure(audioEncoderConfig());

  // Tek sessizlik tamponu — AudioData yapıcısı veriyi KOPYALAR, yeniden
  // kullanmak güvenli (2 kanal × 1470 örnek, f32-planar).
  const SILENCE = new Float32Array(SAMPLES_PER_FRAME * AUDIO_CHANNELS);

  // Ken Burns / zoom çıktısı için tek tuval — kare başına yeniden kurmayız.
  let zoomCanvas: HTMLCanvasElement | null = null;

  const t0 = performance.now();
  let frame = 0;
  let sampleCursor = 0;
  let cancelled = false;

  try {
    for (let si = 0; si < reel.shots.length; si++) {
      const shot = reel.shots[si];
      const n = shotFrames(shot, fps);
      const staticCam = isStaticShot(shot);
      const holdSec = shot.hold ?? 0;
      const moveSec = Math.max(0.2, shot.durSec - holdSec);

      // Kamera hareketi olmayan shot'ta TEK render — hold sırasında da aynı
      // orbit tekrar ettiği için 1 girişlik memo yeter.
      let memoKey = "";
      let memoCanvas: HTMLCanvasElement | null = null;

      for (let f = 0; f < n; f++) {
        if (opts.shouldCancel?.()) {
          cancelled = true;
          break;
        }
        // Yerel zaman: hold penceresinde t sabit 1 kalır.
        const tRaw = n <= 1 ? 1 : (f / (n - 1)) * (shot.durSec / moveSec);
        const t = Math.min(1, tRaw);
        const e = EASE[shot.ease](t);

        const orbit = staticCam ? shot.to : lerpOrbit(shot.from, shot.to, e);
        const key = orbitKey(orbit);

        let src: HTMLCanvasElement;
        if (memoCanvas && memoKey === key) {
          src = memoCanvas;
        } else {
          const dev = deviceOf(shot.slide);
          // Orbit preset'in ÜSTÜNE yazılır; camera alanına DOKUNULMAZ
          // (yoksa çoklu cihaz preset'lerinin instance'ları kaybolur).
          const slide: Slide = isDevice3D(dev)
            ? { ...shot.slide, device: { ...dev, orbit } }
            : shot.slide;
          src = await renderSlide(slide, { width: W, height: H, locale: opts.locale });
          memoKey = key;
          memoCanvas = src;
        }

        // Ken Burns: 1.03× → 1.00×, son kare still ile piksel eşdeğeri.
        let out: HTMLCanvasElement = src;
        if (shot.zoom) {
          const s = lerp(shot.zoom.from, shot.zoom.to, e);
          if (s > 1.0001) {
            if (!zoomCanvas) {
              zoomCanvas = document.createElement("canvas");
              zoomCanvas.width = W;
              zoomCanvas.height = H;
            }
            const zctx = zoomCanvas.getContext("2d");
            if (zctx) {
              zctx.clearRect(0, 0, W, H);
              zctx.imageSmoothingEnabled = true;
              zctx.imageSmoothingQuality = "high";
              const dw = W * s;
              const dh = H * s;
              zctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
              out = zoomCanvas;
            }
          }
        }

        // --- video karesi
        const vf = new VideoFrame(out, {
          timestamp: Math.round((frame * 1e6) / fps),
          duration: FRAME_DUR_US,
        });
        venc.encode(vf, { keyFrame: frame % KEYFRAME_EVERY === 0 });
        vf.close();

        // --- aynı zaman diliminin SESSİZ sesi (interleave burada doğar)
        const ad = new AudioData({
          format: "f32-planar",
          sampleRate: AUDIO_RATE,
          numberOfFrames: SAMPLES_PER_FRAME,
          numberOfChannels: AUDIO_CHANNELS,
          timestamp: Math.round((sampleCursor * 1e6) / AUDIO_RATE),
          data: SILENCE,
        });
        aenc.encode(ad);
        ad.close();
        sampleCursor += SAMPLES_PER_FRAME;

        frame++;
        const ms = (performance.now() - t0) / frame;
        opts.onProgress?.({
          phase: "kare",
          frame,
          totalFrames,
          shot: si,
          totalShots,
          current: `slayt ${si + 1}/${totalShots} · ${shot.move}`,
          msPerFrame: ms,
        });

        if (encodeError) throw encodeError;

        // Kodlayıcı kuyruğu şişerse bekle (render zaten yavaş, nadiren olur).
        while (venc.encodeQueueSize > 8 || aenc.encodeQueueSize > 32) {
          await yieldToBrowser();
          if (encodeError) throw encodeError;
        }
        await yieldToBrowser();
      }
      if (cancelled) break;
    }

    if (cancelled) {
      // Hiçbir şey yazılmadı, hiçbir şey döndürülmüyor — yarım dosya YOK.
      return { ...base, cancelled: true, frames: frame, durSec: frame / fps };
    }

    opts.onProgress?.({
      phase: "kapanış",
      frame,
      totalFrames,
      shot: totalShots,
      totalShots,
      current: L("kodlayıcı boşaltılıyor + mux", "flushing encoder + mux"),
      msPerFrame: frame ? (performance.now() - t0) / frame : 0,
    });

    await venc.flush();
    await aenc.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();

    const buf = muxer.target.buffer;
    return {
      ...base,
      blob: new Blob([buf], { type: "video/mp4" }),
      frames: frame,
      durSec: frame / fps,
      msPerFrame: frame ? (performance.now() - t0) / frame : 0,
    };
  } finally {
    try {
      if (venc.state !== "closed") venc.close();
    } catch {
      /* zaten kapalı */
    }
    try {
      if (aenc.state !== "closed") aenc.close();
    } catch {
      /* zaten kapalı */
    }
  }
}

/* ------------------------------------------------------------------ *
   6. Teslim — Blob'u diske yaz

   /api/export'un HAM İKİLİ dalı kullanılır (`?bin=1`). Neden base64 değil:
   30 sn'lik mp4 ~45 MB; base64 bunu ~60 MB'lık bir STRING yapar, JSON
   ayrıştırıcısı bir kopya daha alır, `Buffer.from(b64)` bir daha — 180 MB'lık
   tepe ve saniyelerce ana-iş parçacığı bloğu. (route.ts'teki "dev gövdelerde
   regex V8'de patlıyor" notu aynı yaranın izi.) Parçalı base64 ise sunucuda
   oturum durumu + geçici dosya birleştirme demek: video için gereksiz
   karmaşıklık. Ham gövde tek `arrayBuffer()` + tek `writeFile`; safeSegment
   ve kök-içinde-mi koruması JSON dalıyla AYNI kodu paylaşır.
 * ------------------------------------------------------------------ */

export type SaveReelResult = { ok: boolean; path?: string; file?: string; bytes?: number; error?: string };

export async function saveReel(
  blob: Blob,
  o: { app: string; locale: string; sizeId: VideoSizeId; fileName?: string }
): Promise<SaveReelResult> {
  const file = o.fileName ?? `${o.sizeId}.mp4`;
  const q = new URLSearchParams({
    bin: "1",
    app: o.app,
    locale: o.locale,
    // ~/Desktop/Vitrin/<app>/video/<locale>/<sizeId>.mp4
    subPath: `video/${o.locale}`,
    file,
  });
  try {
    const res = await fetch(`/api/export?${q.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: blob,
    });
    const data = (await res.json()) as SaveReelResult;
    if (!res.ok || !data.ok) return { ok: false, error: data.error || L(`yazılamadı (${res.status})`, `write failed (${res.status})`) };
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
