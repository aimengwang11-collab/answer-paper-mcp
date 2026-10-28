/**
 * Local entry. Adapted from excalidraw-mcp `src/main.ts` (MIT):
 * https://github.com/excalidraw/excalidraw-mcp
 *
 * Stateless Streamable HTTP on `/mcp`, or stdio when `--stdio` is passed.
 * SDK 2.x split imports replace that repo's `@modelcontextprotocol/sdk` 1.25.2.
 */

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { createServer, distDir } from "./server.js";

export async function startStreamableHTTPServer(factory: () => McpServer): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, mcp: "/mcp" });
  });

  app.get("/preview", async (_req: Request, res: Response) => {
    try {
      const html = await fs.readFile(path.join(distDir(), "mcp-app.html"), "utf-8");
      res.status(200).type("html").send(html);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paper UI is not built.";
      res.status(500).type("text").send(message);
    }
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = factory();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
    console.log(`Paper preview: http://localhost:${port}/preview`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(factory: () => McpServer): Promise<void> {
  await factory().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
