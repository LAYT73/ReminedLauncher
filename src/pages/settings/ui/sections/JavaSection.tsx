import { open } from "@tauri-apps/plugin-dialog";
import { RAM_OPTIONS_GB, useProfileStore } from "@/entities/profile";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { useT } from "@/shared/i18n";

export function JavaSection() {
  const t = useT();
  const { profile, javaInfo, setProfile, persist, refreshJava } =
    useProfileStore();

  async function pickJava() {
    const selected = await open({ multiple: false, directory: false });
    if (!selected || Array.isArray(selected)) return;
    await persist({ ...profile, java_path: selected });
    void refreshJava(selected);
  }

  async function clearJava() {
    await persist({ ...profile, java_path: null });
    void refreshJava(null);
  }

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.java.title")}</h3>

      <div className="field">
        <label htmlFor="ram">{t("settings.java.memory")}</label>
        <select
          id="ram"
          value={String(profile.ram_mb)}
          onChange={(e) =>
            void persist({ ...profile, ram_mb: Number(e.target.value) }).catch(
              () => undefined,
            )
          }
        >
          {RAM_OPTIONS_GB.map((gb) => (
            <option key={gb} value={gb * 1024}>
              {gb} {t("settings.java.gb")}
            </option>
          ))}
          {RAM_OPTIONS_GB.every((gb) => gb * 1024 !== profile.ram_mb) ? (
            <option value={profile.ram_mb}>
              {Math.round(profile.ram_mb / 1024)} {t("settings.java.gb")}
            </option>
          ) : null}
        </select>
      </div>

      <div className="field">
        <label htmlFor="java-path">{t("settings.java.path")}</label>
        <div className="field-row">
          <input
            id="java-path"
            type="text"
            spellCheck={false}
            placeholder={t("settings.java.pathPlaceholder")}
            value={profile.java_path ?? ""}
            onChange={(e) =>
              setProfile({
                ...profile,
                java_path: e.target.value || null,
              })
            }
            onBlur={() => {
              void persist(profile).catch(() => undefined);
              void refreshJava(profile.java_path);
            }}
          />
          <FolderIconBtn title={t("settings.java.browse")} onClick={() => void pickJava().catch(() => undefined)} />
          {profile.java_path ? (
            <button
              type="button"
              className="btn-mc dim"
              onClick={() => void clearJava().catch(() => undefined)}
            >
              {t("settings.java.auto")}
            </button>
          ) : null}
        </div>
        {javaInfo ? (
          <p
            className={`java-probe ${javaInfo.ok ? "is-ok" : "is-warn"}`}
            title={javaInfo.path}
          >
            {javaInfo.version}
            {javaInfo.major != null ? ` · ${t("settings.java.major", { n: javaInfo.major })}` : ""}
            {!javaInfo.ok && javaInfo.path
              ? ` — ${t("settings.java.needJava25")}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="jvm-args">{t("settings.java.jvmFlags")}</label>
        <textarea
          id="jvm-args"
          rows={3}
          spellCheck={false}
          placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
          value={profile.jvm_args}
          onChange={(e) =>
            setProfile({ ...profile, jvm_args: e.target.value })
          }
          onBlur={() => void persist(profile).catch(() => undefined)}
        />
        <p className="field-hint">
          {t("settings.java.jvmHint")}
        </p>
      </div>
    </div>
  );
}
