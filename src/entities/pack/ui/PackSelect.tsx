import { useT } from "@/shared/i18n";
import { McSelect } from "@/shared/ui/McSelect";

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
};

export function PackSelect({
  label,
  packs,
  value,
  onChange,
  disabled = false,
  placeholder,
}: Props) {
  const t = useT();
  return (
    <McSelect
      label={label ?? t("pack.select.installation")}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      menuPlacement="up"
      options={packs.map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.version,
      }))}
    />
  );
}
