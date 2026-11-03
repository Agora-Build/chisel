import { createHash, randomUUID } from "node:crypto";
import type { Annotation, StationConfig } from "./types";

const MAX_PNG = 8 * 1024 * 1024;
const opaque = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function screenshot(dataUrl: unknown): Buffer {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("A PNG screenshot is required");
  }
  const raw = dataUrl.slice(22);
  if (raw.length > Math.ceil(MAX_PNG / 3) * 4) throw new Error("Screenshot exceeds 8 MiB");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.toString("base64") !== raw || bytes.length < 33 || bytes.length > MAX_PNG ||
      !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG screenshot");
  }
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  if (!w || !h || w > 16384 || h > 16384 || w * h > 40_000_000) throw new Error("Screenshot dimensions exceed limits");
  return bytes;
}

export function markPayload(id: string, url: unknown, title: unknown, annotations: unknown, png: Buffer) {
  if (typeof url !== "string" || Buffer.byteLength(url) > 2048 ||
      typeof title !== "string" || Buffer.byteLength(title) > 512 ||
      !Array.isArray(annotations) || !annotations.length || annotations.length > 128) {
    throw new Error("Invalid mark metadata or annotations");
  }
  const normalized = annotations.map((a: Annotation) => {
    if (!a || !["circle", "arrow", "text"].includes(a.tool) ||
        !Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < 0 || a.y < 0 || a.x > 16384 || a.y > 16384 ||
        (a.text !== undefined && (typeof a.text !== "string" || Buffer.byteLength(a.text) > 1024))) {
      throw new Error("Invalid mark annotation");
    }
    return { tool: a.tool, text: a.text || "", x: Math.round(a.x), y: Math.round(a.y) };
  });
  const mark = { mark_id: id, url, title, screenshot: { attachment_id: randomUUID(),
    digest: createHash("sha256").update(png).digest("hex"), size: png.length, media_type: "image/png" }, annotations: normalized };
  if (Buffer.byteLength(JSON.stringify(mark)) > 15 * 1024 || /[\x00-\x08\x0b-\x1f\x7f]/.test([url, title, ...normalized.map(a => a.text)].join(""))) {
    throw new Error("Mark content exceeds limits or contains control characters");
  }
  return mark;
}

type Progress = Record<string, any>;

