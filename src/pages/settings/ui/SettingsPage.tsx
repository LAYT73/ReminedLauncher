import { AccountSection } from "./sections/AccountSection";
import { JavaSection } from "./sections/JavaSection";
import { LauncherSection } from "./sections/LauncherSection";
import { PackSection } from "./sections/PackSection";
import { ThemeSection } from "./sections/ThemeSection";

export function SettingsPage() {
  return (
    <section className="section settings-panel">
      <h2 className="page-title">Settings</h2>
      <JavaSection />
      <PackSection />
      <ThemeSection />
      <LauncherSection />
      <AccountSection />
    </section>
  );
}
