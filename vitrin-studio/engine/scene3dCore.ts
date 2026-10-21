import { buildDuo } from "./duo";
import { duoAssetUrl, prepareDuoAsset, retargetDuoAssetScreen } from "./duoAsset";
import { isDuoKind, deviceAspectOf, isTabletKind, type DeviceKind } from "./types";
// 3D sahne çekirdeği — scene3d (tek kare export) ve scene3dLive (60fps canlı)
// modüllerinin PAYLAŞTIĞI kurulum kodu: cihaz modeli (varsayılan prosedürel
// "kontur" silüeti; style.model === "real" ya da style.glb ile GLB), materyal
// iyileştirmeleri, ekran-plane yaklaşımı, ortam/ışık, gölge, yansıma, kadraj
// çözücü. Bu modül renderer SAHİPLENMEZ; her tüketici kendi WebGLRenderer'ını
// kurar ve buraya parametre geçer.

import * as THREE from "three";
// DİKKAT: "@pmndrs/vanilla" KÖK import'u kullanılamaz — index.js CameraShake
// üzerinden three/examples/jsm/Addons.js'i çekiyor, o da LottieLoader ile
// https://cdn.jsdelivr.net/... adresine bağlanıyor ve webpack build'i patlıyor.
// Sadece ihtiyacımız olan iki dosya alt yoldan alınır.
import { BlurPass } from "@pmndrs/vanilla/materials/BlurPass";
import { MeshReflectorMaterial } from "@pmndrs/vanilla/materials/MeshReflectorMaterial";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  DEFAULT_MODEL_FILE,
  DEFAULT_TABLET_MODEL_FILE,
  ensureModelMeta,
  listModels,
  getModel,
  modelFileOf,
  modelVersion,
  hasInvertedNormals,
  screenCalib,
} from "./modelRegistry";
import type { CameraPresetId, DeviceStyle3D, LightRigId, Orbit } from "./types";

// ---------------------------------------------------------------------------
// Model ölçüleri (model birimi) — gövde ~ 1 : 2.16, incelik yüksekliğin ~%4.8'i
// ---------------------------------------------------------------------------

export const BODY_W = 1;
export const BODY_H = 2.16;
// Dış hat köşe yarıçapı. Gerçek iPhone Pro Max: 77.6mm genişlik / ~11.5mm köşe
// ≈ %14.8. Eski %16 fazla "hap" duruyordu; kontur v2 gerçeğe yaklaştırıldı.
export const BODY_R = BODY_W * 0.148;
export const BODY_D = BODY_H * 0.048; // incelik — dik açıda zarif, tuğla değil

// Normalize edilmiş cihaz BODY_H yüksekliğinde ve gerçek telefon ~147mm →
// "1 milimetre"nin sahne birimi karşılığı. Katman ofsetleri bununla verilir.
export const MM = BODY_H / 147;

/**
 * Cihaz türüne göre gövde ölçüleri. Yükseklik her türde BODY_H'ye normalize
 * (kadraj/gölge/zemin hesapları buna dayanır); yalnız EN, köşe ve "1 mm"
 * değişir.
 *   tablet: iPad Pro 13″ gövde 215.5×281.6 mm → en/boy 0.765; kadraj oranı
 *   FORMATS.ipad.deviceAspect (0.75) ile aynı tutuldu ki 2D/snap kutusuyla
 *   birebir örtüşsün. Köşe 281.6 mm'de ~18 mm → enin %11'i (telefonda %14.8).
 *   Dynamic Island YOK.
 */
export function bodyDimsOf(kind?: DeviceKind): {
  W: number;
  R: number;
  MM: number;
  island: boolean;
  tablet: boolean;
  /** Bezel: cam eninin oranı (iPhone 0.034, iPad 0.026 — kısa kenara göre). */
  bezel: number;
} {
  if (isDuoKind(kind)) { const W = BODY_H * deviceAspectOf(kind); return { W, R: Math.min(W, BODY_H) * .065, MM: BODY_H / 117.8, island: false, tablet: false, bezel: .022 }; }
  // iPad Pro 13″ (M4): 281.6 × 215.5 mm, köşe ≈ 18 mm (kısa kenarın %8.4'ü),
  // bezel ≈ 5.6 mm (kısa kenarın %2.6'sı). Yükseklik her zaman BODY_H'ye
  // normalize; yatayda kısa kenar yükseklik OLDUĞU için mm ölçeği değişir.
  if (kind === "tablet") {
    const W = BODY_H * 0.765;
    return { W, R: W * 0.084, MM: BODY_H / 281.6, island: false, tablet: true, bezel: 0.026 };
  }
  if (kind === "tablet-landscape") {
    const W = BODY_H * (281.6 / 215.5);
    return { W, R: BODY_H * 0.084, MM: BODY_H / 215.5, island: false, tablet: true, bezel: 0.026 * (215.5 / 281.6) };
  }
  return { W: BODY_W, R: BODY_R, MM, island: true, tablet: false, bezel: 0.034 };
}

export const DEFAULT_BODY_COLOR = "#2b2b30"; // koyu titanyum
// ?v= sürümü artık MODEL BAŞINA engine/modelRegistry.ts'te (meta.json ile
// override edilebilir) — GLB yeniden bake edilince o modelin version'ı artar.
// Varsayılan gerçek model: polyman "iPhone 15 Pro Max" (CC-BY, tam PBR texture,
// gerçek bezel + üçlü kamera) — bkz. public/assets/models/MODELS.md
export const DEFAULT_GLB = `/assets/models/${DEFAULT_MODEL_FILE}`;

// GLB derinlik inceltme çarpanı — gerçek model dik açılarda tuğla gibi kalın
// durduğu için ekran-normal ekseninde bu oranla ezilir.
// İnceltme artık BAKE'te (scripts/prep-iphone17.mjs, SLIM=0.85) — runtime'da
// ikinci kez inceltme YOK, yoksa ekran-plane/gölge hesapları kayar.
const GLB_SLIM = 1.0;

// ---------------------------------------------------------------------------
// Kamera presetleri
// ---------------------------------------------------------------------------
// Orbit sözleşmesi:
//   theta    — yatay açı (rad). 0 = tam karşıdan, + = kamera sağa kayar.
//   phi      — dikey açı (rad). + = kamera yukarıdan bakar.
//   distance — kamera mesafesi (model birimi). Perspektif karakterini belirler;
//              kadraj fov ile oturtulduğu için boyutu DEĞİŞTİRMEZ.
//   targetY  — bakış hedefinin dikey ofseti (model birimi).

