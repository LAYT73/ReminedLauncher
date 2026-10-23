//! Vanilla (unmodded) skin via a generated resource pack + options.txt.
//! Regenerated every launch so profile skin / slim|wide changes apply.

use crate::runtime::offline_player_uuid;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub const PACK_DIR_NAME: &str = "ReminedSkin";
const PACK_OPTIONS_ID: &str = "file/ReminedSkin";

/// Apply (or refresh) the Remined skin resource pack for a vanilla instance.
pub fn apply(
    instance: &Path,
    skin_png: &Path,
    skin_model: &str,
    mc_version: &str,
    username: &str,
) -> Result<(), String> {
    if !skin_png.is_file() {
        return Err(crate::i18n::trf("skin.not_found", &[("path", &skin_png.display().to_string())]));
    }
    let bytes = fs::read(skin_png).map_err(|e| e.to_string())?;
    if bytes.len() < 100 {
        return Err(crate::i18n::tr("skin.invalid_png").into());
    }

    let pack_root = instance.join("resourcepacks").join(PACK_DIR_NAME);
    // Wipe previous pack so stale slim/wide / uuid textures never linger.
    if pack_root.exists() {
        fs::remove_dir_all(&pack_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&pack_root).map_err(|e| e.to_string())?;

    let format = pack_format_for_version(mc_version);
    write_pack_mcmeta(&pack_root, format)?;

    let slim = skin_model.trim().eq_ignore_ascii_case("slim");
    let uuid = offline_player_uuid(username);
    let uuid_nodash = uuid.simple().to_string();

    write_skin_textures(&pack_root, &bytes, slim, mc_version, &uuid_nodash)?;
    ensure_resource_pack_selected(instance)?;
    Ok(())
}

fn write_pack_mcmeta(pack_root: &Path, format: u32) -> Result<(), String> {
    // 25w31a+ / 26.x: min_format + max_format (pack_format alone is ignored / incompatible).
    // Older releases still need pack_format.
    let meta = if format >= 65 {
        json!({
            "pack": {
                "description": "Remined profile skin",
                "min_format": format,
                "max_format": format
            }
        })
    } else if format >= 18 {
        json!({
            "pack": {
                "description": "Remined profile skin",
                "pack_format": format,
                "supported_formats": { "min_inclusive": format, "max_inclusive": format }
            }
        })
    } else {
        json!({
            "pack": {
                "pack_format": format,
                "description": "Remined profile skin"
            }
        })
    };
    fs::write(
        pack_root.join("pack.mcmeta"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn write_skin_textures(
    pack_root: &Path,
    bytes: &[u8],
    slim: bool,
    mc_version: &str,
    uuid_nodash: &str,
) -> Result<(), String> {
    let entity = pack_root
        .join("assets")
        .join("minecraft")
        .join("textures")
        .join("entity");
    fs::create_dir_all(&entity).map_err(|e| e.to_string())?;

    // Legacy default skins (pre–player/ tree and still used as fallbacks).
    write_png(&entity.join("steve.png"), bytes)?;
    write_png(&entity.join("alex.png"), bytes)?;

    let (maj, min, pat) = parse_mc_version(mc_version);
    // 1.19.3+ and calendar versions (26.x): player/wide|slim tree.
    let use_player_tree = maj >= 26
        || maj > 1
        || (maj == 1 && min > 19)
        || (maj == 1 && min == 19 && pat >= 3);
    if use_player_tree {
        let wide = entity.join("player").join("wide");
        let slim_dir = entity.join("player").join("slim");
        fs::create_dir_all(&wide).map_err(|e| e.to_string())?;
        fs::create_dir_all(&slim_dir).map_err(|e| e.to_string())?;

        // Override every default skin id (offline UUID picks among these).
        const DEFAULTS: &[&str] = &[
            "steve.png",
            "alex.png",
            "ari.png",
            "efe.png",
            "kai.png",
            "makena.png",
            "noor.png",
            "sunny.png",
            "zuri.png",
        ];
        for name in DEFAULTS {
            write_png(&wide.join(name), bytes)?;
            write_png(&slim_dir.join(name), bytes)?;
        }

        // Prefer profile slim/wide for UUID-named textures.
        let primary = if slim { &slim_dir } else { &wide };
        let secondary = if slim { &wide } else { &slim_dir };
        write_png(&primary.join(format!("{uuid_nodash}.png")), bytes)?;
        write_png(&secondary.join(format!("{uuid_nodash}.png")), bytes)?;
    }

    Ok(())
}

fn write_png(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Patch (or create) options.txt so ReminedSkin is an enabled resource pack.
pub fn ensure_resource_pack_selected(instance: &Path) -> Result<(), String> {
    let path = instance.join("options.txt");
    let raw = if path.is_file() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let mut lines: Vec<String> = if raw.is_empty() {
        Vec::new()
    } else {
        raw.lines().map(|l| l.to_string()).collect()
    };

    let mut found_packs = false;
    for line in &mut lines {
        if let Some(rest) = line.strip_prefix("resourcePacks:") {
            let mut packs = parse_string_list(rest);
            packs.retain(|p| p != PACK_OPTIONS_ID && p != PACK_DIR_NAME);
            if !packs.iter().any(|p| p == "vanilla") {
                packs.insert(0, "vanilla".into());
            }
            // Last pack wins for overrides — keep ReminedSkin at the end.
            packs.push(PACK_OPTIONS_ID.into());
            *line = format!("resourcePacks:{}", format_string_list(&packs));
            found_packs = true;
        } else if let Some(rest) = line.strip_prefix("incompatibleResourcePacks:") {
            let mut bad = parse_string_list(rest);
            bad.retain(|p| p != PACK_OPTIONS_ID && p != PACK_DIR_NAME);
            *line = format!(
                "incompatibleResourcePacks:{}",
                format_string_list(&bad)
            );
        }
    }

    if !found_packs {
        lines.push(format!(
            "resourcePacks:{}",
            format_string_list(&["vanilla".into(), PACK_OPTIONS_ID.into()])
        ));
    }

    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_string_list(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(trimmed) {
        return arr
            .into_iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    // Lenient fallback: ["a","b"]
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(trimmed);
    inner
        .split(',')
        .filter_map(|part| {
            let p = part.trim().trim_matches('"').trim_matches('\'');
            if p.is_empty() {
                None
            } else {
                Some(p.to_string())
            }
        })
        .collect()
}

fn format_string_list(items: &[String]) -> String {
    let escaped: Vec<String> = items
        .iter()
        .map(|s| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")))
        .collect();
    format!("[{}]", escaped.join(","))
}

fn parse_mc_version(version_id: &str) -> (u32, u32, u32) {
    // "1.21.1", "1.20", ignore pre/rc suffix on last component when possible
    let base = version_id
        .split(['-', '+'])
        .next()
        .unwrap_or(version_id)
        .trim();
    let mut parts = base.split('.');
    let maj = parts
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let min = parts
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let pat = parts
        .next()
        .and_then(|s| {
            let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().ok()
        })
        .unwrap_or(0);
    (maj, min, pat)
}

/// Resource-pack major format for a Mojang version id.
/// Supports classic `1.21.x` and calendar `26.1` / `26.2` ids.
pub fn pack_format_for_version(version_id: &str) -> u32 {
    let (maj, min, pat) = parse_mc_version(version_id);

    // Calendar releases: 26.1 → format 84, 26.2 → 88, 26.3 → 97, …
    if maj >= 26 {
        return match (maj, min) {
            (26, 1) => 84,
            (26, 2) => 88,
            (26, 3) => 97,
            (26, m) if m >= 4 => 100,
            (y, _) if y > 26 => 100,
            _ => 84,
        };
    }

    if maj != 1 {
        // Unknown scheme — prefer modern min_format style over ancient 34.
        return 84;
    }

    match (min, pat) {
        (m, _) if m >= 22 => 75,
        (21, p) if p >= 11 => 75,
        (21, p) if p >= 9 => 69,
        (21, p) if p >= 7 => 64,
        (21, 6) => 63,
        (21, 5) => 55,
        (21, 4) => 46,
        (21, p) if p >= 2 => 42,
        (21, _) => 34,
        (20, p) if p >= 5 => 32,
        (20, p) if p >= 3 => 22,
        (20, 2) => 18,
        (20, _) => 15,
        (19, p) if p >= 4 => 13,
        (19, 3) => 12,
        (19, _) => 9,
        (18, _) => 8,
        (17, _) => 7,
        (16, p) if p >= 2 => 6,
        (16, _) | (15, _) => 5,
        (14, _) | (13, _) => 4,
        _ => 4,
    }
}

