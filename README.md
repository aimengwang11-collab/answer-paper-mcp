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

## Public HTTPS

Claude web and ChatGPT connect to the Cloudflare Worker. [excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) deploys to Vercel and has no Workers config, so this uses the same `workers.dev` account as foldscape and studywam. Express stays the local Node process. The Worker (`src/worker.ts`) is a fetch handler around the SDK's web-standard Streamable HTTP transport and the same tools, `ui://` resource, and ink sheet.

| Route | URL |
| --- | --- |
| MCP | `https://answer-paper-mcp.aimengwang11.workers.dev/mcp` |
| Preview | `https://answer-paper-mcp.aimengwang11.workers.dev/preview` |
| Health | `https://answer-paper-mcp.aimengwang11.workers.dev/health` |

```bash
npm run deploy
```

`npm run dev:worker` serves the Worker locally after a build. `npm run build` still writes the Node bundle. The stdio entry is unchanged.

The grade URL is optional. Leave it unset and submit still succeeds. To forward ink, set a Worker secret (the value is not committed):

```bash
npx wrangler secret put STUDYWAM_GRADE_URL
```

Local Worker dev reads that name from `.dev.vars`, which is gitignored.

## Connect a host

Do not put credentials in these snippets.

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

Claude web, Claude Desktop remote, and ChatGPT (Apps / developer mode) use the public Worker. Paste the URL, or use this connector JSON:

```json
{
  "mcpServers": {
    "ink-answer-paper": {
      "type": "http",
      "url": "https://answer-paper-mcp.aimengwang11.workers.dev/mcp"
    }
  }
}
```

Hosts that only accept a URL field can drop `type`:

```json
{
  "mcpServers": {
    "ink-answer-paper": {
      "url": "https://answer-paper-mcp.aimengwang11.workers.dev/mcp"
    }
  }
}
```

There is no OAuth on this endpoint. The sheet is the same MCP App as the local server: questions stay in chat, the paper is answers only, and hosts that support MCP Apps render `ui://ink-answer-paper/mcp-app.html`. Grok Bot can keep using `npm run start:stdio`.

## Layout

- `src/main.ts` — local HTTP and stdio entry, from the Excalidraw MCP App server.
- `src/worker.ts` — Cloudflare Workers fetch entry for the public `/mcp` and `/preview` routes.
- `src/http.ts` — Streamable HTTP fetch handler shared with the Worker.
- `src/server.ts` — tool and UI resource registration.
- `src/mcp-app.html` / `src/mcp-app.ts` — the ink pad. The build inlines the script into `dist/mcp-app.html` and `src/generated/paper-html.ts` (gitignored).
- `src/mcp-widgets/grade-client.ts` — studywam POST placeholder.
- `wrangler.jsonc` — Workers config. `STUDYWAM_GRADE_URL` is a secret, not a var in this file.

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

