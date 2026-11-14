export type Lang = "en" | "fi";
export type Verdict = "go" | "caution" | "walk_away";
export type Severity = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

export interface TranscriptSegment {
  id: string;
  /** Seconds since the session started. */
  t: number;
  text: string;
}

export interface SessionContext {
  category: string;
  item: string;
  price: string;
  budget: string;
  notes: string;
}

export interface AnalyzeRequest {
  lang: Lang;
  context: SessionContext;
  transcript: TranscriptSegment[];
  /** Seconds (since start) where the buyer tapped the glasses to flag discomfort. */
  marks: number[];
  durationSec: number;
}

export interface RedFlag {
  tactic: string;
  quote: string;
  why: string;
  severity: Severity;
}

export interface Analysis {
  verdict: Verdict;
  headline: string;
  spoken_summary: string;
  deal_score: number;
  scam_risk: number;
  confidence: Confidence;
  red_flags: RedFlag[];
  green_flags: string[];
  claims_to_verify: string[];
  questions_to_ask: string[];
  next_steps: string[];
  consumer_rights_note: string;
  /** "ai" = full model analysis, "heuristic" = on-device pattern matching only. */
  source: "ai" | "heuristic";
  notice?: string;
}

export interface LiveCheckRequest {
  lang: Lang;
  context: SessionContext;
  recentText: string;
  alreadyAlerted: string[];
}

export interface LiveAlert {
  tactic: string;
  quote: string;
  severity: Severity;
  /** Very short tip that can be whispered through the glasses. */
  tip: string;
}
