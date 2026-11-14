/**
 * Chooses the AI provider. Gemini is used when GEMINI_API_KEY is set (it has
 * a free tier), otherwise Claude. Force one with AI_PROVIDER=gemini|claude.
 */
import type { Analysis, AnalyzeRequest, LiveAlert, LiveCheckRequest } from "../shared/types.ts";
import { aiAvailable as claudeAvailable, analyzeWithClaude, liveCheckWithClaude } from "./claude.ts";
import { analyzeWithGemini, geminiConfigured, liveCheckWithGemini } from "./gemini.ts";

type Provider = "gemini" | "claude" | "none";

function pick(): Provider {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  if (forced === "gemini") return geminiConfigured() ? "gemini" : "none";
  if (forced === "claude") return claudeAvailable().ok ? "claude" : "none";
  if (geminiConfigured()) return "gemini";
  if (claudeAvailable().ok) return "claude";
  return "none";
}

export const provider: Provider = pick();

export function aiStatus(): { ok: boolean; provider: Provider } {
  return { ok: provider !== "none", provider };
}

export function analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<Analysis> {
  if (provider === "gemini") return analyzeWithGemini(req, signal);
  if (provider === "claude") return analyzeWithClaude(req, signal);
  return Promise.reject(new Error("No AI provider configured"));
}

export function liveCheck(req: LiveCheckRequest, signal?: AbortSignal): Promise<LiveAlert[]> {
  if (provider === "gemini") return liveCheckWithGemini(req, signal);
  if (provider === "claude") return liveCheckWithClaude(req, signal);
  return Promise.reject(new Error("No AI provider configured"));
}
