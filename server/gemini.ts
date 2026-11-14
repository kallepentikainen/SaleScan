import { ApiError, GoogleGenAI } from "@google/genai";
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

/**
 * Free-tier models, tried in order. On the free tier the larger models often
 * return 503 ("high demand"), so the fast Flash-Lite model goes first: it
 * answered the analysis prompt in about 5 s in testing. Override with a
 * comma-separated list in .env, e.g. GEMINI_MODELS=gemini-3.6-flash,gemini-3.5-flash-lite
 */
const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
const ANALYSIS_MODELS = list(process.env.GEMINI_MODELS, ["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
const LIVE_MODELS = list(process.env.GEMINI_LIVE_MODELS, ["gemini-3.5-flash-lite"]);

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

export function geminiConfigured(): boolean {
  return client !== null;
}

/** 429 (rate limit) and 5xx (overloaded) are worth trying on the next model. */
function tryNextModel(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  const status = (err as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

async function structured(opts: {
  models: string[];
  system: string;
  user: string;
  schema: Record<string, unknown>;
  thinking: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  if (!client) throw new Error("GEMINI_API_KEY not set");
  let lastErr: unknown;
  for (const model of opts.models) {
    const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
    try {
      const interaction = await client.interactions.create(
        {
          model,
          system_instruction: opts.system,
          input: opts.user,
          // Privacy: ask Google not to keep the interaction for later retrieval.
          store: false,
          generation_config: { thinking_level: opts.thinking },
          response_format: { type: "text", mime_type: "application/json", schema: opts.schema },
        },
        // No SDK-level retries: fall through to the next model instead of waiting.
        { signal: AbortSignal.any(signals), retries: { strategy: "none" } },
      );
      const text = interaction.output_text;
      if (!text) throw new Error(`${model} returned no text`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted || !tryNextModel(err)) throw err;
      console.warn(`[gemini] ${model} unavailable, trying next model`);
    }
  }
  throw lastErr;
}

export async function analyzeWithGemini(req: AnalyzeRequest, signal?: AbortSignal): Promise<Analysis> {
  const raw = await structured({
    models: ANALYSIS_MODELS,
    system: ANALYSIS_SYSTEM,
    user: analysisUserMessage(req),
    schema: ANALYSIS_SCHEMA,
    thinking: "medium",
    timeoutMs: 60_000,
    signal,
  });
  return normalizeAnalysis(raw);
}

export async function liveCheckWithGemini(req: LiveCheckRequest, signal?: AbortSignal): Promise<LiveAlert[]> {
  const raw = await structured({
    models: LIVE_MODELS,
    system: LIVE_SYSTEM,
    user: liveUserMessage(req),
    schema: LIVE_SCHEMA,
    thinking: "minimal",
    timeoutMs: 15_000,
    signal,
  });
  return normalizeAlerts(raw);
}
