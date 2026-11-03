import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fixture, snapshot, png, station, waitFor } from "./helpers.mjs";

async function server(handler) {
  const app = createServer(handler);
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${app.address().port}`, close: async () => {
    app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
  } };
}

const target = { account_id: "account-test", atem_device_id: "host-a", host_trust_gen: 1,
  session_id: "ses-aaaaaaaaaaaa", process_gen: "11111111-1111-4111-8111-111111111111" };

test("online mark upload waits for durable acceptance and tracks turn end", async () => {
  process.env.CHISEL_TEST_TOKEN = "fixture-token-never-stored";
  let uploaded;
  const http = await server(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${process.env.CHISEL_TEST_TOKEN}`);
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ targets: [target] })); return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    uploaded = JSON.parse(Buffer.concat(chunks));
    assert.equal(uploaded.target.process_gen, target.process_gen);
    assert.equal(uploaded.mark.screenshot.digest, createHash("sha256").update(png).digest("hex"));
    assert.deepEqual(Buffer.from(uploaded.png_base64, "base64"), png);
    const work = { task_id: uploaded.recipient_id, receipt_id: randomUUID(), state: "queued", detail: "queued" };
    res.setHeader("content-type", "application/x-ndjson");
    const event = JSON.stringify({ event: "accepted", message_id: uploaded.message_id, work }) + "\n";
    res.write(event.slice(0, 19));
    setTimeout(() => {
      res.write(event.slice(19));
      setTimeout(() => res.end(JSON.stringify({ event: "work", work: { ...work, state: "awaiting_result" } }) + "\n" +
        JSON.stringify({ event: "end", task_id: uploaded.recipient_id, state: "awaiting_result" }) + "\n"), 70);
    }, 20);
  });
  const f = fixture({ station: station(http.origin) });
  try {
    const { data } = await f.invoke("POST /api/dev/save-mark", snapshot());
    assert.equal(data.forwarded, true, data.forwardingError);
    assert.equal(data.delivery, "accepted");
    await waitFor(() => f.task(data.taskFile).forwarding.event === "end");
    assert.equal(f.task(data.taskFile).status, "awaiting_result");
    assert.deepEqual(readFileSync(f.task(data.taskFile).screenshot), png);
    const saved = JSON.stringify(f.task(data.taskFile));
    assert.ok(!saved.includes(process.env.CHISEL_TEST_TOKEN)); assert.ok(!saved.includes("png_base64"));
    assert.equal((await f.invoke("POST /api/dev/tasks/:id/complete", {}, { id: data.taskId })).status, 409);
  } finally { await http.close(); process.chdir("/tmp"); rmSync(f.directory, { recursive: true }); }
});

test("offline or uncertain delivery preserves files and never retries", async () => {
  for (const outcome of ["refused", "gateway", "lost", "unbound"]) {
    let posts = 0;
    const http = await server(async (req, res) => {
      if (req.method === "GET") { res.end(JSON.stringify({ targets: [target] })); return; }
      posts++;
      for await (const chunk of req) { /* Drain the one upload. */ }
      if (outcome === "refused") { res.writeHead(403); res.end(JSON.stringify({ error: { code: "mark_grant_required" } })); }
      else if (outcome === "gateway") { res.writeHead(502); res.end("upstream closed"); }
      else {
        res.setHeader("content-type", "application/x-ndjson");
        if (outcome === "unbound") res.end(JSON.stringify({ event: "accepted", message_id: randomUUID(), work: {} }) + "\n");
        else res.end();
      }
    });
    const f = fixture({ station: station(http.origin) });
    try {
      const { data } = await f.invoke("POST /api/dev/save-mark", snapshot());
      assert.equal(data.forwarded, false); assert.ok(data.forwardingError);
      assert.equal(data.delivery, outcome === "refused" ? "not_published" : "uncertain");
      assert.equal(posts, 1);
      assert.deepEqual(readFileSync(f.task(data.taskFile).screenshot), png);
    } finally { await http.close(); process.chdir("/tmp"); rmSync(f.directory, { recursive: true }); }
  }
});

test("invalid PNGs and annotations fail before files or network; legacy transport explains upgrade", async () => {
  const f = fixture({ astation: { wsUrl: "ws://unused.invalid" } });
  try {
    for (const body of [{ ...snapshot(), screenshotDataUrl: "data:image/png;base64,YmFk" },
      { ...snapshot(), annotations: [{ tool: "arrow", x: -1, y: 2 }] }]) {
      assert.equal((await f.invoke("POST /api/dev/save-mark", body)).status, 400);
    }
    const { data } = await f.invoke("POST /api/dev/save-mark", snapshot());
    assert.equal(data.forwarded, false); assert.match(data.forwardingError, /configure station/);
    assert.deepEqual(readFileSync(f.task(data.taskFile).screenshot), png);
  } finally { process.chdir("/tmp"); rmSync(f.directory, { recursive: true }); }
});

test("local progress write failure settles acceptance without hanging", { timeout: 2000 }, async () => {
  let f;
  const http = await server(async (req, res) => {
    if (req.method === "GET") { res.end(JSON.stringify({ targets: [target] })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const call = JSON.parse(Buffer.concat(chunks));
    // Simulate the task directory disappearing after the immutable call was saved.
    rmSync(join(f.directory, ".chisel", "tasks"), { recursive: true });
    res.setHeader("content-type", "application/x-ndjson");
    res.end(JSON.stringify({ event: "accepted", message_id: call.message_id,
      work: { task_id: call.recipient_id, receipt_id: randomUUID(), state: "queued" } }) + "\n");
  });
  f = fixture({ station: station(http.origin) });
  try {
    const { data } = await f.invoke("POST /api/dev/save-mark", snapshot());
    assert.equal(data.forwarded, false);
    assert.equal(data.delivery, "accepted");
    assert.ok(data.forwardingError);
  } finally { await http.close(); process.chdir("/tmp"); rmSync(f.directory, { recursive: true }); }
});
