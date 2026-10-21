// WebGL2 tabanlı statik arka plan shader kütüphanesi.
// Kural: ZAMAN YOK. Aynı (shaderId, colors, seed, params, w, h) → birebir aynı görsel.
// Seed sadece faz/ofset kaydırır; export ile önizleme piksel piksel eşleşir.
//
// Renk sırası konvansiyonu: colors[0] = taban/zemin, colors[1..3] = katman ve vurgular.
// Eksik renkler son renk tekrarlanarak 4'e tamamlanır.
//
// Modül seviyesinde TEK bir gizli WebGL2 canvas'ı (singleton) tutulur; her çağrı
// onun buffer'ını ezer. Bu yüzden renderShader her seferinde YENİ bir 2d canvas
// kopyası döndürür — çağıran onu istediği kadar saklayabilir.

// ---------- Katalog ----------

/** Editörde slider olarak sunulan parametre tanımı. */
import { L } from "@/lib/i18n";

type ParamDef = {
  /** params sözlüğünde u_p1/u_p2'yi besleyen anahtarlar; sırayla denenir. */
  keys: string[];
  def: number;
  /** Arayüz etiketi (TR) ve slider sınırları. */
  label: string;
  min: number;
  max: number;
  step: number;
};

type ShaderDef = {
  id: string;
  name: string;
  p1: ParamDef;
  p2: ParamDef;
  main: string;
};

// ---------- Ortak GLSL prelude'u ----------
// hash / noise / fbm / turbulence / renk rampası / dither burada, tek yerde.

const PRELUDE = `#version 300 es
precision highp float;

out vec4 outColor;

uniform vec2  u_res;
uniform float u_seed;
uniform vec3  u_colors[4];
uniform float u_p1;
uniform float u_p2;

const float PI  = 3.14159265;
const float TAU = 6.28318531;

float sat(float x) { return clamp(x, 0.0, 1.0); }

// Sabit indeksli renk erişimi (sürücü uyumluluğu için dizi yerine dallanma).
vec3 colAt(int i) {
  if (i <= 0) return u_colors[0];
  if (i == 1) return u_colors[1];
  if (i == 2) return u_colors[2];
  return u_colors[3];
}
int wrap3(int i) { return i - (i / 3) * 3; }

// --- hash ---
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// --- value noise (quintic yumuşatma) ---
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// --- fbm / turbulence (0..1 normalize) ---
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = m * p;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
float turb(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * abs(vnoise(p) * 2.0 - 1.0);
    n += a;
    p = m * p;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

// --- koordinatlar ---
// uvTop: sol-ÜST köşe (0,0), sağ-alt (1,1). 2d canvas ile aynı yön.
vec2 uvTop() { return vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res; }
// pw: genişliğe göre normalize, kare birimli merkez koordinat (x ±0.5, y ±h/2w).
vec2 pw(vec2 uv) { return vec2(uv.x - 0.5, (uv.y - 0.5) * u_res.y / u_res.x); }

// --- renk yardımcıları ---
// mixP: yarı-ışık-uzayı karışım. Düz sRGB lerp iki doygun rengin ortasında
// luminansı düşürüp "çamur" bir ara ton bırakır; tam ışık uzayı ise fazla
// açar. İkisinin ortası, orta tonları temiz tutan pratik uzlaşma.
vec3 mixP(vec3 a, vec3 b, float t) {
  vec3 aa = max(a, 0.0);
  vec3 bb = max(b, 0.0);
  vec3 lin = sqrt(mix(aa * aa, bb * bb, t));
  return mix(mix(a, b, t), lin, 0.5);
}
vec3 ramp(float t) {
  t = sat(t) * 3.0;
  vec3 c = mixP(u_colors[0], u_colors[1], smoothstep(0.0, 1.0, sat(t)));
  c = mixP(c, u_colors[2], smoothstep(0.0, 1.0, sat(t - 1.0)));
  c = mixP(c, u_colors[3], smoothstep(0.0, 1.0, sat(t - 2.0)));
  return c;
}
vec3 screenB(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - max(b, 0.0)); }
float vign(vec2 uv, float amt) {
  vec2 d = uv - 0.5;
  d.y *= 0.72;                       // uzun kenarda köşe kararması abartmasın
  return sat(1.0 - amt * dot(d, d) * 2.6);
}

// --- dither: 1320x2868'de bant kırma (interleaved gradient noise) ---
// TPDF: iki bağımsız IGN örneğinin FARKI üçgen dağılım verir. Düz (dikdörtgen)
// gürültünün aksine gren şiddeti sinyalle modüle olmaz — koyu zeminlerde
// bantlar tamamen silinir ama "kirli" bir doku kalmaz.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
vec3 dith(vec3 c) {
  float n = ign(gl_FragCoord.xy) - ign(gl_FragCoord.xy + vec2(37.0, 17.0));
  return c + n * (1.15 / 255.0);
}
`;

