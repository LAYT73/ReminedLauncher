#!/usr/bin/env node
/**
 * Builds the Remined Companion mod (companion-mod/) and copies the merged jar to
 * src-tauri/resources/remined-companion.jar, which the launcher embeds via include_bytes!.
 *
 * Needs JDK 25+ (Gradle wrapper 9.8.2, Loom 1.19.3). JAVA_HOME is used when it points at
 * JDK 25+; otherwise macOS falls back to Homebrew openjdk@25 and /usr/libexec/java_home.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOD = join(ROOT, "companion-mod");
const BUILT_JAR = join(MOD, "build", "libs", "remined-companion.jar");
const DEST_JAR = join(ROOT, "src-tauri", "resources", "remined-companion.jar");
const MIN_JAVA = 25;
const isWin = process.platform === "win32";

/** Major version reported by `<home>/bin/java -version`, or null. */
function javaMajor(home) {
  const bin = join(home, "bin", isWin ? "java.exe" : "java");
  if (!existsSync(bin)) return null;
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  const m = /version "(\d+)/.exec(`${r.stderr ?? ""}${r.stdout ?? ""}`);
  return m ? Number(m[1]) : null;
}

function resolveJdk() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  if (process.platform === "darwin") {
    candidates.push("/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home");
    const r = spawnSync("/usr/libexec/java_home", ["-v", String(MIN_JAVA)], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
  }
  for (const home of candidates) {
    const major = javaMajor(home);
    if (major !== null && major >= MIN_JAVA) return home;
  }
  console.error(
    `build-mod: no JDK ${MIN_JAVA}+ found. Set JAVA_HOME to a JDK ${MIN_JAVA}+ install ` +
      "(macOS: brew install openjdk@25).",
  );
  process.exit(1);
}

const javaHome = resolveJdk();
console.log(`build-mod: using JAVA_HOME=${javaHome}`);

const gradle = join(MOD, isWin ? "gradlew.bat" : "gradlew");
const run = spawnSync(gradle, ["build"], {
  cwd: MOD,
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, JAVA_HOME: javaHome },
});
if (run.status !== 0) {
  console.error("build-mod: Gradle build failed");
  process.exit(run.status ?? 1);
}

if (!existsSync(BUILT_JAR)) {
  console.error(`build-mod: expected jar not found: ${BUILT_JAR}`);
  process.exit(1);
}
mkdirSync(dirname(DEST_JAR), { recursive: true });
copyFileSync(BUILT_JAR, DEST_JAR);
console.log(`build-mod: copied ${BUILT_JAR} -> ${DEST_JAR}`);
