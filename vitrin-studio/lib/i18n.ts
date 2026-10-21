// Arayüz dili — Türkçe / English.
//
// Her metin iki diliyle birlikte yazılır: L("Dışa aktar", "Export"). Ortak
// sözlük yok; metin, kullanıldığı yerde okunur kalır. Dil sayfa yüklenirken
// bir kez seçilir (stüdyo yalnız istemcide çalışır); değiştirmek sayfayı
// yeniler. Sunucuda (API, headless) her zaman Türkçe.

export type Lang = "tr" | "en";

const KEY = "vitrin:lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export const LANG: Lang = typeof window === "undefined" ? "tr" : detect();

// CSS büyük harfi dile göre çevirir: lang="tr" kalırsa "Minimal" → "MİNİMAL".
if (typeof document !== "undefined") document.documentElement.lang = LANG;

/** Etkin dile göre metni seçer. */
export const L = (tr: string, en: string): string => (LANG === "en" ? en : tr);

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  location.reload();
}
