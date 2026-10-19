//! Hide SkinShuffle's title/pause "Skin Presets" button chrome while keeping the skin preview.
//!
//! SkinShuffle draws the button and preview in one widget (`OpenCarouselButton`). Across Remined
//! Vanilla's version range the package name and Button render API change several times, so a single
//! companion Fabric mod cannot cover every MC version. Instead we patch the downloaded SkinShuffle
//! jar in place after install.

use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const OCB_SUFFIX: &str = "skinshuffle/client/gui/widgets/OpenCarouselButton.class";
const TOAST_HELPER_SUFFIX: &str = "skinshuffle/util/ToastHelper.class";

/// Prepare SkinShuffle for an instance: jar patches + disable offline toast in config.
pub fn prepare_instance(instance: &Path, game: &str) -> Result<usize, String> {
    let patched = prepare_mods_dir(&instance.join("mods"), game)?;
    let _ = disable_offline_toast_config(instance);
    let _ = seed_default_presets(instance, game);
    Ok(patched)
}

/// SkinShuffle 2.x for 1.20/1.20.1 builds its default preset at client init, when
/// `Minecraft.getSkinManager()` is still null (NPE → crash on first launch). A valid
/// `presets.json` makes it skip that path entirely.
pub fn seed_default_presets(instance: &Path, game: &str) -> Result<bool, String> {
    if game != "1.20" && game != "1.20.1" {
        return Ok(false);
    }
    let dir = instance.join("config").join("skinshuffle");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("presets.json");
    if path.is_file() {
        // Replace an earlier seed written with a wrong type id; leave user presets alone.
        let stale = fs::read_to_string(&path)
            .map(|t| t.contains("\"type\": \"resource\""))
            .unwrap_or(false);
        if !stale {
            return Ok(false);
        }
    }
    let seed = serde_json::json!({
        "chosenPreset": 0,
        "apiPreset": 0,
        "loadedPresets": [{
            "name": "Default",
            "skin": {
                "type": "skinshuffle:resource",
                "texture": "minecraft:textures/entity/player/wide/steve.png",
                "model": "classic"
            }
        }]
    });
    fs::write(&path, serde_json::to_vec_pretty(&seed).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Remined is always offline — suppress SkinShuffle's "not authenticated" toast.
pub fn disable_offline_toast_config(instance: &Path) -> Result<bool, String> {
    let dir = instance.join("config").join("skinshuffle");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let mut value: serde_json::Value = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    let Some(obj) = value.as_object_mut() else {
        return Ok(false);
    };
    if obj.get("disableOfflineToast") == Some(&serde_json::Value::Bool(true)) {
        return Ok(false);
    }
    obj.insert("disableOfflineToast".into(), serde_json::json!(true));
    let pretty = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Prepare every SkinShuffle jar under `mods_dir` for the given Minecraft version.
/// Hides the Skin Presets button chrome and relaxes nested (JiJ) Minecraft deps when needed.
pub fn prepare_mods_dir(mods_dir: &Path, game: &str) -> Result<usize, String> {
    if !mods_dir.is_dir() {
        return Ok(0);
    }
    let mut patched = 0usize;
    for ent in fs::read_dir(mods_dir).map_err(|e| e.to_string())? {
        let path = ent.map_err(|e| e.to_string())?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !name.ends_with(".jar") || !name.contains("skinshuffle") {
            continue;
        }
        let mut changed = false;
        if widen_top_level_minecraft_dep(&path, game)? {
            changed = true;
        }
        if relax_jij_minecraft_deps(&path, game)? {
            changed = true;
        }
        if patch_jar(&path)? {
            changed = true;
        }
        if changed {
            patched += 1;
        }
    }
    Ok(patched)
}

/// Modrinth tags some SkinShuffle builds for a Minecraft patch (e.g. 1.20.3) that the jar's
/// own `depends.minecraft` omits (`1.20.4` only). The builds are protocol-identical, so add
/// the requested game to the accepted set when Fabric would otherwise refuse the jar.
fn widen_top_level_minecraft_dep(jar_path: &Path, game: &str) -> Result<bool, String> {
    let input = fs::read(jar_path).map_err(|e| format!("read {}: {e}", jar_path.display()))?;
    let mut archive =
        ZipArchive::new(Cursor::new(&input[..])).map_err(|e| format!("open zip: {e}"))?;
    let mut json_idx = None;
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|e| e.to_string())?;
        if f.name().map_err(|e| e.to_string())?.as_ref() == "fabric.mod.json" {
            json_idx = Some(i);
            break;
        }
    }
    let Some(idx) = json_idx else {
        return Ok(false);
    };
    let mut raw = Vec::new();
    archive
        .by_index(idx)
        .map_err(|e| e.to_string())?
        .read_to_end(&mut raw)
        .map_err(|e| e.to_string())?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("fabric.mod.json: {e}"))?;
    let preds: Vec<String> = match value.pointer("/depends/minecraft") {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => return Ok(false),
    };
    if crate::mod_audit::version_matches(&preds, game) {
        return Ok(false);
    }
    let mut widened = preds;
    widened.push(game.to_string());
    value["depends"]["minecraft"] = serde_json::json!(widened);
    let new_json = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;

    let mut archive =
        ZipArchive::new(Cursor::new(input)).map_err(|e| format!("reopen zip: {e}"))?;
    let mut out_buf = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut out_buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().map_err(|e| e.to_string())?.into_owned();
            if entry_name.ends_with('/') {
                continue;
            }
            let data = if i == idx {
                new_json.clone()
            } else {
                let mut d = Vec::new();
                file.read_to_end(&mut d).map_err(|e| e.to_string())?;
                d
            };
            writer
                .start_file(&entry_name, opts)
                .map_err(|e| e.to_string())?;
            writer.write_all(&data).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    fs::write(jar_path, out_buf.into_inner())
        .map_err(|e| format!("write {}: {e}", jar_path.display()))?;
    Ok(true)
}

