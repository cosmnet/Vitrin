// Canlı 3D cihaz görünümü — Stage için 60fps etkileşimli sahne.
// Kamera artık camera-controls (yomotsu) ile sürülüyor: sönümlü rotate,
// wheel = dolly (mesafe → perspektif karakteri; kadraj fov ile sabit kaldığı
// için boyut DEĞİŞMEZ) ve preset değişince ANİMASYONLU geçiş (rotateTo /
// dollyTo / moveTo, enableTransition = true). dpr ≤ 2, sekme gizliyken durur.
// Kullanıcı bırakıp kamera dinlenince ("rest") onOrbitCommit ile son Orbit
// bildirilir — store'a yazmak UI'ın işi.
//
// Sahne kurulumu ve cihaz seçimi scene3d ile ORTAK (engine/scene3dCore.ts):
// style.model "kontur" (açık tercih) → prosedürel silüet, "real"/style.glb → GLB.
// DİKKAT: camera-controls YALNIZCA burada import edilir; deterministik
// export yolu (scene3d.ts) ona hiç dokunmaz.

import CameraControls from "camera-controls";
import * as THREE from "three";
import { sourceFingerprint } from "./assets";
import { loadImage } from "./assets";
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
  presetOf,
  buildDeviceSource,
  renderScene,
  resolveDofParams,
  resolveOrbit,
  screenTexture,
  setupEnv,
  type Bin,
  type PixelBox,
  type Preset,
  type StageBuild,
} from "./scene3dCore";
import type { CameraPresetId, DeviceStyle3D, Orbit } from "./types";

/** Cihaz kutusu, slayt ORANI cinsinden (0..1). `rotation` radyan. */
export type BoxRatio = { cx: number; cy: number; scale: number; rotation?: number };

export type LiveView = {
  setSlide(p: {
    screenshot: string | null;
    /**
     * ÇOKLU EKRAN (R10/E): i. cihazın kendi görseli. Verilmezse hepsi
     * `screenshot`'ı paylaşır. Eksik girdiler sırayla bir öncekine düşer.
     */
    screenshots?: (string | null)[];
    style: DeviceStyle3D;
    boxRatio: { cx: number; cy: number; scale: number };
    /**
     * ÇOKLU CİHAZ (R10/E): layout kutuları. İlk eleman `boxRatio` ile aynı
     * olmalı. Verilmezse (ya da tek elemanlıysa) tek cihazlı yol — Stage'in
     * bugünkü çağrısı olduğu gibi çalışmaya devam eder.
     */
    boxes?: BoxRatio[];
  }): void;
  setSize(w: number, h: number): void;
  onOrbitCommit(cb: (orbit: Orbit) => void): void;
  /**
   * TUVAL DIŞINDAN orbit — fare ORTA TUŞU ile döndürme için.
   *
   * Canlı katman yalnız "orbit" aracındayken tıklama alır (pointer-events),
   * yani orta tuşla başlayan bir sürüklemeyi CameraControls hiç görmez.
   * Stage jesti kendisi dinleyip deltayı buraya geçirir; commit yolu
   * (controlstart/controlend → rest → onOrbitCommit) aynen korunur, böylece
   * export ve küçük resimler yine aynı açıyı basar.
   *
   * dTheta/dPhi RADYANDIR. `begin`/`end` jestin sınırlarını bildirir.
   */
  orbitBy(dTheta: number, dPhi: number, phase?: "begin" | "move" | "end"): void;
  dispose(): void;
};

// renderSlide box.h'yi 1.12 ile telafi eder (render.ts) — canlı görünüm statik
// render ile birebir örtüşsün diye aynı çarpan burada da uygulanır.
const FIT_COMP = 1.12;

/** Canlı DoF tap sayısı — 60fps için ucuz varyant (A3). */
const LIVE_DOF_TAPS = 13;

const PHI_MAX = 1.32;
const DIST_MIN = 3.5;
const DIST_MAX = 24;
const HALF_PI = Math.PI / 2;