// ---------- Shader'lar ----------

const AURORA = `
// Yumuşak kuzey ışığı bantları: fbm ile eğrilen, üst üste "screen" binen katmanlar.
void main() {
  vec2 uv = uvTop();
  float sd = u_seed * 0.6180339;
  float inten = max(u_p1, 0.0);
  float soft  = clamp(u_p2, 0.25, 4.0);

  // Taban: üstte biraz açık, altta koyu gece.
  vec3 col = mix(u_colors[0], u_colors[0] * 0.42, smoothstep(0.05, 1.0, uv.y));
  col = screenB(col, u_colors[1] * 0.06 * smoothstep(0.6, 0.0, uv.y));

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ph = sd * 7.3 + fi * 4.317;
    float yc = 0.30 + fi * 0.18 + 0.055 * sin(ph * 1.31);
    float amp = 0.135 + 0.040 * fi;
    float freq = 0.85 + 0.45 * fi;

    float w1 = fbm(vec2(uv.x * freq * 1.7 + ph, ph * 0.63), 5) - 0.5;
    float w2 = fbm(vec2(uv.x * 3.6 + ph * 1.7, 3.7 + ph), 4) - 0.5;
    float y = yc + w1 * amp * 1.5 + w2 * 0.045;

    // Perde: alt kenar keskin ve parlak, ışık yukarı doğru uzun bir kuyrukla söner.
    float dy = uv.y - y;
    float base = (0.052 + 0.026 * fi) * soft;
    float th = dy < 0.0 ? base * 2.6 : base * 0.9;
    float e = dy / th;
    float g = exp(-e * e);

    // Dikey lif dokusu — perdeye "akış" hissi verir (yukarı doğru belirginleşir).
    float fib = mix(1.0, 0.55 + 0.45 * fbm(vec2(uv.x * 18.0 + ph, uv.y * 3.0 + ph), 3),
                    sat(-dy / (base * 2.6)));

    col = screenB(col, colAt(i + 1) * g * fib * 0.95 * inten);
  }

  // Alttan gelen çok geniş, hafif parıltı.
  col = screenB(col, u_colors[2] * 0.09 * smoothstep(1.0, 0.5, uv.y) * inten);
  col *= vign(uv, 0.55);
  outColor = vec4(dith(col), 1.0);
}
`;

const SILK = `
// İpeksi akışkan kıvrımlar: iki kademeli domain warping + ince sheen.
void main() {
  vec2 uv = uvTop();
  float sd = u_seed * 0.3713;
  float scale = clamp(u_p2, 0.25, 4.0);
  // Düşük frekans: iri, akışkan kıvrımlar istiyoruz — mermer değil.
  vec2 p = pw(uv) * 0.95 * scale;

  vec2 q = vec2(fbm(p + vec2(0.0, sd), 4),
                fbm(p + vec2(5.2, 1.3 + sd), 4));
  vec2 r = vec2(fbm(p + 1.7 * q + vec2(1.7, 9.2) + sd * 0.5, 4),
                fbm(p + 1.7 * q + vec2(8.3, 2.8) - sd * 0.3, 4));
  float f = fbm(p + 2.0 * r + sd, 5);

  // Renk: ana alan + kıvrım derinliği.
  float t = sat(f * 1.35 + (r.x - r.y) * 0.45 + 0.02);
  vec3 col = ramp(t);

  // Kumaş parlaklığı: kıvrım sırtlarında geniş, yumuşak saten highlight.
  float ridge = sat(1.0 - abs(fract(f * 1.6 + 0.5) * 2.0 - 1.0));
  float sheen = ridge * ridge * ridge;
  col = screenB(col, vec3(1.0) * sheen * 0.10 * max(u_p1, 0.0));

  // Derinlik: kıvrım tabanları hafif koyulaşsın.
  col *= 0.88 + 0.24 * f;
  col *= vign(uv, 0.38);
  outColor = vec4(dith(col), 1.0);
}
`;

