import { useEffect, useState } from "react";
import type { AnalyzeRequest, Lang, SessionContext } from "../shared/types.ts";
import { STRINGS } from "./i18n.ts";
import { Setup } from "./screens/Setup.tsx";
import { Prepare } from "./screens/Prepare.tsx";
import { Session } from "./screens/Session.tsx";
import { Result } from "./screens/Result.tsx";

export interface Settings {
  lang: Lang;
  deviceId?: string;
  glasses: boolean;
  localSpeech: boolean;
  demo: boolean;
  tts: boolean;
  whisperTips: boolean;
  rate: number;
  announce: boolean;
}

type Screen = "setup" | "prepare" | "session" | "result";

const EMPTY_CONTEXT: SessionContext = { category: "", item: "", price: "", budget: "", notes: "" };

/** Only non-sensitive preferences are remembered. Transcripts never are. */
function loadPrefs(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem("salescan.prefs") ?? "{}") as Partial<Settings>;
  } catch {
    return {};
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const p = loadPrefs();
    const browserFi = navigator.language?.toLowerCase().startsWith("fi");
    return {
      lang: p.lang ?? (browserFi ? "fi" : "en"),
      glasses: false,
      localSpeech: false,
      demo: false,
      tts: p.tts ?? true,
      whisperTips: p.whisperTips ?? true,
      rate: p.rate ?? 1,
      announce: p.announce ?? false,
    };
  });
  const [screen, setScreen] = useState<Screen>("setup");
  const [context, setContext] = useState<SessionContext>(EMPTY_CONTEXT);
  const [request, setRequest] = useState<AnalyzeRequest | null>(null);

  const t = STRINGS[settings.lang];

  useEffect(() => {
    document.documentElement.lang = settings.lang;
    try {
      const { lang, tts, whisperTips, rate, announce } = settings;
      localStorage.setItem("salescan.prefs", JSON.stringify({ lang, tts, whisperTips, rate, announce }));
    } catch {
      /* storage blocked */
    }
  }, [settings]);

  useEffect(() => {
    // Move focus to the new screen's heading for screen reader users.
    document.querySelector<HTMLElement>("main h1, main h2")?.focus();
    window.scrollTo(0, 0);
  }, [screen]);

  const reset = () => {
    setRequest(null);
    setContext(EMPTY_CONTEXT);
    setScreen("setup");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" aria-hidden="true">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>SaleScan</span>
        </div>
        {screen !== "session" && (
          <div className="lang-switch" role="group" aria-label={t.language}>
            {(["fi", "en"] as const).map((l) => (
              <button
                key={l}
                className={settings.lang === l ? "on" : ""}
                aria-pressed={settings.lang === l}
                onClick={() => setSettings((s) => ({ ...s, lang: l }))}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </header>

      <main>
        {screen === "setup" && (
          <Setup t={t} settings={settings} setSettings={setSettings} onContinue={() => setScreen("prepare")} />
        )}
        {screen === "prepare" && (
          <Prepare
            t={t}
            settings={settings}
            setSettings={setSettings}
            context={context}
            setContext={setContext}
            onBack={() => setScreen("setup")}
            onStart={() => setScreen("session")}
          />
        )}
        {screen === "session" && (
          <Session
            t={t}
            settings={settings}
            context={context}
            onEnd={(req) => {
              setRequest(req);
              setScreen("result");
            }}
          />
        )}
        {screen === "result" && request && <Result t={t} settings={settings} request={request} onReset={reset} />}
      </main>
    </div>
  );
}
