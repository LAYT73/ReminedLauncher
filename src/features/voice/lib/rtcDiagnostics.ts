import { voiceLog } from "../api/voiceNative";

let rtcDiagInstalled = false;
let iceLogBudget = 40;

/** Happ / Clash TUN fake-IP ranges — host ICE over these never reaches 127.0.0.1 LiveKit. */
function isVpnFakeIp(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // 198.18.0.0/15 (RFC 2544 benchmarking / common TUN fake-IP)
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function candidateSummary(c: string): string {
  const m = c.match(/candidate:\S+ \d+ (\w+) \d+ (\S+) (\d+) typ (\w+)/);
  return m ? `${m[4]}/${m[1]} ${m[2]}:${m[3]}` : c.slice(0, 80);
}

function candidateIp(c: string): string | null {
  const m = c.match(/candidate:\S+ \d+ \w+ \d+ (\S+) \d+ typ/);
  return m?.[1] ?? null;
}

function iceLog(msg: string) {
  // Cap IPC during peer join — flooding voice_log_append mid-ICE stresses WKWebView.
  if (iceLogBudget <= 0) return;
  iceLogBudget -= 1;
  void voiceLog("ice", msg);
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
      iceLog(
        `${why} pair state=${String(rec.state)} local=${String(l?.candidateType)}/${String(l?.protocol)} ${String(l?.address ?? l?.ip)}:${String(l?.port)} remote=${String(rm?.candidateType)}/${String(rm?.protocol)} ${String(rm?.address ?? rm?.ip)}:${String(rm?.port)}`,
      );
    });
    if (!logged) iceLog(`${why} no successful candidate pair`);
  } catch (e) {
    iceLog(`${why} getStats failed: ${String(e)}`);
  }
}

/**
 * Log ICE candidates / states into voice.log (budgeted).
 * Also drop local VPN fake-IP host candidates so WKWebView prefers LAN/loopback
 * when the SFU is on 127.0.0.1 (BUG-001).
 */
export function installRtcDiagnostics() {
  if (rtcDiagInstalled || typeof window === "undefined") return;
  const Orig = window.RTCPeerConnection;
  if (!Orig) return;
  rtcDiagInstalled = true;
  iceLogBudget = 40;
  const Wrapped = function (
    this: unknown,
    ...args: ConstructorParameters<typeof RTCPeerConnection>
  ) {
    const pc = new Orig(...args);
    const tag = Math.random().toString(36).slice(2, 6);
    pc.addEventListener("icecandidate", (ev) => {
      const c = ev.candidate?.candidate;
      if (!c) return;
      const ip = candidateIp(c);
      if (ip && isVpnFakeIp(ip)) {
        iceLog(
          `[${tag}] WARN VPN fake-IP local ${candidateSummary(c)} (will not reach 127.0.0.1 LiveKit)`,
        );
      } else {
        iceLog(`[${tag}] local candidate ${candidateSummary(c)}`);
      }
    });
    const origAdd = pc.addIceCandidate.bind(pc);
    pc.addIceCandidate = (candidate?: RTCIceCandidateInit | null) => {
      const c =
        typeof candidate?.candidate === "string"
          ? candidate.candidate
          : candidate instanceof RTCIceCandidate
            ? candidate.candidate
            : "";
      if (c) iceLog(`[${tag}] remote candidate ${candidateSummary(c)}`);
      return origAdd(candidate as RTCIceCandidateInit);
    };
    pc.addEventListener("icegatheringstatechange", () => {
      iceLog(`[${tag}] gathering=${pc.iceGatheringState}`);
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState;
      iceLog(`[${tag}] iceConnection=${st}`);
      if (st === "connected" || st === "completed") void logSelectedPair(pc, `[${tag}] ${st}`);
      if (st === "failed") void logSelectedPair(pc, `[${tag}] failed`);
    });
    pc.addEventListener("connectionstatechange", () => {
      iceLog(`[${tag}] pc=${pc.connectionState}`);
    });
    return pc;
  } as unknown as typeof RTCPeerConnection;
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
}
