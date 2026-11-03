// Invoked by Station's isolated HTTP/R9 fixture with a test-only bearer token.
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fixture, snapshot, station, waitFor } from "./helpers.mjs";
const bytes = readFileSync(process.env.CHISEL_TEST_PNG_FILE);
const f = fixture({ station: station(process.env.CHISEL_TEST_ORIGIN) });
try {
  const { status, data } = await f.invoke("POST /api/dev/save-mark", snapshot(bytes));
  assert.equal(status, 200);
  assert.equal(data.forwarded, true, data.forwardingError);
  assert.equal(data.delivery, "accepted");
  await waitFor(() => f.task(data.taskFile).forwarding.event === "end", 8000);
  const task = f.task(data.taskFile);
  assert.equal(task.status, "awaiting_result");
  assert.deepEqual(readFileSync(task.screenshot), bytes);
  assert.equal(task.forwarding.call.mark.annotations[0].x, 1);
  assert.equal(task.forwarding.call.mark.annotations[0].y, 0);
  assert.ok(!JSON.stringify(task).includes(process.env.CHISEL_TEST_TOKEN));
  console.log("CHISEL_ONLINE_MARK_PASS");
} finally {
  process.chdir("/tmp"); rmSync(f.directory, { recursive: true });
}
