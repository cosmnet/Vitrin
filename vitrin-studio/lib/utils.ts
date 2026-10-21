import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-uyumlu class birleştirici — components/ui bileşenleri bunu bekler. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