export type Instance = {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Kendi ekseninde roll (rad). Layout kutusunun `rotation` alanı buraya iner;
   *  işaret canvas ile aynı olsun diye çağıran NEGATİFLER (canvas'ta + = saat
   *  yönü, three'de + = ters). Presetlerde yok → eski kareler bit-bit aynı. */
  rz?: number;
  /** Bu kopyanın ölçek çarpanı (vars. 1). Layout kutuları farklı boyda telefon
   *  isteyebilir; gölge katmanı da bu çarpanla ölçeklenir. */
  s?: number;
};

/** Ekran düzlemi ve cam şeridi klonda ADLA bulunur — kopya başına farklı
 *  screenshot bağlayabilmek için (aynı karede FARKLI ekranlar). */
export const SCREEN_MESH_NAME = "__vitrinScreen";
export const SHEEN_MESH_NAME = "__vitrinSheen";

/** Ekran düzleminin FİT ÖNCESİ UV'leri + dörtgen oranı + o an bağlı
 *  görselin oranı. Geometri klonlar arasında paylaşıldığı için anahtar odur;
 *  userData kullanılamaz (bkz. prepareGlb'deki not). */
const SCREEN_UV = new WeakMap<
  THREE.BufferGeometry,
  { rect: number; rawUv: Float32Array; imgAspect: number; fit: "cover" | "contain" }
>();

export type Preset = {
  orbit: Orbit;
  roll: number; // cihaz grubunun z ekseni eğimi (rad)
  fit: number; // box.h çarpanı — cihazın ekran-uzayı yüksekliği
  instances: Instance[];
};

const SOLO: Instance[] = [{ x: 0, y: 0, z: 0, ry: 0 }];

export const PRESETS: Record<CameraPresetId, Preset> = {
  front: {
    orbit: { theta: 0, phi: 0.035, distance: 13, targetY: 0 },
    roll: 0,
    fit: 1,
    instances: SOLO,
  },
  "hero-left": {
    orbit: { theta: -0.209, phi: 0.06, distance: 8.5, targetY: 0 },
    roll: 0.055,
    fit: 1,
    instances: SOLO,
  },
  "hero-right": {
    orbit: { theta: 0.209, phi: 0.06, distance: 8.5, targetY: 0 },
    roll: -0.055,
    fit: 1,
    instances: SOLO,
  },
  iso: {
    orbit: { theta: 0.524, phi: 0.524, distance: 8.5, targetY: 0 },
    roll: 0,
    fit: 1,
    instances: SOLO,
  },
  laydown: {
    orbit: { theta: 0.12, phi: 1.134, distance: 9, targetY: 0 },
    roll: 0,
    fit: 1,
    instances: SOLO,
  },
  pair: {
    orbit: { theta: 0.42, phi: 0.09, distance: 10.5, targetY: 0 },
    roll: 0,
    fit: 1,
    instances: [
      { x: -0.64, y: 0.06, z: 0.22, ry: 0 },
      { x: 0.64, y: -0.06, z: -0.22, ry: 0 },
    ],
  },
  fan3: {
    orbit: { theta: 0, phi: 0.075, distance: 12, targetY: 0 },
    roll: 0,
    fit: 1,
    instances: [
      { x: -1.02, y: 0.03, z: -0.5, ry: 0.36 },
      { x: 0, y: -0.05, z: 0.14, ry: 0 },
      { x: 1.02, y: 0.03, z: -0.5, ry: -0.36 },
    ],
  },
  // R8: derinlik kademeli üçlü — ön telefon keskin, arkadakiler DoF ile erir.
  stack3: {
    orbit: { theta: 0.36, phi: 0.06, distance: 7.4, targetY: 0 },
    roll: -0.02,
    fit: 1,
    instances: [
      { x: 0.1, y: 0.06, z: 1.35, ry: 0.1 },
      { x: 0.48, y: 0, z: -0.05, ry: 0 },
      { x: 0.86, y: -0.07, z: -1.45, ry: -0.1 },
    ],
  },
  // R8: sinematik dutch açı — belirgin roll, hafif yandan.
  dutch: {
    orbit: { theta: 0.26, phi: 0.085, distance: 7.8, targetY: 0 },
    roll: 0.14,
    fit: 1,
    instances: SOLO,
  },
  // R8: alttan kahraman — kamera aşağıdan yukarı bakar.
  "low-hero": {
    orbit: { theta: 0.16, phi: -0.26, distance: 7.4, targetY: 0.12 },
    roll: -0.03,
    fit: 1,
    instances: SOLO,
  },
  "close-top": {
    orbit: { theta: -0.1, phi: 0.045, distance: 7.5, targetY: 0.5 },
    roll: 0.02,
    fit: 2,
    instances: SOLO,
  },
  "close-bottom": {
    orbit: { theta: -0.1, phi: -0.03, distance: 7.5, targetY: -0.5 },
    roll: 0.02,
    fit: 2,
    instances: SOLO,
  },
  // R12 — POZ İYİLEŞTİRMELERİ. Üç yeni poz, üçü de "ürün fotoğrafı" dilinde:
  // hero-left/right'ın masaüstü tanıtım hissinden farklı, daha fiziksel.
  //
  // lean-back: kamera hafif ALTTAN (phi -0.09), telefon 17° yana dönük ve
  //   0.04 rad roll. Sanki masaya yaslanmış; alt kenar ve yan ray görünür,
  //   ekran hâlâ %85 okunur. Mesafe 8.0: perspektif belli ama bozmaz.
  "lean-back": {
    orbit: { theta: 0.3, phi: -0.09, distance: 8.0, targetY: 0.05 },
    roll: 0.04,
    // fit 1'de alttan bakış cihazı kadrajın altından taşırıyordu (ölçüldü:
    // gece-altın çerçevesi 2812'de biter, telefon 2868'e iniyordu). 0.93.
    fit: 0.93,
    instances: SOLO,
  },
  // three-quarter: 3/4 profil — theta 0.62 (≈36°) gövde yanını ve kamera
  //   adasının derinliğini okutur; phi 0.14 üstten bakış ekranı kısaltmaz.
  //   iso'dan farkı: iso 30/30 ile "teknik çizim" hissi verir, bu poz
  //   yatayda daha dönük, dikeyde daha az — ürün fotoğrafı.
  "three-quarter": {
    orbit: { theta: 0.62, phi: 0.14, distance: 8.2, targetY: 0 },
    roll: -0.02,
    fit: 1,
    instances: SOLO,
  },
  // top-down: laydown (phi 1.13) fazla yatıktı, ekran ezilip okunmaz
  //   oluyordu. 0.78 rad (≈45°) ile ekran hâlâ dik durur, ama kadraj
  //   "yukarıdan diyagonal" bir editoryal açı kazanır. roll 0.09 yönü kırar.
  "top-down": {
    // Mesafe 8.6→9.6: üstten bakışta perspektif üst kenarı şişiriyordu.
    // targetY -0.12: eğik telefon kadrajda aşağı sarkıyordu, başlıkla arası
    // boş kalıyordu; hedefi aşağı alınca cihaz yukarı çıkar.
    orbit: { theta: -0.18, phi: 0.78, distance: 9.6, targetY: -0.12 },
    roll: 0.09,
    // fitFov projeksiyon YÜKSEKLİĞİNE göre çözer; 45° eğik cihazın izdüşümü
    // kısa olduğu için fit 1 kadraja sığmayan dev bir telefon veriyordu. 0.8.
    fit: 0.8,
    instances: SOLO,
  },
  custom: {
    orbit: { theta: 0.28, phi: 0.1, distance: 9, targetY: 0 },
    roll: 0.03,
    fit: 1,
    instances: SOLO,
  },
};

export function presetOf(camera: CameraPresetId): Preset {
  return PRESETS[camera] ?? PRESETS.front;
}

/** style.orbit'i preset üzerine uygular — camera "custom" olmasa bile öncelik orbit'te. */
export function resolveOrbit(style: DeviceStyle3D, preset: Preset): Orbit {
  const o = style.orbit;
  return o
    ? {
        theta: o.theta,
        phi: o.phi,
        distance: o.distance > 0 ? o.distance : preset.orbit.distance,
        targetY: o.targetY ?? preset.orbit.targetY ?? 0,
      }
    : { ...preset.orbit };
}

// ---------------------------------------------------------------------------
// Kaynak takibi — render başına oluşturulan her şey bin'e girer, sonda dispose.
// GLB önbelleğine ait geometri/materyaller bin'e GİRMEZ (paylaşımlıdır).
// ---------------------------------------------------------------------------

export type Bin = { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; texs: THREE.Texture[] };

export function newBin(): Bin {
  return { geos: [], mats: [], texs: [] };
}

export function disposeBin(bin: Bin): void {
  for (const g of bin.geos) g.dispose();
  for (const m of bin.mats) m.dispose();
  for (const t of bin.texs) t.dispose();
  bin.geos.length = 0;
  bin.mats.length = 0;
  bin.texs.length = 0;
}

// ---------------------------------------------------------------------------
// Paylaşılan CPU-taraflı dokular (canvas tabanlı — renderer'lar arası paylaşılabilir)
// ---------------------------------------------------------------------------

let _sheenTex: THREE.Texture | null = null;

// --- Katmanlı yumuşak gölge -------------------------------------------------
// Tek radyal blob yerine ÜÇ katman: geniş ortam halesi + gövde + sıkı temas
// çekirdeği. Her katman gerçek gauss bulanıklığı geçirilmiş YUVARLAK DİKDÖRTGEN
// (telefon ayak izi) — radyal lekeye göre çok daha "yere basmış" durur.
//
// Neden gerçek shadow-map / AccumulativeShadows değil: bu render şeffaf bir
// KATMAN üretir, altındaki 2D arka planla birleştirilir; sahnede fiziksel zemin
// yok ve kameraların çoğu (front/hero, phi ≈ 0.03–0.06 rad) zemine neredeyse
// teğet bakar — yatay bir gölge düzlemi o açılarda 1-2 piksele iner. Mevcut
// "yatay↔billboard karışımı" düzlem bu yüzden korunuyor; katmanlı bulanıklık
// aynı kadraj davranışını bozmadan yumuşaklığı gerçekten artırıyor. Ayrıca
// tamamen deterministik (rastgele örnekleme yok).

export type ShadowLayerId = "halo" | "body" | "contact";

/** [rect genişlik oranı, rect yükseklik oranı, köşe oranı, blur px] */
const SHADOW_LAYERS: Record<ShadowLayerId, [number, number, number, number]> = {
  halo: [0.4, 0.28, 0.5, 78],
  body: [0.5, 0.34, 0.42, 32],
  contact: [0.58, 0.17, 0.5, 9],
};

const _shadowTex = new Map<ShadowLayerId, THREE.Texture | null>();

/** Bulanıklaştırılmış yuvarlak dikdörtgen alfa maskesi (katman başına). */
export function getShadowTexture(layer: ShadowLayerId = "body"): THREE.Texture | null {
  const hit = _shadowTex.get(layer);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const [rw, rh, rr, blur] = SHADOW_LAYERS[layer];
  const w = S * rw;
  const h = S * rh;
  const r = Math.min(w, h) * rr;
  ctx.clearRect(0, 0, S, S);
  // İki geçişli bulanıklık — tek geçişte kalan sert çekirdek kırılır.
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(S / 2 - w / 2, S / 2 - h / 2, w, h, r);
  ctx.fill();
  ctx.filter = `blur(${Math.max(2, blur * 0.45)}px)`;
  ctx.drawImage(c, 0, 0);
  ctx.filter = "none";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  _shadowTex.set(layer, tex);
  return tex;
}

/** Cam üzerindeki ince diyagonal yansıma şeridi (prosedürel model). */
function getSheenTexture(): THREE.Texture | null {
  if (_sheenTex) return _sheenTex;
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, S, S * 1.15, -S * 0.15);
  g.addColorStop(0.0, "rgba(255,255,255,0)");
  g.addColorStop(0.52, "rgba(255,255,255,0)");
  g.addColorStop(0.66, "rgba(255,255,255,0.30)");
  g.addColorStop(0.74, "rgba(255,255,255,0.5)");
  g.addColorStop(0.82, "rgba(255,255,255,0.16)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sheenTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Ortam / ışık
// ---------------------------------------------------------------------------

// --- R8/D1: PROSEDÜREL STÜDYO ORTAMI (RoomEnvironment yerine) --------------
// RoomEnvironment bir "oda"dır: metal rayda biçimsiz, bulanık dikdörtgen
// lekeler bırakır. Burada gerçek bir çekim seti kuruluyor — dikey gradyan
// kubbe + iki DİKEY strip softbox + arka rim kartı + tepe kutusu + kısık yer
// sıçraması. Dikey stripler telefonun dikey kenar raylarında uzun, KASITLI
// parlama çizgileri üretir; Blender render'larındaki "çizilmiş kenar" hissi
// tam olarak budur. 0 KB asset, deterministik, tintedEnv önbelleği aynen
// çalışır (aşağıdaki tint parametresi doğrudan materyal renklerine biner).

/** Kubbenin dikey gradyanı — HDR (lineer) 1×N yarı-kayan veri dokusu. */
function domeGradient(tint: [number, number, number]): THREE.DataTexture {
  const N = 128;
  // [v (0 = nadir, 1 = zenit), r, g, b] durakları — lineer radyans.
  const stops: Array<[number, number, number, number]> = [
    [0.0, 0.05, 0.05, 0.052],
    [0.33, 0.105, 0.106, 0.112],
    [0.46, 0.235, 0.239, 0.249],
    [0.53, 0.63, 0.636, 0.657],
    [0.74, 1.18, 1.186, 1.213],
    [1.0, 1.62, 1.63, 1.66],
  ];
  const data = new Uint16Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = i / (N - 1);
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [v0, r0, g0, b0] = stops[k];
    const [v1, r1, g1, b1] = stops[k + 1];
    const t = v1 > v0 ? THREE.MathUtils.clamp((v - v0) / (v1 - v0), 0, 1) : 0;
    const e = t * t * (3 - 2 * t); // smoothstep — bantlaşma olmasın
    const px = [
      (r0 + (r1 - r0) * e) * tint[0],
      (g0 + (g1 - g0) * e) * tint[1],
      (b0 + (b1 - b0) * e) * tint[2],
      1,
    ];
    for (let c = 0; c < 4; c++) data[i * 4 + c] = THREE.DataUtils.toHalfFloat(px[c]);
  }
  const tex = new THREE.DataTexture(data, 1, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace; // ham lineer radyans
  tex.needsUpdate = true;
  return tex;
}

/** Işık kartı: [genişlik, yükseklik, x, y, z, yoğunluk, (r,g,b) tonu] */
const ENV_CARDS: Array<[number, number, number, number, number, number, number, number, number]> = [
  // ANA STRIP — sol ön, dar ve parlak: sol kenar rayındaki uzun beyaz çizgi.
  [1.05, 15, -8.5, 3.6, 6.6, 10.5, 1, 1, 1.02],
  // İkinci ince strip — sağ ön, daha kısık: karşı rayda ince tanım çizgisi.
  [0.75, 12, 7.6, 2.6, 4.6, 4.6, 0.99, 1, 1.05],
  // Yumuşak dolgu kartı — sağ ön, geniş ve kısık: gövdeyi karanlıktan çıkarır.
  [7.5, 12, 9.5, 1.4, 6.5, 1.15, 1, 1, 1],
  // Arka rim kartı — üst/arka kenarda ayırıcı parlaklık.
  [11, 5, -1.6, 6.2, -9.5, 1.9, 0.98, 0.99, 1.03],
  // Tepe softbox — büyük, yumuşak, aşağı bakar.
  [17, 17, 0, 13, 1, 1.5, 1, 1, 1],
  // Yer sıçraması — çok kısık, alttan dolgu.
  [15, 15, 0, -11, 2, 0.12, 1, 0.99, 0.97],
];

/** PMREM için stüdyo sahnesi + kaynaklarını toplayan dispose. */
function buildEnvScene(tint: [number, number, number]): {
  scene: THREE.Scene;
  dispose(): void;
} {
  const scene = new THREE.Scene();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];

  const domeTex = domeGradient(tint);
  const domeGeo = new THREE.SphereGeometry(60, 32, 48);
  const domeMat = new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide });
  scene.add(new THREE.Mesh(domeGeo, domeMat));
  geos.push(domeGeo);
  mats.push(domeMat);
  texs.push(domeTex);

  for (const [w, h, x, y, z, i, r, g, b] of ENV_CARDS) {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(r * i * tint[0], g * i * tint[1], b * i * tint[2]),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    geos.push(geo);
    mats.push(mat);
  }

  return {
    scene,
    dispose(): void {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

/** Ortamın genel parlaklık ölçeği — RoomEnvironment tabanına kalibre. */
const ENV_GAIN = 1;

/** PMREM üretimi — buildEnvScene → önceden filtrelenmiş ortam haritası. */
function envFromScene(
  renderer: THREE.WebGLRenderer,
  tint: [number, number, number]
): THREE.Texture | null {
  try {
    const env = buildEnvScene([tint[0] * ENV_GAIN, tint[1] * ENV_GAIN, tint[2] * ENV_GAIN]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(env.scene, 0.02);
    env.dispose();
    pmrem.dispose();
    return rt.texture;
  } catch {
    return null;
  }
}

/**
 * Nötr stüdyo PMREM'i. Render target'a bağlı olduğu için her renderer (GL
 * context) kendi kopyasını üretmelidir — tüketici cache'ler.
 */
export function makeEnvTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  return envFromScene(renderer, [1, 1, 1]);
}

// --- Işık rigleri -----------------------------------------------------------
// Veri güdümlü: her rig ambient + yönlü ışık listesi + env/exposure/gölge
// katsayılarından ibaret. "studio"/"softbox"/"night" ESKİ env değerlerinin
// birebir kopyasıdır — lightRig yazmayan kayıtlı projeler aynı basılır.

type LightDef = {
  color: number;
  intensity: number;
  pos: [number, number, number];
  /** Sıcaklık kaydırmasından muaf (nötr kalması gereken neon rimler). */
  fixedColor?: boolean;
};

export type RigDef = {
  envIntensity: number;
  exposure: number;
  ambient: { color: number; intensity: number };
  lights: LightDef[];
  /** Contact shadow taban opaklığı. */
  shadowOpacity: number;
  /** Gölge yayılma çarpanı — 1 = taban (sert-ish), >1 = daha dağınık. */
  shadowSpread: number;
  /** Zemin yansıması gücü çarpanı. */
  reflection: number;
  /** Varsayılan bloom gücü (0 = kapalı). */
  bloom: number;
  /** Varsayılan anamorfik streak gücü (0 = kapalı). */
  streak: number;
  /** Ortam haritası tonu (RGB çarpanı). [1,1,1] = nötr (PMREM yeniden üretilmez). */
  envTint: [number, number, number];
  /** Cam üzerindeki yansıma şeridi payı — 1 = taban. */
  sheen: number;
};

export const LIGHT_RIGS: Record<LightRigId, RigDef> = {
  // Dengeli nötr key / fill / rim — ESKİ "studio" env'i (bire bir).
  studio: {
    envIntensity: 1,
    exposure: 1,
    ambient: { color: 0xffffff, intensity: 0.3 },
    lights: [
      { color: 0xffffff, intensity: 3, pos: [2.5, 3.5, 4] },
      { color: 0xdde6f5, intensity: 1, pos: [-3, 1, 2.5] },
      { color: 0xffffff, intensity: 1.6, pos: [-1.5, 2, -3] },
    ],
    shadowOpacity: 0.42,
    shadowSpread: 1,
    reflection: 1,
    bloom: 0,
    streak: 0,
    envTint: [1, 1, 1],
    sheen: 1,
  },
  // Büyük yumuşak kutu — düşük kontrast, gölge geniş ve açık. ESKİ "soft".
  softbox: {
    envIntensity: 0.75,
    exposure: 1.05,
    ambient: { color: 0xffffff, intensity: 1.15 },
    lights: [{ color: 0xffffff, intensity: 1.4, pos: [-1.2, 2.4, 3.4] }],
    shadowOpacity: 0.3,
    shadowSpread: 1.3,
    reflection: 0.9,
    bloom: 0,
    streak: 0,
    envTint: [1, 1, 1],
    sheen: 0.7,
  },
  // Kontur ışığı — koyu zeminde premium siluet: arkadan iki güçlü rim,
  // önden yalnızca okunurluk için kısık dolgu.
  rim: {
    envIntensity: 0.34,
    exposure: 1.06,
    ambient: { color: 0x0e1014, intensity: 0.55 },
    lights: [
      { color: 0xf4f7ff, intensity: 5.2, pos: [-2.6, 1.9, -2.6] },
      { color: 0xdfe8ff, intensity: 3.2, pos: [2.9, 1.05, -2.4] },
      { color: 0xffffff, intensity: 0.62, pos: [1.2, 1.6, 3.6] },
      { color: 0xc8d4ee, intensity: 0.5, pos: [0, -1.8, 2.2] },
    ],
    shadowOpacity: 0.5,
    shadowSpread: 0.85,
    reflection: 1.2,
    bloom: 0,
    streak: 0.3,
    envTint: [0.78, 0.85, 1.02],
    sheen: 1.5,
  },
  // Gece / neon — ESKİ "night" env'i (bire bir) + bloom varsayılan açık.
  night: {
    envIntensity: 0.22,
    exposure: 1.12,
    ambient: { color: 0x131722, intensity: 0.35 },
    lights: [
      { color: 0x4d7cff, intensity: 4.6, pos: [-3.2, 1.4, -2.2], fixedColor: true },
      { color: 0xff3d7f, intensity: 3.8, pos: [3.4, 0.7, -2.1], fixedColor: true },
      { color: 0x9fb4ff, intensity: 0.55, pos: [0.4, 1.6, 4.2] },
    ],
    shadowOpacity: 0.55,
    shadowSpread: 0.9,
    reflection: 1.25,
    bloom: 0.55,
    streak: 0.42,
    envTint: [1, 1, 1],
    sheen: 1.6,
  },
  // Gün ışığı — parlak, havadar, gölge açık ve geniş.
  daylight: {
    envIntensity: 1.35,
    exposure: 1.04,
    ambient: { color: 0xf6f9ff, intensity: 0.85 },
    lights: [
      { color: 0xfff4e4, intensity: 2.4, pos: [-1.8, 3.4, 2.6] },
      { color: 0xe8f1ff, intensity: 1.15, pos: [2.6, 1.2, 2.4] },
      { color: 0xffffff, intensity: 1, pos: [0.6, 2.2, -3.2] },
    ],
    shadowOpacity: 0.24,
    shadowSpread: 1.45,
    reflection: 0.8,
    bloom: 0,
    streak: 0,
    envTint: [1.1, 1.04, 0.94],
    sheen: 0.85,
  },
};

/** lightRig yoksa eski env alanından türet — kayıtlı projeler bozulmasın. */
export function rigIdOf(style: DeviceStyle3D): LightRigId {
  if (style.lightRig && LIGHT_RIGS[style.lightRig]) return style.lightRig;
  if (style.env === "soft") return "softbox";
  if (style.env === "night") return "night";
  return "studio";
}

/** setupEnv çıktısı — sahne montajı ve render bunlara göre ayarlanır. */
export type RigResult = {
  id: LightRigId;
  shadowOpacity: number;
  shadowSpread: number;
  reflection: number;
  bloom: number;
  /** Anamorfik streak gücü (0 = kapalı). */
  streak: number;
  /** Baskın ışığın yatay azimutu (rad) — gölgeyi ışıktan kaçırmak için. */
  keyAzimuth: number;
};

// --- Tonlanmış ortam haritaları ---------------------------------------------
// Telefon KOYU METAL + SİYAH CAM: yönlü ışıkların difüz katkısı neredeyse sıfır,
// nesneyi asıl aydınlatan ORTAM HARİTASI. Bu yüzden "sıcaklık" ve rig tonu
// gerçekten hissedilsin diye stüdyo sahnesinin renkleri çarpılıp PMREM
// yeniden üretiliyor. Nötr ton ([1,1,1]) istendiğinde TABAN doku aynen döner →
// nötr rigler tek PMREM ile çalışır. Önbellek: renderer başına LRU 10.

type EnvCache = { base: THREE.Texture | null; tinted: Map<string, THREE.Texture> };
const _envCache = new WeakMap<THREE.WebGLRenderer, EnvCache>();
const ENV_CACHE_MAX = 10;

function tintedEnv(
  renderer: THREE.WebGLRenderer,
  base: THREE.Texture | null,
  r: number,
  g: number,
  b: number
): THREE.Texture | null {
  // 0.04 adımına yuvarla — sıcaklık slider'ı sürüklenirken sonsuz PMREM
  // üretilmesin (her PMREM ~1-2MB GPU belleği).
  const q = (v: number): number => Math.round(v * 25) / 25;
  const [qr, qg, qb] = [q(r), q(g), q(b)];
  if (qr === 1 && qg === 1 && qb === 1) return base;
  let c = _envCache.get(renderer);
  if (!c) {
    c = { base, tinted: new Map() };
    _envCache.set(renderer, c);
  }
  const key = `${qr},${qg},${qb}`;
  const hit = c.tinted.get(key);
  if (hit) return hit;
  // Sınırlı önbellek: en eski girdi atılır (Map ekleme sırasını korur).
  while (c.tinted.size >= ENV_CACHE_MAX) {
    const oldest = c.tinted.keys().next().value;
    if (oldest === undefined) break;
    c.tinted.get(oldest)?.dispose();
    c.tinted.delete(oldest);
  }
  const tex = envFromScene(renderer, [qr, qg, qb]);
  if (!tex) return base;
  c.tinted.set(key, tex);
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Renk sıcaklığı kaydırma — parlaklığı koruyarak sıcak/soğuk. */
function shiftWarmth(hex: number, w: number): THREE.Color {
  const c = new THREE.Color(hex);
  if (w === 0) return c;
  const k = THREE.MathUtils.clamp(w, -1, 1);
  const before = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.r *= 1 + 0.3 * k;
  c.g *= 1 - 0.05 * Math.abs(k);
  c.b *= 1 - 0.3 * k;
  const after = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  if (after > 1e-4) c.multiplyScalar(before / after);
  return c;
}

/**
 * Işık rigini sahneye kurar; exposure'ı renderer'a yazar. Dönen RigResult
 * gölge/yansıma/bloom katsayılarını taşır.
 */
export function setupEnv(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  envTex: THREE.Texture | null,
  style: DeviceStyle3D
): RigResult {
  const id = rigIdOf(style);
  const rig = LIGHT_RIGS[id];
  scene.background = null;

  const gain = THREE.MathUtils.clamp(style.lightIntensity ?? 1, 0.35, 2.5);
  const warmth = THREE.MathUtils.clamp(style.lightWarmth ?? 0, -1, 1);
  const yaw = THREE.MathUtils.degToRad(style.lightAngle ?? 0);

  // Ortam tonu = rig tonu × kullanıcı sıcaklığı. Nötrde taban doku aynen kalır.
  const wr = 1 + 0.26 * warmth;
  const wb = 1 - 0.26 * warmth;
  const wg = 1 - 0.045 * Math.abs(warmth);
  scene.environment = tintedEnv(
    renderer,
    envTex,
    rig.envTint[0] * wr,
    rig.envTint[1] * wg,
    rig.envTint[2] * wb
  );
  // lightAngle ortamı da döndürür — metal gövdedeki specular'ı asıl bu taşır.
  // (Canlı yolda sahne yeniden kullanılıyor; yaw 0 olsa da HER ZAMAN yazılır.)
  scene.environmentRotation = new THREE.Euler(0, yaw, 0);

  // Env, şiddetin 0.8 kuvvetiyle ölçeklenir; exposure ise çok az —
  // 2x'te sahne yıkanmadan gerçekten parlar, 0.5x'te gerçekten koyulur.
  scene.environmentIntensity = rig.envIntensity * Math.pow(gain, 0.8);
  renderer.toneMappingExposure = rig.exposure * (1 + (gain - 1) * 0.16);

  const amb = new THREE.AmbientLight(rig.ambient.color, rig.ambient.intensity * gain);
  scene.add(amb);

  const dom = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const l of rig.lights) {
    const color = l.fixedColor ? new THREE.Color(l.color) : shiftWarmth(l.color, warmth);
    const light = new THREE.DirectionalLight(color, l.intensity * gain);
    p.set(l.pos[0], l.pos[1], l.pos[2]);
    if (yaw !== 0) p.applyAxisAngle(UP, yaw);
    light.position.copy(p);
    scene.add(light);
    dom.addScaledVector(p.clone().normalize(), l.intensity);
  }

  return {
    id,
    shadowOpacity: rig.shadowOpacity,
    shadowSpread: rig.shadowSpread,
    reflection: rig.reflection,
    // R9 — PARLAMA AÇIK TERCİH. Eskiden night/rim rigleri kendiliğinden bloom
    // ve streak basıyordu: ekrandaki parlak UI'nin çevresinde hale oluşuyor,
    // kullanıcı kapatacak yer bulamıyordu. Artık yalnız açıkça istenirse.
    bloom: style.bloom === true ? Math.max(rig.bloom, 0.5) : 0,
    streak: style.streak === true ? Math.max(rig.streak, 0.35) : 0,
    keyAzimuth: dom.lengthSq() > 1e-6 ? Math.atan2(dom.x, dom.z) : 0,
  };
}

// ---------------------------------------------------------------------------
// Geometri yardımcıları
// ---------------------------------------------------------------------------

/** Yuvarlak köşeli dikdörtgen Shape'i (merkez orijinde).
 *  v2: köşeler GERÇEK daire yayı (absarc). Eski quadraticCurveTo yaklaşımı
 *  köşeyi içeri kaçırıyor, ince metal bantta bariz kalınlık oynaması yapıyordu. */
function roundedShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const HALF = Math.PI / 2;
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -HALF, 0, false);
  s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, HALF, false);
  s.lineTo(x + rr, y + h);
  s.absarc(x + rr, y + h - rr, rr, HALF, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, HALF * 3, false);
  return s;
}

