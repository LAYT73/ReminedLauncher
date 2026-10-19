import homeWallpaperVideo from "@/shared/assets/home-wallpaper.mp4";
import { RAIL } from "@/shared/config/routes";
import { useRoute } from "@/shared/lib/useRoute";
import { useHomeVideo, useHomeVideoReady } from "../model/useHomeVideo";

/** One persistent <video> — survives rail changes (settings/java/etc.). */
export function HomeVideoLayer() {
  const { rail, tab } = useRoute();
  const live = rail === RAIL.home && tab === "play";
  const { ref, kept } = useHomeVideo(live);
  const { ready, setReady } = useHomeVideoReady();
  if (!live && !kept) return null;
  return (
    <video
      ref={ref}
      className={`home-video${live ? " is-live" : " is-parked"}${
        ready ? " is-ready" : ""
      }`}
      src={homeWallpaperVideo}
      autoPlay={live}
      muted
      loop
      playsInline
      preload="auto"
      onCanPlay={() => setReady(true)}
      onEnded={(e) => {
        // Fallback if native `loop` stalls (common after park/pause on WebKit)
        const v = e.currentTarget;
        v.currentTime = 0;
        if (live) void v.play().catch(() => {});
      }}
      aria-hidden
    />
  );
}
