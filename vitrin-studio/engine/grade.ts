// Vitrin Studio — kompozit renk grade'i (ASC-CDL sınıfı).
//
// NEDEN VAR
// Cihaz katmanı three.js'in ACESFilmic + sRGB ton eğrisinden geçiyor; zemin ve
// metin ise ham 2D canvas. İki katman FARKLI ton eğrisinde buluşunca kompozit
// "yapıştırılmış" duruyor. Tek doğru çözüm, HER ŞEYİN üstünde çalışan tek bir
// grade pass'i: zemin, cihaz ve metin aynı eğriden geçer.
//
// SÖZLEŞME
//   - Deterministik. Zaman/rastgele YOK; dither bile gl_FragCoord tabanlı.
//     Aynı (kompozit, spec, w, h) → birebir aynı piksel. Export = önizleme.
//   - GPU zorunlu. Saf JS ImageData yolu 1320×2868'de ~300ms+; WebGL2 yoksa
//     pass SESSİZCE atlanır (asla throw etmez, asla bozuk çıktı bırakmaz).
//   - Yerinde çalışır: verilen 2D ctx'in içeriğini okur, grade'leyip geri basar.
//
// FİLM SIRASI (shader içinde, tek pass)
//   1. radyal kromatik aberasyon  — R/B kanalı uv'de ayrışır (lens)
//   2. halation                    — yarım çözünürlük parlak-yayılma, screen (emülsiyon)
//   3. ASC-CDL                     — (x·slope + offset)^power, kanal başına (negatif)
//   4. doygunluk                   — luma ağırlıklı (Rec.709)
//   5. split-tone                  — gölge/parlak tonlaması, LUMA'sız (saf kroma)
//   6. yumuşak S eğrisi            — kontrast, uçlar sabit
//   7. TPDF dither                 — 8-bit bantlanmayı kırar
//
// 1 ve 2 "çekim" tarafındadır (mercek + emülsiyon), 3-6 "baskı" tarafında.
// Bu yüzden halation grade'den ÖNCE binder: noir'da turuncu hale değil, gri
// yayılma alırsın — doğrusu budur.

import type { GradeSpec } from "./types";

/* ================================================================== *
   1. Katalog
 * ================================================================== */

/**
 * Preset, GradeSpec'in üstüne bir alan daha taşır: `curve` (S eğrisi gücü).
 * Kullanıcıya slider olarak açılmaz — preset'in "kişiliği"dir; ince ayar
 * CDL/sat/split alanlarından yapılır. Slide.grade yalnız `preset` id'sini
 * saklar, curve katalogdan çözülür → JSON küçük, sonuç deterministik.
 */
export type GradePreset = GradeSpec & { curve?: number; label?: string };

/**
 * Preset defteri. Sıra kontrattır (Inspector çip sırası buradan okunur).
 *
 * Değer felsefesi:
 *   - CDL kaymaları KÜÇÜK tutulur (offset ≤ 0.02); büyük karakter split-tone
 *     ve S eğrisinden gelir, çünkü ikisi de luma'yı korur → metin okunur kalır.
 *   - splitAmount 0.35'i geçmez: App Store kapak görselinde ten/altın tonlarını
 *     bozan tek şey aşırı split'tir.
 */
