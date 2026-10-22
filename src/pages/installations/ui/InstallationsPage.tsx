import { Fragment } from "react";
import { useT } from "@/shared/i18n";
import { isReminedVanillaPackId, isVanillaPackId, reminedVanillaPackId, vanillaPackId } from "@/shared/lib/packIds";
import { useEditionState } from "@/entities/game-version";
import { useActiveReminePack, useInstalledPacks, useViewCatalog } from "@/entities/pack";
import { InstallRow } from "./InstallRow";
import { EmptyState } from "@/shared/ui/EmptyState";

export function InstallationsPage() {
  const t = useT();
  const installedPacks = useInstalledPacks();
  const catalog = useViewCatalog();
  const vanillaPick = useEditionState("vanilla").pick;
  const rvPick = useEditionState("remined-vanilla").pick;
  const activeId = useActiveReminePack()?.id ?? "";
  const selectedVanillaId = vanillaPick ? vanillaPackId(vanillaPick) : null;
  const selectedReminedVanillaId = rvPick ? reminedVanillaPackId(rvPick) : null;

  function renderRow(pack: Parameters<typeof InstallRow>[0]["pack"]) {
    const vanilla = isVanillaPackId(pack.id);
    const rv = isReminedVanillaPackId(pack.id);
    const active = vanilla
      ? pack.id === selectedVanillaId
      : rv
        ? pack.id === selectedReminedVanillaId
        : pack.id === activeId;
    const logo = vanilla || rv ? null : catalog.find((c) => c.id === pack.id)?.logo_url;
    return <InstallRow key={pack.id} pack={pack} active={active} logo={logo} />;
  }

  const remine = installedPacks.filter(
    (p) => !isVanillaPackId(p.id) && !isReminedVanillaPackId(p.id),
  );
  const vanilla = installedPacks.filter((p) => isVanillaPackId(p.id));
  const rv = installedPacks.filter((p) => isReminedVanillaPackId(p.id));
  // Remined → Remined Vanilla → Vanilla, divided only between non-empty groups.
  const groups = [remine, rv, vanilla].filter((g) => g.length > 0);

  return (
    <section className="section">
      <h2 className="page-title">{t("pack.installations.title")}</h2>
      {groups.length === 0 ? (
        <EmptyState
          kind="installations"
          title={t("pack.installations.emptyTitle")}
          description={t("pack.installations.emptyDescription")}
        />
      ) : (
        <div className="install-groups">
          {groups.map((group, i) => (
            <Fragment key={i}>
              {i > 0 ? <hr className="install-divider" /> : null}
              <ul className="install-list">{group.map(renderRow)}</ul>
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