/// SkinShuffle's 1.20/1.20.1 build jars-in-jar YACL marked `minecraft: 1.20.1` only,
/// which Fabric rejects on plain 1.20. Widen that dep to match SkinShuffle's own range.
fn relax_jij_minecraft_deps(jar_path: &Path, game: &str) -> Result<bool, String> {
    let input = fs::read(jar_path).map_err(|e| format!("read {}: {e}", jar_path.display()))?;
    let mut archive =
        ZipArchive::new(Cursor::new(&input[..])).map_err(|e| format!("open zip: {e}"))?;

    let mut replacements: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().map_err(|e| e.to_string())?.into_owned();
        if !name.starts_with("META-INF/jars/") || !name.ends_with(".jar") {
            continue;
        }
        let mut nested = Vec::new();
        file.read_to_end(&mut nested).map_err(|e| e.to_string())?;
        if let Some(fixed) = relax_nested_fabric_mod_json(&nested, game)? {
            replacements.push((name, fixed));
        }
    }

    if replacements.is_empty() {
        return Ok(false);
    }

    let mut archive =
        ZipArchive::new(Cursor::new(input)).map_err(|e| format!("reopen zip: {e}"))?;
    let mut out_buf = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut out_buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().map_err(|e| e.to_string())?.into_owned();
            if entry_name.ends_with('/') {
                continue;
            }
            let data = if let Some((_, bytes)) = replacements.iter().find(|(n, _)| n == &entry_name)
            {
                bytes.clone()
            } else {
                let mut d = Vec::new();
                file.read_to_end(&mut d).map_err(|e| e.to_string())?;
                d
            };
            writer
                .start_file(&entry_name, opts)
                .map_err(|e| e.to_string())?;
            writer.write_all(&data).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }

    fs::write(jar_path, out_buf.into_inner())
        .map_err(|e| format!("write {}: {e}", jar_path.display()))?;
    Ok(true)
}

