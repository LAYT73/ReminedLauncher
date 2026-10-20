import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listAudioDevices, type VoiceDeviceLists } from "../lib/audioDevices";
import type { VoiceSession } from "../lib/voiceSession";
import { McSelect } from "@/shared/ui/McSelect";
import { PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { PixelProgress } from "@/shared/ui/PixelProgress";

type Props = {
  open: boolean;
  session: VoiceSession | null;
  micId: string;
  outputId: string;
  onClose: () => void;
  onApply: (micId: string, outputId: string) => void;
};

const METER_CELLS = 20;

/** Live mic preview — stepped peak/decay so short phrases register on the bar. */
function useMicPreview(open: boolean, deviceId: string) {
  const [levelPct, setLevelPct] = useState(0);

  useEffect(() => {
    if (!open) {
      setLevelPct(0);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let held = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId
            ? { deviceId: { exact: deviceId }, echoCancellation: true }
            : { echoCancellation: true },
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx = new AC();
        await ctx.resume().catch(() => undefined);
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.35;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const raw = Math.min(1, rms * 5);
          // Instant attack so a short phrase lights cells; slow decay to read it.
          if (raw > held) held = raw;
          else held = Math.max(0, held - 0.045);
          // Snap to the same steps the pixel bar uses (5% per cell).
          const stepped = Math.round(held * METER_CELLS) / METER_CELLS;
          setLevelPct(Math.round(stepped * 100));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setLevelPct(0);
      }
    }

    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
    };
  }, [open, deviceId]);

  return levelPct;
}

export function VoiceDevicesModal({
  open,
  session: _session,
  micId,
  outputId,
  onClose,
  onApply,
}: Props) {
  const titleId = useId();
  const [devices, setDevices] = useState<VoiceDeviceLists>({
    inputs: [],
    outputs: [],
  });
  const [mic, setMic] = useState(micId);
  const [out, setOut] = useState(outputId);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const levelPct = useMicPreview(open, mic);

  useEffect(() => {
    if (!open) return;
    setMic(micId);
    setOut(outputId);
    setLoading(true);
    void listAudioDevices()
      .then(setDevices)
      .finally(() => setLoading(false));
  }, [open, micId, outputId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("button")
        ?.focus();
    }, 0);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  const micOptions = useMemo(
    () => [
      { id: "", label: "System default", hint: "OS microphone" },
      ...devices.inputs.map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
        hint: d.deviceId.slice(0, 10),
      })),
    ],
    [devices.inputs],
  );

  const outOptions = useMemo(
    () => [
      { id: "", label: "System default", hint: "OS speakers" },
      ...devices.outputs.map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Output ${i + 1}`,
        hint: d.deviceId.slice(0, 10),
      })),
    ],
    [devices.outputs],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="voice-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="voice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voice-modal-head">
          <h3 id={titleId} className="settings-heading">
            Voice devices
          </h3>
          <button
            type="button"
            className="btn-mc dim btn-icon-sq voice-modal-close"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <PixelCrossIcon />
          </button>
        </header>

        <McSelect
          className="pack-select--full"
          label="Microphone"
          menuPlacement="down"
          disabled={loading}
          options={micOptions}
          value={mic}
          onChange={setMic}
          placeholder="System default"
        />

        <McSelect
          className="pack-select--full"
          label="Output"
          menuPlacement="down"
          disabled={loading}
          options={outOptions}
          value={out}
          onChange={setOut}
          placeholder="System default"
        />

        <div className="voice-meter-block">
          <PixelProgress
            value={levelPct}
            phase="Input level"
            cells={METER_CELLS}
          />
          <p className="field-hint">
            Speak to test — uses a live mic preview (not the room session).
          </p>
        </div>

        <div className="voice-modal-actions btn-row">
          <button type="button" className="btn-mc dim" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-mc ok"
            onClick={() => {
              onApply(mic, out);
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