/** Shape'ten düzlem — ShapeGeometry ham x,y'yi UV yazdığı için 0..1'e normalliyoruz. */
function roundedPlane(w: number, h: number, r: number, seg = 18): THREE.ShapeGeometry {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), seg);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Screenshot UV'lerini ekran oranına uyarlar.
 *
 * Telefonlarda tarihsel `cover` davranışı korunur. Tabletlerde `contain`,
 * native ekran görüntüsünün üst/alt araç çubukları dahil tamamını gösterir.
 * Contain'in ekran dışında kalan UV'leri texture'ın ClampToEdge ayarıyla en
 * yakın kaynak pikseline uzar; böylece UI esnemez ve siyah letterbox oluşmaz.
 */
function fitScreenUV(
  g: THREE.BufferGeometry,
  rectAspect: number,
  imgAspect: number,
  fit: "cover" | "contain"
): void {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | null;
  if (!uv || !isFinite(imgAspect) || imgAspect <= 0) return;
  let su = 1;
  let sv = 1;
  if (fit === "contain") {
    if (imgAspect > rectAspect) sv = imgAspect / rectAspect;
    else su = rectAspect / imgAspect;
  } else if (imgAspect > rectAspect) su = rectAspect / imgAspect;
  else sv = imgAspect / rectAspect;
  const ou = (1 - su) / 2;
  const ov = (1 - sv) / 2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, ou + uv.getX(i) * su, ov + uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Screenshot texture
// ---------------------------------------------------------------------------

export function screenTexture(
  renderer: THREE.WebGLRenderer,
  img: HTMLImageElement | null
): THREE.Texture | null {
  if (!img) return null;
  // Cap GPU uploads independently of export canvas resolution. A 6K source
  // does not need a 6K texture for a device occupying a fraction of the frame.
  const edge = Math.min(3072, renderer.capabilities.maxTextureSize);
  let source: HTMLImageElement | HTMLCanvasElement = img;
  if (Math.max(img.naturalWidth,img.naturalHeight)>edge) {
    const c=document.createElement("canvas"), k=edge/Math.max(img.naturalWidth,img.naturalHeight);
    c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);
    const ctx=c.getContext("2d");if(ctx){ctx.drawImage(img,0,0,c.width,c.height);source=c;}
  }
  const tex = new THREE.Texture(source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Prosedürel "kontur" cihaz — VARSAYILAN model. Butonsuz, kamera çıkıntısız
// tek parça saf silüet: premium, temiz, contentcore hissi.
// ---------------------------------------------------------------------------

/** Tek bir kontur telefon (merkez orijinde, ekran +Z'ye bakar). */
export function buildPhone(
  style: DeviceStyle3D,
  screenTex: THREE.Texture | null,
  bin: Bin
): THREE.Group {
  const phone = new THREE.Group();

  let bodyColor: THREE.Color;
  try {
    bodyColor = new THREE.Color(style.bodyColor || DEFAULT_BODY_COLOR);
  } catch {
    bodyColor = new THREE.Color(DEFAULT_BODY_COLOR);
  }

  // Cihaz türü: telefon/tablet gövde ölçüleri (en, köşe, mm) buradan.
  const dims = bodyDimsOf(style.kind);
  const BODY_W = dims.W;
  const BODY_R = dims.R;
  const MM = dims.MM;

  // Kontur kalınlığı — bezel payı VE metal bandı BİRLİKTE ölçekler.
  // Alt sınır 0.55 → 0.15: kılcal çerçeve ("2D gibi") mümkün olsun.
  const kw = THREE.MathUtils.clamp(style.konturWidth ?? 1, 0.15, 1.7);
  // Gövde derinliği çarpanı — 0'a yaklaştıkça kart gibi yassı.
  const kd = THREE.MathUtils.clamp(style.konturDepth ?? 1, 0.05, 1.6);
  // iPad çok daha ince: 5.1 mm / 281.6 mm ≈ %1.8 (telefon %4.8) → 0.42×.
  const bodyD = BODY_D * kd * (bodyDimsOf(style.kind).tablet ? 0.42 : 1);
  const clay = style.finish === "clay";

  // --- Gövde: tek parça, sürekli yuvarlak silüet. RoundedBox'ı derin üretip
  // z'de eziyoruz — plan köşesi BODY_R kalır, kenar rayı yumuşak elipse döner.
  // Segment 12 → 16: köşe ve kenar rayında faset izi kalmasın.
  const D0 = 1;
  const bodyGeo = new RoundedBoxGeometry(BODY_W, BODY_H, D0, 16, BODY_R);
  bodyGeo.scale(1, 1, bodyD / D0);
  const bodyMat = clay
    ? // Düz renk (clay) kaplama — mat, tek renk, yansımasız modern mockup.
      new THREE.MeshStandardMaterial({
        color: bodyColor,
        metalness: 0,
        roughness: 0.92,
        envMapIntensity: 0.25,
      })
    : new THREE.MeshPhysicalMaterial({
        color: bodyColor,
        metalness: 0.85,
        roughness: 0.3,
        clearcoat: 0.3,
        clearcoatRoughness: 0.3,
        envMapIntensity: 1,
      });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  phone.add(body);
  bin.geos.push(bodyGeo);
  bin.mats.push(bodyMat);

  // --- Ön cam: dış hattan ray payı kadar içeride, gövdeye GÖMÜLÜ ince siyah
  // plaka. Kesişen katı olduğu için hiçbir açıda cam-gövde dikişinde
  // çizgi/boşluk oluşmaz; çevredeki metal şerit "kenar rayı" hissini verir.
  // v2: pay 1mm → 0.8mm (kw ile ölçekli) — daha ince, daha zarif ray.
  const inset = MM * 0.8 * kw;
  const glassW = BODY_W - inset * 2;
  const glassH = BODY_H - inset * 2;
  const glassR = BODY_R - inset;
  const glassD = MM * 2.4; // ~2.4mm cam; büyük kısmı gövdenin içinde
  const glassGeo = new RoundedBoxGeometry(glassW, glassH, D0, 12, glassR);
  glassGeo.scale(1, 1, glassD / D0);
  const glassMat = clay
    ? // Clay'de cam da mat ve gövdeyle aynı ailede — tek parça his.
      new THREE.MeshStandardMaterial({
        color: bodyColor.clone().multiplyScalar(0.8),
        metalness: 0,
        roughness: 0.85,
        envMapIntensity: 0.2,
      })
    : new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#08080b"),
        metalness: 0,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        reflectivity: 0.65,
        envMapIntensity: 1.2,
      });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  // Cam gövdeden 0.22mm taşar (v2: daha az); yassı gövdede taşma da kısılır
  // ki cam gövdeden kalın görünmesin.
  const glassFront = bodyD / 2 + MM * 0.22 * Math.min(1, kd);
  glass.position.z = glassFront - glassD / 2;
  phone.add(glass);
  bin.geos.push(glassGeo);
  bin.mats.push(glassMat);

  // --- Metal çerçeve ringi: cam-gövde birleşimindeki cilalı kenar.
  // v2: BANT İNCELDİ (1.4mm → 0.85mm) ve env yansıması 2.2 → 1.15'e çekildi —
  // eskiden üst bezelde kocaman beyaz bir leke oluşuyordu ("çirkin kontur").
  // Renk de ×1.7 yerine ×1.32: gövdeyle aynı aileden, sadece bir ton parlak.
  if (!clay) {
    const ringOuterW = BODY_W - MM * 0.34;
    const ringOuterH = BODY_H - MM * 0.34;
    const ringR = BODY_R - MM * 0.17;
    const ringBand = MM * 0.85 * kw;
    const shape = roundedShape(ringOuterW, ringOuterH, ringR);
    shape.holes.push(
      roundedShape(ringOuterW - ringBand * 2, ringOuterH - ringBand * 2, ringR - ringBand)
    );
    const ringGeo = new THREE.ShapeGeometry(shape, 64);
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: bodyColor.clone().multiplyScalar(1.28),
      metalness: 1,
      roughness: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = glassFront + 0.0002;
    phone.add(ring);
    bin.geos.push(ringGeo);
    bin.mats.push(ringMat);
  }

  // --- Ekran: camın önünde, bezelle içeride. Gerçek iPhone Pro Max bezeli
  // gövde genişliğinin ~%3.4'ü; kw bunu 0.6×–1.6× arasında oynatır.
  const sInset = glassW * dims.bezel * kw;
  const screenW = glassW - sInset * 2;
  const screenH = glassH - sInset * 2;
  const screenR = Math.max(0.02, glassR - sInset * 0.86);
  const screenGeo = roundedPlane(screenW, screenH, screenR, 32);
  const screenFit = isTabletKind(style.kind) ? "contain" : "cover";
  if (screenTex && screenTex.image) {
    const im = screenTex.image as { width?: number; height?: number };
    const iw = im.width || 0;
    const ih = im.height || 0;
    if (iw > 0 && ih > 0) fitScreenUV(screenGeo, screenW / screenH, iw / ih, screenFit);
  }
  // toneMapped: false → ACES tone mapping UI renklerini bozmasın.
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenTex,
    color: screenTex ? 0xffffff : 0x0c0c11,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  const zScreen = glassFront + MM * 0.3;
  screen.position.z = zScreen;
  phone.add(screen);
  bin.geos.push(screenGeo);
  bin.mats.push(screenMat);

  // --- Dynamic Island hapı. v2 ölçüleri gerçeğe yakın: 430pt ekranda 125×36pt
  // hap, üstten ~11pt boşluk → %29 × %8.4, üst pay %2.7. Kontur da inceldi.
  if (dims.island && style.island !== false) {
    const islW = screenW * 0.29;
    const islH = screenW * 0.084;
    const islY = screenH / 2 - screenW * 0.027 - islH / 2;
    const islEdge = MM * 0.32;
    const islOutGeo = roundedPlane(
      islW + islEdge * 2,
      islH + islEdge * 2,
      (islH + islEdge * 2) / 2,
      24
    );
    const islOutMat = new THREE.MeshBasicMaterial({ color: 0x24242b, toneMapped: false });
    const islandOut = new THREE.Mesh(islOutGeo, islOutMat);
    islandOut.position.set(0, islY, zScreen + 0.0006);
    phone.add(islandOut);
    bin.geos.push(islOutGeo);
    bin.mats.push(islOutMat);
    const islGeo = roundedPlane(islW, islH, islH / 2, 24);
    const islMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const island = new THREE.Mesh(islGeo, islMat);
    island.position.set(0, islY, zScreen + 0.001);
    phone.add(island);
    bin.geos.push(islGeo);
    bin.mats.push(islMat);
  }

  // --- Cam yansıması: çok hafif diyagonal şerit — 3D hissi, abartısız.
  // v2: taban 0.16 → 0.10 ve RİG'e bağlı (rim/gece'de biraz daha belirgin).
  // R9: `glare` (0–1) ile kapılı, VARSAYILAN KAPALI — ekranda parlama istemeyen
  // kullanıcı için. Açıldığında eski taban (0.1 × rig) 1.0'a denk gelir.
  const glare = style.glare ?? 0;
  const sheenTex = glare > 0.001 ? getSheenTexture() : null;
  if (sheenTex) {
    const sheenGeo = roundedPlane(glassW, glassH, glassR, 24);
    const sheenMat = new THREE.MeshBasicMaterial({
      map: sheenTex,
      transparent: true,
      opacity: 0.1 * LIGHT_RIGS[rigIdOf(style)].sheen * glare,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sheen = new THREE.Mesh(sheenGeo, sheenMat);
    sheen.position.z = zScreen + 0.0016;
    phone.add(sheen);
    bin.geos.push(sheenGeo);
    bin.mats.push(sheenMat);
  }

  // --- iPad ARKA KAMERA ADASI: sol üstte yuvarlatılmış kare, iki lens + flaş.
  // Yalnız tablette; 3/4 ve yaslanmış pozlarda gövdenin arkası göründüğünde
  // "düz bir levha" hissini kırar. Ölçüler iPad Pro M4: ada ≈ 25 mm kare,
  // sol/üst kenardan ≈ 8 mm içeride.
  if (dims.tablet) {
    const side = dims.MM * 25;
    const off = dims.MM * 8;
    const bx = -BODY_W / 2 + off + side / 2;
    const by = BODY_H / 2 - off - side / 2;
    const bz = -bodyD / 2;
    const padGeo = new RoundedBoxGeometry(side, side, dims.MM * 1.6, 8, side * 0.28);
    const padMat = new THREE.MeshStandardMaterial({
      color: bodyColor.clone().multiplyScalar(0.92),
      metalness: clay ? 0 : 0.6,
      roughness: clay ? 0.9 : 0.45,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(bx, by, bz - dims.MM * 0.8);
    phone.add(pad);
    bin.geos.push(padGeo);
    bin.mats.push(padMat);
    const lensGeo = new THREE.CylinderGeometry(side * 0.18, side * 0.18, dims.MM * 1.2, 24);
    lensGeo.rotateX(Math.PI / 2);
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0c12,
      metalness: 0.2,
      roughness: 0.25,
      clearcoat: 1,
    });
    for (const [lx, ly] of [
      [-side * 0.2, side * 0.2],
      [-side * 0.2, -side * 0.2],
    ] as const) {
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(bx + lx, by + ly, bz - dims.MM * 1.9);
      phone.add(lens);
    }
    bin.geos.push(lensGeo);
    bin.mats.push(lensMat);
  }

  return phone;
}

// ---------------------------------------------------------------------------
// GLB yolu — gerçek iPhone modeli + materyal iyileştirme + ekran-plane
// ---------------------------------------------------------------------------

let _glbCache: Map<string, Promise<THREE.Group | null>> | null = null;

// Kayıtlı projelerde silinmiş model adları kalabiliyor; ayrıca aynı dosyanın
// sorgulu/sorgusuz halleri _glbCache'te ayrı anahtar üretiyor. Tüm yerel model
// URL'leri tek kanonik forma çekilir. Sürüm (?v=) MODEL BAŞINA modelRegistry'den
// gelir — bir model rebake/sıkıştırılınca sadece onun version'ı artar.

/** Önbellek anahtarı: sürümsüz kanonik yol (sürüm sonradan meta.json'la değişebilir). */
export function canonicalGlbKey(url: string): string {
  const file = modelFileOf(url);
  return /^\/assets\/models\//.test(url) || /^[^/]+\.glb$/i.test(url)
    ? `/assets/models/${file}`
    : url;
}

/** Ağdan çekilecek nihai URL — alias çözülmüş + model sürümü eklenmiş. */
export function canonicalGlbUrl(url: string): string {
  const key = canonicalGlbKey(url);
  if (!key.startsWith("/assets/models/")) return url;
  return `${key}?v=${modelVersion(key)}`;
}

// --- İndirme ilerlemesi (Stage'deki "Model yükleniyor… %NN" çipi) -----------

export type GlbProgress = {
  /** Şu an devam eden (sessiz olmayan) yükleme sayısı. */
  active: number;
  /** 0..1 — birleşik ilerleme; total bilinmiyorsa kaba tahmin. */
  ratio: number;
  /** Son ilerleme bildiren dosya adı. */
  file: string | null;
};

const _glbSubs = new Set<(p: GlbProgress) => void>();
const _inflight = new Map<string, { loaded: number; total: number }>();
let _lastFile: string | null = null;

function glbProgressSnapshot(): GlbProgress {
  let loaded = 0;
  let total = 0;
  for (const v of _inflight.values()) {
    loaded += v.loaded;
    total += v.total > 0 ? v.total : Math.max(v.loaded, 1);
  }
  return {
    active: _inflight.size,
    ratio: total > 0 ? Math.min(1, loaded / total) : 0,
    file: _lastFile,
  };
}

function emitGlbProgress(): void {
  const snap = glbProgressSnapshot();
  for (const cb of _glbSubs) cb(snap);
}

/** Yükleme ilerlemesine abone ol; anında mevcut durumla bir kez çağrılır. */
export function subscribeGlbProgress(cb: (p: GlbProgress) => void): () => void {
  _glbSubs.add(cb);
  cb(glbProgressSnapshot());
  return () => _glbSubs.delete(cb);
}

export function getGlbProgress(): GlbProgress {
  return glbProgressSnapshot();
}

/** URL zaten önbellekte mi (senkron) — bekleme çipi göstermeden önce kontrol. */
export function isGlbCached(url: string): boolean {
  return !!_glbCache?.has(canonicalGlbKey(url));
}

// --- Yükleyici --------------------------------------------------------------

let _decoderPromise: Promise<unknown> | null = null;

/** meshopt decoder — sıkıştırılmış (EXT_meshopt_compression) GLB'ler için. */
function meshoptDecoder(): Promise<unknown> {
  if (!_decoderPromise) {
    _decoderPromise = import("three/examples/jsm/libs/meshopt_decoder.module.js")
      .then((m) => m.MeshoptDecoder)
      .catch(() => null);
  }
  return _decoderPromise;
}

export type LoadGlbOptions = {
  /** Preload gibi arka plan yüklemeleri — ilerleme çipi göstermez. */
  silent?: boolean;
};

/**
 * Üçgen sarımı ve normalleri içe dönük bir GLB'yi yerinde onarır.
 *
 * NEREDE ÇAĞRILIR: yalnız `loadGlb` içinde, sonuç ÖNBELLEĞE girmeden önce,
 * model başına BİR kez. prepareGlb'de yapılamaz: oradaki `src.clone(true)`
 * geometriyi PAYLAŞIR, yani onarım kaynağı bozar ve ikinci çağrıda sarımı
 * geri çevirip modeli yeniden delerdi.
 */
function repairInvertedWinding(scene: THREE.Object3D): void {
  const done = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry | undefined;
    if (!geo || done.has(geo)) return;
    done.add(geo);
    const idx = geo.getIndex();
    if (idx) {
      const a = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i + 2 < a.length; i += 3) {
        const t = a[i];
        a[i] = a[i + 2];
        a[i + 2] = t;
      }
      idx.needsUpdate = true;
    }
    // Normaller sarımla birlikte ters; yeniden hesaplamak ışığı da düzeltir.
    geo.deleteAttribute("normal");
    geo.computeVertexNormals();
  });
}

