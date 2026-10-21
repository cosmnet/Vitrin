// Tarayıcı yardımcıları: dosya okuma, görsel küçültme (director payload'u için).

import { uid, type Screenshot } from "@/engine/types";

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export async function filesToScreenshots(files: File[]): Promise<Screenshot[]> {
  const out: Screenshot[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    out.push({ id: uid(), name: f.name.replace(/\.[a-z]+$/i, ""), dataUrl: await readFileAsDataUrl(f) });
  }
  return out;
}

/** Vision payload'ı için dataURL'i maks yüksekliğe küçültüp JPEG'e çevirir. */
export async function downscaleDataUrl(dataUrl: string, maxH = 760): Promise<string> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = dataUrl;
  });
  if (!img) return dataUrl;
  const scale = Math.min(1, maxH / img.height);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `İstek başarısız (${res.status})`);
  return data;
}
