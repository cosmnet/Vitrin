"use client";

// SOL İKON RAYI — 60px, kalıcı iskelet.
//
// Rapor §0: VEED / Vimeo / Magnific hepsinde ray + çekmece ikilisi var.
// Çekmece kapansa bile ray kalır, yani uygulama hiçbir zaman iskeletini
// kaybetmez. Aktif öğeye basmak çekmeceyi kapatır (toggle).
//
// Aktif işaret KEMİK banttır, Klein değil: Klein kotası (aynı anda 3)
// birincil aksiyon + film şeridi + aktif satır bandına ayrıldı.

import { Icon, type IconName } from "./ui";
import type { PoolTab } from "./MediaPool";
import { L } from "@/lib/i18n";

const ITEMS: { id: PoolTab; label: string; icon: IconName }[] = [
  { id: "shots", label: L("Ekranlar", "Screens"), icon: "image" },
  { id: "templates", label: L("Temalar", "Themes"), icon: "layers" },
  { id: "images", label: L("Görseller", "Images"), icon: "palette" },
];

export default function Rail({
  tab,
  open,
  onPick,
  onPalette,
  shotCount,
  layersOpen,
  onLayers,
  onBackground,
  onSettings,
}: {
  tab: PoolTab;
  open: boolean;
  onPick: (t: PoolTab) => void;
  onPalette: () => void;
  shotCount: number;
  layersOpen?: boolean;
  onLayers?: () => void;
  onBackground?: () => void;
  onSettings?: () => void;
}) {
  return (
    <nav className="rail grain" aria-label={L("Kütüphane", "Library")}>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={`rail-btn ${open && tab === it.id ? "on" : ""}`}
          onClick={() => onPick(it.id)}
          title={L(`${it.label} çekmecesi`, `${it.label} drawer`)}
          aria-pressed={open && tab === it.id}
        >
          <Icon name={it.icon} size={17} />
          <em>{it.label}</em>
        </button>
      ))}
      <span className="rail-rule" />
      <button className={`rail-btn ${layersOpen ? "on" : ""}`} onClick={onLayers} aria-pressed={!!layersOpen} title={L("Katmanlar ve düzenleme", "Layers and editing")}><Icon name="list" size={17}/><em>{L("Katmanlar", "Layers")}</em></button>
      <button className="rail-btn" onClick={onBackground} title={L("Arka planı düzenle", "Edit background")}><Icon name="palette" size={17}/><em>{L("Arka plan", "Background")}</em></button>
      <span className="rail-sp" />
      <span className="rail-rule" />
      <button className="rail-btn" onClick={onPalette} title={L("Komut paleti (⌘K)", "Command palette (⌘K)")}>
        <Icon name="search" size={17} />
        <em>⌘K</em>
      </button>
      <button className="rail-btn" onClick={onSettings} title={L("Ayarlar: API anahtarları, sürüm", "Settings: API keys, version")}>
        <Icon name="sliders" size={17} />
        <em>{L("Ayarlar", "Settings")}</em>
      </button>
      <span className="rail-rule" />
      <div className="rail-btn" style={{ cursor: "default", height: 34 }} title={L("Yüklü ekran sayısı", "Loaded screen count")}>
        <em style={{ color: "var(--ink-4)" }}>{String(shotCount).padStart(2, "0")}</em>
      </div>
    </nav>
  );
}