export function loadGlb(url: string, opts?: LoadGlbOptions): Promise<THREE.Group | null> {
  const key = canonicalGlbKey(url);
  if (!_glbCache) _glbCache = new Map();
  const hit = _glbCache.get(key);
  if (hit) return hit;
  const silent = opts?.silent === true;
  const p = (async (): Promise<THREE.Group | null> => {
    if (!silent) {
      _inflight.set(key, { loaded: 0, total: 0 });
      _lastFile = modelFileOf(key);
      emitGlbProgress();
    }
    try {
      // Sürüm meta.json'dan gelebilir — URL'yi kurmadan önce defteri bekle.
      await ensureModelMeta();
      const [mod, decoder] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        meshoptDecoder(),
      ]);
      const loader = new mod.GLTFLoader();
      if (decoder) {
        // three'nin tip imzası kendi decoder tipini ister; runtime sözleşmesi aynı.
        (loader as unknown as { setMeshoptDecoder: (d: unknown) => void }).setMeshoptDecoder(
          decoder
        );
      }
      const gltf = await loader.loadAsync(canonicalGlbUrl(key), (ev: ProgressEvent) => {
        if (silent) return;
        _inflight.set(key, {
          loaded: ev.loaded || 0,
          total: ev.lengthComputable ? ev.total || 0 : 0,
        });
        _lastFile = modelFileOf(key);
        emitGlbProgress();
      });
      if (hasInvertedNormals(key)) repairInvertedWinding(gltf.scene);
      return gltf.scene;
    } catch {
      return null;
    } finally {
      if (!silent) {
        _inflight.delete(key);
        emitGlbProgress();
      }
    }
  })();
  _glbCache.set(key, p);
  return p;
}

/**
 * Boşta önbelleği ısıtır — gizli olmayan tüm telefon modelleri. Model
 * değiştirmek anında olsun diye ilk boyamadan sonra çağrılır (Stage).
 * Sessiz: yükleme çipi göstermez.
 */
export function preloadModels(): void {
  if (typeof window === "undefined") return;
  void ensureModelMeta().then(() => {
    for (const m of listModels({ kind: ["phone"] }).filter(m => m.file === DEFAULT_MODEL_FILE)) {
      void loadGlb(`/assets/models/${m.file}`, { silent: true });
    }
  });
}

const SCREEN_NAME_RE = /screen|display|ekran/i;
const SCREEN_EXCLUDE_RE = /frame|out|bezel/i;

/** "Screen" materyalli/adlı primitifi bulur — tam eşleşme öncelikli. */
function findScreenMesh(root: THREE.Object3D): THREE.Mesh | null {
  let exact: THREE.Mesh | null = null;
  let fuzzy: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const names = [o.name, ...mats.map((m) => m?.name ?? "")];
    if (names.some((n) => n === "Screen")) {
      if (!exact) exact = o;
    } else if (
      names.some((n) => SCREEN_NAME_RE.test(n) && !SCREEN_EXCLUDE_RE.test(n))
    ) {
      if (!fuzzy) fuzzy = o;
    }
  });
  return exact ?? fuzzy;
}

/** Mesh'in ilk materyal adını okur (primitif başına tek materyal beklenir). */
function matName(mesh: THREE.Mesh): string {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return m?.name ?? "";
}

/**
 * iphone-real.glb materyal iyileştirmesi — ada göre. null dönerse orijinal
 * (önbellek-paylaşımlı) materyal korunur ve bin'e alınmaz.
 */
function upgradeMaterial(name: string, bodyColor: THREE.Color): THREE.Material | null {
  // --- Envato iPhone 17 Pro Max (prep-iphone17.mjs çıktısı) adları ---
  if (name === "Body") {
    // Uzay grisi his: ayna gibi krom DEĞİL — env yansıması kısılır.
    return new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      metalness: 0.35,
      roughness: 0.55,
      clearcoat: 0.12,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.35,
    });
  }
  if (name === "Side") {
    // Kasa yan rayı — hafif parlak ama yıkanmayan metal.
    return new THREE.MeshPhysicalMaterial({
      color: bodyColor.clone().multiplyScalar(1.08),
      metalness: 0.85,
      roughness: 0.3,
      envMapIntensity: 0.7,
    });
  }
  if (name === "Glass") {
    // Kamera lens camları.
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#0a0c12"),
      metalness: 0,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.3,
    });
  }
  if (name === "Body_Phone") {
    return new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      metalness: 0.85,
      roughness: 0.32,
      clearcoat: 0.25,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1,
    });
  }
  if (name === "Behind_Camera_._Frame" || name === "Behind_Camera._Frame_Out") {
    return new THREE.MeshPhysicalMaterial({
      color: bodyColor.clone().multiplyScalar(1.06),
      metalness: 0.85,
      roughness: 0.34,
      clearcoat: 0.2,
      clearcoatRoughness: 0.32,
      envMapIntensity: 1,
    });
  }
  if (name.startsWith("All_Button")) {
    return new THREE.MeshPhysicalMaterial({
      color: bodyColor.clone().multiplyScalar(1.15),
      metalness: 0.9,
      roughness: 0.28,
      envMapIntensity: 1,
    });
  }
  if (name === "Antena") {
    // Antenna hatları — mat plastik şerit.
    return new THREE.MeshStandardMaterial({
      color: bodyColor.clone().multiplyScalar(0.85),
      metalness: 0.2,
      roughness: 0.55,
      envMapIntensity: 0.8,
    });
  }
  if (name === "Display_Frame") {
    // Ön bezel — siyah parlak.
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#050507"),
      metalness: 0,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.15,
    });
  }
  if (name === "Screen") {
    // Kapalı ekran camı — screenshot-plane bunun 0.2mm önünde durur.
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#08080c"),
      metalness: 0,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.1,
    });
  }
  if (name === "Camera_Notch") {
    return new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  }
  if (name === "Flash") {
    // Hafif emissive — flaş camı.
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#ffe9c4"),
      emissive: new THREE.Color("#ffdf9e"),
      emissiveIntensity: 0.55,
      metalness: 0,
      roughness: 0.35,
      envMapIntensity: 1,
    });
  }
  if (/Lens|Optic|Glass/i.test(name)) {
    // Kamera camları — clearcoat hissi.
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#0a0c10"),
      metalness: 0.1,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.35,
    });
  }
  return null; // Speaker, Bolt, Sim_Card, Conector... — orijinal kalır
}

/**
 * GLB sahnesini klonlar, BODY_H'ye normalize eder, derinliğini GLB_SLIM ile
 * inceltir, materyalleri iyileştirir ve screenshot'ı "Screen" primitifinin
 * DÜNYA-UZAYI bbox'ından hesaplanan yuvarlak köşeli bir plane ile ekranın
 * 0.2mm önüne yerleştirir (UV'lere güvenilmez).
 */