const GRAIN = `
// İnce film greni + dikey gradient. params.grain grenin miktarını verir.
void main() {
  vec2 uv = uvTop();
  float g = clamp(u_p1, 0.0, 0.5);
  float curve = clamp(u_p2, 0.2, 4.0);

  float t = pow(sat(uv.y), curve);
  vec3 col = mix(u_colors[0], u_colors[1], smoothstep(0.0, 1.0, t));

  // Üstte çok geniş, yumuşak bir ışık yıkaması.
  col = screenB(col, u_colors[2] * 0.20 * smoothstep(0.8, -0.05, uv.y));
  // Altta üçüncü rengin gölgesi.
  col = mix(col, col * mix(vec3(1.0), u_colors[3] * 1.4 + 0.15, 0.35),
            smoothstep(0.55, 1.05, uv.y) * 0.5);

  // İki oktavlı gren; orta tonlarda güçlü, uçlarda kısık (film davranışı).
  float n1 = hash12(gl_FragCoord.xy + u_seed * 37.13) - 0.5;
  float n2 = vnoise(gl_FragCoord.xy * 0.55 + u_seed * 11.7) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mask = mix(0.55, 1.0, 1.0 - abs(lum * 2.0 - 1.0));
  col += (n1 * 0.62 + n2 * 0.38) * g * mask;

  col *= vign(uv, 0.5);
  outColor = vec4(dith(col), 1.0);
}
`;

const METABALL = `
// İri, yumuşak bloblar. Alan toplamı + renk ağırlıklandırma = mesh gradient hissi.
void main() {
  vec2 uv = uvTop();
  float scale = clamp(u_p2, 0.3, 3.0);
  vec2 p = pw(uv) / scale;

  float field = 0.0;
  float wsum = 0.0;
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float h1 = hash11(u_seed * 0.6180 + fi * 1.373);
    float h2 = hash11(u_seed * 1.3110 + fi * 2.711 + 5.0);
    float h3 = hash11(u_seed * 0.9137 + fi * 3.191 + 11.0);

    vec2 c = vec2(mix(-0.50, 0.50, h1), mix(-0.94, 0.94, h2));
    // Estetik pass: bloblar belirgin şekilde iri. Yarıçap arttıkça ağırlık
    // fonksiyonu daha yayvan olur → renkler birbirine yumuşak geçer,
    // "lav lambası" kenarı yerine mesh gradient hissi kalır.
    float rad = mix(0.44, 0.86, h3);
    vec2 d = p - c;
    float w = (rad * rad) / (dot(d, d) + 1e-4);

    field += w;
    wsum += w;
    acc += colAt(1 + wrap3(i)) * w;
  }

  vec3 blob = acc / max(wsum, 1e-4);
  // Geniş falloff + ekstra smootherstep: eşik çevresinde sert kontur kalmasın.
  float edge = 0.68 * clamp(u_p1, 0.1, 4.0);
  float m = smoothstep(1.05 - edge, 1.05 + edge, field);
  m = m * m * (3.0 - 2.0 * m);

  vec3 col = mixP(u_colors[0] * 0.70, blob, m);
  // Eşiğin dışına taşan çok geniş renk sızıntısı — zemin ile blob arasında
  // görünür bir sınır bırakmaz.
  col = screenB(col, blob * 0.09 * smoothstep(0.20, 1.15, field));
  // Blob içinde hafif hacim: alan yoğunluğu arttıkça parlasın.
  col = screenB(col, blob * 0.13 * smoothstep(1.6, 3.6, field));
  // Genel üst ışık.
  col *= 0.94 + 0.15 * (1.0 - uv.y);
  col *= vign(uv, 0.34);
  outColor = vec4(dith(col), 1.0);
}
`;

const WAVES = `
// Geniş sinüs dalga şeritleri; her şeridin kenarında ince parlak çizgi.
void main() {
  vec2 uv = uvTop();
  float sd = u_seed * 0.7314;
  float inten = max(u_p1, 0.0);
  float freqK = clamp(u_p2, 0.2, 4.0);

  vec3 col = mix(u_colors[0], mix(u_colors[0], u_colors[1], 0.30), smoothstep(0.0, 1.0, uv.y));

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ph = sd * 6.0 + fi * 2.39996;
    float amp = 0.050 + 0.026 * hash11(ph);
    float freq = (0.85 + fi * 0.5) * freqK;
    float yc = 0.16 + fi * 0.215 + 0.045 * sin(ph * 1.7);

    float y = yc
      + amp * sin(uv.x * TAU * freq + ph * 2.0)
      + amp * 0.42 * sin(uv.x * TAU * freq * 2.17 + ph * 3.1)
      + 0.018 * (fbm(vec2(uv.x * 2.2 + ph, ph * 0.5), 4) - 0.5);

    float th = 0.085 + 0.038 * fi;
    float e = (uv.y - y) / th;
    float g = exp(-e * e) * inten;
    col = screenB(col, colAt(1 + wrap3(i)) * g * 0.66);

    // Şeridin tepesinde çok yumuşak bir ışık sırtı (kontur çizgisi gibi durmasın).
    float ew = 0.022 + 0.010 * fi;
    float e2 = (uv.y - y) / ew;
    col = screenB(col, vec3(1.0) * exp(-e2 * e2) * 0.05 * inten);
  }

  col *= vign(uv, 0.40);
  outColor = vec4(dith(col), 1.0);
}
`;