fn relax_nested_fabric_mod_json(nested_jar: &[u8], game: &str) -> Result<Option<Vec<u8>>, String> {
    let mut archive = match ZipArchive::new(Cursor::new(nested_jar)) {
        Ok(a) => a,
        Err(_) => return Ok(None),
    };

    let mut mod_idx = None;
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| e.to_string())?
            .name()
            .map_err(|e| e.to_string())?
            .into_owned();
        if name == "fabric.mod.json" {
            mod_idx = Some(i);
            break;
        }
    }
    let Some(idx) = mod_idx else {
        return Ok(None);
    };

    let mut json_bytes = Vec::new();
    {
        let mut file = archive.by_index(idx).map_err(|e| e.to_string())?;
        file.read_to_end(&mut json_bytes)
            .map_err(|e| e.to_string())?;
    }

    let mut value: serde_json::Value =
        serde_json::from_slice(&json_bytes).map_err(|e| format!("fabric.mod.json: {e}"))?;
    let Some(mc) = value
        .pointer_mut("/depends/minecraft")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        return Ok(None);
    };

    if game == "1.20" && mc == "1.20.1" {
        // Exact 1.20.1 — widen so plain 1.20 can load the JiJ (SkinShuffle itself allows both).
        value["depends"]["minecraft"] = serde_json::json!(">=1.20 <=1.20.1");
    } else if !crate::mod_audit::version_matches(&[mc.clone()], game) {
        // Nested lib pinned to one patch (e.g. YACL for 1.20.4 on 1.20.3): accept `game` too.
        value["depends"]["minecraft"] = serde_json::json!([mc, game]);
    } else {
        return Ok(None);
    }
    let new_json = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;

    let mut out_buf = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut out_buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().map_err(|e| e.to_string())?.into_owned();
            if entry_name.ends_with('/') {
                continue;
            }
            let data = if i == idx {
                new_json.clone()
            } else {
                let mut d = Vec::new();
                file.read_to_end(&mut d).map_err(|e| e.to_string())?;
                d
            };
            writer
                .start_file(&entry_name, opts)
                .map_err(|e| e.to_string())?;
            writer.write_all(&data).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(Some(out_buf.into_inner()))
}

pub fn patch_jar(jar_path: &Path) -> Result<bool, String> {
    let input = fs::read(jar_path).map_err(|e| format!("read {}: {e}", jar_path.display()))?;
    let mut archive =
        ZipArchive::new(Cursor::new(&input[..])).map_err(|e| format!("open zip: {e}"))?;

    let mut ocb_index = None;
    let mut toast_index = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().map_err(|e| e.to_string())?.into_owned();
        if name.ends_with(OCB_SUFFIX) {
            ocb_index = Some(i);
        } else if name.ends_with(TOAST_HELPER_SUFFIX) {
            toast_index = Some(i);
        }
    }
    let Some(ocb_idx) = ocb_index else {
        return Err(format!(
            "OpenCarouselButton not found in {}",
            jar_path.display()
        ));
    };

    let mut replacements: Vec<(usize, Vec<u8>)> = Vec::new();

    let mut ocb_bytes = Vec::new();
    {
        let mut file = archive.by_index(ocb_idx).map_err(|e| e.to_string())?;
        file.read_to_end(&mut ocb_bytes)
            .map_err(|e| e.to_string())?;
    }
    let mut any = patch_open_carousel_button(&mut ocb_bytes)?;
    if any {
        replacements.push((ocb_idx, ocb_bytes));
    }

    if let Some(toast_idx) = toast_index {
        let mut toast_bytes = Vec::new();
        {
            let mut file = archive.by_index(toast_idx).map_err(|e| e.to_string())?;
            file.read_to_end(&mut toast_bytes)
                .map_err(|e| e.to_string())?;
        }
        if rewrite_void_method_to_return(&mut toast_bytes, "showOfflineModeToast")? {
            replacements.push((toast_idx, toast_bytes));
            any = true;
        }
    }

    if !any {
        return Ok(false);
    }

    let mut archive =
        ZipArchive::new(Cursor::new(input)).map_err(|e| format!("reopen zip: {e}"))?;
    let mut out_buf = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut out_buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().map_err(|e| e.to_string())?.into_owned();
            if entry_name.ends_with('/') {
                continue;
            }
            let data = if let Some((_, bytes)) = replacements.iter().find(|(idx, _)| *idx == i) {
                bytes.clone()
            } else {
                let mut d = Vec::new();
                file.read_to_end(&mut d).map_err(|e| e.to_string())?;
                d
            };
            writer
                .start_file(&entry_name, opts)
                .map_err(|e| e.to_string())?;
            writer.write_all(&data).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }

    fs::write(jar_path, out_buf.into_inner())
        .map_err(|e| format!("write {}: {e}", jar_path.display()))?;
    Ok(true)
}

fn patch_open_carousel_button(class: &mut Vec<u8>) -> Result<bool, String> {
    if class.len() < 10 || class[0..4] != [0xCA, 0xFE, 0xBA, 0xBE] {
        return Err("not a class file".into());
    }

    // In-place NOPs first (no size change), then rewrite the on-press lambda Code
    // attribute properly — a bare `return` followed by leftover nops fails the
    // Java verifier ("Expecting a stack map frame").
    let mut changed = patch_render_methods_inplace(class)?;
    if rewrite_void_method_to_return(class, "lambda$new$0")? {
        changed = true;
    }
    Ok(changed)
}

