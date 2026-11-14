/**
 * Hands-free control plus keeping the session alive.
 *
 * Glasses tap: Ray-Ban Meta glasses send Bluetooth media play/pause when the
 * touchpad is tapped. While a session runs, we play an inaudible loop so the
 * page owns the Media Session, and treat play/pause as "flag this moment".
 * The buyer can discreetly mark the moments that feel off, without touching
 * the phone.
 */

let silentEl: HTMLAudioElement | null = null;

function silentWavUrl(seconds = 2, rate = 8000): string {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** Must be called from a user gesture. Returns false if unsupported. */
export async function enableGlassesTap(onTap: () => void, title: string): Promise<boolean> {
  if (!("mediaSession" in navigator)) return false;
  try {
    silentEl ??= Object.assign(new Audio(silentWavUrl()), { loop: true });
    silentEl.volume = 0.01;
    await silentEl.play();
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "SaleScan" });
    navigator.mediaSession.playbackState = "playing";
    const handler = () => {
      onTap();
      // Keep "playing" so the next tap is delivered as well.
      void silentEl?.play();
      navigator.mediaSession.playbackState = "playing";
    };
    for (const action of ["play", "pause", "stop"] as MediaSessionAction[]) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action unsupported */
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function disableGlassesTap() {
  silentEl?.pause();
  if (!("mediaSession" in navigator)) return;
  for (const action of ["play", "pause", "stop"] as MediaSessionAction[]) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
  navigator.mediaSession.playbackState = "none";
}

/* Screen wake lock: SpeechRecognition stops when the screen turns off. */
let lock: WakeLockSentinel | null = null;
let wantLock = false;

export async function keepAwake(on: boolean): Promise<boolean> {
  wantLock = on;
  if (!("wakeLock" in navigator)) return false;
  try {
    if (on && !lock) {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
    return true;
  } catch {
    return false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wantLock && !lock) void keepAwake(true);
});

export function batteryInfo(): Promise<{ level: number; charging: boolean } | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  return nav.getBattery ? nav.getBattery().catch(() => null) : Promise.resolve(null);
}
