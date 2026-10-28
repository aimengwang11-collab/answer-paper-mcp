# Ink answer paper

A dialog-embedded blank sheet. The student handwrites an answer with a finger, stylus, or mouse. The host agent asks the question in the normal chat. The paper has pen, eraser, undo, clear, and submit. It has no question bank.

Submit exports a PNG replayed from the stored strokes, plus the stroke JSON. If `STUDYWAM_GRADE_URL` is set, the server POSTs that payload for later studywam grading. The request sends no credentials.

## What was borrowed

The server shell follows [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) (MIT): `src/main.ts` (stateless Streamable HTTP on `/mcp`, plus `--stdio`) and `src/server.ts` (`registerAppTool` / `registerAppResource`, widget calls an app-only tool through `callServerTool`). `scripts/build.mjs` follows that repo's build (typecheck, one HTML file, one server bundle). The answer surface is not Excalidraw. That repo pins `@modelcontextprotocol/sdk` 1.25.2 and `@modelcontextprotocol/ext-apps` 0.4; this one uses the current split SDK 2 (`@modelcontextprotocol/server`, `client`, `node`, `express`) and `@modelcontextprotocol/ext-apps` 2.x, which speak the same MCP Apps `ui://` resource.

Ink marks follow [Bin-H-17/passpaper](https://github.com/Bin-H-17/passpaper) (MIT): each stroke is `{ points, width, eraser }`, eraser marks paint white and stay in the list, and the PNG is a replay capped at a 1568px long edge. [surfndev/petroglyphs-mcp](https://github.com/surfndev/petroglyphs-mcp) (MIT) is the handoff shape: a base64 PNG in `image` plus stroke metadata, returned to the agent as an image.

[openninoor/noteful-mcp](https://github.com/openninoor/noteful-mcp) (MIT) is the reason the agent receives a page image of the handwriting. This repo does not read or write Noteful notebooks, does not use the `.noteful` container, and does not connect to the Noteful iOS or Mac app.

[aimengwang11-collab/studywam](https://github.com/aimengwang11-collab/studywam) `src/mcp-widgets/` was the intended grade bridge. That repository returned 404 here, so `src/mcp-widgets/grade-client.ts` is a placeholder POST in the PassPaper + Petroglyphs shape. Point `STUDYWAM_GRADE_URL` at studywam when that hook exists.

## Product rules

- Questions stay in chat.
- The paper is answers only.
- `open_answer_paper` opens a blank sheet and takes no question text.
- `submit_ink_answer` is called by the sheet. It returns the PNG and, when configured, forwards the ink.

## Run locally

Node.js 20 or newer.

```bash
npm i
npm run dev
```

The MCP endpoint is `http://localhost:3001/mcp`. `http://localhost:3001/preview` opens the sheet without a host (submit needs the host). `npm run build` writes `dist/index.js` and `dist/mcp-app.html`. `npm start` runs the built HTTP server. `npm run start:stdio` is the desktop stdio entry.

`PORT` defaults to `3001`.

## Connect a host

Placeholders only. Do not put credentials in these snippets.

Claude Desktop, after `npm run build`:

```json
{
  "mcpServers": {
    "ink-answer-paper": {
      "command": "node",
      "args": ["ABSOLUTE_PATH/dist/index.js", "--stdio"],
      "env": {
        "STUDYWAM_GRADE_URL": "https://YOUR_STUDYWAM_HOST/grade"
      }
    }
  }
}
```

ChatGPT, Claude web, or another MCP Apps host:

```json
{
  "mcpServers": {
    "ink-answer-paper": {
      "url": "https://YOUR_PUBLIC_HOST/mcp"
    }
  }
}
```

The same server is the shape for ChatGPT Apps, Claude, Grok Bot MCP Apps, and a later studywam client. Hosts that support MCP Apps render `ui://ink-answer-paper/mcp-app.html`.

## Grade payload

```bash
STUDYWAM_GRADE_URL=https://YOUR_STUDYWAM_HOST/grade npm run dev
```

Unset URL: submit still succeeds and says grading is not configured. Set URL: one JSON POST, `http` or `https`, no userinfo, no `Authorization` header, redirects refused, 10 second timeout. A grading failure keeps the captured ink.

```json
{
  "source": "ink-answer-paper",
  "widget": "ink-answer-paper",
  "action": "grade",
  "submittedAt": "2026-01-01T00:00:00.000Z",
  "mimeType": "image/png",
  "image": "<base64 PNG>",
  "width": 800,
  "height": 600,
  "strokeCount": 1,
  "strokes": [
    { "points": [{ "x": 10, "y": 12 }], "width": 3, "eraser": false }
  ]
}
```

## Layout

- `src/main.ts` — HTTP and stdio entry, from the Excalidraw MCP App server.
- `src/server.ts` — tool and UI resource registration.
- `src/mcp-app.html` / `src/mcp-app.ts` — the ink pad. The build inlines the script into `dist/mcp-app.html`.
- `src/mcp-widgets/grade-client.ts` — studywam POST placeholder.
