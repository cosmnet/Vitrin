"use client";

// Proje merkezi küçük resimleri — ilk slaydın 360px render'ı, sunucuda
// data/projects/.thumbs/<id>.webp. Başarısızlık sessizdir: küçük resim
// olmadan da her şey çalışır.

import { renderSlide } from "@/engine/render";
import { baseOf, formatOf, type Project } from "@/engine/types";

const thumbAt = new Map<string, number>();

/** Kayıttan sonra çağrılır; proje başına en fazla 40 sn'de bir. */
export async function writeProjectThumb(project: Project, force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - (thumbAt.get(project.id) ?? 0) < 40_000) return false;
  thumbAt.set(project.id, now);
  const slide = project.sets[project.activeLocale]?.slides[0] ?? Object.values(project.sets)[0]?.slides[0];
  if (!slide) return false;
  try {
    const fmt = formatOf(project);
    const B = baseOf(fmt);
    const w = 360;
    const h = Math.round((w * B.h) / B.w);
    const c = await renderSlide(slide, { format: fmt, width: w, height: h, draft: false, locale: project.activeLocale });
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.82));
    if (!blob) return false;
    const res = await fetch(`/api/projects?thumb=${encodeURIComponent(project.id)}`, { method: "POST", body: blob });
    return res.ok;
  } catch {
    return false;
  }
}
