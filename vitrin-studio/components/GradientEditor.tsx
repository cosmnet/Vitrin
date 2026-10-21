"use client";

// WP-F — tam serbest arka plan editörü.
//
// Sözleşme: kontrolsüz (controlled) bileşen. `value` mevcut Background,
// `onChange` her düzenlemede YENİ bir Background nesnesi alır. Bileşen içeride
// hiç durum saklamaz (hex alanının taslağı ve galeri filtresi hariç), böylece
// slayt override'ı ile birebir senkron kalır.
//
// Önizlemeler motorun kendi çizicisiyle (engine/backgrounds → renderBackground)
// basılır; galeride gördüğün kare export'ta çıkacak olanın küçültülmüş hâlidir.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { renderBackground } from "@/engine/backgrounds";
import { PALETTE_CATEGORIES, PALETTES, type PaletteCategory } from "@/engine/palettes";
import { SHADER_DEFS, shaderDef } from "@/engine/shaders";
import type { Background, GradientStop } from "@/engine/types";
import { Icon, Segmented, SliderRow } from "./ui";
import { L } from "@/lib/i18n";

type EditKind = "solid" | "linear" | "radial" | "mesh" | "shader";

const KINDS: { value: EditKind; label: ReactNode }[] = [
  { value: "solid", label: <span style={{ fontSize: 11 }}>{L("Düz", "Solid")}</span> },
  { value: "linear", label: <span style={{ fontSize: 11 }}>{L("Doğrusal", "Linear")}</span> },
  { value: "radial", label: <span style={{ fontSize: 11 }}>{L("Radyal", "Radial")}</span> },
  { value: "mesh", label: <span style={{ fontSize: 11 }}>Mesh</span> },
  { value: "shader", label: <span style={{ fontSize: 11 }}>Shader</span> },
];

const ANGLE_PRESETS = [0, 45, 90, 135, 165, 180, 225, 315];

/* ------------------------------------------------------------------ *
   Renk yardımcıları
 * ------------------------------------------------------------------ */

function hx(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/** Her girdiyi <input type="color"> kabul edecek "#rrggbb" biçimine indirger. */
function toHex6(c: string): string {
  const s = (c || "").trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x) || 0);
    return "#" + hx(p[0]) + hx(p[1]) + hx(p[2]);
  }
  let hex = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    hex = hex.slice(0, 3).split("").map((ch) => ch + ch).join("");
  }
  if (/^[0-9a-fA-F]{6,8}$/.test(hex)) return "#" + hex.slice(0, 6).toLowerCase();
  return "#101018";
}

/** Serbest metin → geçerli hex ya da null (geçersizse alan eski değere döner). */
function parseHexInput(v: string): string | null {
  const s = v.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) return "#" + s.split("").map((c) => c + c).join("").toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toLowerCase();
  return null;
}

/** amt < 0 → siyaha, amt > 0 → beyaza doğru. Kind dönüşümlerinde ikinci stop üretir. */
function shade(c: string, amt: number): string {
  const n = parseInt(toHex6(c).slice(1), 16);
  const target = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => hx(v + (target - v) * k))
      .join("")
  );
}

function randSeed(): number {
  return Math.floor(Math.random() * 1000);
}

/* ------------------------------------------------------------------ *
   Background dönüşümleri — kind değişince renk hikâyesi korunur
 * ------------------------------------------------------------------ */

function colorsOf(bg: Background): string[] {
  switch (bg.kind) {
    case "solid":
      return [bg.color];
    case "linear":
    case "radial":
      return bg.stops.map((s) => s[0]);
    case "mesh":
    case "shader":
      return bg.colors.slice();
    case "image":
      return ["#0d0f1a", "#3b2f80", "#7b5cff", "#22d3ee"];
  }
}

function stopsOf(bg: Background): GradientStop[] {
  if (bg.kind === "linear" || bg.kind === "radial") {
    return bg.stops.map((s): GradientStop => [s[0], s[1]]);
  }
  const cs = colorsOf(bg).filter(Boolean);
  if (cs.length === 0) return [["#5b6cff", 0], ["#0b0b12", 1]];
  if (cs.length === 1) return [[cs[0], 0], [shade(cs[0], -0.6), 1]];
  return cs.map((c, i): GradientStop => [c, i / (cs.length - 1)]);
}

function seedOf(bg: Background): number {
  return bg.kind === "mesh" || bg.kind === "shader" ? bg.seed : 7;
}

