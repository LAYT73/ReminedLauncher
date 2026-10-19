import { voiceLog } from "../api/voiceNative";

let rtcDiagInstalled = false;

function candidateSummary(c: string): string {
  const m = c.match(/candidate:\S+ \d+ (\w+) \d+ (\S+) (\d+) typ (\w+)/);
  return m ? `${m[4]}/${m[1]} ${m[2]}:${m[3]}` : c.slice(0, 80);
}

async function logSelectedPair(pc: RTCPeerConnection, why: string) {
  try {
    const stats = await pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    stats.forEach((r) => byId.set(r.id as string, r as Record<string, unknown>));
    let logged = false;
    stats.forEach((r) => {
      const rec = r as Record<string, unknown>;
      if (rec.type !== "candidate-pair") return;
      if (!(rec.selected || rec.nominated) && rec.state !== "succeeded") return;
      const l = byId.get(String(rec.localCandidateId));
      const rm = byId.get(String(rec.remoteCandidateId));
      logged = true;
      void voiceLog(
        "ice",
        `${why} pair state=${String(rec.state)} local=${String(l?.candidateType)}/${String(l?.protocol)} ${String(l?.address ?? l?.ip)}:${String(l?.port)} remote=${String(rm?.candidateType)}/${String(rm?.protocol)} ${String(rm?.address ?? rm?.ip)}:${String(rm?.port)}`,
      );
    });
    if (!logged) void voiceLog("ice", `${why} no successful candidate pair`);
  } catch (e) {
    void voiceLog("ice", `${why} getStats failed: ${String(e)}`);
  }
}

/** Log ICE candidates / states of every RTCPeerConnection into voice.log (BUG-001 diagnosis). */
export function installRtcDiagnostics() {
  if (rtcDiagInstalled || typeof window === "undefined") return;
  const Orig = window.RTCPeerConnection;
  if (!Orig) return;
  rtcDiagInstalled = true;
  const Wrapped = function (
    this: unknown,
    ...args: ConstructorParameters<typeof RTCPeerConnection>
  ) {
    const pc = new Orig(...args);
    const tag = Math.random().toString(36).slice(2, 6);
    pc.addEventListener("icecandidate", (ev) => {
      const c = ev.candidate?.candidate;
      if (c) void voiceLog("ice", `[${tag}] local candidate ${candidateSummary(c)}`);
    });
    pc.addEventListener("icegatheringstatechange", () => {
      void voiceLog("ice", `[${tag}] gathering=${pc.iceGatheringState}`);
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState;
      void voiceLog("ice", `[${tag}] iceConnection=${st}`);
      if (st === "connected" || st === "completed") void logSelectedPair(pc, `[${tag}] ${st}`);
      if (st === "failed") void logSelectedPair(pc, `[${tag}] failed`);
    });
    pc.addEventListener("connectionstatechange", () => {
      void voiceLog("ice", `[${tag}] pc=${pc.connectionState}`);
    });
    return pc;
  } as unknown as typeof RTCPeerConnection;
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
}