const HALO = `
// Merkez dışı ışık halkası + glow. Koyu App Store estetiği.
void main() {
  vec2 uv = uvTop();
  vec2 p = pw(uv);
  float sd = u_seed;
  float inten = max(u_p1, 0.0);
  float size = clamp(u_p2, 0.25, 3.0);

  vec2 c1 = vec2(mix(-0.26, 0.26, hash11(sd * 0.517 + 1.0)),
                 mix(-0.52, -0.04, hash11(sd * 1.131 + 3.0)));
  float d = length(p - c1);
  float R = 0.40 * size;
  float ringW = 0.052 * size;

  // Zemin: neredeyse siyah, merkeze doğru azıcık açılıyor.
  vec3 col = u_colors[0] * (0.82 + 0.30 * smoothstep(1.3, 0.0, d));

  float e = (d - R) / ringW;
  float ring = exp(-e * e);
  float inner = exp(-(d / (R * 0.85)) * (d / (R * 0.85)));
  float glow = exp(-d * 2.0 / max(size, 0.25));

  col = screenB(col, u_colors[1] * ring * 0.95 * inten);
  col = screenB(col, u_colors[1] * inner * 0.22 * inten);
  col = screenB(col, u_colors[2] * glow * 0.42 * inten);

  // İkinci, küçük ve uzak halo — kompozisyona derinlik katar.
  vec2 c2 = c1 + vec2(0.30, 0.62);
  float d2 = length(p - c2);
  float e2 = (d2 - 0.14 * size) / (0.10 * size);
  col = screenB(col, u_colors[3] * (exp(-d2 * 3.2) * 0.30 + exp(-e2 * e2) * 0.20) * inten);

  // Duman/atmosfer dokusu.
  float n = fbm(p * 2.4 + sd * 0.31, 5);
  col *= 0.84 + 0.28 * n;

  col *= vign(uv, 0.85);
  outColor = vec4(dith(col), 1.0);
}
`;

const MARBLE = `
// Mermer: turbulence ile bükülmüş sinüs → ince damarlar + benekli taban.
void main() {
  vec2 uv = uvTop();
  float scale = clamp(u_p2, 0.25, 4.0);
  float thick = sat(u_p1);
  vec2 p = pw(uv) * 2.2 * scale;
  float sd = u_seed * 0.4131;

  float tb = turb(p + sd, 6);
  float mott = fbm(p * 0.65 + vec2(3.1, sd), 5);

  float s1 = sin((p.x * 2.1 + p.y * 0.85 + tb * 3.5) * PI + sd * TAU);
  float v1 = pow(sat(1.0 - abs(s1)), mix(16.0, 5.0, thick));

  float s2 = sin((p.x * 4.6 - p.y * 1.9 + tb * 5.2) * PI + 1.7 - sd * 2.0);
  float v2 = pow(sat(1.0 - abs(s2)), 24.0);

  vec3 base = mix(u_colors[0], u_colors[1], smoothstep(0.22, 0.86, mott));
  base = mix(base, u_colors[2], 0.30 * smoothstep(0.50, 1.0, tb));

  vec3 col = mix(base, u_colors[3], v1 * 0.92);
  col = screenB(col, u_colors[3] * v2 * 0.45);
  // Taş yüzeyinin nefesi.
  col *= 0.90 + 0.18 * mott;
  col *= vign(uv, 0.34);
  outColor = vec4(dith(col), 1.0);
}
`;