export const GRADE_PRESETS: Record<string, GradePreset> = {
  /** Varsayılan birleştirici: karakter yok, sadece cihaz/zemin ton eğrisi birliği. */
  "neutral-plus": {
    preset: "neutral-plus",
    label: "Neutral+",
    slope: [1, 1, 1],
    offset: [0, 0, 0],
    power: [1, 1, 1],
    sat: 1.03,
    curve: 0.18,
    splitAmount: 0,
    aberration: 0,
    halation: 0,
  },

  /** Gölge teal / parlak turuncu. Split saf kroma olduğu için altınlar ezilmez. */
  "teal-orange": {
    preset: "teal-orange",
    label: "Teal-Orange",
    slope: [1.02, 1.0, 0.99],
    offset: [0.004, 0.0, 0.012],
    power: [1.0, 1.0, 1.02],
    sat: 1.06,
    curve: 0.22,
    splitShadow: "#2f6f7d",
    splitHighlight: "#ffb066",
    splitAmount: 0.32,
    aberration: 0.15,
    halation: 0.12,
  },

  /** Bleach-bypass: doygunluk düşük, kontrast yüksek, hafif soğuk gölge. */
  silver: {
    preset: "silver",
    label: "Silver",
    slope: [1.02, 1.02, 1.03],
    offset: [0.01, 0.01, 0.016],
    power: [0.99, 0.99, 0.97],
    sat: 0.38,
    curve: 0.3,
    splitShadow: "#43506b",
    splitHighlight: "#f2f4f8",
    splitAmount: 0.2,
    aberration: 0.1,
    halation: 0.05,
  },

  /** Kodak: siyah lift, gölgede yeşil dip, sıcak parlaklar, belirgin halation. */
  kodak: {
    preset: "kodak",
    label: "Kodak",
    slope: [1.03, 1.0, 0.96],
    offset: [0.018, 0.02, 0.016],
    power: [0.98, 1.0, 1.04],
    sat: 1.08,
    curve: 0.2,
    splitShadow: "#4a5f4a",
    splitHighlight: "#ffd9a8",
    splitAmount: 0.26,
    aberration: 0.12,
    halation: 0.3,
  },

  /** Tonlanmış siyah-beyaz. sat 0 sonrası split biraz kroma geri koyar (saf gri düz durur). */
  noir: {
    preset: "noir",
    label: "Noir",
    slope: [1.05, 1.05, 1.05],
    offset: [-0.008, -0.008, -0.008],
    power: [1.06, 1.06, 1.06],
    sat: 0,
    curve: 0.4,
    splitShadow: "#1a1e2b",
    splitHighlight: "#efeee9",
    splitAmount: 0.14,
    aberration: 0.08,
    halation: 0.1,
  },
};

/** Çip sırası — Inspector bunu okur; "yok" (grade kapalı) UI tarafındadır. */
export const GRADE_PRESET_IDS = [
  "neutral-plus",
  "teal-orange",
  "silver",
  "kodak",
  "noir",
] as const;

/* ================================================================== *
   2. Çözümleme
 * ================================================================== */

export type RGB = [number, number, number];

/** Shader'a giden tam değer kümesi — hiçbir alan opsiyonel değil. */
export type ResolvedGrade = {
  slope: RGB;
  offset: RGB;
  power: RGB;
  sat: number;
  curve: number;
  splitShadow: RGB;
  splitHighlight: RGB;
  splitAmount: number;
  aberration: number;
  halation: number;
};

const IDENTITY: ResolvedGrade = {
  slope: [1, 1, 1],
  offset: [0, 0, 0],
  power: [1, 1, 1],
  sat: 1,
  curve: 0,
  splitShadow: [0.5, 0.5, 0.5],
  splitHighlight: [0.5, 0.5, 0.5],
  splitAmount: 0,
  aberration: 0,
  halation: 0,
};

