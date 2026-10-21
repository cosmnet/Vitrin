import manifest from "../public/assets/media-manifest.json";
import { BRAND_COLLECTIONS } from "./brandThemes";
type MediaEntry = { src: string; preview: string; width?: number; height?: number; bytes: number; previewBytes: number };
const media=manifest as Record<string,MediaEntry>;
export function optimizedSrc(src:string):string { return media[src]?.src ?? src; }
export function previewSrc(src:string):string {
  if (src && BRAND_COLLECTIONS.some(c => src.startsWith(`/assets/brand/${c.id}/`))) return `/assets/brand-previews/${src.split("/").at(-1)}`;
  return media[src]?.preview ?? src;
}
export function mediaInfo(src:string):MediaEntry | undefined { return media[src]; }