const RAYS = `
// Merkezden yayılan yumuşak ışınlar — seher/nur hissi. Dikişsiz açısal desen:
// gürültü birim çember üzerinden örneklenir, böylece ±PI dikişi oluşmaz.
void main() {
  vec2 uv = uvTop();
  vec2 p = pw(uv);
  float sd = u_seed * 0.2917;
  float inten = max(u_p1, 0.0);
  float count = clamp(u_p2, 0.25, 4.0);

  vec2 c = vec2(0.0, -0.58);            // kaynak: üst orta
  vec2 v = p - c;
  float r = length(v);
  vec2 dir = v / max(r, 1e-4);
  float a = atan(dir.y, dir.x);

  float k = 7.0 * count;
  float ang =
      fbm(dir * 2.6 + sd, 4) * 1.55
    + 0.26 * sin(a * k + sd * TAU)
    + 0.14 * sin(a * k * 1.87 - sd * 3.7)
    + 0.07 * sin(a * k * 3.13 + sd * 1.9);

  // Işınlar kaynağın hemen dibinde erisin, orta mesafede ayrışsın, uzakta sönsün.
  float rays = smoothstep(0.26, 1.05, ang) * smoothstep(0.0, 0.55, r);
  float fall = exp(-r * 1.05) * 0.80 + exp(-r * 0.40) * 0.30;

  vec3 col = mix(u_colors[0], u_colors[0] * 0.52, smoothstep(0.10, 1.0, uv.y));
  col = screenB(col, u_colors[1] * rays * fall * 0.85 * inten);
  col = screenB(col, u_colors[2] * exp(-r * 4.2) * 0.45 * inten);   // yumuşak çekirdek
  col = screenB(col, u_colors[3] * exp(-r * 1.15) * 0.22 * inten);  // geniş hare

  // Havadaki ince toz — ışınların kenarını yumuşatır.
  col += (fbm(p * 8.5 + sd * 2.0, 3) - 0.5) * 0.022;

  col *= vign(uv, 0.62);
  outColor = vec4(dith(col), 1.0);
}
`;


// ---------------------------------------------------------------------------
// R10 — üç yeni zemin. Mevcut sekizin dokunulmadığına dikkat: katalog id
// sırası kontrat, yenisi yalnız SONA eklenir.
// ---------------------------------------------------------------------------

const PRISM = `
// Mesh gradyan: dört renk çapası, ters-mesafe küpü ağırlıklı karışım.
// metaball'dan farkı KENARSIZ olması — eşik yok, tek sürekli renk yüzeyi.
// Arc/Linear marka zeminlerinin dili; dither olmadan 1320x2868'de bantlanır.
void main() {
  vec2 uv = uvTop();
  vec2 p = pw(uv);
  float sd = u_seed * 0.4817;
  float warpAmt = clamp(u_p1, 0.0, 2.0);
  float spread  = clamp(u_p2, 0.4, 3.0);

  // Domain warp: çapalar arası geçişi kıvırır — düz radyal karışım fazla
  // "yazılımsal" duruyordu, hafif bükülme el işi ipek hissi veriyor.
  vec2 w = vec2(fbm(p * 1.7 + sd, 4), fbm(p * 1.7 + sd + 4.7, 4)) - 0.5;
  p += w * 0.42 * warpAmt;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float h1 = hash11(sd * 0.771 + fi * 2.117);
    float h2 = hash11(sd * 1.319 + fi * 3.733 + 7.0);
    vec2 c = vec2(mix(-0.44, 0.44, h1), mix(-0.90, 0.90, h2));
    float d = length((p - c) / spread) + 0.14;
    float wt = 1.0 / (d * d * d);
    acc += colAt(i) * wt;
    wsum += wt;
  }
  vec3 col = acc / max(wsum, 1e-4);

  // Işık yönü: üstte hafif açılma, altta toplanma — kadraj cihaza iner.
  col *= 0.92 + 0.16 * (1.0 - uv.y);
  col = screenB(col, col * 0.07 * smoothstep(0.9, 0.0, uv.y));
  col *= vign(uv, 0.28);
  outColor = vec4(dith(col), 1.0);
}
`;

const GRID = `
// Teknik ızgara: ince minör + parlak majör çizgiler, merkezden dışa sönerek.
// Zemin neredeyse düz; ızgara yalnız kadrajın ortasında okunur, kenarda erir —
// böylece cihazın arkasında "blueprint" hissi kalır ama metni yormaz.
void main() {
  vec2 uv = uvTop();
  vec2 p = pw(uv);
  float sd = u_seed * 0.313;
  float glow = max(u_p1, 0.0);
  float cells = clamp(u_p2, 0.25, 4.0);

  vec3 col = mixP(u_colors[0], mixP(u_colors[0], u_colors[1], 0.34), smoothstep(1.0, 0.0, uv.y));

  float n = 16.0 * cells;
  vec2 off = vec2(hash11(sd), hash11(sd + 3.0)) * 0.5;
  vec2 g = fract(p * n + 0.5 + off) - 0.5;
  float lw = 0.028;
  float line = max(1.0 - smoothstep(0.0, lw, abs(g.x)),
                   1.0 - smoothstep(0.0, lw, abs(g.y)));

  vec2 G = fract(p * (n * 0.25) + 0.5 + off * 0.25) - 0.5;
  float LW = 0.014;
  float major = max(1.0 - smoothstep(0.0, LW, abs(G.x)),
                    1.0 - smoothstep(0.0, LW, abs(G.y)));

  // Dikey ekseni sıkıştırarak sönüm: dikey slaytta daire yerine elips istiyoruz.
  float r = length(p * vec2(1.0, 0.62));
  float fade = exp(-r * 1.9);

  col = screenB(col, u_colors[2] * line  * 0.14 * fade * glow);
  col = screenB(col, u_colors[2] * major * 0.28 * fade * glow);
  col = screenB(col, u_colors[3] * exp(-r * 2.6) * 0.32 * glow);

  col += (fbm(p * 6.0 + sd, 3) - 0.5) * 0.014;
  col *= vign(uv, 0.55);
  outColor = vec4(dith(col), 1.0);
}
`;