fn for_each_code_attr(
    class: &[u8],
    mut visit: impl FnMut(&str, &str, usize, usize) -> Result<(), String>,
) -> Result<(), String> {
    let cp = parse_constant_pool(class)?;
    let mut offset = constant_pool_end(class)?;
    offset += 6;
    let interfaces_count = u16_at(class, offset)? as usize;
    offset += 2 + interfaces_count * 2;

    let fields_count = u16_at(class, offset)? as usize;
    offset += 2;
    for _ in 0..fields_count {
        offset = skip_field_or_method(class, offset)?;
    }

    let methods_count = u16_at(class, offset)? as usize;
    offset += 2;
    for _ in 0..methods_count {
        let name_idx = u16_at(class, offset + 2)? as usize;
        let desc_idx = u16_at(class, offset + 4)? as usize;
        let name = utf8_at(&cp, name_idx)?.to_string();
        let desc = utf8_at(&cp, desc_idx)?.to_string();
        let attrs_count = u16_at(class, offset + 6)? as usize;
        let mut attr_off = offset + 8;
        for _ in 0..attrs_count {
            let attr_name_idx = u16_at(class, attr_off)? as usize;
            let attr_len = u32_at(class, attr_off + 2)? as usize;
            let attr_name = utf8_at(&cp, attr_name_idx)?;
            if attr_name == "Code" {
                visit(&name, &desc, attr_off, attr_len)?;
            }
            attr_off += 6 + attr_len;
        }
        offset = attr_off;
    }
    Ok(())
}

fn patch_render_methods_inplace(class: &mut [u8]) -> Result<bool, String> {
    let cp = parse_constant_pool(class)?;
    let mut changed = false;
    let mut targets = Vec::new();
    for_each_code_attr(class, |name, desc, attr_off, attr_len| {
        if name != "lambda$new$0" && is_widget_render_desc(desc) {
            targets.push((attr_off + 6, attr_len));
        }
        Ok(())
    })?;
    for (info_off, attr_len) in targets {
        if hide_button_chrome(class, info_off, attr_len, &cp)? {
            changed = true;
        }
    }
    Ok(changed)
}

fn is_widget_render_desc(desc: &str) -> bool {
    // (Lgui;IIF)V — DrawContext / GuiGraphics / GuiGraphicsExtractor
    desc.starts_with("(L") && desc.ends_with(";IIF)V")
}

/// Rewrite a void method to a single `return`, shrinking the Code attribute and
/// dropping StackMapTable so the class verifies on modern JVMs.
fn rewrite_void_method_to_return(class: &mut Vec<u8>, method_name: &str) -> Result<bool, String> {
    let mut found: Option<(usize, usize, u16)> = None; // attr_off, attr_len, max_locals
    for_each_code_attr(class, |name, _desc, attr_off, attr_len| {
        if name == method_name {
            let info_off = attr_off + 6;
            if attr_len < 8 {
                return Err("Code attribute too short".into());
            }
            let max_locals = u16_at(class, info_off + 2)?;
            let code_len = u32_at(class, info_off + 4)? as usize;
            let code_off = info_off + 8;
            if code_len == 0 || code_off + code_len > class.len() {
                return Err("invalid Code length".into());
            }
            // Already a clean single-return method.
            if code_len == 1 && class[code_off] == 0xB1 {
                let after_code = code_off + 1;
                let exc = u16_at(class, after_code)? as usize;
                let attrs = u16_at(class, after_code + 2 + exc * 8)?;
                if exc == 0 && attrs == 0 {
                    return Ok(());
                }
            }
            found = Some((attr_off, attr_len, max_locals));
        }
        Ok(())
    })?;

    let Some((attr_off, old_attr_len, max_locals)) = found else {
        return Ok(false);
    };

    // max_stack=0, max_locals=…, code=[return], no exceptions, no nested attrs.
    let mut new_info = Vec::with_capacity(13);
    new_info.extend_from_slice(&0u16.to_be_bytes());
    new_info.extend_from_slice(&max_locals.to_be_bytes());
    new_info.extend_from_slice(&1u32.to_be_bytes());
    new_info.push(0xB1);
    new_info.extend_from_slice(&0u16.to_be_bytes());
    new_info.extend_from_slice(&0u16.to_be_bytes());

    let old_end = attr_off + 6 + old_attr_len;
    let mut rebuilt = Vec::with_capacity(class.len() - old_attr_len + new_info.len());
    rebuilt.extend_from_slice(&class[..attr_off + 2]);
    rebuilt.extend_from_slice(&(new_info.len() as u32).to_be_bytes());
    rebuilt.extend_from_slice(&new_info);
    rebuilt.extend_from_slice(&class[old_end..]);
    *class = rebuilt;
    Ok(true)
}

