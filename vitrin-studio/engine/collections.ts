import type { Theme } from "./types";
import { L } from "@/lib/i18n";

// GPT Image artwork is separate from editable type and live device geometry.
export const COLLECTIONS = [
  { id: "solstice", name: "Solstice", description: L("Güneş, mimari ve sıcak taş", "Sun, architecture and warm stone"), color: "#a74423", paper: "#f7dcc0", ink: "#4c2519", font: "Fraunces", camera: "hero-right" },
  { id: "tidal", name: "Tidal", description: L("Akışkan cam ve suyun ışığı", "Fluid glass and the light of water"), color: "#007d9b", paper: "#e2f8fc", ink: "#083a4c", font: "Manrope", camera: "front" },
  { id: "bloom", name: "Bloom", description: L("Botanik, derin yeşil ve doğal ışık", "Botanical, deep green and natural light"), color: "#c9e6a6", paper: "#10251b", ink: "#f1f8e5", font: "Newsreader", camera: "hero-left" },
  { id: "orbit", name: "Orbit", description: L("Saten krom ve yörüngesel formlar", "Satin chrome and orbital forms"), color: "#7452a7", paper: "#eae1f5", ink: "#30213f", font: "Sora", camera: "three-quarter" },
  { id: "play", name: "Play", description: L("Cesur renkler ve heykelsi geometri", "Bold colors and sculptural geometry"), color: "#225af3", paper: "#ffe679", ink: "#202238", font: "Bricolage Grotesque", camera: "front" },
] as const;

export const COLLECTION_THEMES: Theme[] = COLLECTIONS.map((c) => ({
  id: c.id, name: c.name,
  background: { kind: "image", src: `/assets/collections/${c.id}.webp` },
  altBackgrounds: [
    { kind: "solid", color: c.paper },
    { kind: "image", src: `/assets/collections/${c.id}.webp`, overlayColor: c.paper, overlayAlpha: .38 },
    { kind: "linear", stops: [[c.paper, 0], [c.id === "bloom" ? "#20392b" : "#ffffff", 1]], angle: 165 },
  ],
  headline: { fontFamily: c.font, weight: c.id === "solstice" || c.id === "bloom" ? 600 : 700, sizePx: c.id === "play" ? 144 : 116, lineHeight: 1.04, letterSpacing: c.id === "play" ? -5 : -2.5, color: c.ink, align: "center", transform: "none" },
  sub: { fontFamily: "Instrument Sans", weight: 500, sizePx: 38, lineHeight: 1.4, letterSpacing: .1, color: c.id === "bloom" ? "#c6d8bb" : c.ink, align: "center", transform: "none" },
  badge: { bg: c.color, color: c.id === "bloom" ? "#14241a" : "#ffffff", fontFamily: "Instrument Sans" },
  device: { mode: "3d", model: "real", camera: c.camera, lightRig: c.id === "bloom" ? "rim" : c.id === "solstice" ? "daylight" : "softbox", bodyColor: c.id === "bloom" ? "#252e27" : "#cbd0d8", shadow: true, reflection: false, float: .06, glare: .035 },
  defaultLayout: "text-top", accent: c.color,
}));
