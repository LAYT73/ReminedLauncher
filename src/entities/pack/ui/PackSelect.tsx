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
};

export function PackSelect({
  label = "Installation",
  packs,
  value,
  onChange,
  disabled = false,
}: Props) {
  return (
    <McSelect
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      menuPlacement="up"
      options={packs.map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.version,
      }))}
    />
  );
}