export function prepareGlb(
  src: THREE.Group,
  style: DeviceStyle3D,
  screenTex: THREE.Texture | null,
  bin: Bin
): THREE.Group | null {
  const root = src.clone(true);
  const entry = getModel(style.glb || DEFAULT_GLB);
  if (isTabletKind(style.kind)) {
    const nativeLandscape = entry?.orientation === "landscape";
    const desiredLandscape = style.kind === "tablet-landscape";
    if (nativeLandscape !== desiredLandscape) root.rotateZ(nativeLandscape ? Math.PI / 2 : -Math.PI / 2);
  }
  root.updateMatrixWorld(true);

  const screenMesh = findScreenMesh(root);
  if (!screenMesh) return null; // sessizce prosedürel modele düşülecek

  // --- Ölçek + merkezleme: cihaz yüksekliği BODY_H olsun, merkez orijine gelsin.
  const modelBox = new THREE.Box3().setFromObject(root);
  const size = modelBox.getSize(new THREE.Vector3());
  if (!(size.y > 0)) return null;
  const k = BODY_H / size.y;
  const center = modelBox.getCenter(new THREE.Vector3());

  const wrap = new THREE.Group();
  root.position.sub(center);
  const inner = new THREE.Group();
  inner.add(root);
  inner.scale.setScalar(k);
  wrap.add(inner);
  wrap.updateMatrixWorld(true);

  // --- İnceltme: ekran-normal eksende GLB_SLIM — dik açıdaki "tuğla" görünümü
  // kırılır. Eksen, "Screen" primitifinin en ince bbox eksenidir. Ölçek burada,
  // bbox/gölge/kadraj hesaplarından ÖNCE uygulanır; hepsi güncel ölçeği görür.
  const sBox0 = new THREE.Box3().setFromObject(screenMesh);
  const sSize0 = sBox0.getSize(new THREE.Vector3());
  const dims: Array<[axis: "x" | "y" | "z", len: number]> = [
    ["x", sSize0.x],
    ["y", sSize0.y],
    ["z", sSize0.z],
  ];
  dims.sort((a, b) => a[1] - b[1]);
  const normalAxis = dims[0][0]; // en ince eksen = ekran normali
  inner.scale[normalAxis] *= GLB_SLIM;
  wrap.updateMatrixWorld(true);

  // --- Materyal iyileştirme (klon başına taze materyaller; önbellek bozulmaz).
  let bodyColor: THREE.Color;
  try {
    bodyColor = new THREE.Color(style.bodyColor || DEFAULT_BODY_COLOR);
  } catch {
    bodyColor = new THREE.Color(DEFAULT_BODY_COLOR);
  }
  const upgraded = new Map<string, THREE.Material>();
  let notchMesh: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = matName(o);
    if (name === "Camera_Notch") notchMesh = o;
    let mat = upgraded.get(name);
    if (!mat) {
      const fresh = upgradeMaterial(name, bodyColor);
      if (!fresh) return;
      fresh.name = name;
      upgraded.set(name, fresh);
      bin.mats.push(fresh);
      mat = fresh;
    }
    o.material = mat;
  });

  // --- Ekran-plane: "Screen" primitifinin dünya-uzayı bbox'ı ölçü verir
  // (inceltme sonrası, güncel ölçekle).
  if (screenTex) {
    const sBox = new THREE.Box3().setFromObject(screenMesh);
    const sSize = sBox.getSize(new THREE.Vector3());
    const sCenter = sBox.getCenter(new THREE.Vector3());
    // Ekran, modelin merkezine göre hangi taraftaysa plane o yöne bakar.
    const mCenter = new THREE.Vector3(); // wrap-uzayında model merkezi = orijin
    const sign = sCenter[normalAxis] >= mCenter[normalAxis] ? 1 : -1;

    let planeW = 0;
    let planeH = 0;
    if (normalAxis === "z") {
      planeW = sSize.x;
      planeH = sSize.y;
    } else if (normalAxis === "x") {
      planeW = sSize.z;
      planeH = sSize.y;
    } else {
      planeW = sSize.x;
      planeH = sSize.z;
    }
    if (planeW > 0 && planeH > 0) {
      // Ön cam kenardan kenara uzanır; aktif ekran camdan içeridedir. Ne kadar
      // içeride olduğu MODEL BAŞINA kalibrasyondan gelir (/calibrate →
      // meta.json); kalibre edilmemiş modeller DEFAULT_SCREEN'i kullanır.
      const cal = screenCalib(style.glb || DEFAULT_GLB);
      const rawW = planeW;
      const rawH = planeH;
      planeW = rawW * cal.insetX;
      planeH = rawH * cal.insetY;
      const radius = Math.min(planeW, planeH) * cal.cornerRadiusRatio;
      let geo: THREE.BufferGeometry;
      if (entry?.nativeScreenGeometry && normalAxis === "z") {
        // Preserve every vertex of the real display outline, including its
        // continuous corners. Project UVs after orientation, so landscape
        // screenshots stay upright without stretching a portrait texture.
        geo = screenMesh.geometry.clone().applyMatrix4(screenMesh.matrixWorld);
        geo.translate(-sCenter.x, -sCenter.y, -sCenter.z);
        geo.scale(cal.insetX, cal.insetY, 1);
        const positions = geo.getAttribute("position");
        const uv = new Float32Array(positions.count * 2);
        for (let i = 0; i < positions.count; i++) {
          uv[i * 2] = positions.getX(i) / planeW + 0.5;
          uv[i * 2 + 1] = positions.getY(i) / planeH + 0.5;
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      } else geo = roundedPlane(planeW, planeH, radius, 24);
      // Fit ÖNCESİ ham UV'ler saklanır: aynı GLB klonuna BAŞKA oranda bir
      // screenshot bağlanacağı zaman (çoklu cihaz) fit sıfırdan hesaplanmalı,
      // yoksa iki kırpma üst üste biner. Bkz. retargetScreen.
      const rawUv = Float32Array.from(
        (geo.getAttribute("uv") as THREE.BufferAttribute).array as ArrayLike<number>
      );
      const im = screenTex.image as { width?: number; height?: number } | null;
      const iw = im?.width || 0;
      const ih = im?.height || 0;
      const screenFit = isTabletKind(style.kind) ? "contain" : "cover";
      if (iw > 0 && ih > 0) fitScreenUV(geo, planeW / planeH, iw / ih, screenFit);
      const mat = new THREE.MeshBasicMaterial({
        map: screenTex,
        toneMapped: false, // SRGB screenshot — ACES bunu bozmasın
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.name = SCREEN_MESH_NAME;
      // DİKKAT: bu kayıt userData'ya KONULAMAZ. Object3D.copy userData'yı
      // JSON.parse(JSON.stringify(...)) ile kopyalıyor; Float32Array klonda
      // `{0:…,1:…}` biçimli sıradan bir nesneye dönüşüyor ve UV'ler sessizce
      // boşalıyordu (ekran düz renk basıyordu). Geometri klonlar arasında
      // PAYLAŞILDIĞI için onu anahtar alan bir WeakMap doğru ve ücretsiz.
      SCREEN_UV.set(geo, { rect: planeW / planeH, rawUv, imgAspect: iw > 0 && ih > 0 ? iw / ih : 0, fit: screenFit });
      bin.geos.push(geo);
      bin.mats.push(mat);

      // Konum: ekran yüzeyinin 0.2mm önü — cam-gövde dikişinde boşluk görünmez.
      const offset = bodyDimsOf(style.kind).MM * 0.2;
      plane.position.copy(sCenter);
      if (normalAxis === "z") {
        plane.position.z = (sign > 0 ? sBox.max.z : sBox.min.z) + sign * offset;
        if (sign < 0) plane.rotation.y = Math.PI;
      } else if (normalAxis === "x") {
        plane.position.x = (sign > 0 ? sBox.max.x : sBox.min.x) + sign * offset;
        plane.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        plane.position.y = (sign > 0 ? sBox.max.y : sBox.min.y) + sign * offset;
        plane.rotation.x = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      }

      // Kalibrasyon ofseti — düzlemin KENDİ sağ/yukarı eksenlerinde kaydır,
      // böylece +X hep "ekrana bakan gözlemcinin sağı" demek olur (yön/rotasyon
      // ne olursa olsun). Birim: HAM bbox boyutunun oranı (inset'ten bağımsız).
      if (cal.offsetX !== 0 || cal.offsetY !== 0) {
        const right = new THREE.Vector3(1, 0, 0).applyEuler(plane.rotation);
        const up = new THREE.Vector3(0, 1, 0).applyEuler(plane.rotation);
        plane.position.addScaledVector(right, cal.offsetX * rawW);
        plane.position.addScaledVector(up, cal.offsetY * rawH);
      }
      wrap.add(plane);

      // --- Cam yansıması: GLB ekranı şimdiye kadar TAMAMEN düz duruyordu
      // ("yapıştırılmış ekran görüntüsü" hissi). Kontur modelindeki ince
      // diyagonal şeridin aynısı, ekran-plane'in 0.05mm önünde. Çok kısık
      // (taban %6) — UI okunurluğu bozulmaz, cam olduğu anlaşılır.
      const sheenTex = getSheenTexture();
      const sheenAmt = 0.06 * LIGHT_RIGS[rigIdOf(style)].sheen * (style.glare ?? 0);
      if (sheenTex && sheenAmt > 0.001) {
        const sGeo = roundedPlane(planeW, planeH, radius, 20);
        const sMat = new THREE.MeshBasicMaterial({
          map: sheenTex,
          transparent: true,
          opacity: sheenAmt,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        bin.geos.push(sGeo);
        bin.mats.push(sMat);
        const sheen = new THREE.Mesh(sGeo, sMat);
        sheen.name = SHEEN_MESH_NAME;
        sheen.position.copy(plane.position);
        sheen.rotation.copy(plane.rotation);
        sheen.translateZ(MM * 0.05);
        wrap.add(sheen);
      }

      // Dynamic Island (Camera_Notch) plane'in önünde kalsın — gerçek görünüm.
      if (notchMesh && normalAxis === "z" && sign > 0) {
        const nm: THREE.Mesh = notchMesh;
        const nBox = new THREE.Box3().setFromObject(nm);
        if (!nBox.isEmpty()) {
          const lift = plane.position.z + MM * 0.3 - nBox.max.z;
          // Yerel eksen dünya z ile hizalı; z ölçeği inceltme dahil k * GLB_SLIM.
          nm.position.z += lift / (k * GLB_SLIM);
        }
      }
    }
  }

  return wrap;
}

/**
 * Cihaz kaynağını çözer — style.model'e göre:
 *   "kontur"             → null döner; çağıran prosedürel kontur modeli kurar.
 *   undefined | "real"   → cihaz türüne uygun gerçek GLB yüklenip hazırlanır.
 * Tabletlerde yalnız kayıtlı tablet GLB'si kullanılabilir. GLB yüklenemez ya da
 * hazırlanamazsa null döner → çağıran yine kontur'a düşer.
 */
export async function buildDeviceSource(
  style: DeviceStyle3D,
  screenTex: THREE.Texture | null,
  bin: Bin,
  outerTex?: THREE.Texture | null
): Promise<THREE.Group | null> {
  if (isDuoKind(style.kind)) {
    const asset = await loadGlb(duoAssetUrl(style));
    return asset ? prepareDuoAsset(asset, style, screenTex, bin, outerTex) : null;
  }
  if (style.model === "kontur") return null;
  await ensureModelMeta();
  const tablet = isTabletKind(style.kind);
  const requested = style.glb && getModel(style.glb);
  // Legacy templates may carry a phone GLB into an iPad project (or vice
  // versa). Resolve by physical device kind, never stretch the wrong model.
  const compatible = style.glb && (tablet ? requested && requested.kind === "tablet" : !requested || requested.kind !== "tablet");
  const url = compatible ? style.glb! : tablet ? `/assets/models/${DEFAULT_TABLET_MODEL_FILE}` : DEFAULT_GLB;
  const glb = await loadGlb(url);
  if (!glb) return null;
  try {
    const device = prepareGlb(glb, { ...style, glb: url }, screenTex, bin);
    if (device) device.userData.modelSource = url;
    return device;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GERÇEK düzlemsel zemin yansıması — MeshReflectorMaterial + planar reflector
// ---------------------------------------------------------------------------
// Eski yol cihazın aynalanmış KOPYASINI çiziyordu: normaller ters döndüğü için
// ışık yanlış oturuyor, bulanıklık yok, katman sırası kırılgandı. v2'de zemine
// gerçek bir ayna düzlemi konuyor: sahne aynalanmış kameradan bir FBO'ya
// çekiliyor, BlurPass ile yumuşatılıyor, MeshReflectorMaterial düzleme
// yansıtıyor. Çıktı ŞEFFAF bir katman olmak zorunda olduğu için materyalin
// çıkışı ele geçirilip aydınlatmasız + FBO'nun kendi alfasıyla veriliyor:
// yansımanın olmadığı yerde zemin tamamen görünmez kalır.

const REFLECTION_OPACITY = 0.24;
/** Yansımanın tamamen söndüğü zemin mesafesi (model birimi). */
const REFLECTION_FADE = BODY_H * 3.9;
/** Ayna düzleminin kenar uzunluğu — kameraya doğru uzanan kısım şart. */
const FLOOR_SIZE = 40;

const REFL_MARK =
  "diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);";

type ReflUniforms = {
  uReflStrength: { value: number };
  uReflFade: { value: number };
  uReflCenter: { value: THREE.Vector2 };
};

/**
 * MeshReflectorMaterial'in aydınlatılmış çıkışı yerine yalnızca yansımayı
 * (tone-map + sRGB uygulanmış) ve FBO alfasını basan alt sınıf.
 */
class FloorReflectMaterial extends MeshReflectorMaterial {
  readonly u: ReflUniforms = {
    uReflStrength: { value: REFLECTION_OPACITY },
    uReflFade: { value: REFLECTION_FADE },
    uReflCenter: { value: new THREE.Vector2(0, 0) },
  };

  constructor() {
    super();
    this.transparent = true;
    this.depthWrite = false;
    this.toneMapped = true; // toneMapping() fonksiyonu shader'a girsin
    this.color = new THREE.Color(0xffffff);
    this.roughness = 0.82;
    this.metalness = 0;
    this.envMapIntensity = 0;
    this.mirror = 1;
    this.mixStrength = 1;
    this.mixBlur = 1;
    this.mixContrast = 1;
    this.hasBlur = true;
    this.defines = { ...(this.defines || {}), USE_BLUR: "" };
  }

  onBeforeCompile(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown>; defines?: Record<string, unknown> }): void {
    super.onBeforeCompile(shader);
    shader.uniforms.uReflStrength = this.u.uReflStrength;
    shader.uniforms.uReflFade = this.u.uReflFade;
    shader.uniforms.uReflCenter = this.u.uReflCenter;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vReflWorld;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n{ vec4 rwp = modelMatrix * vec4( transformed, 1.0 ); vReflWorld = rwp.xyz; }"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vReflWorld;\nuniform float uReflStrength;\nuniform float uReflFade;\nuniform vec2 uReflCenter;\nvec4 vsRefl = vec4( 0.0 );"
      )
      .replace(REFL_MARK, `${REFL_MARK}\n  vsRefl = vec4( newMerge.rgb * mixStrength, merge.a );`)
      .replace(
        "#include <dithering_fragment>",
        // toneMapping() SADECE tuvale çizerken tanımlı; three, render-target'a
        // çizerken tone mapping/renk uzayı dönüşümünü atlar (bloom geçişi
        // sahneyi FBO'ya çekiyor). Korumasız hâli orada "no matching
        // overloaded function" ile shader'ı derlemiyordu.
        `#include <dithering_fragment>
        {
          float rd = length( vReflWorld.xz - uReflCenter );
          float fade = 1.0 - smoothstep( 0.0, uReflFade, rd );
          fade *= fade;
          vec3 rcol = max( vsRefl.rgb, vec3( 0.0 ) );
          #if defined( TONE_MAPPING )
            rcol = toneMapping( rcol );
          #endif
          vec4 rc = linearToOutputTexel( vec4( rcol, 1.0 ) );
          gl_FragColor = vec4( rc.rgb, clamp( vsRefl.a, 0.0, 1.0 ) * uReflStrength * fade );
        }`
      );
  }
}

type Reflector = {
  mesh: THREE.Mesh;
  material: FloorReflectMaterial;
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
};

// Renderer başına paylaşılan yansıma hedefleri — her render'da yeniden
// yaratmak GPU'yu boşuna yorar. Boyut/AA sabit olduğu için deterministik.
type ReflTargets = {
  rt: THREE.WebGLRenderTarget;
  blur: THREE.WebGLRenderTarget;
  pass: BlurPass;
  w: number;
  h: number;
};
const _reflTargets = new WeakMap<THREE.WebGLRenderer, ReflTargets>();
const REFL_RES = 900;

/** Hedef boyutu — çizim tamponunun ORANINI korur (blur anizotropik olmasın). */
function fitRes(renderer: THREE.WebGLRenderer, res: number): [number, number] {
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  const a = v.x > 0 && v.y > 0 ? v.x / v.y : 1;
  const w = a >= 1 ? res : Math.max(64, Math.round(res * a));
  const h = a >= 1 ? Math.max(64, Math.round(res / a)) : res;
  return [w, h];
}

/** Blur geçişinin çekirdek ölçeğini hedef boyutuna göre tazeler. */
function tuneBlur(pass: BlurPass, w: number, h: number): void {
  pass.renderTargetA.setSize(w, h);
  pass.renderTargetB.setSize(w, h);
  pass.convolutionMaterial.setTexelSize(1 / w, 1 / h);
  pass.convolutionMaterial.setResolution(new THREE.Vector2(w, h));
}

function reflTargets(renderer: THREE.WebGLRenderer): ReflTargets {
  const [w, h] = fitRes(renderer, REFL_RES);
  let t = _reflTargets.get(renderer);
  if (!t) {
    const opt = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
    } as const;
    const rt = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: true });
    const blur = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: false });
    const pass = new BlurPass({ gl: renderer, resolution: Math.max(w, h), width: w, height: h });
    t = { rt, blur, pass, w: 0, h: 0 };
    _reflTargets.set(renderer, t);
  }
  if (t.w !== w || t.h !== h) {
    t.rt.setSize(w, h);
    t.blur.setSize(w, h);
    tuneBlur(t.pass, w, h);
    t.w = w;
    t.h = h;
  }
  return t;
}