// camera-controls'un ihtiyaç duyduğu THREE alt kümesi (tree-shaking dostu).
let _installed = false;
function installControls(): void {
  if (_installed) return;
  CameraControls.install({
    THREE: {
      Vector2: THREE.Vector2,
      Vector3: THREE.Vector3,
      Vector4: THREE.Vector4,
      Quaternion: THREE.Quaternion,
      Matrix4: THREE.Matrix4,
      Spherical: THREE.Spherical,
      Box3: THREE.Box3,
      Sphere: THREE.Sphere,
      Raycaster: THREE.Raycaster,
    },
  });
  _installed = true;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Orbit sözleşmesi ↔ camera-controls küresel açıları.
 *  theta = azimuthAngle, phi = π/2 − polarAngle. */
function polarOf(phi: number): number {
  return THREE.MathUtils.clamp(HALF_PI - phi, HALF_PI - PHI_MAX, HALF_PI + PHI_MAX);
}

export function createLiveDeviceView(container: HTMLElement): LiveView {
  installControls();

  // --- Renderer: canlı görünüm kendi context'ini kurar (offline singleton'dan bağımsız).
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
  } catch {
    renderer = null;
  }

  const canvas = renderer?.domElement ?? null;
  if (canvas) {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    container.appendChild(canvas);
  }

  const envTex = renderer ? makeEnvTexture(renderer) : null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  // --- Kamera kontrolü: sönümlü orbit + animasyonlu preset geçişleri.
  const controls = canvas ? new CameraControls(camera, canvas) : null;
  if (controls) {
    controls.minDistance = DIST_MIN;
    controls.maxDistance = DIST_MAX;
    controls.minPolarAngle = HALF_PI - PHI_MAX;
    controls.maxPolarAngle = HALF_PI + PHI_MAX;
    // Sürüklerken çevik, bırakınca uzun ve yumuşak oturuş (spline hissi).
    controls.draggingSmoothTime = 0.09;
    controls.smoothTime = 0.42;
    controls.azimuthRotateSpeed = 0.62;
    controls.polarRotateSpeed = 0.62;
    controls.dollySpeed = 0.55;
    controls.restThreshold = 0.0025;
    // Hedef HEP cihaz ekseninde kalsın: pan/truck yok, yoksa kadraj kayar.
    controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
    controls.mouseButtons.right = CameraControls.ACTION.NONE;
    controls.mouseButtons.middle = CameraControls.ACTION.NONE;
    controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
    controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY;
    controls.touches.three = CameraControls.ACTION.NONE;
  }

  // --- Durum.
  let disposed = false;
  let raf = 0;
  let lastT = 0;
  let dirty = true; // bir şey değişti → render gerekir
  let gen = 0; // async kurulum yarışlarına karşı jeton

  let size = {
    w: Math.max(1, container.clientWidth || 1),
    h: Math.max(1, container.clientHeight || 1),
  };
  let lastDpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  let boxRatio = { cx: 0.5, cy: 0.5, scale: 0.6 };
  /** Çoklu cihaz kutuları (oransal). Tek elemanlıysa eski tek-cihaz yolu. */
  let boxesRatio: BoxRatio[] = [];
  let preset: Preset = presetOf("front");
  let stage: StageBuild | null = null;
  let bin: Bin = newBin();
  let corners: THREE.Vector3[] = [];
  let sphere: THREE.Sphere | null = null;
  let styleKey = ""; // orbit hariç stil parmak izi — değişirse sahne yeniden kurulur
  let shotKey = "";
  let bloom = 0;
  let streak = 0;
  let devBox: THREE.Box3 | null = null;
  let liveStyle: DeviceStyle3D | null = null;
  let lastCamera: CameraPresetId | null = null;

  let snapNext = true; // ilk kurulumda animasyonsuz otur
  let dragging = false;
  let commitPending = false;
  let commitCb: ((orbit: Orbit) => void) | null = null;
  const targetV = new THREE.Vector3();

  function markDirty(): void {
    dirty = true;
  }

  /** Kontrolün güncel durumunu Orbit sözleşmesine çevirir. */
  function readOrbit(): Orbit {
    if (!controls) return { theta: 0, phi: 0.035, distance: 13, targetY: 0 };
    controls.getTarget(targetV);
    return {
      theta: controls.azimuthAngle,
      phi: HALF_PI - controls.polarAngle,
      distance: controls.distance,
      targetY: targetV.y,
    };
  }

  /** Store'dan gelen orbit'i uygular — ilk kurulumda anında, sonra ANİMASYONLU. */
  function applyOrbit(o: Orbit): void {
    if (!controls) return;
    const animate = !snapNext;
    const dist = THREE.MathUtils.clamp(o.distance > 0 ? o.distance : 9, DIST_MIN, DIST_MAX);
    void controls.rotateTo(o.theta, polarOf(o.phi), animate);
    void controls.dollyTo(dist, animate);
    void controls.moveTo(0, o.targetY ?? 0, 0, animate);
    snapNext = false;
    markDirty();
  }

  if (controls) {
    controls.addEventListener("controlstart", () => {
      dragging = true;
      if (canvas) canvas.style.cursor = "grabbing";
      markDirty();
    });
    controls.addEventListener("controlend", () => {
      dragging = false;
      commitPending = true;
      if (canvas) canvas.style.cursor = "grab";
      markDirty();
    });
    controls.addEventListener("control", markDirty);
    controls.addEventListener("update", markDirty);
    // Kamera dinlendi → son orbit'i store'a bildir (bir kez).
    controls.addEventListener("rest", () => {
      if (!commitPending) return;
      commitPending = false;
      if (!commitCb) return;
      const o = readOrbit();
      commitCb({
        theta: round4(o.theta),
        phi: round4(o.phi),
        distance: round4(o.distance),
        targetY: round4(o.targetY ?? 0),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Sahne kurulumu (async — screenshot + GLB yüklenir)
  // -------------------------------------------------------------------------

  /** Oransal kutuları güncel tuval pikseline çevirir (kadraj telafisi dahil). */
  function pixelBoxes(): PixelBox[] {
    const src = boxesRatio.length > 0 ? boxesRatio : [boxRatio as BoxRatio];
    // FIT_COMP yalnız TEK cihazda: çoklu düzende bağlayıcı kısıt düzenin
    // yatay bütçesi (oluk/bindirme), statik yol da aynısını yapıyor.
    const comp = src.length > 1 ? 1 : FIT_COMP;
    return src.map((b) => ({
      cx: b.cx * size.w,
      cy: b.cy * size.h,
      h: b.scale * size.h * comp * preset.fit,
      rotation: b.rotation,
    }));
  }

  async function rebuild(shots: (string | null)[], style: DeviceStyle3D): Promise<void> {
    if (!renderer) return;
    const myGen = ++gen;
    const nextBin = newBin();
    try {
      // Aynı yol iki kez yüklenmesin/iki doku olmasın — split'te üç kutu
      // çoğu zaman aynı görseli paylaşıyor.
      const memo = new Map<string, THREE.Texture | null>();
      const texes: (THREE.Texture | null)[] = [];
      for (const s of shots) {
        if (!s) {
          texes.push(null);
          continue;
        }
        const hit = memo.get(s);
        if (hit !== undefined) {
          texes.push(hit);
          continue;
        }
        const img = await loadImage(s);
        if (disposed || myGen !== gen) {
          disposeBin(nextBin);
          return;
        }
        const t = screenTexture(renderer, img);
        if (t) nextBin.texs.push(t);
        memo.set(s, t);
        texes.push(t);
      }
      const tex = texes[0] ?? null;
      // kontur (açık tercih) → null döner, assembleStage prosedürel modeli kurar;
      // "real"/glb → hazırlanmış GLB. styleKey model'i içerir → değişince rebuild.
      const source = await buildDeviceSource(style, tex, nextBin, texes[1]);
      if (disposed || myGen !== gen) {
        disposeBin(nextBin);
        return;
      }

      // Eski sahneyi boşalt, yenisini kur.
      scene.clear();
      disposeBin(bin);
      bin = nextBin;

      const rig = setupEnv(scene, renderer, envTex, style);
      bloom = rig.bloom;
      streak = rig.streak;
      liveStyle = style;
      const multi = boxesRatio.length > 1;
      stage = assembleStage({
        style,
        preset,
        source,
        screenTex: tex,
        rig,
        bin,
        // Çoklu kutu: konumlar her karede placeByPixels ile tazelenir; burada
        // yalnız ölçek/roll'ü olan bir iskelet kurulur.
        instances: multi ? instancesFromBoxes(pixelBoxes()) : undefined,
        screenTexes: texes,
      });
      scene.add(stage.root);
      scene.updateMatrixWorld(true);

      // Kadraj REFERANS telefona bakar (çoklu kutuda birleşim kutusu yanlış
      // ölçek verirdi); tek cihazda ikisi zaten aynı nesne.
      const fitOn = (multi && stage.phones[0]) || stage.deviceRoot;
      const fitB = new THREE.Box3().setFromObject(fitOn);
      corners = fitB.isEmpty() ? [] : boxCorners(fitB);
      const box = new THREE.Box3().setFromObject(stage.deviceRoot);
      devBox = box.isEmpty() ? null : box;
      const allBox = new THREE.Box3().setFromObject(stage.root);
      sphere = allBox.isEmpty() ? null : allBox.getBoundingSphere(new THREE.Sphere());
      markDirty();
    } catch {
      disposeBin(nextBin);
    }
  }

  // -------------------------------------------------------------------------
  // Kare döngüsü
  // -------------------------------------------------------------------------

  function step(now: number): void {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;

    // camera-controls sönümü — kendi "değişti mi" cevabını verir.
    if (controls && controls.update(dt)) dirty = true;

    if (!dirty || !renderer || !stage || corners.length === 0) return;
    dirty = false;

    const orbit = readOrbit();
    stage.updateShadow(orbit);
    if (sphere) fitNearFar(camera, sphere);

    const pb = pixelBoxes();
    const cx = pb[0].cx;
    const cy = pb[0].cy;
    camera.aspect = size.w / size.h;
    camera.setViewOffset(size.w, size.h, size.w / 2 - cx, size.h / 2 - cy, size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const targetPx = Math.max(1, pb[0].h);
    fitFov(camera, corners, targetPx, size.h);

    // Çoklu cihaz: kadraj oturduktan sonra kopyalar piksel kutularına konur.
    // Her karede yapılır — kutu oranları (layout, sürükleme nudge'ı) sahneyi
    // yeniden kurmadan değişebiliyor. Maliyeti birkaç vektör işlemi.
    let dofBox = devBox;
    if (pb.length > 1) {
      placeByPixels(stage, camera, pb, size.w, size.h);
      scene.updateMatrixWorld(true);
      fitNearFar(camera, stage.bounds()); // ucuz analitik küre (Box3 taraması değil)
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      if (liveStyle?.dof) dofBox = new THREE.Box3().setFromObject(stage.deviceRoot);
    }

    if (stage.updateReflection) {
      stage.updateReflection(renderer, scene, camera);
      renderer.setRenderTarget(null);
    }
    // Canlı yolda DoF UCUZ varyant (13 tap, A3) ve yalnız dof aktifken.
    const dof =
      liveStyle && liveStyle.dof && dofBox
        ? resolveDofParams({
            style: liveStyle,
            camera,
            deviceBox: dofBox,
            centers: stage.centers.map((c) => (stage as StageBuild).root.localToWorld(c.clone())),
            frameH: renderer.getDrawingBufferSize(new THREE.Vector2()).y,
            taps: LIVE_DOF_TAPS,
          })
        : null;
    renderScene(renderer, scene, camera, { dof, bloom, streak });
  }

  function loop(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    step(now);
  }

  function start(): void {
    if (disposed || raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // camera-controls TEKERLEK için "controlstart"/"controlend" YAYINLAMAZ
  // (scroll aralıklı geldiği için başlangıç/bitiş tespit edilemiyor — kütüphane
  // dokümanında yazıyor). Bu yüzden yalnız-tekerlek etkileşiminde commit hiç
  // tetiklenmezdi: mesafe store'a yazılmaz, export eski açıyla basılırdı.
  // Kendi (passive) dinleyicimizle commit bayrağını kaldırıyoruz; hareket
  // sönümlenip "rest" gelince orbit yazılır.
  const onWheelCommit = (): void => {
    commitPending = true;
    markDirty();
  };
  if (canvas) canvas.addEventListener("wheel", onWheelCommit, { passive: true });

  // Sekme gizlenince dur, görününce devam et.
  const onVisibility = (): void => {
    if (document.hidden) stop();
    else {
      markDirty();
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Konteyner boyutunu ayrıca izle — setSize çağrısıyla çakışması zararsız.
  let ro: ResizeObserver | null = null;
  try {
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) view.setSize(w, h);
    });
    ro.observe(container);
  } catch {
    ro = null;
  }

  // -------------------------------------------------------------------------
  // Genel API
  // -------------------------------------------------------------------------

  const view: LiveView = {
    setSlide(p): void {
      if (disposed) return;
      const style = p.style;
      preset = presetOf(style.camera);
      boxRatio = { ...p.boxRatio };
      boxesRatio = p.boxes && p.boxes.length > 0 ? p.boxes.map((b) => ({ ...b })) : [];

      // Ekran listesi: verilmezse tek görsel. Eksik girdiler bir öncekine
      // düşer — hiçbir telefon BOŞ ekranla kalmaz.
      const raw = p.screenshots ?? [p.screenshot];
      const shots: (string | null)[] = [];
      let last = p.screenshot ?? null;
      for (const s of raw) {
        last = s ?? last;
        shots.push(last);
      }
      if (shots.length === 0) shots.push(p.screenshot ?? null);

      // Orbit hariç stil parmak izi — sadece orbit değiştiyse sahneyi kurma.
      const { orbit: _omit, ...rest } = style;
      const nextStyleKey = JSON.stringify(rest);
      // Parmak izi TÜM ekranları kapsar: ikinci ekran değişince de sahne
      // yeniden kurulmalı (dokular kopya başına bağlanıyor). Kutu SAYISI da
      // girer — 1↔N geçişi instance iskeletini değiştirir.
      const nextShotKey = `${Math.max(1, boxesRatio.length)}|${shots
        .map((s) => sourceFingerprint(s ?? undefined) || "-")
        .join("~")}`;

      // Kullanıcı sürüklerken store'dan gelen orbit'i (çoğu kez kendi commit'imizin
      // yankısı) uygulama — kavga çıkmasın. AMA kamera PRESET'i değiştiyse bu
      // açık bir kullanıcı komutudur: her hâlükârda uygulanır (ve animasyonlu
      // geçer). Aksi hâlde takılı kalan bir sürükleme durumu preset'leri
      // tamamen etkisiz bırakabiliyor.
      const camChanged = style.camera !== lastCamera;
      lastCamera = style.camera;
      if (camChanged || (!dragging && !commitPending)) {
        if (camChanged) {
          dragging = false;
          commitPending = false;
        }
        applyOrbit(resolveOrbit(style, preset));
      }

      if (nextStyleKey !== styleKey || nextShotKey !== shotKey) {
        styleKey = nextStyleKey;
        shotKey = nextShotKey;
        void rebuild(shots, style);
      }
      markDirty();
    },

    setSize(w, h): void {
      if (disposed || !renderer) return;
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      if (nw === size.w && nh === size.h && dpr === lastDpr) return;
      size = { w: nw, h: nh };
      lastDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(nw, nh, false);
      markDirty();
    },

    onOrbitCommit(cb): void {
      commitCb = cb;
    },

    orbitBy(dTheta, dPhi, phase = "move"): void {
      if (disposed || !controls) return;
      if (phase === "begin") {
        dragging = true;
        markDirty();
        return;
      }
      if (phase === "end") {
        dragging = false;
        commitPending = true;
        markDirty();
        return;
      }
      // `rotate` göreli döndürmedir; animasyonsuz çağrılır ki jest fareyi
      // birebir takip etsin (animasyonlu hâli sürüklemede geride kalıyor).
      void controls.rotate(dTheta, dPhi, false);
      markDirty();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      gen++;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (canvas) canvas.removeEventListener("wheel", onWheelCommit);
      if (ro) ro.disconnect();
      if (controls) controls.dispose();
      scene.clear();
      disposeBin(bin);
      if (envTex) envTex.dispose();
      if (renderer) {
        renderer.dispose();
        try {
          renderer.forceContextLoss();
        } catch {
          /* boş */
        }
      }
      if (canvas && canvas.parentElement === container) container.removeChild(canvas);
    },
  };

  // İlk boyut + döngü.
  if (renderer) {
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
  }
  if (controls) {
    // Başlangıç: front preset'i, animasyonsuz.
    const o = presetOf("front").orbit;
    controls.setLookAt(
      Math.sin(o.theta) * Math.cos(o.phi) * o.distance,
      Math.sin(o.phi) * o.distance + (o.targetY ?? 0),
      Math.cos(o.theta) * Math.cos(o.phi) * o.distance,
      0,
      o.targetY ?? 0,
      0,
      false
    );
  }
  if (!document.hidden) start();

  return view;
}
