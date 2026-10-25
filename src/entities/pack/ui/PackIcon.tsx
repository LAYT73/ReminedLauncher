import brandLogo from "@/shared/assets/logo.png";
import vanillaLogo from "@/shared/assets/vanilla.png";
import reminedVanillaLogo from "@/shared/assets/remined-vanilla-logo.png";
import { isReminedVanillaPackId, isVanillaPackId } from "@/shared/lib/packIds";
import { usePackContent } from "../model/selectors";

/** Pack logo as shown on the rail: catalog logo, vanilla / Remined Vanilla mark, or the brand logo. */
export function PackIcon({ packId, size }: { packId: string; size: number }) {
  const logoUrl = usePackContent(packId)?.logo_url;
  const src = isVanillaPackId(packId)
    ? vanillaLogo
    : isReminedVanillaPackId(packId)
      ? reminedVanillaLogo
      : (logoUrl ?? brandLogo);
  return (
    <img
      className="pack-select-pack-icon"
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}
