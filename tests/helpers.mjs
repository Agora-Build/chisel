import { chiselMiddleware } from "../dist/middleware.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
export function snapshot(bytes = png) {
  return { url: "http://localhost:3000/", title: "Test page", viewport: { width: 1, height: 1 },
    screenshotDataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    annotations: [{ id: "a", tool: "arrow", x: 0.6, y: 0.4, text: "Make this red", color: "red" }] };
}
export function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "chisel-mark-test-"));
  process.chdir(directory);
  const routes = new Map();
  const app = { post: (path, f) => routes.set(`POST ${path}`, f), get: (path, f) => routes.set(`GET ${path}`, f) };
  chiselMiddleware(app, { ...options, srcDirs: [] });
  return { directory, task: (file) => JSON.parse(readFileSync(join(directory, file), "utf8")),
    invoke: (key, body = {}, params = {}) => new Promise((resolve, reject) => {
      let status = 200;
      const handler = routes.get(key);
      if (!handler) return reject(new Error(`Missing route ${key}`));
      Promise.resolve(handler({ body, params, query: {} }, { status(code) { status = code; return this; },
        json(data) { resolve({ status, data }); } })).catch(reject);
    }) };
}

export const station = (origin) => ({ origin, integrationId: "i-01234567890123456789012345", hostId: "host-a",
  sessionId: "ses-aaaaaaaaaaaa", routeId: "ui", routeRevision: 1, tokenEnv: "CHISEL_TEST_TOKEN" });

export async function waitFor(check, milliseconds = 4000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error("Timed out waiting for task progress");
}
