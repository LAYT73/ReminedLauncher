import { PIXEL_MAPS, type PixelRows } from "./pixel-icons/maps";

/**
 * Render a 16x16 string map as merged per-row rects in currentColor.
 * '#' = full, '+' = half opacity (second tone), '.' = empty.
 */
export function PixelGlyph({
  rows,
  className,
}: {
  rows: PixelRows;
  className?: string;
}) {
  const full: string[] = [];
  const half: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      if (c !== "#" && c !== "+") {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === c) end++;
      (c === "#" ? full : half).push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return (
    <svg
      className={className ? `pixel-glyph ${className}` : "pixel-glyph"}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      {half.length ? (
        <path d={half.join("")} fill="currentColor" fillOpacity={0.5} />
      ) : null}
      {full.length ? <path d={full.join("")} fill="currentColor" /> : null}
    </svg>
  );
}

type IconProps = { className?: string };

function make(name: string) {
  const rows = PIXEL_MAPS[name];
  return function PixelIcon({ className }: IconProps) {
    return <PixelGlyph rows={rows} className={className} />;
  };
}

/** X used by cancel / close buttons (white by default, like the old one). */
export function PixelCrossIcon({
  color = "#fff",
  className = "btn-pixel-icon",
}: IconProps & { color?: string }) {
  return (
    <span style={{ color, display: "contents" }}>
      <PixelGlyph rows={PIXEL_MAPS.PixelCrossIcon} className={className} />
    </span>
  );
}

/** Check mark used by the username "save" button. */
export function PixelCheckIcon({ className = "btn-pixel-icon" }: IconProps) {
  return <PixelGlyph rows={PIXEL_MAPS.PixelCheckIcon} className={className} />;
}

export const PixelPlusIcon = make("PixelPlusIcon");
export const PixelPlayIcon = make("PixelPlayIcon");
export const PixelChevronLeftIcon = make("PixelChevronLeftIcon");
export const PixelChevronRightIcon = make("PixelChevronRightIcon");
export const PixelChevronDownIcon = make("PixelChevronDownIcon");
export const PixelUploadIcon = make("PixelUploadIcon");
export const PixelDownloadIcon = make("PixelDownloadIcon");
export const PixelTrashIcon = make("PixelTrashIcon");
export const PixelCopyIcon = make("PixelCopyIcon");
export const PixelSkinIcon = make("PixelSkinIcon");
/** @deprecated use PixelSkinIcon */
export const PixelCapeIcon = make("PixelCapeIcon");
export const PixelSignOutIcon = make("PixelSignOutIcon");
export const PixelLeaveIcon = make("PixelLeaveIcon");
export const PixelFolderIcon = make("PixelFolderIcon");
export const PixelGearIcon = make("PixelGearIcon");
export const PixelCameraIcon = make("PixelCameraIcon");
export const PixelFriendsIcon = make("PixelFriendsIcon");
export const PixelWifiIcon = make("PixelWifiIcon");
export const PixelWifiOffIcon = make("PixelWifiOffIcon");
export const PixelMicIcon = make("PixelMicIcon");
export const PixelMicOffIcon = make("PixelMicOffIcon");
export const PixelHeadphonesIcon = make("PixelHeadphonesIcon");
export const PixelHeadphonesOffIcon = make("PixelHeadphonesOffIcon");
export const PixelVideoIcon = make("PixelVideoIcon");
export const PixelVideoOffIcon = make("PixelVideoOffIcon");
export const PixelScreenIcon = make("PixelScreenIcon");
export const PixelScreenOffIcon = make("PixelScreenOffIcon");
export const PixelInviteIcon = make("PixelInviteIcon");
export const PixelFullscreenIcon = make("PixelFullscreenIcon");
export const PixelDiceIcon = make("PixelDiceIcon");
export const PixelClockIcon = make("PixelClockIcon");
export const PixelCalendarIcon = make("PixelCalendarIcon");
