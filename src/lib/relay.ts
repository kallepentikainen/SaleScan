import type { RelayEvent, RelaySnapshot } from "../../shared/types.ts";

/** One shared room: the server runs on the team's own laptop. */
const ROOM = "main";

let chain: Promise<unknown> = Promise.resolve();

/** Fire-and-forget, but delivered in order (alerts after their segment). */
export function publish(ev: RelayEvent) {
  chain = chain
    .then(() =>
      fetch(`/api/relay/${ROOM}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
        keepalive: true,
      }),
    )
    .catch(() => {
      /* receivers re-sync from the snapshot when they reconnect */
    });
}

let lastInterim = 0;
export function publishInterim(text: string) {
  const now = Date.now();
  if (now - lastInterim < 300) return;
  lastInterim = now;
  publish({ type: "interim", text });
}

export interface RelayHandlers {
  onSnapshot: (s: RelaySnapshot) => void;
  onEvent: (ev: RelayEvent) => void;
  onConnection: (connected: boolean) => void;
}

/** Subscribes via Server-Sent Events. EventSource reconnects by itself. */
export function subscribe(h: RelayHandlers): () => void {
  const es = new EventSource(`/api/relay/${ROOM}/events`);
  es.addEventListener("snapshot", (e) => {
    h.onConnection(true);
    h.onSnapshot(JSON.parse((e as MessageEvent<string>).data) as RelaySnapshot);
  });
  es.onmessage = (e) => h.onEvent(JSON.parse(e.data) as RelayEvent);
  es.onerror = () => h.onConnection(false);
  return () => es.close();
}
