//! `remined-cli smoke-rv` — automated Remined Vanilla compatibility smoke test.
//!
//! For each version: fresh install -> static Fabric dependency audit (fabric.mod.json
//! of every jar incl. jar-in-jar) -> optional real launch until the sound engine starts
//! (past mod loading + resource reload), watching logs for mod/mixin failures.

use crate::instance;
use crate::java_runtime;
use crate::mod_audit::{self, AuditEnv};
use crate::paths::pack_dir;
use crate::progress::Ctx;
use crate::remined_vanilla;
use crate::runtime::{self, LaunchOpts, LaunchedGame};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const FAIL_PATTERNS: &[&str] = &[
    "Incompatible mod",
    "Mod resolution failed",
    "Mixin apply failed",
    "Mixin transformation of",
    "Critical injection failure",
    "InvalidInjectionException",
    "MixinTransformerError",
    "NoClassDefFoundError",
    "NoSuchMethodError",
    "NoSuchFieldError",
    "FormattedException",
    "Exception in thread \"main\"",
    "---- Minecraft Crash Report ----",
    "Failed to load mod",
    "Unable to launch",
];

const OK_MARKERS: &[&str] = &["Sound engine started", "OpenAL initialized"];

struct Args {
    root: PathBuf,
    versions: Vec<String>,
    launch: bool,
    keep: bool,
    reuse: bool,
    timeout: u64,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut root = PathBuf::from("/tmp/rs");
    let mut versions: Vec<String> = Vec::new();
    let mut all = false;
    let mut launch = false;
    let mut keep = false;
    let mut reuse = false;
    let mut timeout = 180u64;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                root = PathBuf::from(args.get(i + 1).ok_or("--root needs a path")?);
                i += 1;
            }
            "--all" => all = true,
            "--launch" => launch = true,
            "--keep" => keep = true,
            "--reuse" => reuse = true,
            "--timeout" => {
                timeout = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .ok_or("--timeout needs seconds")?;
                i += 1;
            }
            v if !v.starts_with("--") => versions.push(v.to_string()),
            other => return Err(format!("Unknown option: {other}")),
        }
        i += 1;
    }
    if all {
        versions = remined_vanilla::supported_versions()
            .iter()
            .map(|s| s.to_string())
            .collect();
    }
    if versions.is_empty() {
        return Err("Pass versions (e.g. 1.20.1 1.21.4) or --all".into());
    }
    Ok(Args {
        root,
        versions,
        launch,
        keep,
        reuse,
        timeout,
    })
}

pub fn print_help() {
    eprintln!(
        "\
remined-cli smoke-rv [versions… | --all] [--launch] [--timeout 180] [--keep] [--root <dir>]

  Installs each Remined Vanilla version into a scratch root (default \
/tmp/rs),
  audits every jar's fabric.mod.json dependencies, and with --launch boots the game
  until the sound engine starts (fails on Incompatible mods / mixin / crash).
  Env: REMINED_PROGRESS=1 prints install progress."
    );
}

struct Outcome {
    version: String,
    install: String,
    audit: String,
    launch: String,
    ok: bool,
    notes: Vec<String>,
}

fn read_loader(instance: &Path) -> Option<String> {
    let v: Value =
        serde_json::from_str(&fs::read_to_string(instance.join("mods-manifest.json")).ok()?).ok()?;
    v.get("loader")?.as_str().map(String::from)
}

fn tail(s: &str, n: usize) -> String {
    let start = s.len().saturating_sub(n);
    let mut st = start;
    while !s.is_char_boundary(st) {
        st += 1;
    }
    s[st..].to_string()
}

async fn launch_check(
    ctx: &Ctx,
    root: &Path,
    instance: &Path,
    java_major: u32,
    timeout: u64,
) -> Result<(), String> {
    let mut java = java_runtime::find_java(root, java_major, None);
    if !java.ok || java.path.is_empty() {
        java = java_runtime::ensure_java(ctx, root, java_major).await?;
    }
    let _ = fs::remove_dir_all(instance.join("logs"));
    let _ = fs::remove_dir_all(instance.join("crash-reports"));
    // Same idempotent prep the launcher does on every Play (ensure_installed).
    if let Some(game) = instance
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(remined_vanilla::version_from_pack_id)
    {
        let _ = crate::skinshuffle_patch::prepare_instance(instance, game);
    }
    let opts = LaunchOpts {
        root: root.to_path_buf(),
        instance: instance.to_path_buf(),
        java: PathBuf::from(&java.path),
        username: "SmokeTest".into(),
        ram_mb: 3072,
        jvm_args: std::env::var("REMINED_SMOKE_JVM").unwrap_or_default(),
        quick_play: None,
        launch_label_suffix: if cfg!(target_os = "macos") { Some("smoke".into()) } else { None },
    };
    let mut game = runtime::spawn_game(opts).await?;
    // Drain stderr so the JVM never blocks on a full pipe.
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    if let LaunchedGame::Child(child) = &mut game {
        if let Some(mut err) = child.stderr.take() {
            let buf = stderr_buf.clone();
            std::thread::spawn(move || {
                let mut chunk = [0u8; 4096];
                while let Ok(n) = err.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut b) = buf.lock() {
                        b.push_str(&String::from_utf8_lossy(&chunk[..n]));
                        if b.len() > 200_000 {
                            let cut = b.len() - 100_000;
                            let mut c = cut;
                            while !b.is_char_boundary(c) {
                                c += 1;
                            }
                            *b = b[c..].to_string();
                        }
                    }
                }
            });
        }
    }

    let started = Instant::now();
    let latest = instance.join("logs").join("latest.log");
    let result: Result<(), String> = loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let log = fs::read_to_string(&latest).unwrap_or_default();
        let mut err_text = stderr_buf.lock().map(|b| b.clone()).unwrap_or_default();
        #[cfg(target_os = "macos")]
        if let LaunchedGame::Detached { log_path, .. } = &game {
            err_text = fs::read_to_string(log_path).unwrap_or_default();
        }
        let combined = format!("{log}\n{err_text}");
        for pat in FAIL_PATTERNS {
            if combined.contains(pat) {
                let line = combined
                    .lines()
                    .find(|l| l.contains(pat))
                    .unwrap_or(pat)
                    .trim()
                    .to_string();
                break_with(&mut game);
                return Err(format!("log matched '{pat}': {}", tail(&line, 300)));
            }
        }
        if let Ok(Some(status)) = game.try_wait() {
            let crash = fs::read_dir(instance.join("crash-reports"))
                .map(|rd| rd.flatten().count())
                .unwrap_or(0);
            break Err(format!(
                "game exited early ({status}); crash reports: {crash}; stderr: {}",
                tail(err_text.trim(), 400)
            ));
        }
        if OK_MARKERS.iter().any(|m| log.contains(m)) {
            break Ok(());
        }
        if started.elapsed().as_secs() > timeout {
            break Err(format!(
                "timeout after {timeout}s without reaching sound engine; log tail: {}",
                tail(log.trim(), 400)
            ));
        }
    };
    break_with(&mut game);
    result
}

