import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { AccountSection } from "./sections/AccountSection";
import { DebugSection } from "./sections/DebugSection";
import { JavaSection } from "./sections/JavaSection";
import { LauncherSection } from "./sections/LauncherSection";
import { NetworkSection } from "./sections/NetworkSection";
import { PackSection } from "./sections/PackSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { ThemeSection } from "./sections/ThemeSection";

type SettingsTab = "general" | "network" | "runtime" | "updates" | "debug";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "network", label: "Network" },
  { id: "runtime", label: "Runtime" },
  { id: "updates", label: "Updates" },
  { id: "debug", label: "Debug" },
];

function tabFromHash(hash: string): SettingsTab | null {
  const key = hash.replace(/^#/, "").toLowerCase();
  if (key === "network") return "network";
  if (key === "runtime" || key === "java") return "runtime";
  if (key === "updates" || key === "launcher") return "updates";
  if (key === "debug") return "debug";
  if (key === "general" || key === "theme" || key === "account") return "general";
  return null;
}

function Divided({ sections }: { sections: ReactNode[] }) {
  return (
    <div className="settings-groups">
      {sections.map((node, i) => (
        <Fragment key={i}>
          {i > 0 ? <hr className="settings-divider" /> : null}
          {node}
        </Fragment>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { hash } = useLocation();
  const [tab, setTab] = useState<SettingsTab>(
    () => tabFromHash(hash) ?? "general",
  );

  useEffect(() => {
    const fromHash = tabFromHash(hash);
    if (fromHash) setTab(fromHash);
  }, [hash]);

  return (
    <section className="section settings-panel">
      <h2 className="page-title">Settings</h2>

      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`settings-panel-${t.id}`}
            className={`settings-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="settings-tab-panel"
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "general" ? (
          <Divided
            sections={[
              <ThemeSection key="theme" />,
              <NotificationsSection key="notifications" />,
              <AccountSection key="account" />,
            ]}
          />
        ) : null}
        {tab === "network" ? <NetworkSection /> : null}
        {tab === "runtime" ? <JavaSection /> : null}
        {tab === "updates" ? (
          <Divided
            sections={[
              <LauncherSection key="launcher" />,
              <PackSection key="pack" />,
            ]}
          />
        ) : null}
        {tab === "debug" ? <DebugSection /> : null}
      </div>
    </section>
  );
}
