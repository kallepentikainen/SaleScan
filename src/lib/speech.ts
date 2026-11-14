/**
 * Wrapper around the Web Speech API's SpeechRecognition.
 * - Continuous recognition with automatic restart (browsers stop it after
 *   silence or roughly a minute).
 * - Feeds the glasses microphone track when the browser supports
 *   start(track) (Chrome 136+); otherwise the system default mic is used.
 * - Uses on-device recognition when available (Chrome 139+), so no audio
 *   leaves the phone and it works offline.
 */
import type { Lang } from "../../shared/types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = any;

export const BCP47: Record<Lang, string> = { en: "en-US", fi: "fi-FI" };

function ctor(): AnyRec | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return ctor() !== null;
}

export type LocalModelState = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

export async function localModelState(lang: Lang): Promise<LocalModelState> {
  const C = ctor();
  if (!C?.available) return "unsupported";
  try {
    return (await C.available({ langs: [BCP47[lang]], processLocally: true })) as LocalModelState;
  } catch {
    return "unsupported";
  }
}

/** Must be called from a user gesture. */
export async function installLocalModel(lang: Lang): Promise<boolean> {
  const C = ctor();
  if (!C?.install) return false;
  try {
    return Boolean(await C.install({ langs: [BCP47[lang]], processLocally: true }));
  } catch {
    return false;
  }
}

export type SpeechErrorKind = "denied" | "network" | "audio" | "language" | "unsupported" | "other";

export interface TranscriberEvents {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (kind: SpeechErrorKind, fatal: boolean) => void;
  onListening: (listening: boolean) => void;
}

export class Transcriber {
  private rec: AnyRec | null = null;
  private wanted = false;
  private restarts = 0;
  private restartTimer: number | undefined;
  private paused = false;

  constructor(
    private lang: Lang,
    private events: TranscriberEvents,
    private track: MediaStreamTrack | null = null,
    private local = false,
  ) {}

  start() {
    const C = ctor();
    if (!C) {
      this.events.onError("unsupported", true);
      return;
    }
    this.wanted = true;
    this.spawn(C);
  }

  stop() {
    this.wanted = false;
    window.clearTimeout(this.restartTimer);
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
    this.rec = null;
    this.events.onListening(false);
  }

  /** Ignore results while SaleScan itself is speaking through the glasses. */
  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Swap the input (e.g. glasses disconnected, so fall back to the phone mic). */
  setTrack(track: MediaStreamTrack | null) {
    this.track = track;
    if (this.wanted) {
      try {
        this.rec?.abort();
      } catch {
        /* restart happens in onend */
      }
    }
  }

  private spawn(C: AnyRec) {
    const rec: AnyRec = new C();
    rec.lang = BCP47[this.lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    if (this.local && "processLocally" in rec) rec.processLocally = true;

    rec.onstart = () => {
      this.events.onListening(true);
    };
    rec.onresult = (e: AnyRec) => {
      this.restarts = 0;
      if (this.paused) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = (r[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (r.isFinal) this.events.onFinal(text);
        else interim += text + " ";
      }
      this.events.onInterim(interim.trim());
    };
    rec.onerror = (e: AnyRec) => {
      const code: string = e.error;
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.wanted = false;
        this.events.onError("denied", true);
      } else if (code === "network") {
        this.events.onError("network", false);
      } else if (code === "audio-capture") {
        this.events.onError("audio", false);
      } else if (code === "language-not-supported") {
        this.wanted = false;
        this.events.onError("language", true);
      } else {
        this.events.onError("other", false);
      }
    };
    rec.onend = () => {
      this.events.onListening(false);
      if (!this.wanted) return;
      // Back off if recognition keeps dying (e.g. offline with cloud STT).
      const delay = Math.min(5000, 250 * 2 ** Math.min(this.restarts, 4));
      this.restarts++;
      this.restartTimer = window.setTimeout(() => this.wanted && this.spawn(C), delay);
    };

    this.rec = rec;
    try {
      if (this.track && this.track.readyState === "live") rec.start(this.track);
      else rec.start();
    } catch {
      try {
        rec.start();
      } catch {
        /* onend restarts */
      }
    }
  }
}
