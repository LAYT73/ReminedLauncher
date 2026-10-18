import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  listAudioDevices,
  type VoiceDeviceLists,
  type VoiceSession,
} from "../lib/voiceSession";
import { McSelect } from "./McSelect";

type Props = {
  open: boolean;
  session: VoiceSession | null;
  micId: string;
  outputId: string;
  onClose: () => void;
  onApply: (micId: string, outputId: string) => void;
};

export function VoiceDevicesModal({
  open,
  session,
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
  const [level, setLevel] = useState(0);
  const [loading, setLoading] = useState(false);
  const rafRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
    const tick = () => {
      setLevel(session?.getMicLevel() ?? 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, session]);

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

  const pct = Math.round(level * 100);

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
          <button type="button" className="btn-mc dim" onClick={onClose}>
            Close
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
          <div className="voice-meter-label">
            Input level <span>{pct}%</span>
          </div>
          <div
            className="voice-meter"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Microphone input level"
          >
            <div className="voice-meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="field-hint">
            Speak to test the live mic. Level updates after you are in a room.
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