fn hide_button_chrome(
    class: &mut [u8],
    code_info_off: usize,
    attr_len: usize,
    cp: &[CpInfo],
) -> Result<bool, String> {
    if attr_len < 8 {
        return Err("Code attribute too short".into());
    }
    let code_len = u32_at(class, code_info_off + 4)? as usize;
    let code_off = code_info_off + 8;
    if code_len < 9 || code_off + code_len > class.len() {
        return Ok(false);
    }
    let code = &class[code_off..code_off + code_len];

    // Pattern A (1.20 – ~1.21.8): super.render(ctx, mouseX, mouseY, delta)
    //   aload_0 aload_1 iload_2 iload_3 fload 4 invokespecial
    // Note: fload is 0x17 (dload is 0x18).
    if code[0] == 0x2A
        && code[1] == 0x2B
        && code[2] == 0x1C
        && code[3] == 0x1D
        && code[4] == 0x17
        && code[5] == 0x04
        && code[6] == 0xB7
    {
        for b in class[code_off..code_off + 9].iter_mut() {
            *b = 0x00;
        }
        return Ok(true);
    }

    // Pattern B (1.21.11+ / 26.x): extractDefaultSprite + extractDefaultLabel
    //   aload_0 aload_1 invokevirtual <sprite>
    //   aload_0 aload_1 invokevirtual <textRenderer?>
    //   invokevirtual <label>
    if code.len() >= 13 && code[0] == 0x2A && code[1] == 0x2B && code[2] == 0xB6 {
        let idx = u16::from_be_bytes([code[3], code[4]]) as usize;
        if let Ok(mname) = methodref_name(cp, idx) {
            if mname == "extractDefaultSprite" || mname == "method_75794" {
                if code[5] == 0x2A && code[6] == 0x2B && code[7] == 0xB6 && code[10] == 0xB6 {
                    for b in class[code_off..code_off + 13].iter_mut() {
                        *b = 0x00;
                    }
                    return Ok(true);
                }
            }
        }
    }

    // Already patched (leading nops) or unknown layout — leave alone.
    Ok(false)
}

#[derive(Clone)]
#[allow(dead_code)]
enum CpInfo {
    Utf8(String),
    Class(u16),
    String(u16),
    NameAndType(u16, u16),
    Methodref(u16, u16),
    InterfaceMethodref(u16, u16),
    Fieldref(u16, u16),
    Other,
}

fn parse_constant_pool(class: &[u8]) -> Result<Vec<CpInfo>, String> {
    let mut offset = 8;
    let cp_count = u16_at(class, offset)? as usize;
    offset += 2;
    let mut cp = vec![CpInfo::Other; cp_count];
    let mut i = 1usize;
    while i < cp_count {
        let tag = *class.get(offset).ok_or("truncated CP")?;
        offset += 1;
        match tag {
            1 => {
                let len = u16_at(class, offset)? as usize;
                offset += 2;
                let s = std::str::from_utf8(
                    class.get(offset..offset + len).ok_or("truncated Utf8")?,
                )
                .map_err(|e| e.to_string())?
                .to_string();
                offset += len;
                cp[i] = CpInfo::Utf8(s);
            }
            3 | 4 => {
                offset += 4;
                cp[i] = CpInfo::Other;
            }
            5 | 6 => {
                offset += 8;
                cp[i] = CpInfo::Other;
                i += 1;
                if i < cp_count {
                    cp[i] = CpInfo::Other;
                }
            }
            7 => {
                let n = u16_at(class, offset)?;
                offset += 2;
                cp[i] = CpInfo::Class(n);
            }
            8 => {
                let n = u16_at(class, offset)?;
                offset += 2;
                cp[i] = CpInfo::String(n);
            }
            9 => {
                let (a, b) = (u16_at(class, offset)?, u16_at(class, offset + 2)?);
                offset += 4;
                cp[i] = CpInfo::Fieldref(a, b);
            }
            10 => {
                let (a, b) = (u16_at(class, offset)?, u16_at(class, offset + 2)?);
                offset += 4;
                cp[i] = CpInfo::Methodref(a, b);
            }
            11 => {
                let (a, b) = (u16_at(class, offset)?, u16_at(class, offset + 2)?);
                offset += 4;
                cp[i] = CpInfo::InterfaceMethodref(a, b);
            }
            12 => {
                let (a, b) = (u16_at(class, offset)?, u16_at(class, offset + 2)?);
                offset += 4;
                cp[i] = CpInfo::NameAndType(a, b);
            }
            15 => {
                offset += 3;
                cp[i] = CpInfo::Other;
            }
            16 | 19 | 20 => {
                offset += 2;
                cp[i] = CpInfo::Other;
            }
            17 | 18 => {
                offset += 4;
                cp[i] = CpInfo::Other;
            }
            _ => return Err(format!("unsupported CP tag {tag}")),
        }
        i += 1;
    }
    Ok(cp)
}

