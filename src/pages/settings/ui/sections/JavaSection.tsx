import { open } from "@tauri-apps/plugin-dialog";
import { RAM_OPTIONS_GB, useProfileStore } from "@/entities/profile";

export function JavaSection() {
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
      <h3 className="settings-heading">Java</h3>

      <div className="field">
        <label htmlFor="ram">Memory (RAM)</label>
        <select
          id="ram"
          value={String(profile.ram_mb)}
          onChange={(e) =>
            void persist({ ...profile, ram_mb: Number(e.target.value) })
          }
        >
          {RAM_OPTIONS_GB.map((gb) => (
            <option key={gb} value={gb * 1024}>
              {gb} GB
            </option>
          ))}
          {RAM_OPTIONS_GB.every((gb) => gb * 1024 !== profile.ram_mb) ? (
            <option value={profile.ram_mb}>
              {Math.round(profile.ram_mb / 1024)} GB
            </option>
          ) : null}
        </select>
      </div>

      <div className="field">
        <label htmlFor="java-path">Java path</label>
        <div className="field-row">
          <input
            id="java-path"
            type="text"
            spellCheck={false}
            placeholder="Auto (OpenJDK 25)"
            value={profile.java_path ?? ""}
            onChange={(e) =>
              setProfile({
                ...profile,
                java_path: e.target.value || null,
              })
            }
            onBlur={() => {
              void persist(profile);
              void refreshJava(profile.java_path);
            }}
          />
          <button
            type="button"
            className="btn-mc ok"
            onClick={() => void pickJava()}
          >
            Browse
          </button>
          {profile.java_path ? (
            <button
              type="button"
              className="btn-mc dim"
              onClick={() => void clearJava()}
            >
              Auto
            </button>
          ) : null}
        </div>
        {javaInfo ? (
          <p
            className={`java-probe ${javaInfo.ok ? "is-ok" : "is-warn"}`}
            title={javaInfo.path}
          >
            {javaInfo.version}
            {javaInfo.major != null ? ` · major ${javaInfo.major}` : ""}
            {!javaInfo.ok && javaInfo.path
              ? " — need Java 25 for Fabric 26.2"
              : ""}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="jvm-args">JVM flags</label>
        <textarea
          id="jvm-args"
          rows={3}
          spellCheck={false}
          placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
          value={profile.jvm_args}
          onChange={(e) =>
            setProfile({ ...profile, jvm_args: e.target.value })
          }
          onBlur={() => void persist(profile)}
        />
        <p className="field-hint">
          Extra args after -Xmx. Space-separated. Leave empty for defaults.
        </p>
      </div>
    </div>
  );
}
