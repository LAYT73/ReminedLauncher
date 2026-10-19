import { selectPackPlayStats, usePlaytimeStore } from "@/entities/playtime";
import { PlaytimeBadges } from "@/shared/ui/PlaytimeBadges";

type Props = {
  packId: string | null | undefined;
  className?: string;
};

/** Hours + last launch for one pack/version. Hidden if never played. */
export function PackPlaytime({ packId, className }: Props) {
  const stats = usePlaytimeStore(selectPackPlayStats(packId));
  return <PlaytimeBadges stats={stats} className={className} />;
}
