import { useEffect, useRef, useState } from "react";
import type { Settings } from "../App.tsx";
import type { Strings } from "../i18n.ts";
import { isGlasses, listInputs, micErrorFrom, openMic, pickPreferred, stopStream, watchLevel, type MicError } from "../lib/audio.ts";
import { installLocalModel, localModelState, speechSupported, type LocalModelState } from "../lib/speech.ts";
import { speak, unlockAudio } from "../lib/voice.ts";
import { health } from "../lib/api.ts";
import { IS_IOS } from "../lib/device.ts";

interface Props {
  t: Strings;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  onContinue: () => void;
}

type MicState = { kind: "idle" } | { kind: "checking" } | { kind: "ok" } | { kind: "error"; error: MicError };

export function Setup({ t, settings, setSettings, onContinue }: Props) {
  const [mic, setMic] = useState<MicState>({ kind: "idle" });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [local, setLocal] = useState<LocalModelState>("unsupported");
  const [server, setServer] = useState<"checking" | "ai" | "heuristic" | "down">("checking");
  const streamRef = useRef<MediaStream | null>(null);
  const stopLevelRef = useRef<() => void>(() => {});
  const hasSpeech = speechSupported();

  useEffect(() => {
    void health().then((h) => setServer(!h.reachable ? "down" : h.ai ? "ai" : "heuristic"));
  }, []);

  useEffect(() => {
    let alive = true;
    void localModelState(settings.lang).then((s) => {
      if (!alive) return;
      setLocal(s);
      setSettings((prev) => ({ ...prev, localSpeech: s === "available" }));
    });
    return () => {
      alive = false;
    };
  }, [settings.lang, setSettings]);

  useEffect(() => () => release(), []);

  function release() {
    stopLevelRef.current();
    stopStream(streamRef.current);
    streamRef.current = null;
  }

  async function attach(deviceId?: string) {
    release();
    const stream = await openMic(deviceId);
    streamRef.current = stream;
    stopLevelRef.current = watchLevel(stream, setLevel);
    return stream;
  }

  async function checkMic() {
    unlockAudio();
    setMic({ kind: "checking" });
    try {
      // First request permission (device labels are hidden until then)...
      const first = await attach();
      const inputs = await listInputs();
      setDevices(inputs);
      // ...then switch to the glasses if they're paired.
      const preferred = pickPreferred(inputs);
      const currentId = first.getAudioTracks()[0]?.getSettings().deviceId;
      if (preferred && preferred.deviceId !== currentId && isGlasses(preferred)) await attach(preferred.deviceId);
      setSettings((s) => ({ ...s, deviceId: preferred?.deviceId, glasses: preferred ? isGlasses(preferred) : false }));
      setMic({ kind: "ok" });
    } catch (e) {
      setMic({ kind: "error", error: micErrorFrom(e) });
    }
  }

  async function chooseDevice(id: string) {
    const d = devices.find((x) => x.deviceId === id);
    setSettings((s) => ({ ...s, deviceId: id, glasses: d ? isGlasses(d) : false }));
    try {
      await attach(id);
    } catch (e) {
      setMic({ kind: "error", error: micErrorFrom(e) });
    }
  }

  async function downloadModel() {
    setLocal("downloading");
    const ok = await installLocalModel(settings.lang);
    const s = ok ? await localModelState(settings.lang) : "unavailable";
    setLocal(s);
    setSettings((prev) => ({ ...prev, localSpeech: s === "available" }));
  }

  const micErrorText: Record<MicError, string> = {
    denied: t.denied,
    insecure: t.insecure,
    not_found: t.notFound,
    busy: t.busy,
    unsupported: t.noSpeech,
    unknown: t.audioErr,
  };

  const receiver = settings.role === "earpiece" || settings.role === "presenter";
  const canContinue = receiver || settings.demo || (hasSpeech && mic.kind === "ok");
  const roles = [
    { id: "solo", label: t.roleSolo, sub: t.roleSoloSub },
    { id: "listener", label: t.roleListener, sub: t.roleListenerSub },
    { id: "earpiece", label: t.roleEarpiece, sub: t.roleEarpieceSub },
    { id: "presenter", label: t.rolePresenter, sub: t.rolePresenterSub },
  ] as const;

  return (
    <section className="stack">
      <div className="hero">
        <h1 tabIndex={-1}>{t.tagline}</h1>
      </div>

      <div className="card stack">
        <h2>{t.roleTitle}</h2>
        <div className="roles" role="radiogroup" aria-label={t.roleTitle}>
          {roles.map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={settings.role === r.id}
              className={`role ${settings.role === r.id ? "on" : ""}`}
              onClick={() => setSettings((s) => ({ ...s, role: r.id }))}
            >
              <strong>{r.label}</strong>
              <span>{r.sub}</span>
            </button>
          ))}
        </div>
        {settings.role === "listener" && <p className="banner info">{t.listenerHint}</p>}
      </div>

      {!receiver && (
      <div className="card stack">
        <h2>{t.step1}</h2>

        {!hasSpeech && <p className="banner warn" role="alert">{t.noSpeech}</p>}

        <button className="btn primary" onClick={checkMic} disabled={mic.kind === "checking"}>
          {mic.kind === "checking" ? t.checking : t.checkMic}
        </button>

        {mic.kind === "error" && (
          <p className="banner error" role="alert">
            {micErrorText[mic.error]}
          </p>
        )}

        {mic.kind === "ok" && (
          <div className="stack" aria-live="polite">
            {settings.role === "listener" ? (
              <p className="status good">
                <span className="dot" aria-hidden="true" />
                {t.micOk}
              </p>
            ) : (
              <>
                <p className={`status ${settings.glasses ? "good" : "warn"}`}>
                  <span className="dot" aria-hidden="true" />
                  {settings.glasses ? t.glassesFound : t.glassesNotFound}
                </p>
                {IS_IOS && !settings.glasses && <p className="hint">{t.iosHint}</p>}
              </>
            )}
            {devices.length > 1 && (
              <label className="field">
                <span>{t.input}</span>
                <select value={settings.deviceId} onChange={(e) => void chooseDevice(e.target.value)}>
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="meter" role="meter" aria-label={t.speakToTest} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <div style={{ transform: `scaleX(${level})` }} />
            </div>
            <p className="hint">{t.speakToTest}</p>
            <button className="btn" onClick={() => void speak(t.testVoiceText, settings.lang, settings.rate)}>
              🔊 {t.testVoice}
            </button>
          </div>
        )}

        <dl className="facts">
          <div>
            <dt>{t.localSpeech}</dt>
            <dd>
              {local === "available" && <span className="ok">✓ {t.localOn}</span>}
              {(local === "downloadable" || local === "downloading") && (
                <button className="btn small" onClick={downloadModel} disabled={local === "downloading"}>
                  {local === "downloading" ? t.checking : t.localDownload}
                </button>
              )}
              {(local === "unavailable" || local === "unsupported") && <span className="muted">{t.localCloud}</span>}
            </dd>
          </div>
          <div>
            <dt>{t.server}</dt>
            <dd>
              {server === "checking" && <span className="muted">{t.checking}</span>}
              {server === "ai" && <span className="ok">✓ {t.serverAi}</span>}
              {server === "heuristic" && <span className="muted">{t.serverHeuristic}</span>}
              {server === "down" && <span className="warn-text">{t.serverDown}</span>}
            </dd>
          </div>
        </dl>
      </div>
      )}

      {!receiver && (
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.demo}
          onChange={(e) => setSettings((s) => ({ ...s, demo: e.target.checked }))}
        />
        <span>{t.demo}</span>
      </label>
      )}

      <button
        className="btn primary big"
        disabled={!canContinue}
        onClick={() => {
          unlockAudio();
          release();
          onContinue();
        }}
      >
        {t.continue} →
      </button>
    </section>
  );
}
