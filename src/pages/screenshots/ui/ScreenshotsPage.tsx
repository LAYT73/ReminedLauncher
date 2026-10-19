import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { ScreenshotsPanel } from "@/features/screenshots";
import { useCurrentPackId } from "@/entities/pack";

export function ScreenshotsPage() {
  const packId = useCurrentPackId(useRail());
  return <ScreenshotsPanel packId={packId} onToast={toast} />;
}