/** "#abc" / "#aabbcc" → 0..1 RGB. Bozuk girdi → nötr gri (split'i etkisiz kılar). */
function hex2rgb(input: string | undefined, fallback: RGB): RGB {
  if (!input) return fallback;
  let h = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}/.test(h)) return fallback;
  const n = parseInt(h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function triple(v: [number, number, number] | undefined, fallback: RGB): RGB {
  if (!v || v.length < 3) return fallback;
  const ok = (x: number, d: number) => (Number.isFinite(x) ? x : d);
  return [ok(v[0], fallback[0]), ok(v[1], fallback[1]), ok(v[2], fallback[2])];
}

function num(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * preset + override → tam değer kümesi.
 * Sıra: kimlik → preset (varsa) → spec'in TANIMLI alanları.
 * Bilinmeyen preset id'si sessizce yok sayılır (eski JSON'lar patlamaz).
 */
export function resolveGrade(spec: GradeSpec | undefined | null): ResolvedGrade {
  if (!spec) return { ...IDENTITY };
  const p = spec.preset ? GRADE_PRESETS[spec.preset] : undefined;
  const layer = (s: GradeSpec | GradePreset | undefined, base: ResolvedGrade): ResolvedGrade => {
    if (!s) return base;
    return {
      slope: triple(s.slope, base.slope),
      offset: triple(s.offset, base.offset),
      power: triple(s.power, base.power),
      sat: num(s.sat, base.sat),
      curve: num((s as GradePreset).curve, base.curve),
      splitShadow: hex2rgb(s.splitShadow, base.splitShadow),
      splitHighlight: hex2rgb(s.splitHighlight, base.splitHighlight),
      splitAmount: num(s.splitAmount, base.splitAmount),
      aberration: num(s.aberration, base.aberration),
      halation: num(s.halation, base.halation),
    };
  };
  return layer(spec, layer(p, { ...IDENTITY }));
}

/** Çözülmüş grade görünür bir iş yapıyor mu? Hayırsa pass tamamen atlanır. */
export function gradeIsActive(r: ResolvedGrade): boolean {
  const off = (v: RGB, t: number) => Math.abs(v[0] - t) + Math.abs(v[1] - t) + Math.abs(v[2] - t) > 1e-4;
  return (
    off(r.slope, 1) ||
    off(r.offset, 0) ||
    off(r.power, 1) ||
    Math.abs(r.sat - 1) > 1e-4 ||
    r.curve > 1e-4 ||
    r.splitAmount > 1e-4 ||
    r.aberration > 1e-4 ||
    r.halation > 1e-4
  );
}

/**
 * Preset çipi için gölge→parlak rampası.
 *
 * Uydurma renk değil: nötr grileri shader'ın TONAL adımlarından (CDL → sat →
 * split → S eğrisi) aynı sırayla geçirir. Aberasyon/halation uzamsaldır,
 * rampada karşılığı yoktur. Çip böylece preset'in gerçek karakterini gösterir.
 */
export function gradeRamp(spec: GradeSpec | undefined | null, n = 5): string[] {
  const r = resolveGrade(spec);
  const out: string[] = [];
  const L709 = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sm = (a: number, b: number, x: number) => {
    const t = clamp01((x - a) / Math.max(b - a, 1e-5));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const g = n === 1 ? 0.5 : 0.05 + (0.92 * i) / (n - 1);
    let v = [0, 1, 2].map((k) =>
      Math.pow(Math.max(g * r.slope[k] + r.offset[k], 0), Math.max(0.05, r.power[k]))
    );
    const L = L709(v);
    v = v.map((x) => L + (x - L) * Math.max(0, r.sat));
    if (r.splitAmount > 0.001) {
      const sM = 1 - sm(0, 0.55, L);
      const hM = sm(0.45, 1, L);
      const b = [0, 1, 2].map(
        (k) => (r.splitShadow[k] - 0.5) * sM + (r.splitHighlight[k] - 0.5) * hM
      );
      const bl = L709(b);
      v = v.map((x, k) => x + (b[k] - bl) * clamp01(r.splitAmount) * 0.85);
    }
    if (r.curve > 0.001) {
      v = v.map((x) => {
        const t = clamp01(x);
        return x + (t * t * (3 - 2 * t) - x) * clamp01(r.curve);
      });
    }
    out.push(
      "#" +
        v
          .map((x) =>
            Math.round(clamp01(x) * 255)
              .toString(16)
              .padStart(2, "0")
          )
          .join("")
    );
  }
  return out;
}

/**
 * Canlı 3D yolu için KABA CSS filtresi.
 *
 * Canlı önizlemede kompozit üç ayrı DOM katmanına bölünmüştür (zemin canvas ·
 * WebGL cihaz · metin canvas); tek bir GPU pass'i mümkün değil. CSS filtreleri
 * grubu birleştirdikten SONRA çalışır, yani doğru yerdedir ama dili fakirdir:
 * split-tone, aberasyon ve halation'ın CSS karşılığı yok — atlanır.
 *
 * Dönüşüm:
 *   saturate   ← sat (birebir)
 *   contrast   ← S eğrisi gücü + CDL slope ortalaması
 *   brightness ← CDL offset ortalaması + power (gamma) yaklaşığı
 *   sepia/hue  ← YOK (split'i taklit etmek yanlış yöne kaydırıyor)
 */
export function gradeCssFilter(spec: GradeSpec | undefined | null): string | undefined {
  const r = resolveGrade(spec);
  if (!gradeIsActive(r)) return undefined;
  const avg = (v: RGB) => (v[0] + v[1] + v[2]) / 3;
  const sat = Math.max(0, r.sat);
  // S eğrisi ~ contrast(1 + 0.55·curve); slope de kontrast gibi davranır.
  const contrast = Math.max(0.2, 1 + r.curve * 0.55 + (avg(r.slope) - 1) * 0.6);
  // offset doğrudan parlaklık; power>1 karartır (gamma).
  const bright = Math.max(0.2, 1 + avg(r.offset) * 1.6 - (avg(r.power) - 1) * 0.35);
  const parts: string[] = [];
  if (Math.abs(sat - 1) > 0.005) parts.push(`saturate(${sat.toFixed(3)})`);
  if (Math.abs(contrast - 1) > 0.005) parts.push(`contrast(${contrast.toFixed(3)})`);
  if (Math.abs(bright - 1) > 0.005) parts.push(`brightness(${bright.toFixed(3)})`);
  return parts.length ? parts.join(" ") : undefined;
}

/* ================================================================== *
   3. WebGL2 singleton (engine/shaders.ts deseninin birebir eşi)
 * ================================================================== */

const VERT = `#version 300 es
// Attribute'suz fullscreen üçgen.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COMMON = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_res;

// uv: gl_FragCoord tabanlı, ALT-SOL orijinli. Kaynak doku UNPACK_FLIP_Y ile
// yüklendiği için tüm zincir (kaynak · FBO'lar · ekran) aynı yöndedir.
vec2 uvHere() { return gl_FragCoord.xy / u_res; }

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float lum(vec3 c) { return dot(c, LUMA); }
`;

/** Parlak-geçiş: eşik üstünü izole et, sıcak tint uygula (halation kaynağı). */
const FS_BRIGHT = `${COMMON}
uniform sampler2D u_src;
uniform float u_thresh;
void main() {
  vec3 c = texture(u_src, uvHere()).rgb;
  float l = lum(c);
  float b = max(l - u_thresh, 0.0) / max(1.0 - u_thresh, 1e-3);
  // Kare: sadece GERÇEK parlaklar yayılsın, orta tonlar sızmasın.
  b = b * b;
  // Halation film emülsiyonunda kırmızı katmanın altından saçılır → turuncu-kızıl.
  vec3 warm = vec3(1.0, 0.38, 0.20);
  outColor = vec4(c * b * warm, 1.0);
}
`;

/** Ayrılabilir gauss — u_dir ile yatay/dikey. Ağırlıklar sabit (deterministik). */
const FS_BLUR = `${COMMON}
uniform sampler2D u_src;
uniform vec2 u_dir;      // piksel cinsinden adım vektörü
uniform float u_taps;    // 7 (taslak) veya 13
void main() {
  vec2 uv = uvHere();
  vec2 px = u_dir / u_res;
  vec3 sum = texture(u_src, uv).rgb * 0.2270270270;
  float wsum = 0.2270270270;
  // 6 çift tap; taslakta ilk 3 çift kullanılır.
  float ws[6] = float[6](0.1945945946, 0.1216216216, 0.0540540541, 0.0202702703, 0.0067567568, 0.0022522523);
  float os[6] = float[6](1.0, 2.0, 3.0, 4.0, 5.0, 6.0);
  int n = u_taps > 10.0 ? 6 : 3;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    vec2 d = px * os[i];
    sum += (texture(u_src, uv + d).rgb + texture(u_src, uv - d).rgb) * ws[i];
    wsum += 2.0 * ws[i];
  }
  outColor = vec4(sum / max(wsum, 1e-4), 1.0);
}
`;

/** Ana pass — film sırası yukarıdaki başlıkta. */
const FS_GRADE = `${COMMON}
uniform sampler2D u_src;
uniform sampler2D u_hal;
uniform vec3  u_slope;
uniform vec3  u_offset;
uniform vec3  u_power;
uniform float u_sat;
uniform float u_curve;
uniform vec3  u_tintS;
uniform vec3  u_tintH;
uniform float u_split;
uniform float u_aberPx;   // kenarda maksimum kayma, piksel
uniform float u_halAmt;

// TPDF dither (shaders.ts ile aynı): iki bağımsız IGN örneğinin farkı.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = uvHere();

  // --- 1) radyal kromatik aberasyon -------------------------------------
  // Merkez TAM TEMİZ kalsın (başlık orada durur): kayma alan yüksekliğinin
  // KARESİYLE büyür, köşede u_aberPx'e ulaşır.
  vec3 c;
  float a = texture(u_src, uv).a;
  if (u_aberPx > 0.001) {
    vec2 dd = (uv - 0.5) * 2.0;                 // -1..1
    float rr = min(1.0, length(dd) * 0.70710678); // köşede 1
    vec2 dir = dd / max(length(dd), 1e-5);
    vec2 shift = dir * (rr * rr * u_aberPx) / u_res;
    c.r = texture(u_src, uv + shift).r;
    c.g = texture(u_src, uv).g;
    c.b = texture(u_src, uv - shift).b;
  } else {
    c = texture(u_src, uv).rgb;
  }

  // --- 2) halation (screen) ---------------------------------------------
  if (u_halAmt > 0.001) {
    vec3 h = texture(u_hal, uv).rgb * u_halAmt;
    c = 1.0 - (1.0 - c) * (1.0 - min(h, vec3(1.0)));
  }

  // --- 3) ASC-CDL: (x*slope + offset)^power ------------------------------
  vec3 v = max(c * u_slope + u_offset, 0.0);
  v = pow(v, u_power);

  // --- 4) doygunluk (luma ağırlıklı) -------------------------------------
  float L = lum(v);
  v = mix(vec3(L), v, u_sat);

  // --- 5) split-tone — LUMA BİLEŞENİ ÇIKARILMIŞ (saf kroma kayması) ------
  // Bu yüzden altın/ten tonları "ezilmez": parlaklıkları aynen kalır,
  // yalnız renk sıcaklığı kayar. Orta tonlar iki maskenin arasında nötr.
  if (u_split > 0.001) {
    float sM = 1.0 - smoothstep(0.0, 0.55, L);
    float hM = smoothstep(0.45, 1.0, L);
    vec3 b = (u_tintS - 0.5) * sM + (u_tintH - 0.5) * hM;
    b -= lum(b);
    v += b * u_split * 0.85;
  }

  // --- 6) yumuşak S eğrisi (uçlar sabit) ---------------------------------
  if (u_curve > 0.001) {
    vec3 t = clamp(v, 0.0, 1.0);
    v = mix(v, t * t * (3.0 - 2.0 * t), u_curve);
  }

  // --- 7) dither ---------------------------------------------------------
  float n = ign(gl_FragCoord.xy) - ign(gl_FragCoord.xy + vec2(37.0, 17.0));
  v += n * (1.15 / 255.0);

  outColor = vec4(clamp(v, 0.0, 1.0), a);
}
`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

type Bundle = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  progs: Map<string, Prog | null>;
  srcTex: WebGLTexture | null;
  /** Halation ping-pong hedefleri (yarım/çeyrek çözünürlük). */
  rt: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }[];
  maxTex: number;
};

