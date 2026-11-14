/** Microphone + Bluetooth glasses handling. */

const GLASSES_RE = /ray-?ban|meta|rbm|stories|glasses|oakley/i;

export function isGlasses(device: Pick<MediaDeviceInfo, "label">): boolean {
  return GLASSES_RE.test(device.label);
}

export type MicError = "denied" | "not_found" | "busy" | "insecure" | "unsupported" | "unknown";

export function micErrorFrom(err: unknown): MicError {
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "unknown";
}

export async function openMic(deviceId?: string): Promise<MediaStream> {
  if (!window.isSecureContext) throw Object.assign(new Error("insecure"), { name: "SecurityError" });
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId !== "");
}

/** Prefers the glasses, then the system default. */
export function pickPreferred(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  return devices.find(isGlasses) ?? devices.find((d) => d.deviceId === "default") ?? devices[0];
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Calls onLevel(0..1) about 15 times a second. Returns a stop function. */
export function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const id = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
  }, 66);
  return () => {
    window.clearInterval(id);
    src.disconnect();
    void ctx.close();
  };
}
