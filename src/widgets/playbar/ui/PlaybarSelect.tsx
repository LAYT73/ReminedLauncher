import { RAIL, type Rail } from "@/shared/config/routes";
import { writeLastPlayed } from "@/shared/lib/lastPlayed";
import {
  editionOptions,
  useEditionState,
  useVersionStore,
  type Edition,
} from "@/entities/game-version";
import { useShowProgress } from "@/entities/install";
import {
  PackSelect,
  useActiveReminePack,
  usePackStore,
  useReminePacks,
} from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

function EditionSelect({ edition }: { edition: Edition }) {
  const showProgress = useShowProgress();
  const packs = usePackStore((s) => s.packs);
  const { versions, pick, busy } = useEditionState(edition);
  const select = useVersionStore((s) => s.select);
  return (
    <PackSelect
      label="Version"
      packs={editionOptions(edition, versions, packs)}
      value={pick}
      onChange={(id) => select(edition, id)}
      disabled={showProgress || busy}
    />
  );
}

function ReminePackSelect() {
  const showProgress = useShowProgress();
  const packs = useReminePacks();
  const active = useActiveReminePack();
  return (
    <PackSelect
      packs={packs}
      value={active?.id ?? ""}
      onChange={(id) => {
        writeLastPlayed({ java: id });
        const { profile, persist } = useProfileStore.getState();
        void persist({ ...profile, selected_pack: id });
      }}
      disabled={showProgress}
    />
  );
}

/** Version / pack selector for the active pack rail. */
export function PlaybarSelect({ rail }: { rail: Rail }) {
  if (rail === RAIL.vanilla) return <EditionSelect edition="vanilla" />;
  if (rail === RAIL.reminedVanilla) return <EditionSelect edition="remined-vanilla" />;
  return <ReminePackSelect />;
}