let bundle: Bundle | null = null;

function createBundle(): Bundle | null {
  if (typeof document === "undefined") return null;
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return null;
  }
  canvas.width = 2;
  canvas.height = 2;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // drawImage ile geri kopyalayabilmek için şart
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const vao = gl.createVertexArray();
  if (vao) gl.bindVertexArray(vao);
  // Kaynak 2D canvas'ı ters çevirerek yükle → tüm zincir alt-sol orijinli olur.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const maxTex = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 2048;
  return { canvas, gl, progs: new Map(), srcTex: null, rt: [], maxTex };
}

function getBundle(): Bundle | null {
  if (bundle && bundle.gl.isContextLost()) bundle = null;
  if (!bundle) bundle = createBundle();
  return bundle;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[grade] derleme hatası:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function getProg(b: Bundle, id: string, fs: string, names: string[]): Prog | null {
  const hit = b.progs.get(id);
  if (hit !== undefined) return hit;
  const gl = b.gl;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  let out: Prog | null = null;
  if (vs && f) {
    const p = gl.createProgram();
    if (p) {
      gl.attachShader(p, vs);
      gl.attachShader(p, f);
      gl.linkProgram(p);
      if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const u: Record<string, WebGLUniformLocation | null> = {};
        for (const n of names) u[n] = gl.getUniformLocation(p, n);
        out = { p, u };
      } else {
        console.warn("[grade] link hatası:", gl.getProgramInfoLog(p));
        gl.deleteProgram(p);
      }
    }
  }
  if (vs) gl.deleteShader(vs);
  if (f) gl.deleteShader(f);
  b.progs.set(id, out);
  return out;
}

