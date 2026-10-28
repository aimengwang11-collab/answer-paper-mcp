import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { OPEN_TOOL, RESOURCE_URI, SUBMIT_TOOL } from "./ink.js";
import { createServer } from "./server.js";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const closers: Array<() => Promise<void>> = [];

after(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
});

async function connectClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "ink-answer-paper-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

test("open_answer_paper is a blank sheet linked to the UI resource", async () => {
  const client = await connectClient();
  const listed = await client.listTools();
  const tool = listed.tools.find((item) => item.name === OPEN_TOOL);
  assert.ok(tool);
  assert.match(tool.description ?? "", /chat/i);
  assert.match(tool.description ?? "", /do not put questions/i);
  assert.equal(tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length, 0);
  const meta = tool._meta as { ui?: { resourceUri?: string }; "openai/outputTemplate"?: string };
  assert.equal(meta.ui?.resourceUri, RESOURCE_URI);
  assert.equal(meta["openai/outputTemplate"], RESOURCE_URI);

  const opened = await client.callTool({ name: OPEN_TOOL, arguments: {} });
  const text = opened.content?.find((block) => block.type === "text");
  assert.equal(text?.type, "text");
  if (text?.type === "text") {
    assert.match(text.text, /Ask the question in chat/);
  }
});

test("the paper resource is the handwriting widget", async () => {
  const client = await connectClient();
  const resource = await client.readResource({ uri: RESOURCE_URI });
  const html = resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "";
  assert.match(html ?? "", /id="paper"/);
  assert.match(html ?? "", /Pen/);
  assert.match(html ?? "", /Submit/);
  assert.equal(/noteful|excalidraw|question bank/i.test(html ?? ""), false);
});

test("submit_ink_answer returns the PNG and can POST to STUDYWAM_GRADE_URL", async () => {
  const hits: Array<{ body: string; authorization: string | undefined }> = [];
  const httpServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      hits.push({
        body: Buffer.concat(chunks).toString("utf8"),
        authorization: req.headers.authorization,
      });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const previous = process.env.STUDYWAM_GRADE_URL;
  process.env.STUDYWAM_GRADE_URL = `http://127.0.0.1:${address.port}/grade`;

  try {
    const client = await connectClient();
    const result = await client.callTool({
      name: SUBMIT_TOOL,
      arguments: {
        image: ONE_PX_PNG,
        width: 1,
        height: 1,
        strokes: [{ points: [{ x: 1, y: 2 }], width: 3, eraser: false }],
      },
    });
    assert.equal(result.isError, undefined);
    const image = result.content?.find((block) => block.type === "image");
    assert.equal(image?.type, "image");
    if (image?.type === "image") {
      assert.equal(image.mimeType, "image/png");
      assert.equal(image.data, ONE_PX_PNG);
    }
    const text = result.content?.find((block) => block.type === "text");
    if (text?.type === "text") {
      assert.match(text.text, /HTTP 204/);
    }
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.authorization, undefined);
    const body = JSON.parse(hits[0]?.body ?? "{}") as {
      widget?: string;
      action?: string;
      image?: string;
      strokeCount?: number;
    };
    assert.equal(body.widget, "ink-answer-paper");
    assert.equal(body.action, "grade");
    assert.equal(body.image, ONE_PX_PNG);
    assert.equal(body.strokeCount, 1);

    const rejected = await client.callTool({
      name: SUBMIT_TOOL,
      arguments: {
        image: "aGVsbG8=",
        width: 1,
        height: 1,
        strokes: [{ points: [{ x: 0, y: 0 }], width: 3, eraser: false }],
      },
    });
    assert.equal(rejected.isError, true);
  } finally {
    if (previous === undefined) delete process.env.STUDYWAM_GRADE_URL;
    else process.env.STUDYWAM_GRADE_URL = previous;
  }
});
