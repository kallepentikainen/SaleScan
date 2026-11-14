/**
 * Audio output through the glasses' open-ear speakers (the phone routes
 * Bluetooth audio there): spoken text via speechSynthesis plus short
 * discreet earcons via WebAudio.
 */
import type { Lang } from "../../shared/types.ts";
import { BCP47 } from "./speech.ts";

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx ??= new Ctx();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call once from a user gesture so later audio is allowed to play. */
export function unlockAudio() {
  audio();
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

export type Cue = "start" | "alert" | "mark" | "end" | "ready";

const CUES: Record<Cue, [number, number][]> = {
  start: [[660, 0.09], [880, 0.12]],
  ready: [[880, 0.1], [1175, 0.16]],
  mark: [[1046, 0.07]],
  alert: [[440, 0.12], [0, 0.06], [440, 0.12]],
  end: [[880, 0.09], [660, 0.14]],
};

export function cue(kind: Cue, volume = 0.18) {
  const c = audio();
  if (!c) return;
  let t = c.currentTime + 0.02;
  for (const [freq, dur] of CUES[kind]) {
    if (freq > 0) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    t += dur;
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

function voiceFor(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const tag = BCP47[lang].toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === tag && v.localService) ??
    voices.find((v) => v.lang.toLowerCase() === tag) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang))
  );
}

export function canSpeak(): boolean {
  return "speechSynthesis" in window;
}

export function speak(text: string, lang: Lang, rate = 1): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak() || !text.trim()) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[lang];
    const v = voiceFor(lang);
    if (v) u.voice = v;
    u.rate = rate;
    // Some engines never fire onend, so resolve on a time estimate as well.
    const fallback = window.setTimeout(resolve, 1500 + text.length * 90 / rate);
    const done = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
