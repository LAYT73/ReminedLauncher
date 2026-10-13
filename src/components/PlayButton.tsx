type PlayKind = "play" | "download" | "installing" | "launching" | "running";

type Props = {
  kind: PlayKind;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export function PlayButton({ kind, label, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      className={`play-btn play-btn--pixel is-${kind}`}
      disabled={disabled}
      onClick={onClick}
      data-kind={kind}
    >
      <span className="play-btn-shine" aria-hidden />
      <span className="play-btn-label">{label}</span>
    </button>
  );
}