/** i. ping-pong hedefini istenen boyutta hazırlar (boyut değiştiyse yeniden ayırır). */
function ensureRT(b: Bundle, i: number, w: number, h: number): Bundle["rt"][number] | null {
  const gl = b.gl;
  const cur = b.rt[i];
  if (cur && cur.w === w && cur.h === h) return cur;
  if (cur) {
    gl.deleteFramebuffer(cur.fb);
    gl.deleteTexture(cur.tex);
  }
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return null;
  }
  const rt = { fb, tex, w, h };
  b.rt[i] = rt;
  return rt;
}

const BRIGHT_U = ["u_res", "u_src", "u_thresh"];
const BLUR_U = ["u_res", "u_src", "u_dir", "u_taps"];
const GRADE_U = [
  "u_res", "u_src", "u_hal", "u_slope", "u_offset", "u_power",
  "u_sat", "u_curve", "u_tintS", "u_tintH", "u_split", "u_aberPx", "u_halAmt",
];

/* ================================================================== *
   4. Kamusal API
 * ================================================================== */

/**
 * Kompozit grade'i verilen 2D bağlamın İÇERİĞİNE uygular (yerinde).
 *
 * @param ctx    kompozitin çizildiği 2D bağlam (canvas'ı okunur ve üzerine basılır)
 * @param w,h    kompozit boyutu (px)
 * @param spec   Slide.grade — preset + override
 * @param draft  taslak mod: halation çeyrek çözünürlük + 7 tap, aberasyon yarı güç
 *
 * WebGL2 yoksa, doku limiti aşılırsa ya da program derlenemezse SESSİZCE döner:
 * kompozit dokunulmamış kalır. Asla throw etmez.
 */
