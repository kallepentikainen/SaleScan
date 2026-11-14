import { useEffect, useState } from "react";
import type { SessionContext } from "../../shared/types.ts";
import type { Settings } from "../App.tsx";
import type { Strings } from "../i18n.ts";
import { DEMOS } from "../lib/demo.ts";
import { unlockAudio } from "../lib/voice.ts";

interface Props {
  t: Strings;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  context: SessionContext;
  setContext: React.Dispatch<React.SetStateAction<SessionContext>>;
  onBack: () => void;
  onStart: () => void;
}

export function Prepare({ t, settings, setSettings, context, setContext, onBack, onStart }: Props) {
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (settings.demo) setContext(DEMOS[settings.lang].context);
  }, [settings.demo, settings.lang, setContext]);

  const field = (key: keyof SessionContext, label: string, multiline = false) => (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={2} value={context[key]} maxLength={600} onChange={(e) => setContext((c) => ({ ...c, [key]: e.target.value }))} />
      ) : (
        <input value={context[key]} maxLength={200} onChange={(e) => setContext((c) => ({ ...c, [key]: e.target.value }))} />
      )}
    </label>
  );

  return (
    <section className="stack">
      <div className="card stack">
        <h2 tabIndex={-1}>{t.step2}</h2>
        <div className="chips" role="group" aria-label={t.category}>
          {t.categories.map((c) => (
            <button
              key={c}
              className={`chip ${context.category === c ? "on" : ""}`}
              aria-pressed={context.category === c}
              onClick={() => setContext((x) => ({ ...x, category: x.category === c ? "" : c }))}
            >
              {c}
            </button>
          ))}
        </div>
        {field("item", t.item)}
        <div className="row">
          {field("price", t.price)}
          {field("budget", t.budget)}
        </div>
        {field("notes", t.notes, true)}
      </div>

      <div className="card stack">
        <h2>{t.step3}</h2>
        <ul className="privacy">
          {t.privacy.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <label className="toggle">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t.consentTell}</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.announce}
            onChange={(e) => setSettings((s) => ({ ...s, announce: e.target.checked }))}
          />
          <span>{t.consentPlay}</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.tts} onChange={(e) => setSettings((s) => ({ ...s, tts: e.target.checked }))} />
          <span>{t.tts}</span>
        </label>
        <label className="field">
          <span>
            {t.speed}: {settings.rate.toFixed(1)}×
          </span>
          <input
            type="range"
            min={0.7}
            max={1.5}
            step={0.1}
            value={settings.rate}
            onChange={(e) => setSettings((s) => ({ ...s, rate: Number(e.target.value) }))}
          />
        </label>
      </div>

      <button
        className="btn primary big"
        disabled={!consent}
        onClick={() => {
          unlockAudio();
          onStart();
        }}
      >
        ● {t.start}
      </button>
      <button className="btn ghost" onClick={onBack}>
        ← {t.back}
      </button>
    </section>
  );
}
