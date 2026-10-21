// Ortak dosya-sistemi köprüsü — ingest taramasının izin listesi + yol yardımcıları.
//
// İki rota paylaşır:
//   · app/api/ingest — POST taradığı kökleri buraya yazar, GET ?file= ile servis eder
//   · app/api/shots  — POST kaynak dosyayı data/shots'a kopyalamadan önce buradan sorar
//
// Güvenlik modeli ikisinde de AYNI ve DEĞİŞMEDİ: bir dosya ancak daha önce
// taranmış bir ağacın içindeyse okunabilir; sembolik bağ oyunlarına karşı hem
// hedef hem izinli kök realpath'e indirgenir.

import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Servis edilebilen/kopyalanabilen görsel uzantıları. */
export const IMG_RE = /\.(png|jpe?g|webp)$/i;

/** Kare içeren metin dosyaları (locale MD'leri). */
export const MD_RE = /\.(md|markdown|txt)$/i;

/** Taramada asla inilmeyen klasörler. */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".venv", ".venv-psd", "__pycache__", "dist", "build",
]);

export const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/* ------------------------------------------------------------------ *
   Yol yardımcıları
 * ------------------------------------------------------------------ */

/** "~/Desktop/x" → "/Users/…/Desktop/x"; sonuç her zaman mutlak. */
export function expandPath(input: string): string {
  let s = input.trim().replace(/^["']|["']$/g, "");
  // Finder'dan sürüklenen yollarda kaçışlı boşluk olabilir: "a\ b"
  s = s.replace(/\\ /g, " ");
  if (s === "~") s = os.homedir();
  else if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
  return path.resolve(s);
}

/** Gerçek yola indirger; çözülemezse verilen yolu döner. */
export async function realOr(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

export function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** Gezinmenin ve taramanın üst sınırı — ev klasörü. */
export function homeRoot(): Promise<string> {
  return realOr(os.homedir());
}

/**
 * Kalıcı ekran görüntüsü deposu (app/api/shots yazar ve okur).
 * Rota dosyalarından export edilemez — Next rota modüllerinde yalnız HTTP
 * metotları ve tanınan config alanları serbest; bu yüzden sabit burada durur.
 */
export const SHOTS_DIR = path.join(process.cwd(), "data", "shots");

/* ------------------------------------------------------------------ *
   İzinli kökler — ingest POST yazar, ingest GET + shots POST okur
 * ------------------------------------------------------------------ */

const ROOTS_FILE = path.join(process.cwd(), "data", "cache", "ingest-roots.json");
const roots = new Set<string>();
let rootsLoaded = false;

/** Dev sunucusu modülü yeniden yüklerse bellekteki liste kaybolur; diskten tazele. */
export async function loadRoots(): Promise<void> {
  if (rootsLoaded) return;
  rootsLoaded = true;
  try {
    const raw = await readFile(ROOTS_FILE, "utf8");
    const list = JSON.parse(raw) as unknown;
    if (Array.isArray(list)) for (const r of list) if (typeof r === "string") roots.add(r);
  } catch {
    // dosya yok — ilk taramada oluşur
  }
}

async function saveRoots(): Promise<void> {
  try {
    await mkdir(path.dirname(ROOTS_FILE), { recursive: true });
    // Son 40 kök yeter; liste sonsuz büyümesin.
    const list = [...roots].slice(-40);
    roots.clear();
    for (const r of list) roots.add(r);
    await writeFile(ROOTS_FILE, JSON.stringify(list), "utf8");
  } catch {
    // yazılamadıysa bellekteki liste yine de bu süreç boyunca geçerli
  }
}

/** Taranan kökleri izin listesine ekler (tekrarlar zararsız). */
export async function addRoots(list: string[]): Promise<void> {
  await loadRoots();
  for (const r of list) if (r) roots.add(r);
  await saveRoots();
}

/**
 * `target` (realpath'e indirgenmiş olmalı) taranmış bir ağacın içinde mi?
 * `?file=` servisi ve `/api/shots` kopyalaması aynı kapıdan geçer.
 */
export async function isAllowedFile(target: string): Promise<boolean> {
  await loadRoots();
  for (const r of roots) {
    if (isInside(await realOr(r), target)) return true;
  }
  return false;
}
