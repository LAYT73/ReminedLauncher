//! CLI helpers for local testing (second Minecraft client on the same Mac).

use crate::instance::{self, PackInstallMeta};
use crate::java_runtime;
use crate::paths::{self, pack_dir};
use crate::runtime::{self, LaunchedGame, LaunchOpts};
use crate::skinshuffle_patch;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const SKIP_DIR_NAMES: &[&str] = &["saves", "logs", "crash-reports", ".git"];

pub async fn run_async() -> ExitCode {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("--") {
        args.remove(0);
    }
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let result = match cmd {
        "second-client" | "second" => second_client(&args[1..]).await,
        "help" | "-h" | "--help" => {
            print_help();
            Ok(())
        }
        other => Err(format!(
            "Unknown command '{other}'. Try: remined-cli second-client --help"
        )),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn print_help() {
    eprintln!(
        "\
Remined CLI

Usage:
  remined-cli second-client [options]

Copy a Remined Vanilla pack (default 26.3 → 26.3-b) and launch a second
Minecraft client that does not kill the first (unique launchctl label).

Options:
  --from <pack-id>     Source pack (default: remined-vanilla-26.3)
  --as <pack-id>       Dest pack copy (default: <from>-b)
  --username <name>    Offline username (default: PlayerB)
  --ram <mb>           Heap MB (default: 2048)
  --join <host:port>   Quick-play join (optional)
  --no-copy            Skip copy; launch --as if it already exists
  --root <path>        Project root (default: auto-detect)
"
    );
}

#[derive(Debug)]
struct SecondClientArgs {
    from: String,
    as_id: String,
    username: String,
    ram_mb: u32,
    join: Option<String>,
    no_copy: bool,
    root: Option<PathBuf>,
}

fn parse_second_client(args: &[String]) -> Result<SecondClientArgs, String> {
    let mut from = "remined-vanilla-26.3".to_string();
    let mut as_id: Option<String> = None;
    let mut username = "PlayerB".to_string();
    let mut ram_mb = 2048u32;
    let mut join = None;
    let mut no_copy = false;
    let mut root = None;

    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--help" || a == "-h" {
            print_help();
            std::process::exit(0);
        }
        let next = || {
            args.get(i + 1)
                .cloned()
                .ok_or_else(|| format!("Missing value after {a}"))
        };
        match a {
            "--from" => {
                from = next()?;
                i += 1;
            }
            "--as" => {
                as_id = Some(next()?);
                i += 1;
            }
            "--username" | "--user" => {
                username = next()?;
                i += 1;
            }
            "--ram" => {
                ram_mb = next()?
                    .parse()
                    .map_err(|_| "--ram must be a number".to_string())?;
                i += 1;
            }
            "--join" => {
                join = Some(next()?);
                i += 1;
            }
            "--no-copy" => no_copy = true,
            "--root" => {
                root = Some(PathBuf::from(next()?));
                i += 1;
            }
            other => return Err(format!("Unknown option: {other}")),
        }
        i += 1;
    }

    let as_id = as_id.unwrap_or_else(|| format!("{from}-b"));
    Ok(SecondClientArgs {
        from,
        as_id,
        username,
        ram_mb,
        join,
        no_copy,
        root,
    })
}

