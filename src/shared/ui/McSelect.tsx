import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PixelCheckIcon, PixelChevronDownIcon } from "./PixelIcons";

export type McSelectOption = {
  id: string;
  label: string;
  hint?: string;
};

type Props<T extends McSelectOption> = {
  label: string;
  options: T[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Pack playbar opens up; forms/modals usually want down. */
  menuPlacement?: "up" | "down";
  className?: string;
  /** Optional leading icon, e.g. a Minecraft face. Size is 24 on the trigger, 28 in the menu. */
  renderIcon?: (option: T, size: number) => ReactNode;
};

/** Pixel listbox used by PackSelect and Voice — never a native OS dropdown. */
export function McSelect<T extends McSelectOption>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "—",
  menuPlacement = "up",
  className = "",
  renderIcon,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value);
  const showIcons = Boolean(renderIcon);

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
    showIcons ? "pack-select--skins" : "",
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
        {renderIcon && selected ? renderIcon(selected, 24) : null}
        <span className="pack-select-value">
          <strong>{selected?.label ?? placeholder}</strong>
          {selected?.hint ? <em>{selected.hint}</em> : null}
        </span>
        <PixelChevronDownIcon className="pack-select-chevron" />
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
                  {renderIcon ? renderIcon(opt, 28) : null}
                  <span className="pack-select-option-copy">
                    <strong>{opt.label}</strong>
                    {opt.hint ? <em>{opt.hint}</em> : null}
                  </span>
                  {active ? (
                    <PixelCheckIcon className="pack-select-check" />
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