const BOKEH = `
// Odak dışı ışık diskleri. Gerçek bokeh'in imzası düz gövde + parlak KENAR
// halkasıdır; düz gauss lekeler plastik duruyor, o yüzden ikisi ayrı çiziliyor.
void main() {
  vec2 uv = uvTop();
  vec2 p = pw(uv);
  float sd = u_seed * 0.5171;
  float inten = max(u_p1, 0.0);
  float size = clamp(u_p2, 0.25, 3.0);

  float cloud = fbm(p * 1.4 + sd, 5);
  vec3 col = mixP(u_colors[0], mixP(u_colors[0], u_colors[1], 0.55), smoothstep(0.15, 0.9, cloud));

  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float h1 = hash11(sd * 0.611 + fi * 1.913);
    float h2 = hash11(sd * 1.277 + fi * 2.531 + 5.0);
    float h3 = hash11(sd * 0.937 + fi * 3.119 + 11.0);
    vec2 c = vec2(mix(-0.52, 0.52, h1), mix(-1.02, 1.02, h2));
    float R = mix(0.07, 0.21, h3) * size;
    float d = length(p - c);
    float body = 1.0 - smoothstep(R * 0.72, R, d);
    float e = (d - R * 0.88) / (R * 0.16);
    float rim = exp(-e * e);
    vec3 tint = colAt(1 + wrap3(i));
    col = screenB(col, tint * (body * 0.09 + rim * 0.15) * inten);
  }

  col = screenB(col, u_colors[3] * 0.10 * smoothstep(1.0, 0.2, length(p)) * inten);
  col *= vign(uv, 0.62);
  outColor = vec4(dith(col), 1.0);
}
`;

/** Sık kullanılan slider sınırları — tanımları kısa tutmak için. */
const P = (keys: string[], label: string, def: number, min: number, max: number, step = 0.05): ParamDef => ({
  keys,
  label,
  def,
  min,
  max,
  step,
});

const SHADERS: ShaderDef[] = [
  { id: "aurora",   name: "Aurora",  p1: P(["intensity", "p1"], L("Şiddet", "Intensity"), 1.0, 0, 2),        p2: P(["softness", "p2"], L("Yumuşaklık", "Softness"), 1.0, 0.25, 4),  main: AURORA },
  { id: "silk",     name: L("İpek", "Silk"),    p1: P(["sheen", "p1"], L("Saten parlaklık", "Satin sheen"), 1.0, 0, 2),   p2: P(["scale", "p2"], L("Ölçek", "Scale"), 1.0, 0.25, 4),          main: SILK },
  { id: "grain",    name: L("Gren", "Grain"),    p1: P(["grain", "p1"], L("Gren", "Grain"), 0.07, 0, 0.5, 0.005),    p2: P(["curve", "p2"], L("Geçiş eğrisi", "Transition curve"), 1.0, 0.2, 4),    main: GRAIN },
  { id: "metaball", name: "Blob",    p1: P(["softness", "p1"], L("Yumuşaklık", "Softness"), 1.0, 0.1, 4),   p2: P(["scale", "p2"], L("Ölçek", "Scale"), 1.0, 0.3, 3),           main: METABALL },
  { id: "waves",    name: L("Dalga", "Waves"),   p1: P(["intensity", "p1"], L("Şiddet", "Intensity"), 1.0, 0, 2),        p2: P(["freq", "p2"], L("Frekans", "Frequency"), 1.0, 0.2, 4),          main: WAVES },
  { id: "halo",     name: L("Hale", "Halo"),    p1: P(["intensity", "p1"], L("Şiddet", "Intensity"), 1.0, 0, 2),        p2: P(["size", "p2"], L("Boyut", "Size"), 1.0, 0.25, 3),           main: HALO },
  { id: "marble",   name: L("Mermer", "Marble"),  p1: P(["veins", "p1"], L("Damar kalınlığı", "Vein thickness"), 0.35, 0, 1, 0.02), p2: P(["scale", "p2"], L("Ölçek", "Scale"), 1.0, 0.25, 4),     main: MARBLE },
  { id: "rays",     name: L("Işınlar", "Rays"), p1: P(["intensity", "p1"], L("Şiddet", "Intensity"), 1.0, 0, 2),        p2: P(["count", "p2"], L("Işın sayısı", "Ray count"), 1.0, 0.25, 4),    main: RAYS },
  // --- R10 eklemeleri (katalog SONUNA; mevcut sıra korunur) ---
  { id: "prism",    name: L("Prizma", "Prism"),  p1: P(["warp", "p1"], L("Kıvrım", "Warp"), 1.0, 0, 2),             p2: P(["spread", "p2"], L("Yayılım", "Spread"), 1.0, 0.4, 3),        main: PRISM },
  { id: "grid",     name: L("Izgara", "Grid"),  p1: P(["glow", "p1"], L("Işık", "Glow"), 1.0, 0, 2),               p2: P(["cells", "p2"], L("Hücre", "Cells"), 1.0, 0.25, 4),          main: GRID },
  { id: "bokeh",    name: "Bokeh",   p1: P(["intensity", "p1"], L("Şiddet", "Intensity"), 1.0, 0, 2),        p2: P(["size", "p2"], L("Boyut", "Size"), 1.0, 0.25, 3),           main: BOKEH },
];

