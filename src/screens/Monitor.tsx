/**
 * Receiving end of the two-device setup.
 * - earpiece:  the phone paired with the glasses. It never opens the mic, so
 *              the glasses stay in media mode and play cues, tips and the
 *              verdict sent by the listener phone.
 * - presenter: a big projector view of the same live session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang, RelayAlert, RelayEvent, RelayResult, RelaySnapshot, TranscriptSegment } from "../../shared/types.ts";
import type { Settings } from "../App.tsx";
import type { Strings } from "../i18n.ts";
import { subscribe } from "../lib/relay.ts";
import { cue, speak, stopSpeaking, unlockAudio } from "../lib/voice.ts";
import { keepAwake } from "../lib/device.ts";
import { Analyzing, ResultView } from "./Result.tsx";

interface Props {
  t: Strings;
  settings: Settings;
  onExit: () => void;
}

type Phase = "waiting" | "live" | "analyzing" | "result";

export function Monitor({ t, settings, onExit }: Props) {
  const presenter = settings.role === "presenter";
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [alerts, setAlerts] = useState<RelayAlert[]>([]);
  const [marks, setMarks] = useState(0);
  const [result, setResult] = useState<RelayResult | null>(null);
  const [sound, setSound] = useState(!presenter && settings.tts);
  const [flash, setFlash] = useState(false);

  const soundRef = useRef(sound);
  soundRef.current = sound;
  const langRef = useRef<Lang>(settings.lang);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const endRef = useRef<HTMLDivElement>(null);

  /** Speak in order, so a tip never cuts off the verdict. */
  const say = useCallback(
    (text: string, lang: Lang = langRef.current) => {
      if (!soundRef.current) return;
      queue.current = queue.current.then(() => speak(text, lang, settings.rate));
    },
    [settings.rate],
  );

  const applySnapshot = useCallback((s: RelaySnapshot) => {
    langRef.current = s.lang;
    setSegments(s.segments);
    setAlerts(s.alerts);
    setMarks(s.marks.length);
    setResult(s.result);
    setInterim("");
    setPhase(s.result ? "result" : s.ended ? "analyzing" : s.active ? "live" : "waiting");
  }, []);

  const onEvent = useCallback(
    (ev: RelayEvent) => {
      switch (ev.type) {
        case "start":
          langRef.current = ev.lang;
          setSegments([]);
          setAlerts([]);
          setMarks(0);
          setResult(null);
          setInterim("");
          setPhase("live");
          if (soundRef.current) cue("start");
          break;
        case "segment":
          setSegments((s) => [...s, ev.seg]);
          setInterim("");
          break;
        case "interim":
          setInterim(ev.text);
          break;
        case "alert":
          setAlerts((a) => [ev.alert, ...a]);
          setFlash(true);
          window.setTimeout(() => setFlash(false), 900);
          if (soundRef.current) cue("alert");
          if (ev.speak) say(ev.alert.tip);
          break;
        case "mark":
          setMarks((m) => m + 1);
          if (soundRef.current) cue("mark");
          break;
        case "say":
          say(ev.text, ev.lang);
          break;
        case "ended":
          setInterim("");
          setPhase("analyzing");
          if (soundRef.current) cue("end");
          break;
        case "analysis":
          setResult({ analysis: ev.analysis, provisional: ev.provisional, reason: ev.reason });
          setPhase("result");
          if (soundRef.current) {
            cue("ready");
            window.setTimeout(() => say(ev.analysis.spoken_summary), 450);
          }
          break;
        case "reset":
          stopSpeaking();
          applySnapshot({ active: false, ended: false, lang: langRef.current, context: null, segments: [], alerts: [], marks: [], result: null });
          break;
      }
    },
    [say, applySnapshot],
  );

  useEffect(() => {
    void keepAwake(true);
    const stop = subscribe({ onSnapshot: applySnapshot, onEvent, onConnection: setConnected });
    return () => {
      stop();
      stopSpeaking();
      void keepAwake(false);
    };
  }, [applySnapshot, onEvent]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [segments, interim]);

  const latest = alerts[0];

  return (
    <section className={`stack monitor ${presenter ? "presenter" : ""} ${flash ? "flash" : ""}`}>
      <div className="live-head">
        <h2 tabIndex={-1} className="live-status">
          <span className={`rec ${phase === "live" ? "on" : ""}`} aria-hidden="true" />
          {presenter ? t.rolePresenter : t.roleEarpiece}
          <span className={`conn ${connected ? "ok" : "bad"}`}>{connected ? t.connected : t.disconnected}</span>
        </h2>
        {!presenter && <p className="muted small">{t.earpieceHint}</p>}
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            unlockAudio();
            setSound(e.target.checked);
          }}
        />
        <span>{presenter ? t.playSoundHere : t.tts}</span>
      </label>

      {phase === "waiting" && (
        <div className="card center-text">
          <p className="big-wait">{t.waitingListener}</p>
        </div>
      )}

      {phase === "analyzing" && <Analyzing t={t} />}

      {phase === "result" && result && (
        <ResultView t={t} analysis={result.analysis} provisional={result.provisional} offline={result.reason === "offline"} />
      )}

      {phase === "live" && (
        <div className="monitor-grid">
          <div className="stack">
            <div className={`card latest ${latest ? `sev-${latest.severity}` : ""}`} aria-live="assertive">
              {latest ? (
                <>
                  <p className="v-label">⚠ {latest.tactic}</p>
                  <p className="latest-tip">{latest.tip}</p>
                  {latest.quote && <q>{latest.quote}</q>}
                </>
              ) : (
                <p className="muted">{t.noAlerts}</p>
              )}
            </div>
            {alerts.length > 1 && (
              <div className="card">
                <h3>
                  {t.alerts} <span className="count">{alerts.length}</span>
                </h3>
                <ul className="alerts">
                  {alerts.slice(1).map((a) => (
                    <li key={a.key} className={`alert sev-${a.severity}`}>
                      <div className="alert-top">
                        <strong>{a.tactic}</strong>
                        <span className="sev">{t.severity[a.severity]}</span>
                      </div>
                      <p>{a.tip}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {marks > 0 && <p className="muted">⚑ {marks}</p>}
          </div>

          <div className="card transcript">
            <h3>{t.transcript}</h3>
            <div className="lines">
              {segments.length === 0 && !interim && <p className="muted">{t.emptyTranscript}</p>}
              {segments.map((s) => (
                <p key={s.id}>{s.text}</p>
              ))}
              {interim && <p className="interim">{interim}</p>}
              <div ref={endRef} />
            </div>
          </div>
        </div>
      )}

      <button
        className="btn ghost"
        onClick={() => {
          stopSpeaking();
          onExit();
        }}
      >
        ← {t.back}
      </button>
    </section>
  );
}