fn constant_pool_end(class: &[u8]) -> Result<usize, String> {
    let mut offset = 8;
    let cp_count = u16_at(class, offset)? as usize;
    offset += 2;
    let mut i = 1usize;
    while i < cp_count {
        let tag = *class.get(offset).ok_or("truncated CP")?;
        offset += 1;
        match tag {
            1 => {
                let len = u16_at(class, offset)? as usize;
                offset += 2 + len;
            }
            3 | 4 => offset += 4,
            5 | 6 => {
                offset += 8;
                i += 1;
            }
            7 | 8 | 16 | 19 | 20 => offset += 2,
            9 | 10 | 11 | 12 | 17 | 18 => offset += 4,
            15 => offset += 3,
            _ => return Err(format!("unsupported CP tag {tag}")),
        }
        i += 1;
    }
    Ok(offset)
}

fn skip_field_or_method(class: &[u8], offset: usize) -> Result<usize, String> {
    // access, name, desc
    let mut off = offset + 6;
    let attrs = u16_at(class, off)? as usize;
    off += 2;
    for _ in 0..attrs {
        let len = u32_at(class, off + 2)? as usize;
        off += 6 + len;
    }
    Ok(off)
}

fn utf8_at(cp: &[CpInfo], idx: usize) -> Result<&str, String> {
    match cp.get(idx) {
        Some(CpInfo::Utf8(s)) => Ok(s.as_str()),
        _ => Err(format!("CP#{idx} is not Utf8")),
    }
}

fn methodref_name(cp: &[CpInfo], idx: usize) -> Result<&str, String> {
    let (name_and_type_idx, _) = match cp.get(idx) {
        Some(CpInfo::Methodref(_, nat)) => (*nat, ()),
        Some(CpInfo::InterfaceMethodref(_, nat)) => (*nat, ()),
        _ => return Err(format!("CP#{idx} is not Methodref")),
    };
    let name_idx = match cp.get(name_and_type_idx as usize) {
        Some(CpInfo::NameAndType(n, _)) => *n as usize,
        _ => return Err("bad NameAndType".into()),
    };
    utf8_at(cp, name_idx)
}

fn u16_at(data: &[u8], off: usize) -> Result<u16, String> {
    let b = data.get(off..off + 2).ok_or("truncated u16")?;
    Ok(u16::from_be_bytes([b[0], b[1]]))
}