const BY_ID = new Map<string, ShaderDef>(SHADERS.map((s) => [s.id, s]));

/** Editörün slider kurabilmesi için parametre tanımının dışa açık şekli. */
export type ShaderParamDef = {
  /** params sözlüğüne yazılacak kanonik anahtar. */
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
};

/**
 * Editör/LLM için shader kataloğu — id sırası kontrattır, değiştirme.
 * p1/p2 alanları WP-F ile eklendi; eski tüketiciler yalnız id/name okur.
 */
export const SHADER_DEFS: {
  id: string;
  name: string;
  p1: ShaderParamDef;
  p2: ShaderParamDef;
}[] = SHADERS.map((s) => ({
  id: s.id,
  name: s.name,
  p1: { key: s.p1.keys[0], label: s.p1.label, def: s.p1.def, min: s.p1.min, max: s.p1.max, step: s.p1.step },
  p2: { key: s.p2.keys[0], label: s.p2.label, def: s.p2.def, min: s.p2.min, max: s.p2.max, step: s.p2.step },
}));

/** Bilinmeyen id → katalogdaki ilk shader (renderShader ile aynı davranış). */
export function shaderDef(id: string): (typeof SHADER_DEFS)[number] {
  return SHADER_DEFS.find((s) => s.id === id) ?? SHADER_DEFS[0];
}

// ---------- Renk ayrıştırma ----------

const DEFAULT_COLORS = ["#0d0f1a", "#3b2f80", "#7b5cff", "#22d3ee"];

