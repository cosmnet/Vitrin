// Gerçek PSD mockup hattı — plates2 (v2, "overlay plate").
//
// scripts/extract_psd.py her mockup için iki şey üretir:
//   <ad>.png    saydam overlay — cihaz opak, EKRAN DELİĞİ SAYDAM, cam
//               yansıması yumuşak alfayla üstte (parlama %35'e kısılmış)
//   meta.json   {name, w, h, quad, quads?, mode:"overlay"}
//
// Kompozisyon sırası bu yüzden basit ve doğrudur:
//
//     1) screenshot ekran dörtgenine projektif basılır   (ALTTA)
//     2) overlay olduğu gibi üstüne çizilir              (ÜSTTE)
//
// Cihazın çerçevesi opak olduğundan dörtgenden taşan screenshot kendiliğinden
// kırpılır; ekranın yuvarlak köşeleri ve kavisli kenar gölgesi overlay'in
// alfasından gelir. v1'deki "plate + shot × gain" kurgusunda ekran maskesi
// ikili (0/255) olduğu için kenarda koyu boşluk kalıyor ve SCREEN modlu
// parlama tam güçle gömülü olduğu için ekranın üstünde beyaz leke duruyordu;
// ikisi de bu modelde yok.
//
// screenshot ekrana WebGL ile perspektif doğru basılır: tek quad, texcoord'lar
// köşegen kesişiminden gelen q ağırlıklarıyla homojenleştirilir (klasik
// projective quad mapping).

import { loadImage } from "./assets";

export type Quad = [number, number][]; // TL, TR, BR, BL

export type PlateMeta = {
  name: string;
  w: number;
  h: number;
  quad: Quad;
  quads?: Quad[];        // çoklu cihaz kompozisyonları (ör. 3'lü dizi)
  mode?: "overlay";      // v2 işareti — ileride başka mod eklenirse ayırt eder
  kind?: "icon";         // app-icon slotlu plate — ekran plate listelerinden gizlenir
  /** Slotun GERÇEK (perspektifsiz) en-boy oranı — cover-fit bununla yapılır;
   *  yoksa quad'ın görünür oranına düşülür (eski plate'ler). */
  aspect?: number;
};

export type PlateRender = {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** Birincil ekranın plate piksel uzayındaki merkezi ve yüksekliği. */
  screen: { cx: number; cy: number; h: number };
};

const DIR = "/assets/plates2";

// ---------------------------------------------------------------------------
// meta.json
// ---------------------------------------------------------------------------

let metaPromise: Promise<Record<string, PlateMeta>> | null = null;

