import { useEffect, useId, useRef, useState } from "react";

export type McSelectOption = {
  id: string;
  label: string;
  hint?: string;
};

type Props = {
  label: string;
  options: McSelectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Pack playbar opens up; forms/modals usually want down. */
  menuPlacement?: "up" | "down";
  className?: string;
};

/** Pixel listbox used by PackSelect and Voice — never a native OS dropdown. */
export function McSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "—",
  menuPlacement = "up",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value);

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
  }, [open, value, options]);

  const rootClass = [
    "pack-select",
    open ? "is-open" : "",
    disabled ? "is-disabled" : "",
    menuPlacement === "down" ? "pack-select--menu-down" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} ref={rootRef}>
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
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pack-select-value">
          <strong>{selected?.label ?? placeholder}</strong>
          {selected?.hint ? <em>{selected.hint}</em> : null}
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
          {options.map((opt) => {
            const active = opt.id === (selected?.id ?? "");
            return (
              <li key={opt.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`pack-select-option ${active ? "is-active" : ""}`}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                >
                  <span className="pack-select-option-copy">
                    <strong>{opt.label}</strong>
                    {opt.hint ? <em>{opt.hint}</em> : null}
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
