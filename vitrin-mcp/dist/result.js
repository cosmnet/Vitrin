// Araç cevabı yardımcıları — metin/görsel blokları ve Türkçe hata sarmalayıcı.
import { log, reasonOf } from "./log.js";
export function text(...lines) {
    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
}
export function withData(res, data) {
    return { ...res, structuredContent: data };
}
export function image(base64, caption) {
    const content = [{ type: "image", data: base64, mimeType: "image/png" }];
    if (caption)
        content.push({ type: "text", text: caption });
    return { content };
}
export function failure(err) {
    const { reason, hint } = reasonOf(err);
    log("HATA:", reason);
    return {
        content: [{ type: "text", text: hint ? `${reason} — ${hint}` : reason }],
        isError: true,
    };
}
/**
 * `_meta.progressToken` varsa `notifications/progress` yollar; yoksa sessizce
 * hiçbir şey yapmaz (istemci token vermediyse bildirim göndermek spec ihlali).
 */
export function progressSender(ctx) {
    const c = ctx;
    const token = c?.mcpReq?._meta?.progressToken;
    if (token === undefined || token === null)
        return () => undefined;
    return (done, total, message) => {
        void c.mcpReq
            .notify({
            method: "notifications/progress",
            params: { progressToken: token, progress: done, total, message },
        })
            .catch(() => undefined);
    };
}
export function tool(server, name, config, handler) {
    server.registerTool(name, {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: config.readOnly
            ? { readOnlyHint: true, openWorldHint: false }
            : { openWorldHint: false },
    }, (async (args, ctx) => {
        const t = Date.now();
        log(`→ ${name}`);
        try {
            const out = await handler(args, ctx);
            log(`← ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
            return out;
        }
        catch (err) {
            return failure(err);
        }
    }));
}
//# sourceMappingURL=result.js.map