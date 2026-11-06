---
name: ink-answer-paper
description: Open a blank handwriting answer sheet so a student can write with finger, stylus, or mouse while the question stays in chat. Use when the user wants handwritten answers, ink practice, stylus math/work, or an MCP App answer pad instead of typing. Requires the ink-answer-paper MCP server (public Worker or local stdio).
---

# Ink answer paper

Give the student a blank ink pad. You ask the question in the normal chat. They write only on the paper. Do not put the question, choices, or a quiz onto the sheet.

## When to use

- The student should handwrite (math, diagrams, short answers, exam-style practice).
- The host supports MCP Apps / UI resources so `open_answer_paper` can show the pad.
- Typing the answer would defeat the point (pen practice, show working, stylus input).

## When not to use

- Pure text Q&A with no handwriting.
- Do not invent stroke data or call `submit_ink_answer` yourself — the widget submits.

## Prerequisites

1. Connect the MCP server before opening the paper.
2. Preferred public endpoint (no OAuth):

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

3. Local / desktop stdio (after `npm i && npm run build` in the repo):

```json
{
  "mcpServers": {
    "ink-answer-paper": {
      "command": "node",
      "args": ["ABSOLUTE_PATH/dist/index.js", "--stdio"]
    }
  }
}
```

Details: `reference/connect.md`.

## Workflow

1. Confirm the MCP server is connected.
2. Call `open_answer_paper` with no arguments.
3. In the **same chat turn or the next message**, ask the question in plain text (one clear prompt).
4. Tell the student briefly: write on the paper, then use Submit on the pad when done.
5. After submit, the widget calls `submit_ink_answer`. You receive a PNG of the ink (and optional grade forward if `STUDYWAM_GRADE_URL` is set on the server).
6. Respond from the submitted image: acknowledge, mark, hint, or ask a follow-up — still keep new questions in chat, not on the pad.

## Product rules (do not break)

- Questions stay in chat.
- The paper is answers only.
- Never pass question text into `open_answer_paper` (it takes no question field).
- Never fabricate `image` / `strokes` for `submit_ink_answer`.
- One blank sheet per open; for another question, open again after they submit or clear.

## Tools

| Tool | Who calls it | Purpose |
| --- | --- | --- |
| `open_answer_paper` | Agent | Opens blank pad + UI resource |
| `submit_ink_answer` | Widget only | Returns PNG + strokes; optional POST to grade URL |

## Source

- GitHub: https://github.com/aimengwang11-collab/answer-paper-mcp
- License: MIT
