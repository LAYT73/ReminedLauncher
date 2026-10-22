export type VoiceDeviceLists = {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
};

export async function listAudioDevices(): Promise<VoiceDeviceLists> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    /* permission may already exist */
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === "audioinput"),
    outputs: all.filter((d) => d.kind === "audiooutput"),
    cams: all.filter((d) => d.kind === "videoinput"),
  };
}
