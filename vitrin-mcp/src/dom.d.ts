// /headless-export sayfasının yayınladığı globaller — page.evaluate içindeki
// kodun tipi buradan gelir. Sayfa tarafındaki bildirimle (app/headless-export/
// page.tsx) BİREBİR aynı olmalıdır.

interface VitrinPreviewItem {
  locale: string;
  slide: number;
  file: string;
  width: number;
  height: number;
  dataUrl: string;
}

interface VitrinExportSummary {
  ok: boolean;
  paths: string[];
  written: number;
  files: string[];
}

interface Window {
  __vitrinProgress?: { done: number; total: number; current: string };
  __vitrinDone?: boolean;
  __vitrinError?: string;
  __vitrinResult?: string | VitrinPreviewItem[] | VitrinExportSummary;
  __vitrinResults?: VitrinPreviewItem[];
  __vitrinUsage?: boolean;
  __vitrinWebgl?: boolean;
}
