// Araç cevabı yardımcıları — metin/görsel blokları ve Türkçe hata sarmalayıcı.

import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { log, reasonOf } from "./log.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function text(...lines: (string | false | null | undefined)[]): ToolResult {
  return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
}

export function withData(res: ToolResult, data: Record<string, unknown>): ToolResult {
  return { ...res, structuredContent: data };
}

export function image(base64: string, caption?: string): ToolResult {
  const content: ContentBlock[] = [{ type: "image", data: base64, mimeType: "image/png" }];
  if (caption) content.push({ type: "text", text: caption });
  return { content };
}

export function failure(err: unknown): ToolResult {
  const { reason, hint } = reasonOf(err);
  log("HATA:", reason);
  return {
    content: [{ type: "text", text: hint ? `${reason} — ${hint}` : reason }],
    isError: true,
  };
}

/* ------------------------------------------------------------------ *
   İlerleme bildirimi
 * ------------------------------------------------------------------ */

type Ctx = {
  mcpReq: {
    _meta?: Record<string, unknown>;
    notify: (n: { method: string; params?: Record<string, unknown> }) => Promise<void>;
  };
};

/**
 * `_meta.progressToken` varsa `notifications/progress` yollar; yoksa sessizce
 * hiçbir şey yapmaz (istemci token vermediyse bildirim göndermek spec ihlali).
 */
export function progressSender(ctx: unknown): (done: number, total: number, msg: string) => void {
  const c = ctx as Ctx | undefined;
  const token = c?.mcpReq?._meta?.progressToken;
  if (token === undefined || token === null) return () => undefined;
  return (done, total, message) => {
    void c!.mcpReq
      .notify({
        method: "notifications/progress",
        params: { progressToken: token, progress: done, total, message },
      })
      .catch(() => undefined);
  };
}

/* ------------------------------------------------------------------ *
   Kayıt yardımcısı — her handler try/catch ile sarılır
 * ------------------------------------------------------------------ */

export type Server = McpServer;

export function tool<S extends z.ZodType>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema: S; readOnly?: boolean },
  handler: (args: z.infer<S>, ctx: unknown) => Promise<ToolResult>
): void {
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema as never,
      annotations: config.readOnly
        ? { readOnlyHint: true, openWorldHint: false }
        : { openWorldHint: false },
    },
    (async (args: unknown, ctx: unknown) => {
      const t = Date.now();
      log(`→ ${name}`);
      try {
        const out = await handler(args as z.infer<S>, ctx);
        log(`← ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
        return out;
      } catch (err) {
        return failure(err);
      }
    }) as never
  );
}
