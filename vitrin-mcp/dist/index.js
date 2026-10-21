#!/usr/bin/env node
// Vitrin MCP — Vitrin Studio'yu Claude'dan süren stdio MCP sunucusu.
//
// stdout SADECE JSON-RPC taşır; her log stderr'e gider (bkz. src/log.ts).
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { closeBrowser } from "./browser.js";
import { BASE_URL, VITRIN_DIR } from "./config.js";
import { log } from "./log.js";
import { registerContent } from "./tools/content.js";
import { registerCore } from "./tools/core.js";
import { registerDesign } from "./tools/design.js";
import { registerMd } from "./tools/md.js";
import { registerRender } from "./tools/render.js";
const VERSION = "1.0.0";
function build() {
    const server = new McpServer({ name: "vitrin", version: VERSION, title: "Vitrin Studio" }, {
        capabilities: { tools: {} },
        instructions: "Vitrin Studio App Store ekran görüntüsü stüdyosudur. Kullanıcıyla TÜRKÇE konuş. " +
            "Her işin başında vitrin_status çağır. Akış: vitrin_scan_folder → vitrin_import → " +
            "vitrin_art_direct → vitrin_render_contact_sheet (kullanıcıya GÖSTER) → düzeltmeler " +
            "(vitrin_edit_slide / vitrin_apply_theme) → vitrin_translate → vitrin_sync_design → " +
            "vitrin_export. Proje JSON'u devasadır; asla ham JSON isteme, özet araçlarını kullan. "
            + "MD kare dosyasını ELLE YAZMA: vitrin_write_frames kanonik biçimi üretir ve "
            + "yazmadan önce doğrular. Vitrin artık tablo/numaralı liste biçimindeki "
            + "serbest MD'leri de okur, ama üretirken hep bu aracı kullan.",
    });
    registerCore(server);
    registerContent(server);
    registerDesign(server);
    registerMd(server);
    registerRender(server);
    return server;
}
log(`vitrin-mcp ${VERSION} · stüdyo=${VITRIN_DIR} · ${BASE_URL}`);
const handle = serveStdio(build, {
    onerror: (err) => log("taşıma hatası:", err.message),
});
async function shutdown(why) {
    log(`kapanıyor (${why})`);
    await closeBrowser(why).catch(() => undefined);
    await handle.close().catch(() => undefined);
    process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.stdin.on("close", () => void shutdown("stdin kapandı"));
//# sourceMappingURL=index.js.map