/** "#abc", "#aabbcc", "#aabbccdd", "rgb(...)" → 0..1 aralığında RGB. */
function parseColor(input: string): [number, number, number] {
  const s = (input || "").trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(",").map((x) => parseFloat(x));
    const r = Number.isFinite(parts[0]) ? parts[0] : 0;
    const g = Number.isFinite(parts[1]) ? parts[1] : 0;
    const b = Number.isFinite(parts[2]) ? parts[2] : 0;
    return [r / 255, g / 255, b / 255];
  }
  let hex = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    hex = hex
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) return [0, 0, 0];
  const n = parseInt(hex.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Paleti tam 4 renge tamamlar (eksikler son rengi tekrarlar). */
function toPalette(colors: string[]): Float32Array {
  const src = colors && colors.length ? colors : DEFAULT_COLORS;
  const out = new Float32Array(12);
  let last: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const c = i < src.length ? parseColor(src[i]) : last;
    last = c;
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

function pickParam(params: Record<string, number> | undefined, keys: string[], def: number): number {
  if (!params) return def;
  for (const k of keys) {
    const v = params[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return def;
}

// ---------- WebGL singleton ----------

const VERT = `#version 300 es
// Attribute'suz fullscreen üçgen.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

type ProgramInfo = {
  program: WebGLProgram;
  uRes: WebGLUniformLocation | null;
  uSeed: WebGLUniformLocation | null;
  uColors: WebGLUniformLocation | null;
  uP1: WebGLUniformLocation | null;
  uP2: WebGLUniformLocation | null;
};

type GLBundle = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  programs: Map<string, ProgramInfo | null>;
  maxDim: number;
};

let bundle: GLBundle | null = null;

function createBundle(): GLBundle | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // drawImage ile kopyalayabilmek için şart
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  const maxDim = Math.min(
    dims && dims.length >= 2 ? Math.min(dims[0], dims[1]) : 4096,
    (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096,
    8192
  );
  // VAO: WebGL2'de varsayılan VAO var ama bazı sürücülerde açıkça bağlamak güvenli.
  const vao = gl.createVertexArray();
  if (vao) gl.bindVertexArray(vao);
  return { canvas, gl, programs: new Map(), maxDim: Math.max(256, maxDim) };
}

function getBundle(): GLBundle | null {
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
    console.warn("[shaders] derleme hatası:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function getProgram(b: GLBundle, def: ShaderDef): ProgramInfo | null {
  const cached = b.programs.get(def.id);
  if (cached !== undefined) return cached;

  const gl = b.gl;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, PRELUDE + def.main);
  let info: ProgramInfo | null = null;
  if (vs && fs) {
    const program = gl.createProgram();
    if (program) {
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        info = {
          program,
          uRes: gl.getUniformLocation(program, "u_res"),
          uSeed: gl.getUniformLocation(program, "u_seed"),
          uColors: gl.getUniformLocation(program, "u_colors[0]"),
          uP1: gl.getUniformLocation(program, "u_p1"),
          uP2: gl.getUniformLocation(program, "u_p2"),
        };
      } else {
        console.warn("[shaders] link hatası:", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
      }
    }
  }
  if (vs) gl.deleteShader(vs);
  if (fs) gl.deleteShader(fs);
  b.programs.set(def.id, info);
  return info;
}

// ---------- Fallback (WebGL yoksa / derleme çökerse) ----------

function paintFallback(ctx: CanvasRenderingContext2D, colors: string[], w: number, h: number): void {
  const src = colors && colors.length ? colors : DEFAULT_COLORS;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const n = Math.max(2, Math.min(src.length, 4));
  for (let i = 0; i < n; i++) g.addColorStop(i / (n - 1), src[Math.min(i, src.length - 1)]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rg = ctx.createRadialGradient(w * 0.5, h * 0.32, 0, w * 0.5, h * 0.32, Math.max(w, h) * 0.7);
  rg.addColorStop(0, "rgba(255,255,255,0.10)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
}

// ---------- Kamusal API ----------

/**
 * Shader'ı verilen boyutta çizer ve YENİ bir 2d canvas döndürür.
 * Deterministik: zaman kullanılmaz, aynı girdi aynı pikselleri verir.
 * Bilinmeyen shaderId → katalogdaki ilk shader'a düşer.
 */
export function renderShader(
  shaderId: string,
  colors: string[],
  seed: number,
  params: Record<string, number> | undefined,
  w: number,
  h: number
): HTMLCanvasElement {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (!octx) return out;

  const def = BY_ID.get(shaderId) ?? SHADERS[0];
  const b = getBundle();
  const prog = b ? getProgram(b, def) : null;

  if (!b || !prog) {
    paintFallback(octx, colors, W, H);
    return out;
  }

  // Cihaz limitini aşan boyutlarda küçük çöz, ölçekleyerek bas.
  const k = Math.min(1, b.maxDim / Math.max(W, H));
  const RW = Math.max(1, Math.round(W * k));
  const RH = Math.max(1, Math.round(H * k));

  const gl = b.gl;
  if (b.canvas.width !== RW) b.canvas.width = RW;
  if (b.canvas.height !== RH) b.canvas.height = RH;
  gl.viewport(0, 0, RW, RH);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  gl.useProgram(prog.program);
  if (prog.uRes) gl.uniform2f(prog.uRes, RW, RH);
  // Seed'i makul bir aralığa sıkıştır: büyük sayılar float hassasiyetini bozar.
  const s = Number.isFinite(seed) ? seed : 0;
  if (prog.uSeed) gl.uniform1f(prog.uSeed, ((s % 4096) + 4096) % 4096);
  if (prog.uColors) gl.uniform3fv(prog.uColors, toPalette(colors));
  if (prog.uP1) gl.uniform1f(prog.uP1, pickParam(params, def.p1.keys, def.p1.def));
  if (prog.uP2) gl.uniform1f(prog.uP2, pickParam(params, def.p2.keys, def.p2.def));

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (gl.isContextLost()) {
    bundle = null;
    paintFallback(octx, colors, W, H);
    return out;
  }

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(b.canvas, 0, 0, RW, RH, 0, 0, W, H);
  return out;
}