/** plates2/meta.json'u bir kez indirir; ada göre haritalar. */
export function loadPlates(): Promise<Record<string, PlateMeta>> {
  if (!metaPromise) {
    metaPromise = fetch(`${DIR}/meta.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PlateMeta[]) => {
        const out: Record<string, PlateMeta> = {};
        for (const m of Array.isArray(list) ? list : []) out[m.name] = m;
        return out;
      })
      .catch(() => ({}));
  }
  return metaPromise;
}

/** UI listeleri için: kullanılabilir plate adları. Icon-slotlular ekran
 *  plate'i değildir; icon desteği gelene dek listelenmez. */
export async function listPlates(): Promise<PlateMeta[]> {
  const all = await loadPlates();
  return Object.values(all)
    .filter((m) => m.kind !== "icon")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Geometri
// ---------------------------------------------------------------------------

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** İki doğrunun (a1a2, b1b2) kesişimi; paralel ise null. */
function intersect(a1: number[], a2: number[], b1: number[], b2: number[]): number[] | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
  return [a1[0] + d1x * t, a1[1] + d1y * t];
}

/**
 * Perspektif doğru doku için köşe ağırlıkları. Köşegenlerin kesişim noktasına
 * olan uzaklık oranları, homojen texcoord'un q bileşenini verir.
 */
function quadQ(p: Quad): number[] {
  const c = intersect(p[0], p[2], p[1], p[3]);
  if (!c) return [1, 1, 1, 1];
  const d0 = dist(c, p[0]);
  const d1 = dist(c, p[1]);
  const d2 = dist(c, p[2]);
  const d3 = dist(c, p[3]);
  if (d0 < 1e-6 || d1 < 1e-6 || d2 < 1e-6 || d3 < 1e-6) return [1, 1, 1, 1];
  return [(d0 + d2) / d2, (d1 + d3) / d3, (d0 + d2) / d0, (d1 + d3) / d1];
}

/** Dörtgenin u (yatay) ve v (dikey) yönündeki ortalama kenar uzunlukları. */
function quadSize(p: Quad): { w: number; h: number } {
  return {
    w: (dist(p[0], p[1]) + dist(p[3], p[2])) / 2,
    h: (dist(p[0], p[3]) + dist(p[1], p[2])) / 2,
  };
}

function quadCenter(p: Quad): { x: number; y: number } {
  const c = intersect(p[0], p[2], p[1], p[3]);
  if (c) return { x: c[0], y: c[1] };
  return {
    x: (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4,
    y: (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4,
  };
}

// ---------------------------------------------------------------------------
// WebGL projective quad
// ---------------------------------------------------------------------------

const VERT = `
attribute vec2 aPos;
attribute vec3 aTex;
varying vec3 vTex;
void main() {
  vTex = aTex;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vTex;
uniform sampler2D uTex;
void main() {
  gl_FragColor = texture2D(uTex, vTex.xy / vTex.z);
}`;

type GLState = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  posBuf: WebGLBuffer;
  texBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  tex: WebGLTexture;
  aPos: number;
  aTex: number;
};

// Tarayıcı başına WebGL context sayısı sınırlı — tek context paylaşılır.
let glState: GLState | null = null;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function getGL(): GLState | null {
  if (glState) return glState;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const posBuf = gl.createBuffer();
  const texBuf = gl.createBuffer();
  const idxBuf = gl.createBuffer();
  const tex = gl.createTexture();
  if (!posBuf || !texBuf || !idxBuf || !tex) return null;
  glState = {
    canvas,
    gl,
    program,
    posBuf,
    texBuf,
    idxBuf,
    tex,
    aPos: gl.getAttribLocation(program, "aPos"),
    aTex: gl.getAttribLocation(program, "aTex"),
  };
  return glState;
}

/**
 * Screenshot'ı hedef ekran genişliğine yakın bir tuvale indirger. WebGL1'de
 * POT olmayan dokuda mipmap yok; 1320 px'lik bir görüntüyü doğrudan ~650 px'e
 * LINEAR ile küçültmek tırtıklanmaya yol açar. Tarayıcının kaliteli ölçekleyicisi
 * ile kademeli yarılayarak indirmek bunu önler.
 */
function fitTexture(
  shot: HTMLImageElement,
  targetW: number
): HTMLImageElement | HTMLCanvasElement {
  const want = Math.max(1, Math.round(targetW));
  if (shot.width <= want * 1.6) return shot;
  let w = shot.width;
  let h = shot.height;
  let src: HTMLImageElement | HTMLCanvasElement = shot;
  while (w > want * 1.6) {
    const nw = Math.max(want, Math.round(w / 2));
    const nh = Math.max(1, Math.round((nw / w) * h));
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh;
    const g = c.getContext("2d");
    if (!g) return src;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, nw, nh);
    src = c;
    w = nw;
    h = nh;
  }
  return src;
}

/** Screenshot'ı verilen dörtgen(ler)e perspektif doğru basar; RGBA canvas döner. */
function warpQuads(
  shot: HTMLImageElement,
  quads: Quad[],
  w: number,
  h: number,
  aspect?: number
): HTMLCanvasElement | null {
  const s = getGL();
  if (!s) return null;
  const { gl } = s;
  s.canvas.width = w;
  s.canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(s.program);

  // En büyük ekranın genişliğine göre tek bir doku hazırlanır.
  let maxW = 1;
  for (const q of quads) maxW = Math.max(maxW, quadSize(q).w);
  const source = fitTexture(shot, maxW);

  gl.bindTexture(gl.TEXTURE_2D, s.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const uTex = gl.getUniformLocation(s.program, "uTex");
  if (uTex) gl.uniform1i(uTex, 0);

  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  for (const q of quads) {
    const size = quadSize(q);
    if (size.w < 1 || size.h < 1) continue;
    // Screenshot'ı ekran oranına cover-fit et (taşan kenar kırpılır).
    // Perspektifli plate'lerde quad'ın GÖRÜNÜR oranı gerçek slot oranından
    // sapar ve %10-16 gereksiz kırpma yapar — meta.aspect varsa o kazanır.
    const target = aspect ?? size.w / size.h;
    const src = shot.width / shot.height;
    let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
    if (src > target) {
      const k = target / src;
      u0 = (1 - k) / 2;
      u1 = u0 + k;
    } else if (src < target) {
      const k = src / target;
      v0 = (1 - k) / 2;
      v1 = v0 + k;
    }
    const uv = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    const qw = quadQ(q);

    const pos = new Float32Array(8);
    const tc = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      pos[i * 2] = (q[i][0] / w) * 2 - 1;
      pos[i * 2 + 1] = 1 - (q[i][1] / h) * 2;
      tc[i * 3] = uv[i][0] * qw[i];
      tc[i * 3 + 1] = uv[i][1] * qw[i];
      tc[i * 3 + 2] = qw[i];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, s.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(s.aPos);
    gl.vertexAttribPointer(s.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, s.texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tc, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(s.aTex);
    gl.vertexAttribPointer(s.aTex, 3, gl.FLOAT, false, 0, 0);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // Paylaşılan context bir sonraki çağrıda temizlenir; kopyasını çıkar.
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(s.canvas, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Plate kompoziti
// ---------------------------------------------------------------------------

const cache = new Map<string, PlateRender>();
const CACHE_MAX = 10;

/**
 * Plate'i screenshot ile birleştirir: önce screenshot ekran dörtgen(ler)ine
 * projektif basılır, sonra saydam overlay üstüne çizilir. Dönen canvas plate'in
 * kendi çözünürlüğündedir; yerleştirmeyi çağıran (device2d) `screen` alanına
 * göre ölçekler.
 */
export async function renderPlate(
  name: string,
  shot: HTMLImageElement | null
): Promise<PlateRender | null> {
  const metas = await loadPlates();
  const meta = metas[name];
  if (!meta) return null;

  const key = `${name}|${shot ? shot.src : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const overlay = await loadImage(`${DIR}/${name}.png`);
  if (!overlay) return null;

  const canvas = document.createElement("canvas");
  canvas.width = meta.w;
  canvas.height = meta.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 1) screenshot ALTA
  if (shot) {
    const quads = meta.quads && meta.quads.length ? meta.quads : [meta.quad];
    const warp = warpQuads(shot, quads, meta.w, meta.h, meta.aspect);
    if (warp) ctx.drawImage(warp, 0, 0);
  }
  // 2) cihaz + cam yansıması ÜSTE — ekran deliği saydam olduğu için screenshot
  //    olduğu gibi görünür, taşan kısmı opak çerçeve örter.
  ctx.drawImage(overlay, 0, 0, meta.w, meta.h);

  const c = quadCenter(meta.quad);
  const out: PlateRender = {
    canvas,
    w: meta.w,
    h: meta.h,
    screen: { cx: c.x, cy: c.y, h: quadSize(meta.quad).h },
  };
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, out);
  return out;
}