/** three Reflector matematiğinin sadeleştirilmiş hali (mesh normali +Z). */
function makeReflector(size: number, hide: THREE.Object3D[], bin: Bin): Reflector {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const mat = new FloorReflectMaterial();
  bin.geos.push(geo);
  bin.mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // +Z → +Y
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  // Yansıma hesabı çalışana kadar zemin GÖRÜNMEZ; ayrıca textureMatrix asla
  // null kalmamalı — null uniform three'nin uniform yüklemesinde patlıyor.
  mesh.visible = false;
  mat.textureMatrix = new THREE.Matrix4();

  const reflectorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const reflectorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();
  const textureMatrix = new THREE.Matrix4();
  const virtualCamera = new THREE.PerspectiveCamera();
  const CLIP_BIAS = 0.003;

  return {
    mesh,
    material: mat,
    dispose(): void {
      /* geo/mat bin üzerinden atılır */
    },
    update(renderer, scene, camera): void {
      mesh.updateMatrixWorld(true);
      reflectorWorldPosition.setFromMatrixPosition(mesh.matrixWorld);
      cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
      rotationMatrix.extractRotation(mesh.matrixWorld);
      normal.set(0, 0, 1).applyMatrix4(rotationMatrix);
      view.subVectors(reflectorWorldPosition, cameraWorldPosition);
      // Kamera aynanın ALTINDA (orbit phi negatif olabilir) → yansıma yok.
      // Zemin gizlenir; yoksa yarım hesaplanmış uniform'larla çizilirdi.
      if (view.dot(normal) > 0) {
        mesh.visible = false;
        return;
      }

      view.reflect(normal).negate().add(reflectorWorldPosition);
      rotationMatrix.extractRotation(camera.matrixWorld);
      lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraWorldPosition);
      target.subVectors(reflectorWorldPosition, lookAtPosition);
      target.reflect(normal).negate().add(reflectorWorldPosition);

      virtualCamera.position.copy(view);
      virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
      virtualCamera.lookAt(target);
      virtualCamera.near = camera.near;
      virtualCamera.far = camera.far;
      virtualCamera.updateMatrixWorld();
      virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

      // Dünya → yansıma UV
      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      textureMatrix.multiply(virtualCamera.projectionMatrix);
      textureMatrix.multiply(virtualCamera.matrixWorldInverse);
      textureMatrix.multiply(mesh.matrixWorld);
      mat.textureMatrix = textureMatrix;

      // Eğik near-plane: aynanın ALTINDAKİ hiçbir şey yansımaya girmesin.
      reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
      reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
      clipPlane.set(
        reflectorPlane.normal.x,
        reflectorPlane.normal.y,
        reflectorPlane.normal.z,
        reflectorPlane.constant
      );
      const pm = virtualCamera.projectionMatrix;
      q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
      q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
      q.z = -1;
      q.w = (1 + pm.elements[10]) / pm.elements[14];
      clipPlane.multiplyScalar(2 / clipPlane.dot(q));
      pm.elements[2] = clipPlane.x;
      pm.elements[6] = clipPlane.y;
      pm.elements[10] = clipPlane.z + 1 - CLIP_BIAS;
      pm.elements[14] = clipPlane.w;

      // --- Tek geçişli, deterministik yansıma render'ı.
      const t = reflTargets(renderer);
      const prevTarget = renderer.getRenderTarget();
      const prevAlpha = renderer.getClearAlpha();
      const prevXR = renderer.xr.enabled;
      const prevShadow = renderer.shadowMap.enabled;
      const wasVisible = hide.map((o) => o.visible);
      mesh.visible = false; // ayna kendini yansıtmasın
      for (const o of hide) o.visible = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(t.rt);
      renderer.setClearAlpha(0);
      renderer.clear(true, true, true);
      renderer.render(scene, virtualCamera);
      t.pass.render(renderer, t.rt, t.blur);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearAlpha(prevAlpha);
      renderer.xr.enabled = prevXR;
      renderer.shadowMap.enabled = prevShadow;
      renderer.shadowMap.autoUpdate = true;
      hide.forEach((o, i) => (o.visible = wasVisible[i]));
      mesh.visible = true;

      mat.tDiffuse = t.rt.texture;
      mat.tDiffuseBlur = t.blur.texture;
    },
  };
}

// ---------------------------------------------------------------------------
// Sahne montajı — instances + gölge + yansıma (offline ve canlı ortak)
// ---------------------------------------------------------------------------

export type StageBuild = {
  root: THREE.Group;
  deviceRoot: THREE.Group;
  /** Cihaz kopyaları — kadraj (yalnız REFERANS telefon) ve piksel yerleşimi için. */
  phones: THREE.Object3D[];
  /** Cihaz merkezlerinin root-YEREL konumları — DoF otomatik odağı için. */
  centers: THREE.Vector3[];
  /** Gölge düzlemlerini güncel orbit'e göre eğer/döndürür (canlıda her karede). */
  updateShadow(orbit: Orbit): void;
  /** i. cihazı (gölgesiyle birlikte) root-YEREL konuma taşır ve şeklini
   *  günceller. Piksel eşlemeli split yerleşimi kamera kurulduktan SONRA
   *  çağırır; `centers` da güncellenir (DoF odağı doğru kalsın). */
  placeInstance(i: number, p: { x: number; y: number; z: number; s: number; ry: number; rz: number }): void;
  /** Zemin/ayna düzlemini cihazların GÜNCEL altlarına göre yeniden hizalar. */
  refreshFloor(): void;
  /** Kaba sahne küresi — near/far için. Box3 taramasından çok daha ucuz;
   *  canlı yolda her karede çağrılabilir. */
  bounds(): THREE.Sphere;
  /** Zemin yansıması varsa ana render'dan HEMEN ÖNCE çağrılır (tek FBO geçişi). */
  updateReflection:
    | ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void)
    | null;
};

/**
 * Klonlanmış bir GLB telefonun ekran düzlemine BAŞKA bir doku bağlar.
 *
 * Materyal ve geometri KLONLANIR: `source.clone(true)` mesh'leri kopyalar ama
 * materyal/geometri referanslarını PAYLAŞTIRIR — doğrudan yazmak diğer
 * kopyaların ekranını da değiştirirdi. UV'ler HAM hâlden yeniden fit
 * edilir; yoksa iki kırpma üst üste binip görüntü fazladan yakınlaşırdı.
 */
function retargetScreen(phone: THREE.Object3D, tex: THREE.Texture, bin: Bin): void {
  if (phone.userData.modelSource?.includes("apple-iphone-duo")) { retargetDuoAssetScreen(phone, tex, bin); return; }
  const plane = phone.getObjectByName(SCREEN_MESH_NAME);
  if (!(plane instanceof THREE.Mesh)) return;

  const src = plane.material;
  const base = Array.isArray(src) ? src[0] : src;
  if (!base) return;
  const mat = base.clone() as THREE.MeshBasicMaterial;
  mat.map = tex;
  mat.needsUpdate = true;
  bin.mats.push(mat);
  plane.material = mat;

  const info = SCREEN_UV.get(plane.geometry);
  const im = tex.image as { width?: number; height?: number } | null;
  const iw = im?.width || 0;
  const ih = im?.height || 0;
  if (!info || iw <= 0 || ih <= 0) return;
  const aspect = iw / ih;
  // Oran aynıysa mevcut UV'ler zaten doğru — boşuna geometri klonlama.
  if (Math.abs(aspect - info.imgAspect) < 1e-4) return;
  const geo = plane.geometry.clone();
  geo.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(info.rawUv), 2));
  fitScreenUV(geo, info.rect, aspect, info.fit);
  SCREEN_UV.set(geo, { ...info, imgAspect: aspect });
  bin.geos.push(geo);
  plane.geometry = geo;
}

// --- R8/E1: FLOAT — gölge ayrışması ----------------------------------------
// Cihazı yukarı taşımak yerine ZEMİNİ (gölge katmanları + ayna düzlemi)
// aşağı indiriyoruz: kadraj bit-bit korunur (fitFov cihaz kutusunu ölçer,
// kamera hedefi değişmez), buna karşılık gölge cihazdan ayrılır, yayılır ve
// söner — Rotato'nun havada duran görünümü. contact katmanı neredeyse
// tamamen silinir (temas yok), halo/body büyür ve yumuşar.

/** float 0..1 → zeminin ne kadar aşağı ineceği (model birimi). */
export function floatLift(style: DeviceStyle3D): number {
  return THREE.MathUtils.clamp(style.float ?? 0, 0, 1) * BODY_H * 0.2;
}

/** float = 1 iken katman tepkisi: [opaklık çarpanı, ölçek çarpanı] */
const FLOAT_RESP: Record<ShadowLayerId, [number, number]> = {
  halo: [0.92, 1.5],
  body: [0.72, 1.4],
  contact: [0.16, 1.95],
};

/** Katman: [ölçek X, ölçek Y, z ofseti, opaklık payı, kayma payı] */
const SHADOW_STACK: Array<[ShadowLayerId, number, number, number, number, number]> = [
  ["halo", 3.1, 3.1, -0.16, 0.34, 1.0],
  ["body", 1.95, 1.5, -0.11, 0.66, 0.6],
  ["contact", 1.16, 0.6, -0.05, 1.05, 0.22],
];

export function assembleStage(opts: {
  style: DeviceStyle3D;
  preset: Preset;
  source: THREE.Group | null; // hazırlanmış GLB; null → prosedürel
  screenTex: THREE.Texture | null;
  rig: RigResult;
  bin: Bin;
  /** preset.instances YERİNE kullanılacak liste — layout tabanlı çoklu cihaz.
   *  Verilmezse preset'in kendi dizilişi (pair/fan3/stack3) geçerli. */
  instances?: Instance[];
  /** i. kopyanın ekran dokusu; yoksa ortak `screenTex`. Aynı karede FARKLI
   *  ekran görüntüleri bu listeyle gelir. */
  screenTexes?: (THREE.Texture | null)[];
}): StageBuild {
  const { style, preset, source, screenTex, rig, bin } = opts;
  const insts = opts.instances ?? preset.instances;

  const root = new THREE.Group();
  root.rotation.z = preset.roll;

  const deviceRoot = new THREE.Group();
  const shadowRoot = new THREE.Group();
  root.add(deviceRoot);
  root.add(shadowRoot);

  const wantShadow = style.shadow !== false;
  const spread = rig.shadowSpread;
  const fl = THREE.MathUtils.clamp(style.float ?? 0, 0, 1);
  const lift = floatLift(style);
  const centers: THREE.Vector3[] = [];

  type Layer = { mesh: THREE.Mesh; baseX: number; baseY: number; slide: number };
  /** Kopya kaydı — sonradan taşınabilmesi (piksel yerleşimi) için tutulur. */
  type Rec = { phone: THREE.Object3D; yaw: THREE.Group | null; s: number };
  const yaws: THREE.Group[] = [];
  const layers: Layer[] = [];
  const recs: Rec[] = [];
  const phones: THREE.Object3D[] = [];
  let floorY = Infinity;

  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i];
    const sc = inst.s ?? 1;
    // i. ekran: liste verilmişse ondan, yoksa ortak doku. Prosedürel yolda
    // telefon zaten kopya başına kurulduğu için doku doğrudan geçer; GLB
    // yolunda paylaşımlı klonun ekranı retargetScreen ile ayrıştırılır.
    const texI = opts.screenTexes ? (opts.screenTexes[i] ?? screenTex) : screenTex;
    const phone = source ? source.clone(true) : isDuoKind(style.kind) ? buildDuo(style, texI, bin, opts.screenTexes?.[1]) : buildPhone(style, texI, bin);
    if (source && texI && texI !== screenTex) retargetScreen(phone, texI, bin);
    phone.position.set(inst.x, inst.y, inst.z);
    phone.rotation.set(0, inst.ry, inst.rz ?? 0);
    if (sc !== 1) phone.scale.setScalar(sc);
    deviceRoot.add(phone);
    phones.push(phone);
    centers.push(new THREE.Vector3(inst.x, inst.y, inst.z));

    const bottom = inst.y - (BODY_H * sc) / 2 - 0.02; // cihazlar BODY_H'ye normalize
    if (bottom < floorY) floorY = bottom;
    if (!wantShadow) {
      recs.push({ phone, yaw: null, s: sc });
      continue;
    }

    const yaw = new THREE.Group();
    yaw.position.set(inst.x, bottom, inst.z);
    if (sc !== 1) yaw.scale.setScalar(sc);
    recs.push({ phone, yaw, s: sc });
    for (const [id, sx, sy, dz, op, slide] of SHADOW_STACK) {
      const tex = getShadowTexture(id);
      if (!tex) continue;
      const geo = new THREE.PlaneGeometry(1, 1);
      const [fOp, fSc] = FLOAT_RESP[id];
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: rig.shadowOpacity * op * (1 + (fOp - 1) * fl),
        depthWrite: false,
        toneMapped: false,
      });
      bin.geos.push(geo);
      bin.mats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      // Halo katmanı daha da dağılsın; temas katmanı sıkı kalsın.
      const k = (id === "contact" ? 1 : spread) * (1 + (fSc - 1) * fl);
      const bx = bodyDimsOf(style.kind).W * sx * k;
      const by = BODY_H * sy * (id === "contact" ? 1 : spread * 0.9 + 0.1) * (1 + (fSc - 1) * fl);
      m.scale.set(bx, by, 1);
      m.position.z = dz;
      m.renderOrder = 1;
      yaw.add(m);
      layers.push({ mesh: m, baseX: bx, baseY: by, slide });
    }
    shadowRoot.add(yaw);
    yaws.push(yaw);
  }
  shadowRoot.position.y = -lift;

  // --- Zemin yansıması: gerçek ayna düzlemi (yansıma pass'i updateReflection'da).
  let updateReflection: StageBuild["updateReflection"] = null;
  let mirror: THREE.Mesh | null = null;
  if (style.reflection && isFinite(floorY)) {
    const reflector = makeReflector(FLOOR_SIZE, [shadowRoot], bin);
    reflector.mesh.position.y = floorY - lift;
    reflector.material.u.uReflStrength.value =
      REFLECTION_OPACITY * rig.reflection * (1 - 0.55 * fl);
    root.add(reflector.mesh);
    mirror = reflector.mesh;
    updateReflection = (renderer, scene, camera) => reflector.update(renderer, scene, camera);
  }

  /** Kopyalar taşındıktan sonra zemini en alttaki cihaza göre yeniden hizalar. */
  const refreshFloor = (): void => {
    if (!mirror) return;
    let y = Infinity;
    for (const r of recs) {
      const b = r.phone.position.y - (BODY_H * r.s) / 2 - 0.02;
      if (b < y) y = b;
    }
    if (isFinite(y)) mirror.position.y = y - lift;
  };

  const placeInstance: StageBuild["placeInstance"] = (i, p): void => {
    const r = recs[i];
    if (!r) return;
    r.s = p.s;
    r.phone.position.set(p.x, p.y, p.z);
    r.phone.rotation.set(0, p.ry, p.rz);
    r.phone.scale.setScalar(p.s);
    centers[i].set(p.x, p.y, p.z);
    if (r.yaw) {
      r.yaw.position.set(p.x, p.y - (BODY_H * p.s) / 2 - 0.02, p.z);
      r.yaw.scale.setScalar(p.s);
      // yaw.rotation.y'ye DOKUNMA — onu updateShadow orbit'ten kuruyor.
    }
  };

  // Kaba küre: her cihazın merkezinden yarım köşegen kadar uzağı kapsar
  // (BODY_H*0.62 ≈ sqrt((H/2)²+(W/2)²) payıyla). Yansıma açıkken 40 birimlik
  // ayna düzlemi zaten baskın. Box3 taramasından ~50× ucuz.
  const bounds = (): THREE.Sphere => {
    let r = 0;
    for (const rec of recs) {
      const d = rec.phone.position.length() + BODY_H * 0.62 * rec.s;
      if (d > r) r = d;
    }
    r += lift;
    if (mirror) r = Math.max(r, FLOOR_SIZE * 0.71);
    return new THREE.Sphere(root.getWorldPosition(new THREE.Vector3()), Math.max(0.1, r));
  };

  const updateShadow = (orbit: Orbit): void => {
    // Gölge düzlemi zemin (yatay) ile billboard arasında karıştırılır:
    // düşük phi'de bile görünür kalsın, laydown'da yere yatsın.
    const tilt = -(orbit.phi + (Math.PI / 2 - orbit.phi) * 0.62);
    for (const yaw of yaws) yaw.rotation.y = orbit.theta;
    // Işık kameraya göre nerede ise gölge ters yöne kayar + o yönde uzar.
    const rel = rig.keyAzimuth - orbit.theta;
    const push = -Math.sin(rel);
    const bodyW = bodyDimsOf(style.kind).W;
    for (const l of layers) {
      l.mesh.rotation.x = tilt;
      l.mesh.position.x = push * l.slide * bodyW * 0.34;
      l.mesh.scale.x = l.baseX * (1 + Math.abs(push) * 0.16 * l.slide);
    }
  };

  return {
    root,
    deviceRoot,
    phones,
    centers,
    updateShadow,
    placeInstance,
    refreshFloor,
    bounds,
    updateReflection,
  };
}