/** Renk listesini en az `n` uzunluğa tamamlar (son renk tonlanarak çoğaltılır). */
function padColors(cs: string[], n: number): string[] {
  const out = cs.filter(Boolean).slice();
  if (!out.length) out.push("#0d0f1a");
  let i = 0;
  while (out.length < n) {
    out.push(shade(out[out.length - 1], i++ % 2 === 0 ? 0.28 : -0.24));
  }
  return out;
}

function convertKind(bg: Background, kind: EditKind): Background {
  const cs = colorsOf(bg);
  switch (kind) {
    case "solid":
      return { kind: "solid", color: toHex6(cs[0] || "#101018") };
    case "linear":
      return { kind: "linear", stops: stopsOf(bg), angle: bg.kind === "linear" ? bg.angle : 165 };
    case "radial":
      return {
        kind: "radial",
        stops: stopsOf(bg),
        cx: bg.kind === "radial" ? bg.cx : 0.5,
        cy: bg.kind === "radial" ? bg.cy : 0.32,
        r: bg.kind === "radial" ? bg.r : 1,
      };
    case "mesh":
      return { kind: "mesh", colors: padColors(cs, 4), seed: seedOf(bg) };
    case "shader":
      return {
        kind: "shader",
        shaderId: bg.kind === "shader" ? bg.shaderId : "aurora",
        colors: padColors(cs, 4),
        seed: seedOf(bg),
        params: bg.kind === "shader" ? bg.params : undefined,
      };
  }
}

/* ------------------------------------------------------------------ *
   Ortak stiller — globals.css'e dokunmadan ev tarzını taklit eder
 * ------------------------------------------------------------------ */

const S: Record<string, CSSProperties> = {
  box: {
    border: "1px solid var(--hairline)",
    borderRadius: 10,
    padding: "7px 8px 4px",
    background: "rgba(255,255,255,0.025)",
    marginBottom: 6,
  },
  row: { display: "flex", alignItems: "center", gap: 6 },
  colorInput: {
    width: 30,
    height: 26,
    border: "1px solid var(--hairline)",
    borderRadius: 7,
    background: "var(--glass)",
    padding: 2,
    cursor: "pointer",
    flex: "0 0 auto",
  },
  hexInput: {
    width: 84,
    flex: "0 0 auto",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid var(--hairline)",
    borderRadius: 8,
    padding: "4px 7px",
    fontSize: 11,
    letterSpacing: 0.3,
    outline: "none",
    color: "var(--text)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  mini: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: 7,
    border: "1px solid var(--hairline)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--muted)",
    cursor: "pointer",
    padding: 0,
    flex: "0 0 auto",
  },
  chipX: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 14,
    height: 14,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--hairline-2)",
    background: "rgba(12,12,16,0.92)",
    color: "var(--muted)",
    cursor: "pointer",
    padding: 0,
    lineHeight: 0,
  },
  pct: {
    width: 34,
    textAlign: "right",
    fontSize: 10,
    color: "var(--faint)",
    flex: "0 0 auto",
    fontVariantNumeric: "tabular-nums",
  },
  sep: { border: 0, borderTop: "1px solid var(--hairline)", margin: "12px 0 10px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 7,
    maxHeight: 330,
    overflowY: "auto",
    paddingRight: 2,
    marginTop: 6,
  },
  palItem: {
    border: "1px solid var(--hairline)",
    borderRadius: 10,
    overflow: "hidden",
    background: "rgba(255,255,255,0.03)",
    padding: 0,
    cursor: "pointer",
    color: "var(--text)",
    textAlign: "left",
    display: "block",
  },
  palName: {
    display: "block",
    padding: "5px 7px 6px",
    fontSize: 10.5,
    lineHeight: 1.2,
    color: "var(--muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  swatchCanvas: { display: "block", width: "100%", height: "auto" },
};

/* ------------------------------------------------------------------ *
   BgCanvas — motorun kendi çizicisiyle küçük önizleme
 * ------------------------------------------------------------------ */

function BgCanvas({ bg, w, h }: { bg: Background; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let alive = true;
    void (async () => {
      // Ara canvas şart: "image" kind'ı asenkron yüklendiğinden, geç dönen
      // ESKİ bir çizim doğrudan hedefe basılsa yeni olanın üstünü boyardı.
      // Önce kenarda çiziyoruz, sonra hâlâ güncelse tek seferde blit ediyoruz.
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d");
      if (!octx) return;
      await renderBackground(bg, octx, w, h); // asla throw etmez
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0);
    })();
    return () => {
      alive = false;
    };
  }, [bg, w, h]);
  return <canvas ref={ref} width={w} height={h} style={S.swatchCanvas} />;
}

/* ------------------------------------------------------------------ *
   HexInput — serbest metin renk alanı (geçersiz girdi eski değere döner)
 * ------------------------------------------------------------------ */

function HexInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const hex = toHex6(value);
  const [draft, setDraft] = useState(hex);
  useEffect(() => setDraft(hex), [hex]);
  const commit = () => {
    const parsed = parseHexInput(draft);
    if (parsed) onChange(parsed);
    else setDraft(hex);
  };
  return (
    <input
      type="text"
      spellCheck={false}
      value={draft}
      style={S.hexInput}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseHexInput(e.target.value);
        if (parsed) onChange(parsed);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
   ColorChips — mesh / shader renk listesi
 * ------------------------------------------------------------------ */

function ColorChips({
  colors,
  onChange,
  min = 2,
  max = 6,
}: {
  colors: string[];
  onChange: (c: string[]) => void;
  min?: number;
  max?: number;
}) {
  const set = (i: number, c: string) => onChange(colors.map((x, k) => (k === i ? c : x)));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", marginTop: 4 }}>
      {colors.map((c, i) => (
        <span key={i} style={{ position: "relative", display: "inline-flex" }}>
          <input
            type="color"
            value={toHex6(c)}
            title={toHex6(c)}
            style={S.colorInput}
            onChange={(e) => set(i, e.target.value)}
          />
          {colors.length > min && (
            <button
              type="button"
              title={L("Rengi çıkar", "Remove color")}
              style={S.chipX}
              onClick={() => onChange(colors.filter((_, k) => k !== i))}
            >
              <Icon name="x" size={8} />
            </button>
          )}
        </span>
      ))}
      {colors.length < max && (
        <button
          type="button"
          title={L("Renk ekle", "Add color")}
          style={S.mini}
          onClick={() => onChange([...colors, shade(colors[colors.length - 1] || "#7b5cff", 0.3)])}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   StopEditor — linear / radial durak listesi
 * ------------------------------------------------------------------ */

function StopEditor({
  stops,
  onChange,
}: {
  stops: GradientStop[];
  onChange: (s: GradientStop[]) => void;
}) {
  const setStop = (i: number, next: GradientStop) =>
    onChange(stops.map((s, k) => (k === i ? next : s)));

  /**
   * Sıra değiştirme: konum merdiveni (0, .4, 1 …) yerinde kalır, sadece
   * renkler yer değiştirir. Aksi hâlde motor durakları konuma göre yeniden
   * sıraladığı için işlem görünmez olurdu.
   */
  const swapColors = (i: number, j: number) => {
    if (j < 0 || j >= stops.length) return;
    const next = stops.map((s): GradientStop => [s[0], s[1]]);
    const tmp = next[i][0];
    next[i][0] = next[j][0];
    next[j][0] = tmp;
    onChange(next);
  };

  const addStop = () => {
    const last = stops[stops.length - 1];
    const prev = stops[stops.length - 2];
    const at = prev ? Math.min(1, (prev[1] + last[1]) / 2) : 0.5;
    const next = stops.map((s): GradientStop => [s[0], s[1]]);
    next.splice(Math.max(1, stops.length - 1), 0, [shade(last[0], 0.25), at]);
    onChange(next);
  };

  return (
    <>
      {stops.map((s, i) => (
        <div key={i} style={S.box}>
          <div style={S.row}>
            <input
              type="color"
              value={toHex6(s[0])}
              style={S.colorInput}
              onChange={(e) => setStop(i, [e.target.value, s[1]])}
            />
            <HexInput value={s[0]} onChange={(c) => setStop(i, [c, s[1]])} />
            <span style={{ flex: 1 }} />
            <button
              type="button"
              title={L("Rengi yukarı taşı", "Move color up")}
              style={{ ...S.mini, opacity: i === 0 ? 0.35 : 1 }}
              disabled={i === 0}
              onClick={() => swapColors(i, i - 1)}
            >
              <Icon name="up" size={11} />
            </button>
            <button
              type="button"
              title={L("Rengi aşağı taşı", "Move color down")}
              style={{ ...S.mini, opacity: i === stops.length - 1 ? 0.35 : 1 }}
              disabled={i === stops.length - 1}
              onClick={() => swapColors(i, i + 1)}
            >
              <Icon name="down" size={11} />
            </button>
            <button
              type="button"
              title={L("Durağı sil", "Delete stop")}
              style={{ ...S.mini, opacity: stops.length <= 2 ? 0.35 : 1 }}
              disabled={stops.length <= 2}
              onClick={() => onChange(stops.filter((_, k) => k !== i))}
            >
              <Icon name="trash" size={11} />
            </button>
          </div>
          <div style={{ ...S.row, marginTop: 2 }}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(s[1] * 100)}
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => setStop(i, [s[0], Number(e.target.value) / 100])}
            />
            <span style={S.pct}>%{Math.round(s[1] * 100)}</span>
          </div>
        </div>
      ))}
      <button className="btn sm ghost" type="button" onClick={addStop} style={{ marginBottom: 4 }}>
        <Icon name="plus" size={12} />
        {L("Durak ekle", "Add stop")}
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ *
   PaletteGallery — küratörlü paletler, motorun çizdiği kare önizlemelerle
 * ------------------------------------------------------------------ */

function PaletteGallery({ onPick }: { onPick: (bg: Background) => void }) {
  const [cat, setCat] = useState<PaletteCategory | "all">("all");
  const list = useMemo(
    () => (cat === "all" ? PALETTES : PALETTES.filter((p) => p.category === cat)),
    [cat]
  );
  return (
    <>
      <div className="field" style={{ marginBottom: 2 }}>
        <label>
          {L("Palet galerisi", "Palette gallery")}
          <em className="val">{list.length}</em>
        </label>
        <div className="chips">
          <button
            type="button"
            className={`chip ${cat === "all" ? "on" : ""}`}
            onClick={() => setCat("all")}
          >
            {L("Tümü", "All")}
          </button>
          {PALETTE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${cat === c.id ? "on" : ""}`}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div style={S.grid}>
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.name}
            style={S.palItem}
            // Derin kopya şart: aksi hâlde slayt üzerinden yapılan düzenleme
            // modül seviyesindeki palet sabitini bozar.
            onClick={() => onPick(structuredClone(p.background) as Background)}
          >
            <BgCanvas bg={p.background} w={120} h={80} />
            <span style={S.palName}>{p.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
   GradientEditor
 * ------------------------------------------------------------------ */

export default function GradientEditor({
  value,
  onChange,
  onReset,
}: {
  value: Background;
  onChange: (bg: Background) => void;
  /** Verilirse "Temaya dön" butonu çıkar (slayt override'ını temizler). */
  onReset?: () => void;
}) {
  const bg = value;

  const setKind = (k: string) => onChange(convertKind(bg, k as EditKind));

  const sdef = bg.kind === "shader" ? shaderDef(bg.shaderId) : null;
  const paramVal = (key: string, def: number): number => {
    if (bg.kind !== "shader") return def;
    const v = bg.params?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : def;
  };
  const setParam = (key: string, v: number) => {
    if (bg.kind !== "shader") return;
    onChange({ ...bg, params: { ...(bg.params || {}), [key]: v } });
  };

  return (
    <div>
      {/* ---- Canlı önizleme + temaya dönüş ---- */}
      <div style={{ ...S.row, alignItems: "stretch", marginBottom: 8 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--hairline)",
          }}
        >
          <BgCanvas bg={bg} w={132} h={62} />
        </div>
        {onReset && (
          <button
            className="btn sm ghost"
            type="button"
            title={L("Slayt override'ını temizle, tema arka planına dön", "Clear the slide override and return to the theme background")}
            style={{ flex: "0 0 auto", alignSelf: "center" }}
            onClick={onReset}
          >
            <Icon name="reset" size={12} />
            {L("Temaya dön", "Back to theme")}
          </button>
        )}
      </div>

      {bg.kind === "image" && (
        <p className="note" style={{ marginBottom: 8 }}>
          {L("Şu an bir görsel arka plan seçili. Aşağıdan bir tür seçersen görsel bırakılıp gradient'e geçilir.", "An image background is currently selected. Choosing a type below drops the image and switches to a gradient.")}
        </p>
      )}

      {/* ---- Tür seçici ---- */}
      <Segmented<string> value={bg.kind} options={KINDS} onChange={setKind} />

      {/* ---- Düz renk ---- */}
      {bg.kind === "solid" && (
        <div style={S.box}>
          <div style={S.row}>
            <input
              type="color"
              value={toHex6(bg.color)}
              style={S.colorInput}
              onChange={(e) => onChange({ kind: "solid", color: e.target.value })}
            />
            <HexInput value={bg.color} onChange={(c) => onChange({ kind: "solid", color: c })} />
          </div>
        </div>
      )}

      {/* ---- Doğrusal ---- */}
      {bg.kind === "linear" && (
        <>
          <SliderRow
            label={L("Açı", "Angle")}
            value={Math.round(((bg.angle % 360) + 360) % 360)}
            min={0}
            max={360}
            step={1}
            onChange={(v) => onChange({ ...bg, angle: v })}
            format={(v) => `${v}°`}
          />
          <div className="chips" style={{ marginBottom: 9 }}>
            {ANGLE_PRESETS.map((a) => (
              <button
                key={a}
                type="button"
                className={`chip ${Math.round(((bg.angle % 360) + 360) % 360) === a ? "on" : ""}`}
                onClick={() => onChange({ ...bg, angle: a })}
              >
                {a}°
              </button>
            ))}
          </div>
          <StopEditor stops={bg.stops} onChange={(stops) => onChange({ ...bg, stops })} />
        </>
      )}

      {/* ---- Radyal ---- */}
      {bg.kind === "radial" && (
        <>
          <SliderRow
            label={L("Merkez X", "Center X")}
            value={Math.round(bg.cx * 100)}
            min={0}
            max={100}
            // C15 · çift tık = varsayılan. Değerler bu dosyanın kendi
            // "radyale çevir" varsayılanları (cx .5 · cy .32 · r 1).
            defaultValue={50}
            onChange={(v) => onChange({ ...bg, cx: v / 100 })}
            format={(v) => `%${v}`}
          />
          <SliderRow
            label={L("Merkez Y", "Center Y")}
            value={Math.round(bg.cy * 100)}
            min={0}
            max={100}
            defaultValue={32}
            onChange={(v) => onChange({ ...bg, cy: v / 100 })}
            format={(v) => `%${v}`}
          />
          <SliderRow
            label={L("Yarıçap", "Radius")}
            value={Math.round(bg.r * 100)}
            min={10}
            max={220}
            defaultValue={100}
            onChange={(v) => onChange({ ...bg, r: v / 100 })}
            format={(v) => `%${v}`}
          />
          <StopEditor stops={bg.stops} onChange={(stops) => onChange({ ...bg, stops })} />
        </>
      )}

      {/* ---- Mesh ---- */}
      {bg.kind === "mesh" && (
        <div style={S.box}>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              {L("Renkler", "Colors")}
              <em className="val">{bg.colors.length}</em>
            </label>
            <ColorChips
              colors={bg.colors}
              onChange={(colors) => onChange({ ...bg, colors })}
              min={2}
              max={6}
            />
          </div>
          <button
            className="btn sm ghost"
            type="button"
            style={{ marginBottom: 4 }}
            onClick={() => onChange({ ...bg, seed: randSeed() })}
          >
            <Icon name="reset" size={12} />
            {L("Yerleşimi karıştır", "Shuffle layout")} · seed {bg.seed}
          </button>
        </div>
      )}

      {/* ---- Shader ---- */}
      {bg.kind === "shader" && sdef && (
        <div style={S.box}>
          <div className="field">
            <label>Shader</label>
            <select
              value={bg.shaderId}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--hairline)",
                borderRadius: 10,
                padding: "7px 10px",
                outline: "none",
                color: "var(--text)",
              }}
              onChange={(e) => onChange({ ...bg, shaderId: e.target.value })}
            >
              {SHADER_DEFS.map((s) => (
                <option key={s.id} value={s.id} style={{ background: "#16161c" }}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              {L("Renkler", "Colors")}
              <em className="val">{L("zemin → vurgu", "background → accent")}</em>
            </label>
            <ColorChips
              colors={bg.colors}
              onChange={(colors) => onChange({ ...bg, colors })}
              min={2}
              max={4}
            />
          </div>
          <SliderRow
            label={sdef.p1.label}
            value={paramVal(sdef.p1.key, sdef.p1.def)}
            min={sdef.p1.min}
            max={sdef.p1.max}
            step={sdef.p1.step}
            defaultValue={sdef.p1.def} // shader tanımının kendi varsayılanı
            onChange={(v) => setParam(sdef.p1.key, v)}
            format={(v) => v.toFixed(sdef.p1.step < 0.01 ? 3 : 2)}
          />
          <SliderRow
            label={sdef.p2.label}
            value={paramVal(sdef.p2.key, sdef.p2.def)}
            min={sdef.p2.min}
            max={sdef.p2.max}
            step={sdef.p2.step}
            defaultValue={sdef.p2.def}
            onChange={(v) => setParam(sdef.p2.key, v)}
            format={(v) => v.toFixed(sdef.p2.step < 0.01 ? 3 : 2)}
          />
          <button
            className="btn sm ghost"
            type="button"
            style={{ marginBottom: 4 }}
            onClick={() => onChange({ ...bg, seed: randSeed() })}
          >
            <Icon name="reset" size={12} />
            {L("Deseni karıştır", "Shuffle pattern")} · seed {bg.seed}
          </button>
        </div>
      )}

      <hr style={S.sep} />

      <PaletteGallery onPick={onChange} />
    </div>
  );
}
