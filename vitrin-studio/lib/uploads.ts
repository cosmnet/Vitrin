// Sürükle-bırak ve yapıştırılan görseller: süzme ve sunucuya yükleme (/api/uploads).

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;

/** Bırakılan / yapıştırılan dosyalardan yalnız görselleri seçer. */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => f.type.startsWith("image/") || IMAGE_NAME.test(f.name));
}

/** Dosyayı yükler, slaytta kullanılacak yolu döndürür (/assets/stickers/yuklenen/…). */
export async function uploadImage(file: File): Promise<string> {
  const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1] || "png";
  const name = IMAGE_NAME.test(file.name) ? file.name : `gorsel.${ext}`;
  const res = await fetch(`/api/uploads?name=${encodeURIComponent(name)}`, { method: "POST", body: file });
  const data = (await res.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!res.ok || !data.src) throw new Error(data.error || res.statusText);
  return data.src;
}

/**
 * v1.0 — ekran görüntüsünü kalıcı depoya yükler (`data/shots/<sha1>`), proje
 * JSON'una yalnız kısa URL yazılır. Sunucuya ulaşılamazsa dataURL'e düşer:
 * kullanıcının bıraktığı dosya hiçbir koşulda kaybolmaz.
 */
export async function uploadScreenshot(file: File): Promise<{ id: string; name: string; dataUrl: string }> {
  const id = Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
  const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "ekran";
  try {
    const res = await fetch(`/api/shots?upload=1&name=${encodeURIComponent(file.name || "ekran.png")}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (res.ok && data.url) return { id, name, dataUrl: data.url };
  } catch {
    /* aşağıdaki yedek yol */
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return { id, name, dataUrl };
}