export async function forwardMark(config: StationConfig, mark: ReturnType<typeof markPayload>, png: Buffer,
  update: (progress: Progress) => void): Promise<Progress> {
  const origin = new URL(config.origin);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) ||
      ![config.integrationId, config.hostId, config.routeId].every(v => opaque.test(v)) ||
      !/^ses-[a-z2-7]{12}$/.test(config.sessionId) || !Number.isSafeInteger(config.routeRevision) || config.routeRevision < 1 ||
      !/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnv)) throw new Error("Invalid server Station configuration");
  const token = process.env[config.tokenEnv];
  if (!token || /[\r\n]/.test(token)) throw new Error("Station credential environment variable is missing or invalid");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const base = `${origin.origin}/api/agent/v1/integrations/${config.integrationId}/hosts/${config.hostId}/sessions`;
  const controller = new AbortController();
  let delivery = "not_published";
  let accepted = false;
  const lifetime = setTimeout(() => controller.abort(), 600_000);
  lifetime.unref();
  let acceptTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await fetch(base, { headers, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    if (!snapshot.ok) throw new Error(`Station refused session lookup (HTTP ${snapshot.status})`);
    const list = await limitedJson(snapshot, 1024 * 1024);
    const target = list.targets?.find((t: any) => t.session_id === config.sessionId);
    if (!target || target.atem_device_id !== config.hostId || !opaque.test(target.account_id) ||
        !uuid.test(target.process_gen) || !Number.isSafeInteger(target.host_trust_gen) || target.host_trust_gen < 0) {
      throw new Error("Station target session is unavailable");
    }
    const now = Date.now();
    const call = { target, route_id: config.routeId, route_revision: config.routeRevision,
      message_id: randomUUID(), workflow_id: randomUUID(), recipient_id: randomUUID(),
      created_at: now, expires_at: now + 600_000, mark };
    // Persist immutable identities before any mutation, without the token or screenshot bytes.
    update({ event: "prepared", delivery, call });
    delivery = "uncertain";
    acceptTimer = setTimeout(() => controller.abort(), 30_000);
    acceptTimer.unref();
    const response = await fetch(`${base}/${config.sessionId}/marks`, { method: "POST", headers, redirect: "error",
      signal: controller.signal, body: JSON.stringify({ ...call, png_base64: png.toString("base64") }) });
    if (!response.ok) {
      // A proxy can return 5xx after the upstream accepted a mutation.
      delivery = response.status < 500 ? "not_published" : "uncertain";
      const body = await limitedJson(response, 4096).catch(() => ({}));
      const code = typeof body.error?.code === "string" && /^[a-z_]{1,80}$/.test(body.error.code) ? `: ${body.error.code}` : "";
      throw new Error(`Station refused mark (HTTP ${response.status}${code})`);
    }
    if (!response.headers.get("content-type")?.startsWith("application/x-ndjson") || !response.body) {
      throw new Error("Station did not return a mark progress stream");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "", ended = false;
    let resolveAccepted!: (value: Progress) => void;
    let rejectAccepted!: (error: Error) => void;
    const acceptance = new Promise<Progress>((resolve, reject) => { resolveAccepted = resolve; rejectAccepted = reject; });
    // Reading continues on the server after the browser receives acceptance.
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 1024 * 1024) throw new Error("Station progress exceeds limits");
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const event: Progress = JSON.parse(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
            if (event.event === "error") {
              if (["not_published", "uncertain", "accepted"].includes(event.delivery)) delivery = event.delivery;
              const code = typeof event.code === "string" && /^[a-z_]{1,80}$/.test(event.code) ? event.code : "online_delivery_failed";
              throw new Error(`Station mark: ${code}`);
            }
            if (event.event === "accepted") {
              if (accepted || event.message_id !== call.message_id || event.work?.task_id !== call.recipient_id ||
                  !uuid.test(event.work?.receipt_id || "")) throw new Error("Unbound Station acceptance");
              delivery = "accepted";
              clearTimeout(acceptTimer);
              update({ ...event, delivery });
              accepted = true;
              resolveAccepted(event);
            } else if (event.event === "work") {
              if (!accepted || event.work?.task_id !== call.recipient_id) throw new Error("Unbound Station task progress");
              update({ ...event, delivery });
            } else if (event.event === "end") {
              if (!accepted || event.task_id !== call.recipient_id) throw new Error("Unbound Station task end");
              ended = true;
              update({ ...event, delivery });
              return;
            } else throw new Error("Unknown Station progress event");
          }
        }
        if (!ended) throw new Error("Station closed before final task progress");
      } catch (error) {
        const message = controller.signal.aborted ? "Online mark connection timed out" : error instanceof Error ? error.message : "Online mark connection lost";
        try { update({ event: "error", delivery, error: message }); } catch { /* Local persistence may also have failed. */ }
        rejectAccepted(new Error(message));
      } finally {
        clearTimeout(lifetime); clearTimeout(acceptTimer);
        await reader.cancel().catch(() => {});
        controller.abort();
      }
    })();
    return await acceptance;
  } catch (error) {
    clearTimeout(lifetime); clearTimeout(acceptTimer); controller.abort();
    const message = error instanceof Error ? error.message : "Online mark connection lost";
    update({ event: "error", delivery, error: message });
    throw new Error(message);
  }
}

async function limitedJson(response: Response, maximum: number): Promise<any> {
  if (!response.body) throw new Error("Missing Station response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new Error("Station response exceeds limits");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}
