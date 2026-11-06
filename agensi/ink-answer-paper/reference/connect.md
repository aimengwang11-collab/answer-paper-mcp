# Connect ink-answer-paper MCP

## Public Worker (Claude web, ChatGPT Apps, remote Desktop)

MCP: `https://answer-paper-mcp.aimengwang11.workers.dev/mcp`  
Preview: `https://answer-paper-mcp.aimengwang11.workers.dev/preview`  
Health: `https://answer-paper-mcp.aimengwang11.workers.dev/health`

No OAuth. Paste the MCP URL into the host’s connector / custom MCP field.

## Local Node (stdio)

```bash
git clone https://github.com/aimengwang11-collab/answer-paper-mcp
cd answer-paper-mcp
npm i
npm run build
```

Point the host at:

```json
{
  "command": "node",
  "args": ["/ABS/PATH/answer-paper-mcp/dist/index.js", "--stdio"]
}
```

Optional env: `STUDYWAM_GRADE_URL` — HTTP(S) endpoint that accepts the submit PNG + strokes POST (no auth header from this server).

## Local HTTP

```bash
npm run build && npm start
```

Endpoint: `http://localhost:3001/mcp` (default `PORT=3001`).