fn break_with(game: &mut LaunchedGame) {
    match game {
        LaunchedGame::Child(c) => {
            let _ = c.kill();
            let _ = c.wait();
        }
        #[cfg(target_os = "macos")]
        LaunchedGame::Detached { pid, .. } => unsafe {
            libc::kill(*pid as i32, libc::SIGKILL);
        },
    }
}

async fn run_one(ctx: &Ctx, a: &Args, version: &str) -> Outcome {
    let mut o = Outcome {
        version: version.into(),
        install: "-".into(),
        audit: "-".into(),
        launch: "-".into(),
        ok: false,
        notes: Vec::new(),
    };
    let existing = pack_dir(&a.root, &remined_vanilla::pack_id_for(version));
    if a.reuse && instance::is_pack_installed(&existing) {
        // Keep the mods folder as-is (manual bisecting).
    } else if let Err(e) = remined_vanilla::install_version(ctx, &a.root, version).await {
        o.install = "FAIL".into();
        o.notes.push(e);
        return o;
    }
    o.install = "ok".into();
    let pack_id = remined_vanilla::pack_id_for(version);
    let dest = pack_dir(&a.root, &pack_id);
    let meta = instance::read_meta(&dest);
    let java_major = meta.as_ref().and_then(|m| m.java_major);
    let loader = read_loader(&dest);
    let mods = mod_audit::read_mods_dir(&dest.join("mods"));
    let problems = mod_audit::audit(
        &mods,
        &AuditEnv {
            minecraft: version,
            loader: loader.as_deref(),
            java_major,
        },
    );
    if problems.is_empty() {
        o.audit = format!("ok ({} mods)", mods.len());
    } else {
        o.audit = "FAIL".into();
        o.notes.extend(problems);
    }
    let mut launch_ok = true;
    if a.launch {
        match launch_check(ctx, &a.root, &dest, java_major.unwrap_or(21), a.timeout).await {
            Ok(()) => o.launch = "ok".into(),
            Err(e) => {
                o.launch = "FAIL".into();
                o.notes.push(e);
                launch_ok = false;
            }
        }
    }
    o.ok = o.audit.starts_with("ok") && launch_ok;
    if !a.keep && o.ok {
        let _ = fs::remove_dir_all(&dest);
    }
    o
}

pub async fn run(args: &[String]) -> Result<(), String> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Ok(());
    }
    let a = parse(args)?;
    fs::create_dir_all(&a.root).map_err(|e| e.to_string())?;
    eprintln!("smoke root: {}", a.root.display());
    let ctx = Ctx::headless();
    let mut outcomes = Vec::new();
    for v in &a.versions {
        eprintln!("=== {v} ===");
        let o = run_one(&ctx, &a, v).await;
        eprintln!(
            "{v}: install={} audit={} launch={}",
            o.install, o.audit, o.launch
        );
        for n in &o.notes {
            eprintln!("    - {n}");
        }
        outcomes.push(o);
    }
    println!("\n| MC | install | audit | launch |\n|---|---|---|---|");
    for o in &outcomes {
        println!("| {} | {} | {} | {} |", o.version, o.install, o.audit, o.launch);
    }
    let report: Vec<Value> = outcomes
        .iter()
        .map(|o| {
            json!({"version": o.version, "install": o.install, "audit": o.audit,
                   "launch": o.launch, "ok": o.ok, "notes": o.notes})
        })
        .collect();
    let _ = fs::write(
        a.root.join("smoke-report.json"),
        serde_json::to_vec_pretty(&report).unwrap_or_default(),
    );
    let failed = outcomes.iter().filter(|o| !o.ok).count();
    if failed > 0 {
        Err(format!("{failed}/{} versions failed", outcomes.len()))
    } else {
        Ok(())
    }
}
