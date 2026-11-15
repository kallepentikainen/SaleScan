import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, AnalyzeRequest, TranscriptSegment } from "../../shared/types.ts";
import type { Settings } from "../App.tsx";
import type { Strings } from "../i18n.ts";
import { analyze, type AnalyzeOutcome } from "../lib/api.ts";
import { publish } from "../lib/relay.ts";
import { cue, speak, stopSpeaking, vibrate } from "../lib/voice.ts";

interface Props {
  t: Strings;
  settings: Settings;
  request: AnalyzeRequest;
  onReset: () => void;
}

const ICON = { go: "✓", caution: "!", walk_away: "✕" } as const;

/** Runs the analysis on this device, then shows (and usually speaks) it. */
export function Result({ t, settings, request, onReset }: Props) {
  const [outcome, setOutcome] = useState<AnalyzeOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const spokenFor = useRef<string>("");
  const relay = settings.role === "listener";

  const run = useCallback(async () => {
    setLoading(true);
    const res = await analyze(request);
    // Never replace a full AI result with a weaker on-device one.
    setOutcome((prev) => {
      const next = prev && !prev.provisional && res.provisional ? prev : res;
      if (relay && next === res) publish({ type: "analysis", ...res });
      return next;
    });
    setLoading(false);
  }, [request, relay]);

  useEffect(() => {
    void run();
    return () => stopSpeaking();
  }, [run]);

  // Retry automatically when connectivity returns.
  useEffect(() => {
    if (!outcome?.provisional || outcome.reason !== "offline") return;
    const on = () => void run();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [outcome, run]);

  const a = outcome?.analysis;

  // Speak the verdict once per distinct result (e.g. heuristic first, then AI).
  // A listener phone stays silent: the earpiece phone speaks instead.
  useEffect(() => {
    if (!a || !settings.tts || relay) return;
    const key = `${a.source}:${a.verdict}:${a.spoken_summary}`;
    if (spokenFor.current === key) return;
    spokenFor.current = key;
    cue("ready");
    vibrate(a.verdict === "walk_away" ? [200, 100, 200] : 120);
    window.setTimeout(() => void speak(a.spoken_summary, settings.lang, settings.rate), 450);
  }, [a, settings.tts, settings.lang, settings.rate, relay]);

  if (loading && !a) return <Analyzing t={t} />;
  if (!a || !outcome) return null;

  return (
    <ResultView
      t={t}
      analysis={a}
      provisional={outcome.provisional}
      offline={outcome.reason === "offline"}
      loading={loading}
      transcript={request.transcript}
      onRetry={() => void run()}
      onReadAgain={relay ? undefined : () => void speak(a.spoken_summary, settings.lang, settings.rate)}
      onReset={() => {
        stopSpeaking();
        onReset();
      }}
    />
  );
}

export function Analyzing({ t }: { t: Strings }) {
  return (
    <section className="stack center" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <h2 tabIndex={-1}>{t.analyzing}</h2>
      <p className="muted">{t.analyzingSub}</p>
    </section>
  );
}

interface ViewProps {
  t: Strings;
  analysis: Analysis;
  provisional: boolean;
  offline: boolean;
  loading?: boolean;
  transcript?: TranscriptSegment[];
  onRetry?: () => void;
  onReadAgain?: () => void;
  onReset?: () => void;
}

export function ResultView({ t, analysis: a, provisional, offline, loading, transcript, onRetry, onReadAgain, onReset }: ViewProps) {
  const [showTranscript, setShowTranscript] = useState(false);

  const list = (title: string, items: string[], cls = "") =>
    items.length > 0 && (
      <div className={`card ${cls}`}>
        <h3>{title}</h3>
        <ul className="bullets">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <section className="stack result">
      <div className={`verdict v-${a.verdict}`} role="status" aria-live="polite">
        <div className="v-icon" aria-hidden="true">
          {ICON[a.verdict]}
        </div>
        <div>
          <p className="v-label">{t.verdict[a.verdict]}</p>
          <h1 tabIndex={-1}>{a.headline || t.verdict[a.verdict]}</h1>
        </div>
      </div>

      <p className="summary">{a.spoken_summary}</p>

      {provisional && (
        <div className="banner warn stack-sm">
          <span>{offline ? t.provisionalOffline : a.notice ?? t.provisional}</span>
          {onRetry && (
            <button className="btn small" onClick={onRetry} disabled={loading}>
              {loading ? t.checking : t.retry}
            </button>
          )}
        </div>
      )}

      <div className="card scores">
        <Score label={t.dealScore} value={a.deal_score} good />
        <Score label={t.scamRisk} value={a.scam_risk} />
        <p className="muted small">
          {t.confidence}: {t.conf[a.confidence]}
        </p>
      </div>

      {a.red_flags.length > 0 && (
        <div className="card">
          <h3>{t.redFlags}</h3>
          <ul className="alerts">
            {a.red_flags.map((f, i) => (
              <li key={i} className={`alert sev-${f.severity}`}>
                <div className="alert-top">
                  <strong>{f.tactic}</strong>
                  <span className="sev">{t.severity[f.severity]}</span>
                </div>
                {f.quote && <q>{f.quote}</q>}
                <p>{f.why}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {list(t.ask, a.questions_to_ask)}
      {list(t.verify, a.claims_to_verify)}
      {list(t.next, a.next_steps)}
      {list(t.greenFlags, a.green_flags, "good")}
      {a.consumer_rights_note && (
        <div className="card">
          <h3>{t.rights}</h3>
          <p>{a.consumer_rights_note}</p>
        </div>
      )}

      {onReadAgain && (
        <button className="btn" onClick={onReadAgain}>
          🔊 {t.readAgain}
        </button>
      )}

      {transcript && (
        <>
          <button className="btn ghost" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
            {t.showTranscript}
          </button>
          {showTranscript && (
            <div className="card transcript">
              <div className="lines">
                {transcript.map((s) => (
                  <p key={s.id}>{s.text}</p>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {onReset && (
        <button className="btn danger" onClick={onReset}>
          🗑 {t.deleteNew}
        </button>
      )}
    </section>
  );
}

function Score({ label, value, good = false }: { label: string; value: number; good?: boolean }) {
  // Deal quality: high = good. Manipulation risk: high = bad.
  const level = good ? (value >= 60 ? "good" : value >= 35 ? "mid" : "bad") : value >= 50 ? "bad" : value >= 21 ? "mid" : "good";
  return (
    <div className="score">
      <div className="score-top">
        <span>{label}</span>
        <strong>{value}/100</strong>
      </div>
      <div className={`bar ${level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
