import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { ScreenshotsPanel } from "@/features/screenshots";
import { useCurrentPackId, usePackStore } from "@/entities/pack";

export function ScreenshotsPage() {
  const packId = useCurrentPackId(useRail());
  const installed = usePackStore((s) =>
    packId ? s.installedIds.has(packId) : false,
  );
  return (
    <ScreenshotsPanel
      packId={packId}
      installed={installed}
      onToast={toast}
    />
  );
}
