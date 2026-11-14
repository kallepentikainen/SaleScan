import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeRequest, SessionContext, Severity, TranscriptSegment } from "../../shared/types.ts";
import { detectFlags } from "../../shared/redFlags.ts";
import type { Settings } from "../App.tsx";
import type { Strings } from "../i18n.ts";
import { isGlasses, listInputs, micErrorFrom, openMic, stopStream } from "../lib/audio.ts";
import { Transcriber, type SpeechErrorKind } from "../lib/speech.ts";
import { cue, speak, stopSpeaking, vibrate } from "../lib/voice.ts";
import { disableGlassesTap, enableGlassesTap, keepAwake } from "../lib/device.ts";
import { liveCheck } from "../lib/api.ts";
import { DEMOS } from "../lib/demo.ts";

interface Props {
  t: Strings;
  settings: Settings;
  context: SessionContext;
  onEnd: (req: AnalyzeRequest) => void;
}

interface UiAlert {
  key: string;
  tactic: string;
  tip: string;
  quote: string;
  severity: Severity;
  t: number;
  source: "local" | "ai";
}

type Banner = { text: string; tone: "warn" | "error" | "info" } | null;

const LIVE_CHECK_EVERY_MS = 25_000;
const LIVE_CHECK_MIN_NEW_CHARS = 160;
const END_COMMAND = /\bsales?\s?scan\b.{0,20}\b(stop|end|done|finish|lopeta|valmis|loppu)\b/i;

