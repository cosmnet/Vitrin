// Görsel önbelleği — dataURL ve /assets yolları için tek yükleyici.

import { optimizedSrc } from "./media";
const fingerprints = new Map<string, number>();
const sessionId = Date.now().toString(36);
let fingerprintId = 0;
/** Immutable image strings get unique cache keys without repeated megabyte scans. */
export function sourceFingerprint(src?: string): string {
  if (!src) return "";
  if (src.length < 128) return src;
  let id = fingerprints.get(src);
  if (id === undefined) {
    id = ++fingerprintId; fingerprints.set(src, id);
    if (fingerprints.size > 256) fingerprints.delete(fingerprints.keys().next().value!);
  }
  return `${sessionId}:${id}`;
}
const cache = new Map<string, Promise<HTMLImageElement | null>>();
const pixels = new Map<string, number>();
const MAX_PIXELS = 36_000_000;
const MAX_IMAGES = 40;
function trimImages() {
  let total = [...pixels.values()].reduce((a,b)=>a+b,0);
  for(const key of cache.keys()) {
    if(cache.size<=MAX_IMAGES && total<=MAX_PIXELS) break;
    const cost=pixels.get(key);
    if(cost===undefined) continue;
    total-=cost;pixels.delete(key);cache.delete(key);
  }
}
export function imageCacheStats() { return { images: cache.size, pixels: [...pixels.values()].reduce((a,b)=>a+b,0) }; }
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const key=optimizedSrc(src);
  const hit=cache.get(key);
  if(hit) { cache.delete(key);cache.set(key,hit);return hit; }
  const promise=new Promise<HTMLImageElement | null>(resolve=>{
    const im=new Image();im.decoding="async";
    im.onload=()=>{ pixels.set(key,im.naturalWidth*im.naturalHeight);trimImages();resolve(im); };
    im.onerror=()=>{cache.delete(key);pixels.delete(key);resolve(null);};
    im.src=key;
  });
  cache.set(key,promise);return promise;
}

/** img'yi (x,y,w,h) kutusuna taşırmadan doldurarak (cover) çizer. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
  focusY = 0.5
): void {
  const iw = img.width;
  const ih = img.height;
  const ir = iw / ih;
  const r = w / h;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (ir > r) {
    sw = ih * r;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / r;
    sy = (ih - sh) * focusY;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