fn u32_at(data: &[u8], off: usize) -> Result<u32, String> {
    let b = data.get(off..off + 4).ok_or("truncated u32")?;
    Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn probe_jar(ver: &str) -> PathBuf {
        PathBuf::from(format!("/tmp/ss-probe/ss_{ver}.jar"))
    }

    #[test]
    fn relaxes_yacl_jij_minecraft_dep_on_1_20() {
        let src = probe_jar("1.20");
        if !src.is_file() {
            eprintln!("skip yacl relax: 1.20 jar missing");
            return;
        }
        let tmp = PathBuf::from("/tmp/ss-probe/yacl_relax_1.20.jar");
        fs::copy(&src, &tmp).unwrap();
        assert!(relax_jij_minecraft_deps(&tmp, "1.20").unwrap());
        assert!(!relax_jij_minecraft_deps(&tmp, "1.20").unwrap());

        let data = fs::read(&tmp).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut found = false;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let name = file.name().unwrap().into_owned();
            if !name.contains("yet-another-config-lib") || !name.ends_with(".jar") {
                continue;
            }
            let mut nested = Vec::new();
            file.read_to_end(&mut nested).unwrap();
            let mut inner = ZipArchive::new(Cursor::new(nested)).unwrap();
            let mut json = String::new();
            inner
                .by_name("fabric.mod.json")
                .unwrap()
                .read_to_string(&mut json)
                .unwrap();
            let v: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(
                v["depends"]["minecraft"].as_str(),
                Some(">=1.20 <=1.20.1")
            );
            found = true;
        }
        assert!(found, "nested YACL jar not found");
    }

    #[test]
    fn patches_known_skinshuffle_layouts() {
        for ver in [
            "1.20.1", "1.20.4", "1.21.1", "1.21.4", "1.21.8", "1.21.11", "26.1", "26.3",
        ] {
            let src = probe_jar(ver);
            if !src.is_file() {
                eprintln!("skip {ver}: jar missing");
                continue;
            }
            let tmp = PathBuf::from(format!("/tmp/ss-probe/patched_{ver}.jar"));
            fs::copy(&src, &tmp).unwrap();
            assert!(patch_jar(&tmp).unwrap(), "expected changes for {ver}");
            // Second pass is idempotent.
            assert!(!patch_jar(&tmp).unwrap(), "second patch should no-op for {ver}");
        }
    }

    #[test]
    fn repairs_broken_return_nop_lambda() {
        let src = probe_jar("26.3");
        if !src.is_file() {
            eprintln!("skip repair test: 26.3 jar missing");
            return;
        }
        let tmp = PathBuf::from("/tmp/ss-probe/broken_26.3.jar");
        fs::copy(&src, &tmp).unwrap();
        assert!(patch_jar(&tmp).unwrap());

        // Inflate lambda Code back to `return` + nops (the VerifyError shape from the first patch).
        let data = fs::read(&tmp).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut idx = None;
        let mut class = Vec::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let name = file.name().unwrap().into_owned();
            if name.ends_with(OCB_SUFFIX) {
                idx = Some(i);
                file.read_to_end(&mut class).unwrap();
                break;
            }
        }
        let idx = idx.expect("OpenCarouselButton");
        let mut target = None;
        for_each_code_attr(&class, |name, _desc, attr_off, attr_len| {
            if name == "lambda$new$0" {
                target = Some((attr_off, attr_len));
            }
            Ok(())
        })
        .unwrap();
        let (attr_off, attr_len) = target.expect("lambda$new$0");
        let info_off = attr_off + 6;
        let max_locals = u16_at(&class, info_off + 2).unwrap();
        let mut new_info = Vec::new();
        new_info.extend_from_slice(&0u16.to_be_bytes());
        new_info.extend_from_slice(&max_locals.to_be_bytes());
        new_info.extend_from_slice(&16u32.to_be_bytes());
        new_info.push(0xB1);
        new_info.extend(std::iter::repeat_n(0u8, 15));
        new_info.extend_from_slice(&0u16.to_be_bytes());
        new_info.extend_from_slice(&0u16.to_be_bytes());
        let old_end = attr_off + 6 + attr_len;
        let mut rebuilt = Vec::new();
        rebuilt.extend_from_slice(&class[..attr_off + 2]);
        rebuilt.extend_from_slice(&(new_info.len() as u32).to_be_bytes());
        rebuilt.extend_from_slice(&new_info);
        rebuilt.extend_from_slice(&class[old_end..]);

        let mut out = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut out);
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).unwrap();
                let entry_name = file.name().unwrap().into_owned();
                if entry_name.ends_with('/') {
                    continue;
                }
                let bytes = if i == idx {
                    rebuilt.clone()
                } else {
                    let mut d = Vec::new();
                    file.read_to_end(&mut d).unwrap();
                    d
                };
                writer.start_file(&entry_name, opts).unwrap();
                writer.write_all(&bytes).unwrap();
            }
            writer.finish().unwrap();
        }
        fs::write(&tmp, out.into_inner()).unwrap();

        assert!(
            patch_jar(&tmp).unwrap(),
            "should repair broken return+nop lambda"
        );
        assert!(!patch_jar(&tmp).unwrap());
    }
}
