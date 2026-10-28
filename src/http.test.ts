import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { OPEN_TOOL, RESOURCE_URI, SUBMIT_TOOL } from "./ink.js";
import { createPaperFetch } from "./http.js";
import { PAPER_HTML } from "./generated/paper-html.js";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SHEET = "<!doctype html><button>Pen</button><button>Submit</button><canvas id=\"paper\"></canvas>";

const closers: Array<() => Promise<void>> = [];

after(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
});

test("preview and health describe the public paper", async () => {
  const fetchPaper = createPaperFetch(PAPER_HTML);
  const health = await fetchPaper(new Request("https://paper.test/health"));
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as { mcp?: string; preview?: string };
  assert.equal(healthBody.mcp, "/mcp");
  assert.equal(healthBody.preview, "/preview");

  const preview = await fetchPaper(new Request("https://paper.test/preview"));
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type") ?? "", /text\/html/);
  const html = await preview.text();
  assert.match(html, /id="paper"/);
  assert.match(html, /Pen/);
  assert.match(html, /Submit/);

  const missing = await fetchPaper(new Request("https://paper.test/nope"));
  assert.equal(missing.status, 404);
});

test("browser preflight can reach /mcp", async () => {
  const fetchPaper = createPaperFetch(SHEET);
  const response = await fetchPaper(
    new Request("https://paper.test/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, mcp-protocol-version",
      },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://claude.ai");
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /mcp-protocol-version/);
});

test("Streamable HTTP initialize serves the same answer paper", async () => {
  const fetchPaper = createPaperFetch(SHEET);
  const client = new Client({ name: "ink-answer-paper-http-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://paper.test/mcp"), {
    fetch: (input, init) => fetchPaper(new Request(input, init)),
  });
  await client.connect(transport);
  closers.push(async () => {
    await client.close();
  });

  const listed = await client.listTools();
  const tool = listed.tools.find((item) => item.name === OPEN_TOOL);
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length, 0);

  const resource = await client.readResource({ uri: RESOURCE_URI });
  const html = resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "";
  assert.match(html ?? "", /id="paper"/);

  const opened = await client.callTool({ name: OPEN_TOOL, arguments: {} });
  const text = opened.content?.find((block) => block.type === "text");
  assert.equal(text?.type, "text");
  if (text?.type === "text") assert.match(text.text, /Ask the question in chat/);
});

test("the worker forwards STUDYWAM_GRADE_URL from its env and not from git", async () => {
  const hits: Array<{ url: string; authorization: string | null; body: string }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    hits.push({
      url: String(input),
      authorization: headers.get("authorization"),
      body: String(init?.body ?? ""),
    });
    return new Response(null, { status: 204 });
  };

  const fetchPaper = createPaperFetch(SHEET);
  const client = new Client({ name: "ink-answer-paper-grade-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://paper.test/mcp"), {
    fetch: (input, init) =>
      fetchPaper(new Request(input, init), {
        STUDYWAM_GRADE_URL: "https://grade.example/ink",
      }),
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: SUBMIT_TOOL,
      arguments: {
        image: ONE_PX_PNG,
        width: 1,
        height: 1,
        strokes: [{ points: [{ x: 1, y: 2 }], width: 3, eraser: false }],
      },
    });
    const text = result.content?.find((block) => block.type === "text");
    assert.equal(text?.type, "text");
    if (text?.type === "text") assert.match(text.text, /HTTP 204/);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.url, "https://grade.example/ink");
    assert.equal(hits[0]?.authorization, null);
    const body = JSON.parse(hits[0]?.body ?? "{}") as { widget?: string; action?: string };
    assert.equal(body.widget, "ink-answer-paper");
    assert.equal(body.action, "grade");
  } finally {
    globalThis.fetch = previous;
    await client.close();
  }
});
