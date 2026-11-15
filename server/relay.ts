/**
 * Two-device relay. The "listener" phone (good microphone, near the seller)
 * POSTs session events; the "earpiece" phone (paired with the glasses) and the
 * "presenter" screen receive them over Server-Sent Events.
 *
 * Privacy: state lives only in memory, is wiped on reset, and rooms expire
 * after two hours without activity.
 */
import type { Express, Response } from "express";
import type { RelayEvent, RelaySnapshot } from "../shared/types.ts";

interface Room {
  clients: Set<Response>;
  state: RelaySnapshot;
  touched: number;
}

const rooms = new Map<string, Room>();
const ROOM_TTL_MS = 2 * 60 * 60_000;
const MAX_SEGMENTS = 400;
const CODE_RE = /^[a-z0-9-]{1,32}$/i;
const TYPES = new Set(["start", "segment", "interim", "alert", "mark", "say", "ended", "analysis", "reset"]);

const empty = (): RelaySnapshot => ({
  active: false,
  ended: false,
  lang: "en",
  context: null,
  segments: [],
  alerts: [],
  marks: [],
  result: null,
});

function getRoom(code: string): Room {
  let r = rooms.get(code);
  if (!r) {
    r = { clients: new Set(), state: empty(), touched: Date.now() };
    rooms.set(code, r);
  }
  r.touched = Date.now();
  return r;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.clients.size === 0 && now - r.touched > ROOM_TTL_MS) rooms.delete(code);
  }
}, 10 * 60_000).unref();

function reduce(s: RelaySnapshot, ev: RelayEvent): RelaySnapshot {
  switch (ev.type) {
    case "start":
      return { ...empty(), active: true, lang: ev.lang, context: ev.context };
    case "segment":
      return { ...s, segments: [...s.segments, ev.seg].slice(-MAX_SEGMENTS) };
    case "alert":
      return { ...s, alerts: [ev.alert, ...s.alerts].slice(0, 50) };
    case "mark":
      return { ...s, marks: [...s.marks, ev.t].slice(-50) };
    case "ended":
      return { ...s, ended: true };
    case "analysis":
      return { ...s, ended: true, result: { analysis: ev.analysis, provisional: ev.provisional, reason: ev.reason } };
    case "reset":
      return empty();
    default:
      return s; // interim / say are transient
  }
}

function send(res: Response, data: unknown, event?: string) {
  res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
}

export function mountRelay(app: Express) {
  app.get("/api/relay/:code/events", (req, res) => {
    const code = req.params.code;
    if (!CODE_RE.test(code)) return res.status(400).end();
    const room = getRoom(code);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1500\n\n");
    send(res, room.state, "snapshot");
    room.clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      room.clients.delete(res);
    });
  });

  app.post("/api/relay/:code", (req, res) => {
    const code = req.params.code;
    const ev = req.body as RelayEvent;
    if (!CODE_RE.test(code) || !ev || typeof ev !== "object" || !TYPES.has(ev.type)) {
      return res.status(400).json({ error: "invalid_event" });
    }
    const room = getRoom(code);
    room.state = reduce(room.state, ev);
    for (const c of room.clients) send(c, ev);
    res.json({ ok: true, receivers: room.clients.size });
  });
}
