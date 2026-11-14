import type {
  Analysis,
  AnalyzeRequest,
  Confidence,
  Lang,
  LiveAlert,
  LiveCheckRequest,
  SessionContext,
  Severity,
  Verdict,
} from "../shared/types.ts";

const MAX_SEGMENTS = 2000;
const MAX_TEXT = 60_000;

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
const lang = (v: unknown): Lang => (v === "fi" ? "fi" : "en");
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const strList = (v: unknown, maxItems = 8): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, 400)) : [];
const clamp = (n: unknown): number => {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 50;
  return Math.round(Math.min(100, Math.max(0, x)));
};

function context(v: unknown): SessionContext {
  const c = (v ?? {}) as Record<string, unknown>;
  return {
    category: str(c.category, 80),
    item: str(c.item, 200),
    price: str(c.price, 80),
    budget: str(c.budget, 80),
    notes: str(c.notes, 600),
  };
}

export function parseAnalyzeRequest(body: unknown): AnalyzeRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.transcript)) return null;
  let total = 0;
  const transcript = [];
  for (const seg of b.transcript.slice(0, MAX_SEGMENTS)) {
    const s = seg as Record<string, unknown>;
    const text = str(s?.text, 2000).trim();
    if (!text) continue;
    total += text.length;
    if (total > MAX_TEXT) break;
    transcript.push({ id: str(s.id, 40), t: clamp0(s.t), text });
  }
  return {
    lang: lang(b.lang),
    context: context(b.context),
    transcript,
    marks: Array.isArray(b.marks) ? b.marks.filter((m) => typeof m === "number").slice(0, 50) : [],
    durationSec: clamp0(b.durationSec),
  };
}

function clamp0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, 24 * 3600) : 0;
}

export function parseLiveRequest(body: unknown): LiveCheckRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const recentText = str(b.recentText, 4000).trim();
  if (!recentText) return null;
  return {
    lang: lang(b.lang),
    context: context(b.context),
    recentText,
    alreadyAlerted: strList(b.alreadyAlerted, 20),
  };
}

const SEV = ["low", "medium", "high"] as const satisfies readonly Severity[];
const VERDICTS = ["go", "caution", "walk_away"] as const satisfies readonly Verdict[];
const CONF = ["low", "medium", "high"] as const satisfies readonly Confidence[];

/** Normalises model output, so the client never receives an unexpected shape. */
export function normalizeAnalysis(raw: unknown): Analysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const flags = Array.isArray(r.red_flags) ? r.red_flags.slice(0, 8) : [];
  return {
    verdict: oneOf(r.verdict, VERDICTS, "caution"),
    headline: str(r.headline, 120),
    spoken_summary: str(r.spoken_summary, 600),
    deal_score: clamp(r.deal_score),
    scam_risk: clamp(r.scam_risk),
    confidence: oneOf(r.confidence, CONF, "low"),
    red_flags: flags.map((f) => {
      const x = (f ?? {}) as Record<string, unknown>;
      return {
        tactic: str(x.tactic, 120),
        quote: str(x.quote, 400),
        why: str(x.why, 400),
        severity: oneOf(x.severity, SEV, "medium"),
      };
    }),
    green_flags: strList(r.green_flags),
    claims_to_verify: strList(r.claims_to_verify),
    questions_to_ask: strList(r.questions_to_ask),
    next_steps: strList(r.next_steps),
    consumer_rights_note: str(r.consumer_rights_note, 600),
    source: "ai",
  };
}

export function normalizeAlerts(raw: unknown): LiveAlert[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.alerts) ? r.alerts.slice(0, 2) : [];
  return list
    .map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      return {
        tactic: str(x.tactic, 100),
        quote: str(x.quote, 300),
        severity: oneOf(x.severity, SEV, "medium"),
        tip: str(x.tip, 100),
      };
    })
    .filter((a) => a.tactic && a.tip);
}
