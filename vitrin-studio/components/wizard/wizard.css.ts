// Sihirbazın kendi CSS'i — globals.css'e dokunmadan taşınır (engine/thumbs.ts'in
// THUMB_CSS deseninin ikizi). Bileşen ağacın tepesinde bir kez <style> basar;
// kurallar idempotent olduğu için iki kez basılsa da zararsız.
//
// UI v3 (R7/W3): tüm sınıflar `wiz-` önekli kaldı, bileşen ağacına HİÇ
// dokunulmadı — yalnız bu dosya cosm koyu kromuna geçirildi.
//   · yüzey #141416, saç çizgileri kemik alfa, köşe 2-3px (brutalist)
//   · künyeler Roboto Mono 9.5-10px / .08em / TAM CAPS
//   · adım rayı = BANT motifi, dolan kısım Klein
//   · hata satır içi TİLKİ bandı, onay ASİT — başka renk yok
//   · tek easing + dört süre tokenı globals.css'ten gelir

export const WIZARD_CSS = `
/* ---------- kabuk ---------- */
.wiz-dialog {
  position: relative;
  width: 880px; max-width: 96vw; height: 88vh; max-height: 88vh;
  display: flex; flex-direction: column;
  background: var(--chrome);
  border: 1px solid var(--line-2);
  border-radius: var(--r);
  box-shadow: 0 30px 80px rgb(0 0 0 / .65);
  animation: band-open var(--t-stage) var(--ease);
  overflow: hidden;
}
.wiz-dialog::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px;
  background: var(--klein); transform-origin: left; z-index: 4;
  animation: band-sweep var(--t-panel) var(--ease),
             band-fade var(--t-fast) linear var(--t-panel) forwards;
}
.wiz-dialog.drop-over { border-color: var(--klein); box-shadow: 0 0 0 1px var(--klein), 0 30px 80px rgb(0 0 0 / .65); }
.wiz-head { padding: 18px 22px 0; flex: none; }
.wiz-head h2 {
  display: flex; align-items: center; gap: 9px; margin: 0 0 12px;
  font: 400 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase;
  color: var(--bone);
}
.wiz-head h2 .gcard-ic { display: flex; color: var(--ink-3); }
.wiz-head h2 .wiz-spacer { flex: 1; }
.wiz-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 22px 18px; }
.wiz-foot {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 12px 22px; border-top: 1px solid var(--line);
  background: var(--chrome-2);
}
.wiz-foot .wiz-spacer { flex: 1; }

/* ---------- adım rayı (bant motifi) ---------- */
.wiz-rail { position: relative; height: 3px; background: var(--line); overflow: hidden; }
.wiz-rail > i {
  position: absolute; inset: 0 auto 0 0; background: var(--klein);
  transition: width var(--t-stage) var(--ease);
}
.wiz-steps { display: flex; gap: 0; margin: 8px 0 12px; }
.wiz-step {
  flex: 1; text-align: left; background: none; border: 0; padding: 0; cursor: pointer;
  font: 400 10px/1.4 var(--mono);
  letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4);
  transition: color var(--t-fast) var(--ease);
}
.wiz-step:disabled { cursor: default; }
.wiz-step.done { color: var(--ink-2); }
.wiz-step.on { color: var(--bone); }
.wiz-step em { font-style: normal; opacity: .5; margin-right: 5px; }

/* ---------- doğrulama şeridi ---------- */
.wiz-strip {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 10px 0 4px; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--fill-1); font-size: 12px; color: var(--ink-2);
}
.wiz-strip b { color: var(--bone); font-weight: 500; }
.wiz-strip.ok { border-color: rgb(198 255 58 / .3); }
.wiz-strip .wiz-spacer { flex: 1; }

/* ---------- klasör tarayıcı ---------- */
.wiz-browser { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--chrome-2); overflow: hidden; }
.wiz-quick {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 6px 9px; border-bottom: 1px solid var(--line); background: var(--chrome-2);
}
.wiz-quick button {
  padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px;
  background: none; color: var(--ink-2); cursor: pointer;
  font: 400 10.5px/1.3 var(--sans);
}
.wiz-quick button:hover { background: var(--fill-2); border-color: var(--line-2); color: var(--bone); }
.wiz-quick button.on { border-color: var(--bone); color: var(--bone); }
.wiz-crumbs {
  display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
  padding: 7px 9px; border-bottom: 1px solid var(--line); background: var(--fill-1);
  font: 400 11px/1.3 var(--mono);
}
.wiz-crumbs button {
  background: none; border: 0; padding: 2px 5px; border-radius: var(--r-sm);
  color: var(--ink-2); cursor: pointer; font: inherit;
}
.wiz-crumbs button:hover { background: var(--fill-2); color: var(--bone); }
.wiz-crumbs span { color: var(--ink-4); }
.wiz-tree { max-height: 260px; overflow-y: auto; padding: 4px; }
.wiz-node { display: flex; align-items: center; gap: 4px; padding: 1px 4px 1px 0; }
.wiz-node:hover { background: var(--fill-1); }
.wiz-node.sel { background: rgb(5 18 232 / .1); box-shadow: inset 3px 0 0 var(--klein); }
.wiz-node > .wiz-caret {
  width: 18px; height: 20px; flex: none; display: flex; align-items: center; justify-content: center;
  background: none; border: 0; color: var(--ink-4); cursor: pointer; padding: 0;
}
.wiz-node > .wiz-caret:hover { color: var(--bone); }
.wiz-node > .wiz-caret.empty { visibility: hidden; }
.wiz-node > .wiz-name {
  flex: 1; min-width: 0; text-align: left; background: none; border: 0; cursor: pointer;
  color: var(--ink-1); font-size: 12px; padding: 3px 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wiz-node > .wiz-open {
  flex: none; background: none; border: 0; color: var(--ink-4); cursor: pointer;
  font: 400 10px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase;
  padding: 4px 6px;
}
.wiz-node > .wiz-open:hover { color: var(--bone); background: var(--fill-2); }
.wiz-badge {
  flex: none; font: 400 9px/1 var(--mono);
  letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 5px; border: 1px solid var(--line); color: var(--ink-3);
}
.wiz-badge.md { border-color: var(--klein); color: var(--bone); background: rgb(5 18 232 / .18); }
.wiz-kids { padding-left: 14px; }
.wiz-empty { padding: 10px; font-size: 11.5px; color: var(--ink-4); }

/* ---------- son kullanılanlar ---------- */
.wiz-recents { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.wiz-recent {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: none; border: 1px solid transparent;
  padding: 6px 8px; cursor: pointer; color: var(--ink-2); font-size: 11.5px;
}
.wiz-recent:hover { background: var(--fill-1); border-color: var(--line); color: var(--bone); }
.wiz-recent code { font: 400 11px/1.3 var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- dil çipleri (2. adım) ---------- */
.wiz-locs { display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 5px; }
.wiz-loc {
  display: flex; align-items: center; gap: 8px; padding: 8px 9px;
  border: 1px solid var(--line); border-radius: var(--r-sm);
  background: transparent; cursor: pointer; color: var(--ink-2); text-align: left;
  transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.wiz-loc:hover { border-color: var(--line-2); background: var(--fill-1); color: var(--bone); }
.wiz-loc.on { border-color: var(--bone); background: var(--fill-2); color: var(--bone); }
.wiz-loc .code { font: 400 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; flex: 1; }
.wiz-loc .cnt { font: 400 10px/1 var(--mono); color: var(--ink-3); }
.wiz-loc .cnt.full { color: var(--acid); }
.wiz-loc .cnt.part { color: #e8b04a; }

/* ---------- kare eşleşme ızgarası (3. adım) ---------- */
.wiz-frames { display: flex; flex-direction: column; gap: 6px; }
.wiz-frame {
  position: relative; display: flex; align-items: flex-start; gap: 10px;
  padding: 8px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--fill-1);
}
.wiz-frame.miss { border-color: rgb(244 82 11 / .4); background: var(--fox-wash); }
.wiz-thumb {
  flex: none; width: 46px; height: 92px; overflow: hidden;
  background: #0d0d0f; border: 1px solid var(--line); padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.wiz-thumb:hover { border-color: var(--klein); }
.wiz-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wiz-thumb .none {
  font: 400 9px/1.2 var(--mono);
  color: var(--ink-4); text-transform: uppercase; letter-spacing: .08em; padding: 4px;
}
.wiz-fmeta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wiz-fno { font: 400 10px/1 var(--mono); letter-spacing: .1em; color: var(--ink-4); }
.wiz-fhead { font-size: 12.5px; font-weight: 500; color: var(--bone);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiz-fhint { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiz-ffile { font: 400 10.5px/1.3 var(--mono); color: var(--ink-4);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiz-conf {
  flex: none; align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  font: 400 9px/1 var(--mono);
  letter-spacing: .08em; text-transform: uppercase;
  padding: 4px 6px; border: 1px solid var(--line); color: var(--ink-3);
}
.wiz-conf.good { border-color: rgb(198 255 58 / .35); color: var(--acid); }
.wiz-conf.weak { border-color: rgb(232 176 74 / .4); color: #e8b04a; }
.wiz-conf.none { border-color: rgb(244 82 11 / .45); color: var(--fox); }
.wiz-conf.manual { border-color: var(--klein); color: var(--bone); background: rgb(5 18 232 / .18); }

/* ---------- aday popover ---------- */
.wiz-pop {
  position: absolute; z-index: 5; top: 8px; left: 62px; right: 8px;
  max-height: min(288px, 46vh); overflow-y: auto;
  background: var(--chrome-3); border: 1px solid var(--line-2);
  border-radius: var(--r); box-shadow: var(--lift); padding: 6px;
}
.wiz-pop h5 {
  margin: 2px 4px 6px; font: 400 9px/1 var(--mono);
  letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4);
}
.wiz-cand {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: none; border: 1px solid transparent;
  padding: 5px 6px; cursor: pointer; color: var(--ink-2);
}
.wiz-cand:hover { background: var(--fill-2); border-color: var(--line); color: var(--bone); }
.wiz-cand.on { border-color: var(--klein); background: rgb(5 18 232 / .1); color: var(--bone); }
.wiz-cand img { width: 22px; height: 44px; object-fit: cover; background: #0d0d0f; flex: none; }
.wiz-cand .f { flex: 1; min-width: 0; font: 400 11px/1.3 var(--mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiz-cand .s { flex: none; font: 400 10px/1 var(--mono); color: var(--ink-4); }
.wiz-pop-foot { display: flex; align-items: center; gap: 6px; padding: 6px 4px 2px; border-top: 1px solid var(--line); margin-top: 5px; }
.wiz-scope { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-3); cursor: pointer; }

/* ---------- şablon ızgarası (4. adım) ---------- */
.wiz-template-tools {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto;
  align-items: center;
  gap: 6px 10px;
  margin-bottom: 7px;
}
.wiz-template-tools .gallery-format { margin: 0; }
.wiz-template-search { width: 100%; }
.wiz-template-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.wiz-template-categories .seg-item {
  flex: 0 1 auto;
  min-height: 25px;
  padding: 5px 7px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 10px;
}
.wiz-template-categories .seg-item small {
  color: var(--ink-4);
  font: 400 9px/1 var(--mono);
}
.wiz-template-categories .seg-item:disabled { opacity: .42; cursor: not-allowed; }
.wiz-tpl { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 7px; }
.wiz-tpl.is-landscape { grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); }

@media (max-width: 640px) {
  .wiz-template-tools { grid-template-columns: 1fr; }
  .wiz-template-tools .gallery-format { gap: 3px 6px; }
}

@media (prefers-reduced-motion: reduce) {
  .wiz-dialog { animation: fade-in 120ms linear !important; }
  .wiz-dialog::before { animation: none !important; opacity: 0; }
}
`;
