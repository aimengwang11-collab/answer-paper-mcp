/**
 * Fetch handler for the public MCP endpoint.
 *
 * Express in `src/main.ts` stays the local Node server. Cloudflare Workers
 * do not run that HTTP server, so this file uses the SDK's web-standard
 * Streamable HTTP handler (`createMcpHandler`): one fresh `McpServer` per
 * request, same tools and `ui://` sheet as the Node process. `legacy:
 * "stateless"` keeps 2025 Streamable HTTP clients (Claude, ChatGPT) working.
 *
 * The optional grade URL is read from the Worker env argument when present.
 * It is not stored on the module. Unset means grading stays unconfigured.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, MAX_MCP_BODY_BYTES } from "./server.js";

const MCP_PATH = "/mcp";

export function createPaperFetch(html: string) {
  return async function fetchPaper(request: Request, env?: unknown): Promise<Response> {
    const path = normalizePath(new URL(request.url).pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (path === "/health" || path === "/") {
      return json(
        request,
        {
          ok: true,
          name: "ink-answer-paper",
          mcp: MCP_PATH,
          preview: "/preview",
        },
        200,
      );
    }

    if (path === "/preview") {
      return withCors(
        request,
        new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }

    if (path !== MCP_PATH) {
      return withCors(request, new Response("Not found", { status: 404 }));
    }

    const gradeUrl = readGradeUrl(env);
    const mcp = createMcpHandler(() => createServer({ html, gradeUrl }), {
      legacy: "stateless",
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
      onerror(error) {
        console.error(
          JSON.stringify({
            message: "mcp request failed",
            error: error.message,
          }),
        );
      },
    });

    try {
      return withCors(request, await mcp.fetch(request));
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "mcp request failed",
          error: error instanceof Error ? error.message : "unknown error",
        }),
      );
      return json(
        request,
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        },
        500,
      );
    }
  };
}

function readGradeUrl(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null || !("STUDYWAM_GRADE_URL" in env)) return undefined;
  const value = (env as { STUDYWAM_GRADE_URL?: unknown }).STUDYWAM_GRADE_URL;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", allowOrigin(request));
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ??
      "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  );
  headers.set("access-control-expose-headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  headers.set("access-control-max-age", "86400");
  headers.set("vary", "Origin");
  return headers;
}

function allowOrigin(request: Request): string {
  const origin = request.headers.get("Origin");
  if (!origin) return "*";
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" || url.protocol === "http:") return origin;
  } catch {
    // A missing or unparsable Origin is not a browser caller we can echo.
  }
  return "*";
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request)) headers.set(key, value);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  const body =
    response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : response.body;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function json(request: Request, body: unknown, status: number): Response {
  return withCors(request, Response.json(body, { status }));
}
