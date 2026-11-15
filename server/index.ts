import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile();
} catch {
  /* no .env file: rely on the real environment */
}

const { AiUnavailableError } = await import("./claude.ts");
const { aiStatus, analyze, liveCheck } = await import("./ai.ts");
const { ApiError: GeminiApiError } = await import("@google/genai");
const { heuristicAnalysis } = await import("../shared/redFlags.ts");
const { parseAnalyzeRequest, parseLiveRequest } = await import("./validate.ts");
const { mountRelay } = await import("./relay.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "300kb" }));

// Privacy: transcripts are processed in memory and never logged or stored.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  next();
});

// Minimal per-IP rate limit so a shared demo URL can't drain the API budget.
const hits = new Map<string, { n: number; reset: number }>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return next();
    }
    if (++h.n > max) {
      res.setHeader("Retry-After", Math.ceil((h.reset - now) / 1000).toString());
      return res.status(429).json({ error: "rate_limited" });
    }
    next();
  };
}

mountRelay(app);

app.get("/api/health", (_req, res) => {
  const s = aiStatus();
  res.json({ ok: true, ai: s.ok, provider: s.provider });
});

app.post("/api/analyze", rateLimit(20, 10 * 60_000), async (req, res) => {
  const parsed = parseAnalyzeRequest(req.body);
  if (!parsed) return res.status(400).json({ error: "invalid_request" });

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    if (parsed.transcript.length === 0) {
      return res.json(heuristicAnalysis(parsed));
    }
    const analysis = await analyze(parsed, controller.signal);
    res.json(analysis);
  } catch (err) {
    console.warn("[analyze] falling back to heuristic:", describe(err));
    const fallback = heuristicAnalysis(parsed);
    res.json(fallback);
  }
});

app.post("/api/live-check", rateLimit(60, 10 * 60_000), async (req, res) => {
  const parsed = parseLiveRequest(req.body);
  if (!parsed) return res.status(400).json({ error: "invalid_request" });
  try {
    res.json({ alerts: await liveCheck(parsed) });
  } catch (err) {
    console.warn("[live-check] skipped:", describe(err));
    // Live checks are best effort; the client keeps its on-device detection.
    res.json({ alerts: [], unavailable: true });
  }
});

function describe(err: unknown): string {
  if (err instanceof AiUnavailableError) return err.message;
  if (err instanceof GeminiApiError) return `Gemini API error ${err.status}: ${err.message.slice(0, 300)}`;
  if (err instanceof Anthropic.AuthenticationError) return "invalid Anthropic credentials";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "Anthropic request timed out";
  if (err instanceof Anthropic.APIConnectionError) return "cannot reach Anthropic API";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}`;
  if (err instanceof SyntaxError) return "model returned invalid JSON";
  return err instanceof Error ? err.message : String(err);
}

// Production: serve the built web app.
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  const ai = aiStatus();
  console.log(`SaleScan API on http://localhost:${port}`);
  console.log(ai.ok ? `AI analysis: ${ai.provider}` : "No AI key (GEMINI_API_KEY / ANTHROPIC_API_KEY): on-device heuristics only");
});