// ---------------------------------------------------------------------------
// PİKSEL EŞLEMELİ ÇOKLU CİHAZ — layout kutuları → 3D sahne yerleşimi
// ---------------------------------------------------------------------------
// R10/E. Eskiden iki cihazlı düzenlerde 3D sahne TAMAMEN kapanıyordu: her iki
// telefon 2D kontur yolundan çiziliyordu (ışık, gölge, cam, perspektif yok).
// Artık N telefon TEK sahnede, ortak ışık/gölge/yansıma altında duruyor.
//
// Yöntem — neden bu:
//   Referans kutu ilk kutudur; kamera kadrajı BUGÜNKÜ yoldan (setViewOffset +
//   fitFov) yalnız ona göre kurulur, yani tek cihazlı davranış korunur.
//   Diğer kutular kameranın SAĞ/YUKARI ekseninin gerdiği düzlemde ötelenir.
//   Bu düzlem bakış eksenine DİKtir → üzerindeki tüm noktalar aynı görüş
//   derinliğindedir → perspektif projeksiyon bu düzlemde tam olarak DOĞRUSAL
//   bir ölçektir. Bir kez ölçülen "piksel / dünya birimi" oranı tüm kutular
//   için birebir doğru sonuç verir; iterasyon gerekmez.
//   (Dünya XY düzleminde ötelemek yanlış olurdu: kamera theta/phi ile döndüğü
//   an o düzlem eğik görünür, yatay piksel farkı yatay dünya farkına eşit
//   olmaz — kutular kayardı.)

/** Layout kutusu, RENDER pikseli cinsinden. */
export type PixelBox = { cx: number; cy: number; h: number; rotation?: number };

/**
 * Kutu SIRASINA göre derinlik kademesi (dünya birimi, BODY_H = 2.16).
 *
 * Neden gerekli: kutular bakış eksenine DİK tek bir düzlemde çözülüyor, yani
 * hepsi AYNI derinlikte olurdu — üst üste binen düzenlerde z-fighting, DoF'ta
 * da hiç ayrışma olmazdı. Her kutu bir kademe geriye itilir: 0. kutu EN ÖNDE.
 * Düzenler buna göre kurgulanır (önde durması gereken telefon `device`).
 *
 * Kadraj bundan ETKİLENMEZ: aşağıdaki çözüm hem düzlem-içi ötelemeyi hem
 * ölçeği derinlik oranıyla telafi ediyor — telefon piksel piksel aynı yerde,
 * aynı boyda kalır, yalnız DERİNLİĞİ değişir.
 */
const DEPTH_STEP = 0.6;

/**
 * İÇE DÖNME (toe-in) — kadrajın yanına düşen telefon merkeze doğru döner.
 *
 * Neden: kutular bakış eksenine dik TEK bir düzlemde çözülüyor, yani hepsi
 * kameraya birebir aynı açıyla bakıyor. "front" kamerada bu, üç paralel düz
 * kart demek — 3D sahnede duruyor ama 3D GÖRÜNMÜYOR. Kendi Y ekseni etrafında
 * dönmek telefonun projekte MERKEZİNİ oynatmaz (piksel eşlemesi bozulmaz),
 * yalnız silüetine derinlik verir.
 *
 * Ölçü: yatay kayma / referans telefonun eni. Tam bir telefon eni kadar yana
 * düşen cihaz TOE_IN kadar döner, ±1.5 ende doyar. 0.11 rad ≈ 6.3° — sahneyi
 * "yelpaze" yapmaya yetmeyecek kadar az, düzlüğü kırmaya yetecek kadar çok.
 */
const TOE_IN = 0.11;

/**
 * Kutuları sahneye uygular. Kamera KURULDUKTAN sonra (setViewOffset + fitFov)
 * çağrılır; referans telefon (0. kutu) yerinden oynamaz, yalnız ölçek/roll'ü
 * tazelenir. Tek kutuda hiçbir şey yapmaz → tek cihazlı yol bit-bit korunur.
 */
export function placeByPixels(
  stage: StageBuild,
  camera: THREE.PerspectiveCamera,
  boxes: PixelBox[],
  frameW: number,
  frameH: number
): void {
  if (boxes.length === 0) return;
  const h0 = boxes[0].h;
  const m = camera.matrixWorld;
  const right = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const origin = stage.root.getWorldPosition(new THREE.Vector3());

  // Referans düzlemin kamera-uzayı koordinatları: derinlik telafisi bunları ister.
  const rel = origin.clone().sub(camera.position);
  const X0 = right.dot(rel);
  const Y0 = up.dot(rel);
  const Z0 = fwd.dot(rel);

  const v = new THREE.Vector3();
  const px = (p: THREE.Vector3): { x: number; y: number } => {
    v.copy(p).project(camera);
    return { x: (v.x * 0.5 + 0.5) * frameW, y: (0.5 - v.y * 0.5) * frameH };
  };
  const s0 = px(origin);
  const sR = px(origin.clone().add(right));
  const sU = px(origin.clone().add(up));
  const ppuX = sR.x - s0.x; // piksel / dünya birimi, kamera sağı
  const ppuY = s0.y - sU.y; // ekran y aşağı, kamera yukarısı ters işaretli

  const q = stage.root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const w = new THREE.Vector3();
  const usable =
    isFinite(ppuX) && isFinite(ppuY) && Math.abs(ppuX) > 1e-6 && Math.abs(ppuY) > 1e-6 && Z0 > 1e-3;

  // Referans telefonun yaklaşık ekran eni (BODY_W/BODY_H oranından) —
  // toe-in ölçüsü buna göre normalize edilir.
  const refW = Math.max(1, h0 * (BODY_W / BODY_H));

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const s = i === 0 || !(h0 > 0) ? 1 : b.h / h0;
    const rz = -(b.rotation ?? 0); // canvas'ta + = saat yönü, three'de tersi
    // Sağa düşen telefon SOLA döner (merkeze bakar) → ry negatif.
    const ry = -THREE.MathUtils.clamp((b.cx - boxes[0].cx) / refW, -1.5, 1.5) * TOE_IN;
    if (i === 0 || !usable) {
      stage.placeInstance(i, { x: 0, y: 0, z: 0, s, ry, rz });
      continue;
    }
    // Düzlem-içi hedef (derinlik olmasaydı olması gereken yer).
    const u = (b.cx - boxes[0].cx) / ppuX;
    const t = (boxes[0].cy - b.cy) / ppuY;
    // Derinlik telafisi: Zv = Z0+dz'de aynı pikseli görmek için
    //   Xv' = (X0+u)·f   (f = Zv/Z0)  →  u' = u·f + X0·(f−1)
    // ve görünen boy 1/f küçüldüğü için ölçek f ile çarpılır. Sonuç: kadraj
    // birebir aynı, yalnız telefon derinlikte ayrışır.
    const dz = DEPTH_STEP * i;
    const f = (Z0 + dz) / Z0;
    w.copy(right)
      .multiplyScalar(u * f + X0 * (f - 1))
      .addScaledVector(up, t * f + Y0 * (f - 1))
      .addScaledVector(fwd, dz)
      .applyQuaternion(q);
    stage.placeInstance(i, { x: w.x, y: w.y, z: w.z, s: s * f, ry, rz });
  }
  stage.refreshFloor();
}

/** Layout kutularından instance listesi — konumlar placeByPixels'e bırakılır
 *  (kamera kurulmadan piksel→dünya oranı bilinemez), ölçek ve roll ise ŞİMDİDEN
 *  yazılır: fitFov referans telefonu SON hâliyle ölçsün. */
