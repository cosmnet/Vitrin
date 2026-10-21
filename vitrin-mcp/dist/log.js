// Log — YALNIZ stderr. stdout JSON-RPC kanalıdır; oraya tek bayt kaçarsa
// istemci bağlantıyı "bozuk çerçeve" diye düşürür.
const t0 = Date.now();
function stamp() {
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6, " ");
    return `[vitrin ${s}s]`;
}
export function log(...args) {
    console.error(stamp(), ...args);
}
export function warn(...args) {
    console.error(stamp(), "UYARI:", ...args);
}
/** Araç hatası — Türkçe tek satır neden + öneri. */
export class VitrinError extends Error {
    hint;
    constructor(reason, hint = "") {
        super(reason);
        this.name = "VitrinError";
        this.hint = hint;
    }
}
export function reasonOf(err) {
    if (err instanceof VitrinError)
        return { reason: err.message, hint: err.hint };
    const msg = err instanceof Error ? err.message : String(err);
    return { reason: msg || "Bilinmeyen hata", hint: "" };
}
//# sourceMappingURL=log.js.map