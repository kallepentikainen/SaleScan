import type { Analysis, AnalyzeRequest, LiveAlert, LiveCheckRequest } from "../../shared/types.ts";
import { heuristicAnalysis } from "../../shared/redFlags.ts";

export class OfflineError extends Error {}

async function post<T>(url: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (!navigator.onLine) throw new OfflineError("offline");
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (!navigator.onLine) throw new OfflineError("offline");
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface AnalyzeOutcome {
  analysis: Analysis;
  /** true when the result is only the on-device check and a retry is worthwhile. */
  provisional: boolean;
  reason?: "offline" | "error";
}

/** Always resolves: falls back to the on-device check when the network or server fails. */
export async function analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeOutcome> {
  try {
    const analysis = await post<Analysis>("/api/analyze", req, 100_000, signal);
    return { analysis, provisional: analysis.source !== "ai" };
  } catch (e) {
    return {
      analysis: heuristicAnalysis(req),
      provisional: true,
      reason: e instanceof OfflineError ? "offline" : "error",
    };
  }
}

export async function liveCheck(req: LiveCheckRequest, signal?: AbortSignal): Promise<LiveAlert[]> {
  try {
    const r = await post<{ alerts: LiveAlert[] }>("/api/live-check", req, 25_000, signal);
    return Array.isArray(r.alerts) ? r.alerts : [];
  } catch {
    return [];
  }
}

export async function health(): Promise<{ reachable: boolean; ai: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("/api/health", { signal: ctrl.signal });
    window.clearTimeout(t);
    const j = (await res.json()) as { ai?: boolean };
    return { reachable: res.ok, ai: Boolean(j.ai) };
  } catch {
    return { reachable: false, ai: false };
  }
}
