import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Analysis, AnalyzeRequest, LiveAlert, LiveCheckRequest } from "../shared/types.ts";
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SYSTEM,
  LIVE_SCHEMA,
  LIVE_SYSTEM,
  analysisUserMessage,
  liveUserMessage,
} from "./prompts.ts";
import { normalizeAlerts, normalizeAnalysis } from "./validate.ts";

const MODEL = process.env.SALESCAN_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
let initError: string | null = null;
try {
  // Resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
  client = new Anthropic({ maxRetries: 2 });
} catch (e) {
  initError = e instanceof Error ? e.message : String(e);
}

// The SDK only discovers missing credentials on the first request, so check
// the usual sources up front and remember auth failures at runtime.
const profileDir = path.join(os.homedir(), ".config", "anthropic");
let credentialsLikely = Boolean(
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || fs.existsSync(profileDir),
);

export function markAuthFailed() {
  credentialsLikely = false;
}

export function aiAvailable(): { ok: boolean; reason?: string } {
  if (!client) return { ok: false, reason: initError ?? "client init failed" };
  if (!credentialsLikely) return { ok: false, reason: "no Anthropic credentials (set ANTHROPIC_API_KEY in .env)" };
  return { ok: true };
}

export class AiUnavailableError extends Error {}

/** Runs one structured-output request and returns the parsed JSON object. */
async function structured(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  if (!client) throw new AiUnavailableError(initError ?? "No credentials");
  if (!credentialsLikely) throw new AiUnavailableError("No Anthropic credentials configured");
  const response = await client.beta.messages
    .create(
    {
      model: MODEL,
      max_tokens: opts.maxTokens,
      // Server-side fallback: if a safety classifier declines, the API
      // re-runs the request on a suitable fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      output_config: {
        effort: opts.effort,
        format: { type: "json_schema", schema: opts.schema },
      },
      messages: [{ role: "user", content: opts.user }],
    },
    { timeout: opts.timeoutMs, signal: opts.signal },
    )
    .catch((err: unknown) => {
      if (err instanceof Anthropic.AuthenticationError || (err instanceof Error && /authentication method/i.test(err.message))) {
        markAuthFailed();
      }
      throw err;
    });

  if (response.stop_reason === "refusal") {
    throw new AiUnavailableError("The model declined to analyse this conversation");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiUnavailableError("The analysis was cut off");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

export async function analyzeWithClaude(req: AnalyzeRequest, signal?: AbortSignal): Promise<Analysis> {
  const raw = await structured({
    system: ANALYSIS_SYSTEM,
    user: analysisUserMessage(req),
    schema: ANALYSIS_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
    timeoutMs: 90_000,
    signal,
  });
  return normalizeAnalysis(raw);
}

export async function liveCheckWithClaude(req: LiveCheckRequest, signal?: AbortSignal): Promise<LiveAlert[]> {
  const raw = await structured({
    system: LIVE_SYSTEM,
    user: liveUserMessage(req),
    schema: LIVE_SCHEMA,
    effort: "low",
    maxTokens: 4000,
    timeoutMs: 20_000,
    signal,
  });
  return normalizeAlerts(raw);
}
