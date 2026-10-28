/**
 * MCP App registration.
 *
 * Adapted from the Excalidraw MCP App server (MIT):
 * https://github.com/excalidraw/excalidraw-mcp
 * `registerAppTool` + a `ui://` HTML resource, with an app-only submit tool
 * the widget calls through `callServerTool` (their `export_to_excalidraw`).
 *
 * The answer surface is an ink pad. Excalidraw is not loaded.
 * Package imports use MCP SDK 2.x (`@modelcontextprotocol/server` and
 * `@modelcontextprotocol/ext-apps`) because that repo still pins SDK 1.25.2.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LIMITS, OPEN_TOOL, RESOURCE_URI, SUBMIT_TOOL, type InkStroke } from "./ink.js";
import {
  describeGrade,
  forwardToStudywam,
  normalizePngBase64,
  type GradePayload,
} from "./mcp-widgets/grade-client.js";

const pointSchema = z.object({
  x: z.number().min(-100_000).max(100_000),
  y: z.number().min(-100_000).max(100_000),
});

const strokeSchema = z.object({
  points: z.array(pointSchema).min(1).max(LIMITS.maxPoints),
  width: z.number().positive().max(128),
  eraser: z.boolean(),
});

const submitInputSchema = z.object({
  image: z.string().min(32).max(LIMITS.maxImageChars + 100_000),
  width: z.number().int().positive().max(LIMITS.maxEdge),
  height: z.number().int().positive().max(LIMITS.maxEdge),
  strokes: z.array(strokeSchema).min(1).max(LIMITS.maxStrokes),
});

export function distDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(here) === "src") return path.join(here, "..", "dist");
  return here;
}

export function registerTools(server: McpServer, htmlDir: string): void {
  registerAppTool(
    server,
    OPEN_TOOL,
    {
      title: "Answer paper",
      description:
        "Open a blank handwriting answer paper. The student writes with a finger, stylus, or mouse. Ask the question in the normal chat message. The paper is answers only: do not put questions, choices, or a quiz on it.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        "openai/outputTemplate": RESOURCE_URI,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Blank answer paper is open. Ask the question in chat. The paper is for handwriting only.",
        },
      ],
    }),
  );

  registerAppTool(
    server,
    SUBMIT_TOOL,
    {
      title: "Submit ink answer",
      description:
        "Accept the PNG and stroke list from the answer-paper widget and POST them to STUDYWAM_GRADE_URL when that variable is set. The widget calls this. Do not invent strokes or a PNG.",
      inputSchema: submitInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["app"],
        },
      },
    },
    async (args) => submitInk(args),
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(htmlDir, "mcp-app.html"), "utf-8");
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: { prefersBorder: false },
            },
          },
        ],
      };
    },
  );
}

async function submitInk(args: z.infer<typeof submitInputSchema>) {
  const image = normalizePngBase64(args.image);
  if (!image) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "image must be a base64-encoded PNG." }],
    };
  }

  const strokes = args.strokes as InkStroke[];
  const payload: GradePayload = {
    source: "ink-answer-paper",
    widget: "ink-answer-paper",
    action: "grade",
    submittedAt: new Date().toISOString(),
    mimeType: "image/png",
    image,
    width: args.width,
    height: args.height,
    strokeCount: strokes.length,
    strokes,
  };

  let grade;
  try {
    grade = await forwardToStudywam(payload);
  } catch {
    grade = {
      forwarded: false as const,
      reason: "request_failed" as const,
      message: "grade request failed",
    };
  }

  const summary = [
    "Handwritten answer captured.",
    `strokes: ${payload.strokeCount}`,
    `png: ${payload.width}x${payload.height}`,
    describeGrade(grade),
  ].join("\n");

  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "image" as const, data: image, mimeType: "image/png" as const },
    ],
    structuredContent: {
      submittedAt: payload.submittedAt,
      width: payload.width,
      height: payload.height,
      strokeCount: payload.strokeCount,
      strokes: payload.strokes,
      studywam: grade,
    },
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ink-answer-paper",
    version: "0.1.0",
  });
  registerTools(server, distDir());
  return server;
}
