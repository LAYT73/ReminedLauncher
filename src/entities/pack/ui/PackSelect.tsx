import { useT } from "@/shared/i18n";
import { McSelect } from "@/shared/ui/McSelect";
import { PackIcon } from "./PackIcon";

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
  /** Shown on the trigger when nothing is selected (e.g. empty list). */
  placeholder?: string;
  /** Defaults to "up" for the bottom playbar. */
  menuPlacement?: "up" | "down";
  className?: string;
  /** Option ids are pack ids: show each pack's rail logo. */
  withIcons?: boolean;
};

export function PackSelect({
  label,
  packs,
  value,
  onChange,
  disabled = false,
  placeholder,
  menuPlacement = "up",
  className,
  withIcons = false,
}: Props) {
  const t = useT();
  return (
    <McSelect
      label={label ?? t("pack.select.installation")}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      menuPlacement={menuPlacement}
      className={className}
      renderIcon={withIcons ? (opt, size) => <PackIcon packId={opt.id} size={size} /> : undefined}
      options={packs.map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.version,
      }))}
    />
  );
}