export function Session({ t, settings, context, onEnd }: Props) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [alerts, setAlerts] = useState<UiAlert[]>([]);
  const [marks, setMarks] = useState<number[]>([]);
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [banner, setBanner] = useState<Banner>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [flash, setFlash] = useState(false);
  const [tapEnabled, setTapEnabled] = useState(false);

  const startRef = useRef(Date.now());
  const segRef = useRef<TranscriptSegment[]>([]);
  const marksRef = useRef<number[]>([]);
  const alertedRef = useRef(new Set<string>());
  const alertLabelsRef = useRef<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<Transcriber | null>(null);
  const onFallbackMicRef = useRef(false);
  const lastCheckedLenRef = useRef(0);
  const speakingRef = useRef(false);
  const endedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const now = () => (Date.now() - startRef.current) / 1000;

  /** Speak through the glasses without transcribing our own voice. */
  const say = useCallback(
    async (text: string) => {
      speakingRef.current = true;
      recRef.current?.setPaused(true);
      await speak(text, settings.lang, settings.rate);
      speakingRef.current = false;
      recRef.current?.setPaused(false);
    },
    [settings.lang, settings.rate],
  );

  const raiseAlert = useCallback(
    (a: Omit<UiAlert, "key" | "t">) => {
      const id = a.tactic.toLowerCase();
      if (alertedRef.current.has(id)) return;
      alertedRef.current.add(id);
      alertLabelsRef.current.push(a.tactic);
      setAlerts((prev) => [{ ...a, key: `${id}-${Date.now()}`, t: now() }, ...prev]);
      cue("alert");
      vibrate([90, 60, 90]);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 700);
      if (settings.whisperTips && settings.tts && a.severity !== "low" && !speakingRef.current) void say(a.tip);
    },
    [say, settings.whisperTips, settings.tts],
  );

  const finish = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    recRef.current?.stop();
    stopSpeaking();
    stopStream(streamRef.current);
    disableGlassesTap();
    void keepAwake(false);
    cue("end");
    vibrate(120);
    onEnd({
      lang: settings.lang,
      context,
      transcript: segRef.current,
      marks: marksRef.current,
      durationSec: Math.round(now()),
    });
  }, [context, onEnd, settings.lang]);

  const addFinal = useCallback(
    (text: string) => {
      if (speakingRef.current || endedRef.current) return;
      if (END_COMMAND.test(text)) {
        finish();
        return;
      }
      const seg: TranscriptSegment = { id: crypto.randomUUID().slice(0, 8), t: Math.round(now()), text };
      segRef.current = [...segRef.current, seg];
      setSegments(segRef.current);
      setInterim("");
      // Check the new line together with the previous one, since phrases get split.
      const prev = segRef.current.at(-2)?.text ?? "";
      for (const hit of detectFlags(`${prev} ${text}`, settings.lang)) {
        raiseAlert({ tactic: hit.label, tip: hit.tip, quote: hit.quote, severity: hit.severity, source: "local" });
      }
    },
    [finish, raiseAlert, settings.lang],
  );

  const addMark = useCallback(() => {
    if (endedRef.current) return;
    const m = Math.round(now());
    marksRef.current = [...marksRef.current, m];
    setMarks(marksRef.current);
    cue("mark");
    vibrate(40);
  }, []);

  // --- Microphone + transcription lifecycle -------------------------------
  useEffect(() => {
    let cancelled = false;
    const tt = () => tRef.current;

    const speechError = (kind: SpeechErrorKind, fatal: boolean) => {
      const map: Record<SpeechErrorKind, string> = {
        denied: tt().denied,
        network: tt().netSpeech,
        audio: tt().audioErr,
        language: tt().langErr,
        unsupported: tt().noSpeech,
        other: tt().netSpeech,
      };
      setBanner({ text: map[kind], tone: fatal ? "error" : "warn" });
    };

    async function boot() {
      await keepAwake(true);
      const tapOk = await enableGlassesTap(addMark, "SaleScan");
      if (!cancelled) setTapEnabled(tapOk);

      if (settings.announce && settings.tts) await say(tt().disclosure);
      if (cancelled) return;
      cue("start");

      if (settings.demo) {
        setListening(true);
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await openMic(settings.deviceId);
      } catch {
        try {
          stream = await openMic();
          onFallbackMicRef.current = true;
          if (settings.glasses) setBanner({ text: tt().glassesLost, tone: "warn" });
        } catch (e) {
          const err = micErrorFrom(e);
          setBanner({ text: err === "denied" ? tt().denied : err === "insecure" ? tt().insecure : tt().audioErr, tone: "error" });
          return;
        }
      }
      if (cancelled) return stopStream(stream);
      streamRef.current = stream;
      watchTrack(stream);

      const rec = new Transcriber(
        settings.lang,
        {
          onFinal: addFinal,
          onInterim: (txt) => !speakingRef.current && setInterim(txt),
          onError: speechError,
          onListening: (l) => {
            setListening(l);
            if (l) setBanner((b) => (b?.tone === "warn" && b.text === tt().netSpeech ? null : b));
          },
        },
        stream.getAudioTracks()[0] ?? null,
        settings.localSpeech,
      );
      recRef.current = rec;
      rec.start();
    }

    /** If the glasses' audio track dies (Bluetooth dropped), switch mics. */
    function watchTrack(stream: MediaStream) {
      stream.getAudioTracks()[0]?.addEventListener("ended", () => void switchToFallback());
    }

    async function switchToFallback() {
      if (endedRef.current || onFallbackMicRef.current) return;
      onFallbackMicRef.current = true;
      setBanner({ text: tt().glassesLost, tone: "warn" });
      cue("alert");
      try {
        const s = await openMic();
        stopStream(streamRef.current);
        streamRef.current = s;
        recRef.current?.setTrack(s.getAudioTracks()[0] ?? null);
      } catch {
        setBanner({ text: tt().audioErr, tone: "error" });
      }
    }

    async function onDeviceChange() {
      if (settings.demo || endedRef.current || !settings.deviceId) return;
      const inputs = await listInputs();
      const glassesPresent = inputs.some((d) => d.deviceId === settings.deviceId);
      if (!glassesPresent && !onFallbackMicRef.current) {
        await switchToFallback();
      } else if (glassesPresent && onFallbackMicRef.current && inputs.some(isGlasses)) {
        try {
          const s = await openMic(settings.deviceId);
          stopStream(streamRef.current);
          streamRef.current = s;
          watchTrack(s);
          onFallbackMicRef.current = false;
          recRef.current?.setTrack(s.getAudioTracks()[0] ?? null);
          setBanner({ text: tt().glassesBack, tone: "info" });
          cue("ready");
          window.setTimeout(() => setBanner((b) => (b?.text === tt().glassesBack ? null : b)), 4000);
        } catch {
          /* stay on fallback */
        }
      }
    }

    void boot();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      recRef.current?.stop();
      stopStream(streamRef.current);
      disableGlassesTap();
      void keepAwake(false);
    };
    // Mount-only: the session is a single lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Demo playback ------------------------------------------------------
  useEffect(() => {
    if (!settings.demo) return;
    const lines = DEMOS[settings.lang].lines;
    let i = 0;
    let timer: number;
    let typer: number;
    const next = () => {
      if (endedRef.current || i >= lines.length) return;
      const line = lines[i++];
      const words = line.split(" ");
      let w = 0;
      // Type out interim text word by word, like live recognition does.
      typer = window.setInterval(() => {
        w++;
        setInterim(words.slice(0, w).join(" "));
        if (w >= words.length) {
          window.clearInterval(typer);
          addFinal(line);
          timer = window.setTimeout(next, 1400);
        }
      }, 120);
    };
    timer = window.setTimeout(next, 1500);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(typer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Timer, connectivity, periodic AI live check ------------------------
  useEffect(() => {
    const tick = window.setInterval(() => setElapsed(now()), 1000);
    const on = () => {
      setOnline(true);
      setBanner((b) => (b?.text === tRef.current.offline ? null : b));
    };
    const off = () => {
      setOnline(false);
      setBanner({ text: tRef.current.offline, tone: "warn" });
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    const ctrl = new AbortController();
    const check = window.setInterval(async () => {
      if (!navigator.onLine || endedRef.current) return;
      const text = segRef.current.map((s) => s.text).join(" ");
      if (text.length - lastCheckedLenRef.current < LIVE_CHECK_MIN_NEW_CHARS) return;
      lastCheckedLenRef.current = text.length;
      const found = await liveCheck(
        { lang: settings.lang, context, recentText: text.slice(-2500), alreadyAlerted: alertLabelsRef.current },
        ctrl.signal,
      );
      for (const a of found) raiseAlert({ ...a, source: "ai" });
    }, LIVE_CHECK_EVERY_MS);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(check);
      ctrl.abort();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [segments, interim]);

  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60).toString().padStart(2, "0");
  const statusText = settings.demo ? t.demoRunning : listening ? t.listening : t.paused;

  return (
    <section className={`stack session ${flash ? "flash" : ""}`}>
      <div className="live-head">
        <h2 tabIndex={-1} className="live-status">
          <span className={`rec ${listening ? "on" : ""}`} aria-hidden="true" />
          {statusText}
          <span className="timer" aria-label={`${mm}:${ss}`}>
            {mm}:{ss}
          </span>
        </h2>
        <p className="muted small">
          {settings.demo ? "Demo" : settings.glasses && !onFallbackMicRef.current ? "🕶 Ray-Ban Meta" : "📱 Phone mic"}
          {!online && " · offline"}
          {settings.localSpeech && " · on-device"}
        </p>
      </div>

      {banner && (
        <p className={`banner ${banner.tone}`} role={banner.tone === "error" ? "alert" : "status"}>
          {banner.text}
        </p>
      )}

      <div className="card">
        <h3>
          {t.alerts} {alerts.length > 0 && <span className="count">{alerts.length}</span>}
        </h3>
        <div aria-live="assertive" aria-atomic="false">
          {alerts.length === 0 ? (
            <p className="muted">{t.noAlerts}</p>
          ) : (
            <ul className="alerts">
              {alerts.map((a) => (
                <li key={a.key} className={`alert sev-${a.severity}`}>
                  <div className="alert-top">
                    <strong>{a.tactic}</strong>
                    <span className="sev">{t.severity[a.severity]}</span>
                  </div>
                  <p>{a.tip}</p>
                  {a.quote && <q>{a.quote}</q>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card transcript">
        <h3>{t.transcript}</h3>
        <div className="lines">
          {segments.length === 0 && !interim && <p className="muted">{t.emptyTranscript}</p>}
          {segments.map((s) => (
            <p key={s.id}>
              <span className="ts">{Math.floor(s.t / 60)}:{(s.t % 60).toString().padStart(2, "0")}</span> {s.text}
              {marks.some((m) => Math.abs(m - s.t) <= 3) && <span className="flagged" title={t.marked}> ⚑</span>}
            </p>
          ))}
          {interim && <p className="interim">{interim}</p>}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      <div className="session-actions">
        <button className="btn mark" onClick={addMark} aria-describedby="tap-hint">
          ⚑ {t.mark} {marks.length > 0 && `(${marks.length})`}
        </button>
        {tapEnabled && (
          <p id="tap-hint" className="hint">
            {t.markHint}
          </p>
        )}
        <button className="btn danger big" onClick={finish}>
          ■ {t.end}
        </button>
      </div>
    </section>
  );
}