export async function applyGrade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: GradeSpec | undefined | null,
  draft = false
): Promise<void> {
  const r = resolveGrade(spec);
  if (!gradeIsActive(r)) return;

  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const b = getBundle();
  if (!b) return;
  if (W > b.maxTex || H > b.maxTex) return; // devasa export — sessizce atla

  const gl = b.gl;
  try {
    const gradeProg = getProg(b, "grade", FS_GRADE, GRADE_U);
    if (!gradeProg) return;

    // ---- kaynağı doku olarak yükle -------------------------------------
    if (!b.srcTex) {
      b.srcTex = gl.createTexture();
      if (!b.srcTex) return;
      gl.bindTexture(gl.TEXTURE_2D, b.srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, b.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ---- halation ön-pass'i --------------------------------------------
    let halTex: WebGLTexture | null = null;
    if (r.halation > 0.001) {
      const div = draft ? 4 : 2;
      const hw = Math.max(2, Math.round(W / div));
      const hh = Math.max(2, Math.round(H / div));
      const a = ensureRT(b, 0, hw, hh);
      const c = ensureRT(b, 1, hw, hh);
      const bright = getProg(b, "bright", FS_BRIGHT, BRIGHT_U);
      const blur = getProg(b, "blur", FS_BLUR, BLUR_U);
      if (a && c && bright && blur) {
        // parlak geçiş: src → a
        // ensureRT kendi dokularını TEXTURE0'a bağlamış olabilir; kaynağı geri al.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, b.srcTex);
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
        gl.viewport(0, 0, hw, hh);
        gl.useProgram(bright.p);
        gl.uniform2f(bright.u.u_res, hw, hh);
        gl.uniform1i(bright.u.u_src, 0);
        gl.uniform1f(bright.u.u_thresh, 0.72);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // yayılma: hale ~ genişliğin %1.6'sı. Sabit oran → boyuttan bağımsız görünüm.
        const step = Math.max(1, (hw / 220) * (draft ? 0.6 : 1));
        const taps = draft ? 7 : 13;
        gl.useProgram(blur.p);
        gl.uniform2f(blur.u.u_res, hw, hh);
        gl.uniform1i(blur.u.u_src, 0);
        gl.uniform1f(blur.u.u_taps, taps);

        // yatay: a → c
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform2f(blur.u.u_dir, step, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // dikey: c → a
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
        gl.bindTexture(gl.TEXTURE_2D, c.tex);
        gl.uniform2f(blur.u.u_dir, 0, step);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        halTex = a.tex;
      }
    }

    // ---- ana pass → ekran ----------------------------------------------
    if (b.canvas.width !== W) b.canvas.width = W;
    if (b.canvas.height !== H) b.canvas.height = H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(gradeProg.p);
    const u = gradeProg.u;
    gl.uniform2f(u.u_res, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, b.srcTex);
    gl.uniform1i(u.u_src, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, halTex ?? b.srcTex);
    gl.uniform1i(u.u_hal, 1);
    gl.uniform3f(u.u_slope, r.slope[0], r.slope[1], r.slope[2]);
    gl.uniform3f(u.u_offset, r.offset[0], r.offset[1], r.offset[2]);
    gl.uniform3f(u.u_power, Math.max(0.05, r.power[0]), Math.max(0.05, r.power[1]), Math.max(0.05, r.power[2]));
    gl.uniform1f(u.u_sat, Math.max(0, r.sat));
    gl.uniform1f(u.u_curve, clamp01(r.curve));
    gl.uniform3f(u.u_tintS, r.splitShadow[0], r.splitShadow[1], r.splitShadow[2]);
    gl.uniform3f(u.u_tintH, r.splitHighlight[0], r.splitHighlight[1], r.splitHighlight[2]);
    gl.uniform1f(u.u_split, clamp01(r.splitAmount));
    // 0..1 → kenarda en fazla 1.2px. Taslakta yarı güç (yarım rasterde zaten görünmez).
    gl.uniform1f(u.u_aberPx, clamp01(r.aberration) * 1.2 * (draft ? 0.5 : 1));
    gl.uniform1f(u.u_halAmt, halTex ? clamp01(r.halation) : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

    if (gl.isContextLost()) {
      bundle = null;
      return;
    }

    // ---- geri bas (tam değiştirme) --------------------------------------
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(b.canvas, 0, 0, W, H, 0, 0, W, H);
    ctx.restore();
  } catch (e) {
    // GPU tarafında ne olursa olsun kompoziti bozma.
    console.warn("[grade] pass atlandı:", e);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
