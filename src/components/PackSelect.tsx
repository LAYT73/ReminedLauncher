import { useEffect, useId, useRef, useState } from "react";

export type PackOption = {
  id: string;
  name: string;
  version: string;
};

type Props = {
  label?: string;
  packs: PackOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export function PackSelect({
  label = "Installation",
  packs,
  value,
  onChange,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = packs.find((p) => p.id === value) ?? packs[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const active = menuRef.current.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    } else {
      menuRef.current.scrollTop = 0;
    }
  }, [open, value, packs]);

  return (
    <div
      className={`pack-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}
      ref={rootRef}
    >
      <span className="pack-select-label" id={`${listId}-label`}>
        {label}
      </span>
      <button
        type="button"
        className="pack-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label`}
        aria-controls={listId}
        disabled={disabled || packs.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pack-select-value">
          <strong>{selected?.name ?? "—"}</strong>
          {selected ? <em>{selected.version}</em> : null}
        </span>
        <svg className="pack-select-chevron" viewBox="0 0 12 8" aria-hidden>
          <path
            d="M1.1 1.2 6 6.1l4.9-4.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <ul
          className="pack-select-menu"
          id={listId}
          role="listbox"
          aria-labelledby={`${listId}-label`}
          ref={menuRef}
        >
          {packs.map((pack) => {
            const active = pack.id === (selected?.id ?? "");
            return (
              <li key={pack.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`pack-select-option ${active ? "is-active" : ""}`}
                  onClick={() => {
                    onChange(pack.id);
                    setOpen(false);
                  }}
                >
                  <span className="pack-select-option-copy">
                    <strong>{pack.name}</strong>
                    <em>{pack.version}</em>
                  </span>
                  {active ? (
                    <svg
                      className="pack-select-check"
                      viewBox="0 0 14 14"
                      aria-hidden
                    >
                      <path
                        d="M2.2 7.2 5.4 10.4 11.8 3.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span className="pack-select-check-slot" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
