import { STORAGE_KEY } from "@/shared/config/storage-keys";

/** Persisted voice device preferences (mic / speaker / camera). */
const KEY = STORAGE_KEY.voiceDevices;

export type DevicePref = { id: string; label: string };
export type DevicePrefs = {
  mic: DevicePref;
  out: DevicePref;
  cam: DevicePref;
};

const EMPTY: DevicePref = { id: "", label: "" };

function pref(raw: unknown): DevicePref {
  const o = (raw ?? {}) as Partial<DevicePref>;
  return {
    id: typeof o.id === "string" ? o.id : "",
    label: typeof o.label === "string" ? o.label : "",
  };
}

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<DevicePrefs>;
      return { mic: pref(p.mic), out: pref(p.out), cam: pref(p.cam) };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { mic: EMPTY, out: EMPTY, cam: EMPTY };
}

export function saveDevicePrefs(prefs: DevicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Find a still-present device: by deviceId, then label. "" = system default. */
export function resolveDevice(
  p: DevicePref,
  list: MediaDeviceInfo[],
): string {
  if (!p.id && !p.label) return "";
  const byId = p.id ? list.find((d) => d.deviceId === p.id) : undefined;
  if (byId) return byId.deviceId;
  const byLabel = p.label ? list.find((d) => d.label === p.label) : undefined;
  return byLabel?.deviceId ?? "";
}

export async function enumerateKinds(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: all.filter((d) => d.kind === "audioinput"),
      outputs: all.filter((d) => d.kind === "audiooutput"),
      cams: all.filter((d) => d.kind === "videoinput"),
    };
  } catch {
    return { inputs: [], outputs: [], cams: [] };
  }
}