async fn second_client(args: &[String]) -> Result<(), String> {
    let args = parse_second_client(args)?;
    let root = args
        .root
        .or_else(paths::project_root)
        .ok_or_else(|| {
            "Could not find Remined project root (look for packs/ or .remined/). Pass --root."
                .to_string()
        })?;

    let src = pack_dir(&root, &args.from);
    let dest = pack_dir(&root, &args.as_id);

    if !instance::is_pack_installed(&src) {
        return Err(format!(
            "Source pack not installed: {}\nExpected under {}",
            args.from,
            src.display()
        ));
    }

    if !args.no_copy {
        if dest.exists() && instance::is_pack_installed(&dest) {
            eprintln!("Using existing copy {}", dest.display());
        } else {
            eprintln!("Copying {} → {} …", src.display(), dest.display());
            copy_pack_tree(&src, &dest)?;
            if let Some(mut meta) = instance::read_meta(&dest) {
                meta.id = args.as_id.clone();
                meta.name = format!("{} (B)", meta.name);
                instance::write_meta(&dest, &meta)?;
            } else if let Some(meta) = instance::read_meta(&src) {
                let meta = PackInstallMeta {
                    id: args.as_id.clone(),
                    name: format!("{} (B)", meta.name),
                    ..meta
                };
                instance::write_meta(&dest, &meta)?;
            }
            eprintln!("Copy done.");
        }
    } else if !instance::is_pack_installed(&dest) {
        return Err(format!(
            "Dest pack missing: {} (omit --no-copy to create it)",
            dest.display()
        ));
    }

    let game = args
        .as_id
        .strip_prefix("remined-vanilla-")
        .unwrap_or("26.3");
    let game = game.strip_suffix("-b").unwrap_or(game);
    let _ = skinshuffle_patch::prepare_instance(&dest, game);
    // Keep LAN helper + offline defaults in sync with Remined Vanilla installs.
    {
        let mods_dir = dest.join("mods");
        let src_mods = pack_dir(&root, &args.from).join("mods");
        if let Ok(rd) = fs::read_dir(&src_mods) {
            for ent in rd.flatten() {
                let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
                if name.contains("mcwifipnp") && name.ends_with(".jar") {
                    let _ = fs::copy(ent.path(), mods_dir.join(ent.file_name()));
                }
            }
        }
        let cfg_dir = dest.join("config");
        let _ = fs::create_dir_all(&cfg_dir);
        let cfg = cfg_dir.join("mcwifipnp.json");
        if !cfg.is_file() {
            let _ = fs::write(
                &cfg,
                r#"{
  "online-mode": false,
  "apply-for-all-world": true,
  "enable-uuid-fixer": true
}
"#,
            );
        }
    }

    let meta = instance::read_meta(&dest);
    let java_major = meta.and_then(|m| m.java_major).unwrap_or(21);
    let java = java_runtime::find_java(&root, java_major, None);
    if !java.ok || java.path.is_empty() {
        return Err(format!(
            "Java {java_major} not found. Launch this pack once from Remined UI first \
             (installs runtime), then retry.\n({})",
            java.version
        ));
    }

    let opts = LaunchOpts {
        root: root.clone(),
        instance: dest.clone(),
        java: PathBuf::from(&java.path),
        username: args.username.clone(),
        ram_mb: args.ram_mb.clamp(1024, 8192),
        jvm_args: String::new(),
        quick_play: args.join.clone(),
        launch_label_suffix: Some(format!("cli-{}", args.username)),
    };

    eprintln!(
        "Launching second client as '{}' from {} …",
        args.username,
        dest.display()
    );
    let launched = runtime::spawn_game(opts).await?;
    match &launched {
        #[cfg(target_os = "macos")]
        LaunchedGame::Detached { pid, log_path } => {
            eprintln!("OK — pid {pid}");
            eprintln!("log: {}", log_path.display());
        }
        LaunchedGame::Child(child) => {
            eprintln!("OK — pid {}", child.id());
        }
    }
    eprintln!(
        "\nIn the first client: Open to LAN, then join from this one \
         (Multiplayer → Direct → localhost:<port>).\n\
         Tip: use different Remined skins/usernames so CSL can tell you apart."
    );
    Ok(())
}

fn copy_pack_tree(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| format!("remove {}: {e}", dest.display()))?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    copy_dir_filtered(src, dest)?;
    Ok(())
}

fn copy_dir_filtered(src: &Path, dest: &Path) -> Result<(), String> {
    for ent in fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".DS_Store" {
            continue;
        }
        let from = ent.path();
        let to = dest.join(&name);
        if from.is_dir() {
            if SKIP_DIR_NAMES.iter().any(|s| *s == name_str.as_ref()) {
                continue;
            }
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_dir_filtered(&from, &to)?;
        } else if from.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}
