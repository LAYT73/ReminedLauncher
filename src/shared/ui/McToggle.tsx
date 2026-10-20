type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
};

/** Minecraft-style square toggle — sliding thumb, no On/Off text. */
export function McToggle({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: Props) {
  const inputId = id ?? `mc-toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <label
      className={`mc-toggle-row${disabled ? " is-disabled" : ""}`}
      htmlFor={inputId}
    >
      <span className="mc-toggle-label">{label}</span>
      <span className={`mc-toggle${checked ? " is-on" : " is-off"}`}>
        <input
          id={inputId}
          type="checkbox"
          className="mc-toggle-input"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="mc-toggle-track" aria-hidden>
          <span className="mc-toggle-thumb" />
        </span>
      </span>
    </label>
  );
}
