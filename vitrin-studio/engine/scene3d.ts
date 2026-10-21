// 3D cihaz render modülü — tek kare, deterministik export/önizleme render'ı.
// Varsayılan cihaz PROSEDÜREL "kontur" silüeti (temiz, butonsuz, tek parça);
// style.model === "real" ya da style.glb gerçek iPhone GLB'sine geçirir,
// GLB yüklenemezse yine kontur'a düşülür. Kalite: 2x süpersampling + downscale
// (draft'ta 1x), ACESFilmic, prosedürel stüdyo ortamı (PMREM), yumuşak contact
// shadow ve isteğe bağlı sahte yansıma (style.reflection; draft'ta kapalı).
// Sahne kurulumu scene3dLive ile PAYLAŞILIR — ortak kod scene3dCore.ts'te.

import * as THREE from "three";
import {
  assembleStage,
  boxCorners,
  disposeBin,
  fitFov,
  fitNearFar,
  instancesFromBoxes,
  makeEnvTexture,
  newBin,
  placeByPixels,
  placeCamera,
  presetOf,
  buildDeviceSource,
  renderScene,
  resolveDofParams,
  resolveOrbit,
  screenTexture,
  setupEnv,
  type PixelBox,
} from "./scene3dCore";
import type { CameraPresetId, DeviceStyle3D, Orbit } from "./types";

// ---------------------------------------------------------------------------
// Genel API
// ---------------------------------------------------------------------------

export type Device3DRequest = {
  screenshot: HTMLImageElement | null;
  /**
   * ÇOKLU EKRAN (R10/E): i. cihazın kendi ekran görüntüsü. Verilmezse tüm
   * kopyalar `screenshot`'ı paylaşır (eski davranış). Liste `screenshot`'tan
   * uzun olabilir — preset kopyaları (pair/fan3/stack3) da buradan beslenir,
   * yani "aynı karede farklı ekranlar" layout'suz da çalışır.
   */
  screenshots?: (HTMLImageElement | null)[];
  style: DeviceStyle3D;
  width: number; // dönen katmanın toplam boyutu (slayt boyutu)
  height: number;
  box: { cx: number; cy: number; h: number }; // cihazın slayt içindeki merkez + hedef piksel yüksekliği
  /**
   * LAYOUT TABANLI ÇOKLU CİHAZ (R10/E): slayt-piksel kutuları. İlk eleman
   * `box` ile aynı olmalı — kadraj ona göre kurulur, kalanlar ona göre
   * konumlanır. Tek elemanlı/boş liste tek cihazlı yoldan hiç ayrılmaz.
   */
  boxes?: PixelBox[];
  /** Canlı sürükleme hızlı yolu: süpersampling 1x, gölge basit, yansıma kapalı. */
  draft?: boolean;
};

/** Editörün "custom" moda geçerken başlangıç değeri olarak kullandığı orbit. */
export function presetOrbit(camera: CameraPresetId): Orbit {
  return { ...presetOf(camera).orbit };
}

// ---------------------------------------------------------------------------
// Singleton kaynaklar (lazy) — offline render tek paylaşımlı renderer kullanır.
// ---------------------------------------------------------------------------

let _renderer: THREE.WebGLRenderer | null = null;
let _envTex: THREE.Texture | null = null;

const SS = 2; // süpersampling çarpanı — 2x render + downscale = jaggysiz kenar
const MAX_BUFFER = 8192; // drawing-buffer üst sınırı (GPU limitiyle ayrıca kısılır)
/** Offline DoF tap sayısı — SABİT (deterministik). Canlı yol 13 kullanır. */
const DOF_TAPS = 39;

function getRenderer(): THREE.WebGLRenderer | null {
  if (_renderer) return _renderer;
  if (typeof document === "undefined") return null;
  try {
    const r = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      // Offscreen render + hemen drawImage yapıyoruz; buffer'ın korunması şart.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    r.setPixelRatio(1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x000000, 0);
    _renderer = r;
    return r;
  } catch {
    return null;
  }
}

function getEnvTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (_envTex) return _envTex;
  _envTex = makeEnvTexture(renderer);
  return _envTex;
}

// ---------------------------------------------------------------------------
// Ana render
// ---------------------------------------------------------------------------

function blankCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Export, gallery thumbnails and previews share one renderer. Hold it through
// asynchronous model loading, rendering and the final copy into the output.
let renderTail: Promise<void> = Promise.resolve();

export function renderDevice3D(req: Device3DRequest): Promise<HTMLCanvasElement> {
  const result = renderTail.then(() => renderDevice3DAt(req));
  renderTail = result.then(() => undefined, () => undefined);
  return result;
}

async function renderDevice3DAt(req: Device3DRequest): Promise<HTMLCanvasElement> {
  const W = Math.max(1, Math.round(req.width));
  const H = Math.max(1, Math.round(req.height));
  const out = blankCanvas(W, H);

  const renderer = getRenderer();
  if (!renderer) return out; // WebGL yoksa şeffaf katman döner, slayt yine çizilir

  // Draft modu (canlı sürükleme): süpersampling 1x, sahte yansıma kapalı —
  // gölge zaten tek blob plane olduğu için olduğu gibi kalır (ucuz).
  const draft = req.draft === true;
  const style: DeviceStyle3D =
    draft && req.style.reflection ? { ...req.style, reflection: false } : req.style;

  const preset = presetOf(style.camera);
  const orbit = resolveOrbit(style, preset);

  // 2x süpersampling (draft'ta 1x) — GPU'nun izin verdiği buffer sınırına kadar.
  const cap = Math.min(MAX_BUFFER, renderer.capabilities.maxTextureSize || 4096);
  const rs = Math.max(0.25, Math.min(draft ? 1 : SS, cap / Math.max(W, H)));
  const rw = Math.max(1, Math.round(W * rs));
  const rh = Math.max(1, Math.round(H * rs));
  // Kadraj REFERANS kutuya göre kurulur; çoklu cihazda o, kutu listesinin
  // ilkidir (çağıran orada perspektif telafisi uygulamaz — bkz. render.ts).
  const refBox = req.boxes && req.boxes.length > 1 ? req.boxes[0] : req.box;
  const cx = refBox.cx * rs;
  const cy = refBox.cy * rs;
  const targetPx = Math.max(1, refBox.h * rs * preset.fit);

  const bin = newBin();
  const scene = new THREE.Scene();
  let camera: THREE.PerspectiveCamera | null = null;

  try {
    // Ölçüler renderer'a önce yazılır: yansıma/bloom hedefleri çizim tamponunun
    // ORANINA göre boyutlanır, oran render'dan önce doğru olmalı.
    renderer.setSize(rw, rh, false);

    const rig = setupEnv(scene, renderer, getEnvTexture(renderer), style);

    // Aynı HTMLImageElement iki kez doku olmasın (2 telefon = 1 doku olabilir).
    const texMemo = new Map<HTMLImageElement, THREE.Texture | null>();
    const texOf = (img: HTMLImageElement | null): THREE.Texture | null => {
      if (!img) return null;
      const hit = texMemo.get(img);
      if (hit !== undefined) return hit;
      const t = screenTexture(renderer, img);
      if (t) bin.texs.push(t);
      texMemo.set(img, t);
      return t;
    };
    // GLB'nin ekran düzlemi bu dokunun ORANINA göre kurulur; kopya başına
    // farklı olanlar retargetScreen ile ayrışır. Bu yüzden taban = ilk ekran.
    const tex = texOf(req.screenshots?.[0] ?? req.screenshot);

    // --- Cihaz kaynağı: kontur (açık tercih) → null/prosedürel; "real"/glb → GLB,
    // yüklenemezse yine kontur.
    const source = await buildDeviceSource(style, tex, bin, texOf(req.screenshots?.[1] ?? null));

    // --- Layout tabanlı çoklu cihaz: kutular RENDER pikseline ölçeklenir
    // (süpersampling çarpanı rs), instance listesi onlardan türetilir.
    const boxes: PixelBox[] | null =
      req.boxes && req.boxes.length > 1
        ? req.boxes.map((b) => ({
            cx: b.cx * rs,
            cy: b.cy * rs,
            h: b.h * rs * preset.fit,
            rotation: b.rotation,
          }))
        : null;

    // Kopya sayısı kadar doku — fazlası boşuna GPU yüklemesi olurdu.
    const nInst = boxes ? boxes.length : preset.instances.length;
    const screenTexes = req.screenshots?.slice(0, style.kind?.startsWith("foldable") ? Math.max(2, nInst) : nInst).map(texOf);

    // --- Sahne montajı: roll + kopyalar + gölge + isteğe bağlı yansıma.
    const stage = assembleStage({
      style,
      preset,
      source,
      screenTex: tex,
      rig,
      bin,
      instances: boxes ? instancesFromBoxes(boxes) : undefined,
      screenTexes,
    });
    stage.updateShadow(orbit);
    scene.add(stage.root);
    scene.updateMatrixWorld(true);

    // --- Kamera.
    let devBox = new THREE.Box3().setFromObject(stage.deviceRoot);
    if (devBox.isEmpty()) return out;

    // Kadraj REFERANS telefona göre kurulur. Layout modunda kopyalar henüz
    // üst üste duruyor (konumları kameradan türetilecek), ama ölçekleri
    // farklı olabilir — birleşim kutusu en büyüğü ölçer ve referansı küçültürdü.
    const fitBox = boxes && stage.phones[0]
      ? new THREE.Box3().setFromObject(stage.phones[0])
      : devBox;

    camera = new THREE.PerspectiveCamera(30, rw / rh, 0.1, 100);
    placeCamera(camera, orbit);

    const allBox = new THREE.Box3().setFromObject(stage.root);
    fitNearFar(camera, allBox.getBoundingSphere(new THREE.Sphere()));

    // Hedef noktayı (cx,cy) pikseline taşıyan off-center projeksiyon.
    camera.setViewOffset(rw, rh, rw / 2 - cx, rh / 2 - cy, rw, rh);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    fitFov(camera, boxCorners(fitBox.isEmpty() ? devBox : fitBox), targetPx, rh);

    // Kadraj oturdu → kopyaları piksel kutularına yerleştir. Telefonlar
    // dağıldığı için near/far ve DoF kutusu TAZELENİR; fov'a dokunulmaz
    // (referans telefon yerinden oynamadı, kadraj sabit).
    if (boxes) {
      placeByPixels(stage, camera, boxes, rw, rh);
      scene.updateMatrixWorld(true);
      const spread = new THREE.Box3().setFromObject(stage.root);
      if (!spread.isEmpty()) fitNearFar(camera, spread.getBoundingSphere(new THREE.Sphere()));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const db = new THREE.Box3().setFromObject(stage.deviceRoot);
      if (!db.isEmpty()) devBox = db;
    }

    // --- Tek kare render. Yansıma pass'i (varsa) TAM ÖNCE, sabit tek geçiş →
    // deterministik: aynı girdi = aynı piksel.
    renderer.setViewport(0, 0, rw, rh);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    if (stage.updateReflection) stage.updateReflection(renderer, scene, camera);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, rw, rh);
    // Post zinciri: sahne TEK kez ortak sceneRT'ye çizilir, DoF + bloom +
    // streak aynı dokudan beslenir. Hiçbiri aktif değilse doğrudan tuvale
    // çizilir (eski yolla bit-bit aynı). draft: post yok.
    renderScene(renderer, scene, camera, {
      dof: draft
        ? null
        : resolveDofParams({
            style,
            camera,
            deviceBox: devBox,
            centers: stage.centers.map((c) => stage.root.localToWorld(c.clone())),
            frameH: rh,
            taps: DOF_TAPS,
          }),
      bloom: draft ? 0 : rig.bloom,
      streak: draft ? 0 : rig.streak,
    });

    // Singleton buffer paylaşımlı → pikselleri hemen kendi 2d canvas'ımıza
    // kopyala; 2x → 1x downscale burada jaggyleri süpürür.
    const octx = out.getContext("2d");
    if (octx) {
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      octx.drawImage(renderer.domElement, 0, 0, rw, rh, 0, 0, W, H);
    }
  } catch {
    // Sessizce boş (şeffaf) katman — slayt render'ı kesilmesin.
  } finally {
    if (camera) camera.clearViewOffset();
    scene.clear();
    disposeBin(bin);
  }

  return out;
}