export function instancesFromBoxes(boxes: PixelBox[]): Instance[] {
  const h0 = boxes[0]?.h ?? 0;
  return boxes.map((b, i) => ({
    x: 0,
    y: 0,
    z: 0,
    ry: 0,
    s: i === 0 || !(h0 > 0) ? 1 : b.h / h0,
    rz: -(b.rotation ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// POST — ortak sahne hedefi (sceneRT) + DoF + bloom + anamorfik streak
// ---------------------------------------------------------------------------
// R8/W1. Eskiden bloom sahneyi İKİNCİ kez çiziyordu (renderBloom içinde ayrı,
// düşük çözünürlüklü tam bir sahne render'ı). Artık sahne TEK kez ortak bir
// `sceneRT`'ye çizilir; DoF ve bloom/streak aynı dokuyu okur.
//
// Kritik ayrıntı: three, render-target'a çizerken tone mapping ve çıkış renk
// uzayı dönüşümünü ATLAR (WebGLPrograms: `currentRenderTarget === null ||
// currentRenderTarget.isXRRenderTarget === true`). Bu yüzden sceneRT
// `isXRRenderTarget = true` ile işaretlenir ve dokusunun renk uzayı sRGB
// yapılır: three tuvale çizermiş gibi ACES + sRGB uygular, `toneMapped:false`
// materyaller (ekran görüntüsü, ada, sheen) yine muaf kalır. Sonuç: sceneRT
// içeriği TUVALİN BİREBİR AYNISI olur; nihai geçiş renk matematiği yapmadan
// kopyalar → renk regresyonu yok, ekran görüntüsü ACES yemez.
//
// Alfa: three'nin NormalBlending'i (SRC_ALPHA, ONE_MINUS_SRC_ALPHA / ONE,
// ONE_MINUS_SRC_ALPHA) temizlenmiş (0,0,0,0) tampon üzerinde ÖN-ÇARPILMIŞ
// RGBA üretir — DoF toplayıcısı doğrudan RGBA üzerinde çalışır, klasik
// "bokeh kenarında siyah halka" sorunu bizde doğmaz.
//
// postprocessing/EffectComposer neden değil: bu render ŞEFFAF bir katman
// üretmek zorunda (üstüne 2D metin, altına arka plan biniyor); composer son
// geçişte alfayı giriş rengine sabitliyor, siluet dışındaki parlama kayboluyor.

/** Glow zincirinin (bright/blur/streak) taban çözünürlüğü. */
const GLOW_RES = 640;

/** MSAA bütçesi — bu piksel sayısının üstünde sceneRT tek örnekli olur.
 *  (Tam çözünürlük export'ta 2640×5736 × 4 örnek ≈ 485MB VRAM demekti;
 *  SS=2 küçültme zaten piksel başına 4 geometri örneği veriyor.) */
const MSAA_PIXEL_BUDGET = 9e6;

/** Anamorfik streak tonu — soğuk mavi (sinema anamorfik flare'i). */
const STREAK_TINT = 0x6f9bff;

const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const COPY_FRAG = `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D( tSrc, vUv ); }`;

// sceneRT artık TUVAL ile aynı içerikte (ACES + sRGB uygulanmış). Eşik yine
// LİNEER ışıkta uygulanır: sRGB'den geri çözülür → eski bright-pass ile aynı
// sayıları görür (eskiden: aces(lineer sahne); şimdi: toLinear(sRGB(aces(...)))
// = aynı değer). Fark yalnızca `toneMapped:false` katmanlarda: onlar artık
// GERÇEK parlaklıklarıyla katkı veriyor (eskiden gereksizce ACES yiyorlardı).
const BRIGHT_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uBox;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 toLinear( vec3 c ) {
  return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, step( c, vec3( 0.04045 ) ) );
}
void main() {
  // 4 çapraz bilineer örnek = kutu küçültme; ince parlak metal raylarda
  // (kaynak tam çözünürlük → hedef 640) örnekleme kırpışmasını kırar.
  vec4 c = texture2D( tSrc, vUv + vec2( -uBox.x, -uBox.y ) );
  c += texture2D( tSrc, vUv + vec2( uBox.x, -uBox.y ) );
  c += texture2D( tSrc, vUv + vec2( -uBox.x, uBox.y ) );
  c += texture2D( tSrc, vUv + vec2( uBox.x, uBox.y ) );
  c *= 0.25;
  vec3 t = toLinear( clamp( c.rgb, 0.0, 1.0 ) );
  float l = dot( t, vec3( 0.2126, 0.7152, 0.0722 ) );
  float k = smoothstep( uThreshold, uThreshold + uKnee, l );
  gl_FragColor = vec4( t * k * c.a, c.a * k );
}`;

/** YALNIZ yatay gauss — anamorfik streak (C2). Sabit tap, deterministik. */
function streakFrag(taps: number, sigma: number): string {
  const half = (taps - 1) / 2;
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w.push(v);
    sum += i === 0 ? v : 2 * v;
  }
  const lines = [`  vec4 s = texture2D( tSrc, vUv ) * ${(w[0] / sum).toFixed(6)};`];
  for (let i = 1; i <= half; i++) {
    lines.push(
      `  s += ( texture2D( tSrc, vUv + uDir * ${i}.0 ) + texture2D( tSrc, vUv - uDir * ${i}.0 ) ) * ${(
        w[i] / sum
      ).toFixed(6)};`
    );
  }
  return `uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
${lines.join("\n")}
  gl_FragColor = s;
}`;
}

const STREAK_TAPS = 21;
const STREAK_FRAG = streakFrag(STREAK_TAPS, 6.2);

/**
 * Premultiplied CoC-gather DoF (A1). Altıgen diyafram, altın-açı dağılımı,
 * SABİT tap sayısı → deterministik.
 *   • CoC işaretlidir: + = odak DÜZLEMİNİN ARKASI, − = önü.
 *   • Toplama yarıçapı max(|merkez CoC|, uMinRad); uMinRad JS tarafında
 *     "sahnedeki en yakın cihazın CoC'si" olarak verilir → odak arkadayken
 *     ön plan gerçekten yayılır, odak öndeyken örnekleme yoğunluğu boşa
 *     harcanmaz.
 *   • Voxagon kuralı: merkezden DAHA UZAKTAKİ örneğin yarıçapı merkezin
 *     CoC'siyle sınırlanır → bulanık arka plan, keskin ön planın üstüne akmaz.
 *   • Hiç geometri olmayan piksel (derinlik = 1) CoC 0 sayılır: gölge ve
 *     yansıma katmanları (depthWrite:false) olduğu gibi keskin kalır, yani
 *     DoF açıkken gölge görünümü DEĞİŞMEZ.
 */
function dofFrag(taps: number): string {
  const GA = Math.PI * (3 - Math.sqrt(5));
  const HEX = Math.cos(Math.PI / 6);
  const lines: string[] = [];
  for (let i = 0; i < taps; i++) {
    const r = taps > 1 ? Math.sqrt(i / (taps - 1)) : 0;
    const a = i * GA;
    const m = a % (Math.PI / 3);
    const hex = HEX / Math.cos(m - Math.PI / 6); // birim daireyi altıgene ger
    const rr = r * hex;
    lines.push(`  tap( vec2( ${(Math.cos(a) * rr).toFixed(5)}, ${(Math.sin(a) * rr).toFixed(5)} ) );`);
  }
  return `uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uK;
uniform float uMax;
uniform float uMinRad;
varying vec2 vUv;

vec4 acc;
float wsum;
float cCoc;
float rad;

float vdist( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  if ( d >= 0.999999 ) return -1.0;
  return ( uNear * uFar ) / ( uFar - ( uFar - uNear ) * d );
}

float cocOf( float z ) {
  if ( z <= 0.0 ) return 0.0;
  return clamp( uK * ( 1.0 / uFocus - 1.0 / z ), -uMax, uMax );
}

void tap( vec2 dir ) {
  vec2 o = dir * rad;
  float r = length( o );
  vec2 uv = vUv + o * uTexel;
  float sc = cocOf( vdist( uv ) );
  float lim = sc > cCoc ? min( abs( sc ), abs( cCoc ) + 1.0 ) : abs( sc );
  float w = clamp( lim - r + 1.0, 0.0, 1.0 );
  acc += texture2D( tSrc, uv ) * w;
  wsum += w;
}

void main() {
  cCoc = cocOf( vdist( vUv ) );
  rad = max( abs( cCoc ), uMinRad );
  acc = vec4( 0.0 );
  wsum = 0.0;
${lines.join("\n")}
  gl_FragColor = acc / max( wsum, 1e-4 );
}`;
}

type Unit = { mat: THREE.ShaderMaterial; scene: THREE.Scene };

type PostKit = {
  /** Ortak sahne hedefi — tuvalle aynı içerik (ACES + sRGB, ön-çarpılmış). */
  sceneRT: THREE.WebGLRenderTarget | null;
  w: number;
  h: number;
  samples: number;
  hasDepth: boolean;
  // Glow zinciri (sabit GLOW_RES tabanı).
  bright: THREE.WebGLRenderTarget;
  blur: THREE.WebGLRenderTarget;
  streakA: THREE.WebGLRenderTarget;
  streakB: THREE.WebGLRenderTarget;
  pass: BlurPass;
  gw: number;
  gh: number;
  geo: THREE.PlaneGeometry;
  cam: THREE.Camera;
  copy: Unit;
  brightU: Unit;
  streakU: Unit;
  dof: Map<number, Unit>;
  bloomQuad: { mat: THREE.MeshBasicMaterial; scene: THREE.Scene };
  streakQuad: { mat: THREE.MeshBasicMaterial; scene: THREE.Scene };
};

const _post = new WeakMap<THREE.WebGLRenderer, PostKit>();

function quadScene(geo: THREE.PlaneGeometry, mat: THREE.Material): THREE.Scene {
  const s = new THREE.Scene();
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  s.add(m);
  return s;
}

function shaderUnit(geo: THREE.PlaneGeometry, frag: string, uniforms: Record<string, { value: unknown }>): Unit {
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms as { [k: string]: THREE.IUniform },
    vertexShader: POST_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  return { mat, scene: quadScene(geo, mat) };
}

/** Ön-çarpılmış additive quad: rgb VE alfa doğrudan toplanır (One/One) —
 *  parlama siluetin dışında da alfa kazanır, şeffaf katmanda arka plana
 *  gerçekten ışık döker. */
function additiveQuad(geo: THREE.PlaneGeometry, map: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  return { mat, scene: quadScene(geo, mat) };
}

function postKit(renderer: THREE.WebGLRenderer): PostKit {
  const hit = _post.get(renderer);
  const [gw, gh] = fitRes(renderer, GLOW_RES);
  if (hit) {
    if (hit.gw !== gw || hit.gh !== gh) {
      hit.bright.setSize(gw, gh);
      hit.blur.setSize(gw, gh);
      hit.streakA.setSize(gw, gh);
      hit.streakB.setSize(gw, gh);
      tuneBlur(hit.pass, gw, gh);
      hit.gw = gw;
      hit.gh = gh;
    }
    return hit;
  }
  const opt = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false,
    depthBuffer: false,
  } as const;
  const bright = new THREE.WebGLRenderTarget(gw, gh, opt);
  const blur = new THREE.WebGLRenderTarget(gw, gh, opt);
  const streakA = new THREE.WebGLRenderTarget(gw, gh, opt);
  const streakB = new THREE.WebGLRenderTarget(gw, gh, opt);
  const pass = new BlurPass({ gl: renderer, resolution: Math.max(gw, gh), width: gw, height: gh });
  const geo = new THREE.PlaneGeometry(2, 2);

  const kit: PostKit = {
    sceneRT: null,
    w: 0,
    h: 0,
    samples: -1,
    hasDepth: false,
    bright,
    blur,
    streakA,
    streakB,
    pass,
    gw,
    gh,
    geo,
    cam: new THREE.Camera(),
    copy: shaderUnit(geo, COPY_FRAG, { tSrc: { value: null } }),
    brightU: shaderUnit(geo, BRIGHT_FRAG, {
      tSrc: { value: null },
      uBox: { value: new THREE.Vector2() },
      uThreshold: { value: 0.52 },
      uKnee: { value: 0.32 },
    }),
    streakU: shaderUnit(geo, STREAK_FRAG, {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2() },
    }),
    dof: new Map(),
    bloomQuad: additiveQuad(geo, blur.texture),
    streakQuad: additiveQuad(geo, streakB.texture),
  };
  _post.set(renderer, kit);
  return kit;
}

function dofUnit(kit: PostKit, taps: number): Unit {
  const hit = kit.dof.get(taps);
  if (hit) return hit;
  const u = shaderUnit(kit.geo, dofFrag(taps), {
    tSrc: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
    uFocus: { value: 9 },
    uK: { value: 0 },
    uMax: { value: 0 },
    uMinRad: { value: 0 },
  });
  kit.dof.set(taps, u);
  return u;
}

/** sceneRT'yi güncel çizim tamponu boyutuna/derinlik ihtiyacına göre hazırlar. */
function ensureSceneRT(kit: PostKit, w: number, h: number, needDepth: boolean): THREE.WebGLRenderTarget {
  const samples = w * h <= MSAA_PIXEL_BUDGET ? 4 : 0;
  const rebuild =
    !kit.sceneRT || kit.samples !== samples || (needDepth && !kit.hasDepth);
  if (rebuild) {
    kit.sceneRT?.dispose();
    kit.sceneRT?.depthTexture?.dispose();
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
    // Tone mapping + sRGB'yi three'ye YAPTIRMAK için (yukarıdaki nota bak).
    (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.generateMipmaps = false;
    if (needDepth || kit.hasDepth) {
      // DepthFormat + UnsignedInt → hem tek örnekli hem MSAA çözümlemesinde
      // DEPTH_COMPONENT24; blit formatları eşleşir.
      const dt = new THREE.DepthTexture(w, h);
      dt.minFilter = THREE.NearestFilter;
      dt.magFilter = THREE.NearestFilter;
      dt.generateMipmaps = false;
      rt.depthTexture = dt;
      kit.hasDepth = true;
    }
    kit.sceneRT = rt;
    kit.samples = samples;
    kit.w = w;
    kit.h = h;
  } else if (kit.w !== w || kit.h !== h) {
    kit.sceneRT!.setSize(w, h);
    kit.w = w;
    kit.h = h;
  }
  return kit.sceneRT as THREE.WebGLRenderTarget;
}

/** DoF geçişi parametreleri — resolveDofParams üretir, renderScene tüketir. */
export type DofParams = {
  /** Odak mesafesi (görüş uzayı, pozitif). */
  focus: number;
  /** Diyafram × piksel odak uzaklığı — CoC ölçeği. */
  k: number;
  /** Maksimum CoC (render pikseli). */
  maxPx: number;
  /** Ön plan taraması için taban yarıçap (render pikseli). */
  minRad: number;
  /** Tap sayısı — 39 (offline) | 13 (canlı). */
  taps: number;
};

export type PostParams = {
  dof: DofParams | null;
  bloom: number;
  streak: number;
};

/**
 * Sahneyi çizer ve post zincirini uygular; sonuç TUVALDEDİR.
 * Hiçbir efekt aktif değilse doğrudan tuvale çizer — eski yolla bit-bit aynı.
 */
export function renderScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  post: PostParams
): void {
  const dof = post.dof;
  const bloom = post.bloom > 0 ? post.bloom : 0;
  const streak = post.streak > 0 ? post.streak : 0;
  if (!dof && bloom === 0 && streak === 0) {
    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    return;
  }

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.round(size.x));
  const h = Math.max(1, Math.round(size.y));
  const kit = postKit(renderer);
  const rt = ensureSceneRT(kit, w, h, !!dof);
  const prevAuto = renderer.autoClear;

  // --- 1) Sahne → sceneRT (TEK sahne render'ı).
  renderer.setRenderTarget(rt);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  // --- 2) sceneRT → tuval (DoF ya da düz kopya; NoBlending).
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  if (dof) {
    const u = dofUnit(kit, dof.taps);
    const uni = u.mat.uniforms;
    uni.tSrc.value = rt.texture;
    uni.tDepth.value = rt.depthTexture;
    (uni.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    uni.uNear.value = camera.near;
    uni.uFar.value = camera.far;
    uni.uFocus.value = dof.focus;
    uni.uK.value = dof.k;
    uni.uMax.value = dof.maxPx;
    uni.uMinRad.value = dof.minRad;
    renderer.render(u.scene, kit.cam);
  } else {
    kit.copy.mat.uniforms.tSrc.value = rt.texture;
    renderer.render(kit.copy.scene, kit.cam);
  }

  // --- 3) Glow: bright-pass (ortak sceneRT'den) → bloom bulanıklığı + streak.
  if (bloom > 0 || streak > 0) {
    const bu = kit.brightU.mat.uniforms;
    bu.tSrc.value = rt.texture;
    // Kutu küçültmenin çeyrek adımı — kaynak/hedef oranına göre.
    (bu.uBox.value as THREE.Vector2).set(0.25 / kit.gw, 0.25 / kit.gh);
    renderer.setRenderTarget(kit.bright);
    renderer.clear(true, true, true);
    renderer.render(kit.brightU.scene, kit.cam);

    // Streak de bulanık hedefi kaynak alır: yatay geçişten ÖNCE izotropik
    // yumuşatma, çizgilerin dikeyde "tarama satırı" gibi durmasını engeller.
    kit.pass.render(renderer, kit.bright, kit.blur);

    if (streak > 0) {
      const su = kit.streakU.mat.uniforms;
      su.tSrc.value = kit.blur.texture;
      // İki geçiş: ince (kenar tanımı) + geniş (uzun anamorfik kuyruk).
      (su.uDir.value as THREE.Vector2).set(3.0 / kit.gw, 0);
      renderer.setRenderTarget(kit.streakA);
      renderer.clear(true, true, true);
      renderer.render(kit.streakU.scene, kit.cam);
      su.tSrc.value = kit.streakA.texture;
      (su.uDir.value as THREE.Vector2).set(15.0 / kit.gw, 0);
      renderer.setRenderTarget(kit.streakB);
      renderer.clear(true, true, true);
      renderer.render(kit.streakU.scene, kit.cam);
    }

    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    if (bloom > 0) {
      kit.bloomQuad.mat.color.setScalar(bloom);
      kit.bloomQuad.mat.opacity = bloom;
      renderer.render(kit.bloomQuad.scene, kit.cam);
    }
    if (streak > 0) {
      kit.streakQuad.mat.color.setHex(STREAK_TINT).multiplyScalar(streak);
      kit.streakQuad.mat.opacity = streak * 0.5;
      renderer.render(kit.streakQuad.scene, kit.cam);
    }
  }

  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(null);
}

// --- DoF parametre çözümü ---------------------------------------------------
// Sözleşme (DeviceStyle3D.dof):
//   focus  0..1 — cihaz kutusunun DERİNLİĞİ boyunca odak düzlemi
//                 (0 = kutunun kameraya en yakın yüzü, 1 = en uzak yüzü).
//                 VERİLMEZSE otomatik: EN ÖNDEKİ cihazın merkezi odakta.
//   amount 0..1 — diyafram açıklığı; 0 = kapalı.
//   maxPx       — maksimum bokeh yarıçapı, BASE px (1320×2868 tabanı, vars. 28).
//                 Yarıçap kare yüksekliğiyle ORANTILI ölçeklenir → canlı
//                 görünüm, önizleme ve export aynı göreli bulanıklığı verir.

/** amount = 1'de diyafram çapı (model birimi; cihaz genişliği = 1). */
const DOF_APERTURE = 0.26;
/** Varsayılan maksimum bokeh yarıçapı — BASE px (1320×2868 tabanı). */
const DOF_MAX_PX = 28;
/** maxPx'in tanımlandığı referans kare yüksekliği (types.BASE_H).
 *  Yarıçap her zaman kare yüksekliğiyle ORANTILI ölçeklenir: canlı görünüm,
 *  önizleme ve export aynı slaytta AYNI göreli bulanıklığı verir. */
const DOF_REF_H = 2868;

export function resolveDofParams(opts: {
  style: DeviceStyle3D;
  camera: THREE.PerspectiveCamera;
  /** Cihazların dünya-uzayı kutusu. */
  deviceBox: THREE.Box3;
  /** Cihaz merkezlerinin dünya-uzayı konumları (otomatik odak için). */
  centers: THREE.Vector3[];
  /** Render yüksekliği (piksel) — hem odak uzaklığı hem maxPx bununla ölçeklenir. */
  frameH: number;
  taps: number;
}): DofParams | null {
  const d = opts.style.dof;
  if (!d) return null;
  const amount = THREE.MathUtils.clamp(d.amount ?? 0.6, 0, 1);
  if (amount < 0.02) return null;
  const cam = opts.camera;
  const inv = cam.matrixWorldInverse;
  const v = new THREE.Vector3();
  const viewDist = (p: THREE.Vector3): number => -v.copy(p).applyMatrix4(inv).z;

  let near = Infinity;
  let far = -Infinity;
  for (const c of boxCorners(opts.deviceBox)) {
    const z = viewDist(c);
    if (z < near) near = z;
    if (z > far) far = z;
  }
  if (!isFinite(near) || !isFinite(far) || near <= 0) return null;

  let focus: number;
  if (d.focus === undefined) {
    focus = Infinity;
    for (const c of opts.centers) focus = Math.min(focus, viewDist(c));
    if (!isFinite(focus) || focus <= 0) focus = (near + far) / 2;
  } else {
    focus = near + THREE.MathUtils.clamp(d.focus, 0, 1) * (far - near);
  }
  if (focus <= 1e-3) return null;

  const focalPx = (opts.frameH * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const k = amount * DOF_APERTURE * focalPx;
  const maxPx = Math.min(
    Math.max(1, (d.maxPx ?? DOF_MAX_PX) * (opts.frameH / DOF_REF_H)),
    opts.frameH * 0.05
  );
  const cocAt = (z: number): number =>
    THREE.MathUtils.clamp(k * (1 / focus - 1 / z), -maxPx, maxPx);
  const span = Math.max(Math.abs(cocAt(near)), Math.abs(cocAt(far)));
  if (span < 0.6) return null; // görünür bulanıklık yok → geçişi atla
  return { focus, k, maxPx, minRad: Math.abs(cocAt(near)), taps: opts.taps };
}

// ---------------------------------------------------------------------------
// Kadrajlama
// ---------------------------------------------------------------------------

/** Cihazın ekran-uzayı yüksekliği targetPx'e otursun diye fov'u iteratif çözer. */
export function fitFov(
  camera: THREE.PerspectiveCamera,
  corners: THREE.Vector3[],
  targetPx: number,
  frameH: number
): void {
  const v = new THREE.Vector3();
  let fov = 30;
  for (let i = 0; i < 6; i++) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      v.copy(c).project(camera);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const px = ((maxY - minY) / 2) * frameH;
    if (!isFinite(px) || px <= 0) break;
    // fov büyürse nesne küçülür → tan(fov/2) ölçülen/hedef oranıyla çarpılır.
    const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (px / targetPx);
    const next = THREE.MathUtils.radToDeg(Math.atan(t) * 2);
    if (!isFinite(next)) break;
    const clamped = THREE.MathUtils.clamp(next, 3, 100);
    if (Math.abs(clamped - fov) < 0.005) {
      fov = clamped;
      break;
    }
    fov = clamped;
  }
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
    );
  }
  return out;
}

/** Kamerayı orbit'e göre konumlar ve hedefe bakar. */
export function placeCamera(camera: THREE.PerspectiveCamera, orbit: Orbit): void {
  const target = new THREE.Vector3(0, orbit.targetY ?? 0, 0);
  const cp = Math.cos(orbit.phi);
  const dir = new THREE.Vector3(
    Math.sin(orbit.theta) * cp,
    Math.sin(orbit.phi),
    Math.cos(orbit.theta) * cp
  );
  const dist = orbit.distance > 0 ? orbit.distance : 9;
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
}

/** near/far'ı sahne küresine sıkıştırır — ince ön yüz katmanlarında z-fighting olmasın.
 *  Yansıma açıkken sahne küresi 40 birimlik zemin düzlemini de kapsar; near
 *  dc*0.08'in ALTINA inmez, yoksa derinlik hassasiyeti ekran/ada/sheen
 *  katmanlarının 0.0006 birimlik aralığının altına düşerdi. Zemin yokken
 *  (dc≈13, r≈1.6) taban formül zaten çok daha büyük çıkar → davranış aynı. */
export function fitNearFar(camera: THREE.PerspectiveCamera, sphere: THREE.Sphere): void {
  const dc = camera.position.distanceTo(sphere.center);
  camera.near = Math.max(0.02, dc * 0.08, dc - sphere.radius * 1.3);
  camera.far = dc + sphere.radius * 1.3 + 0.5;
}
