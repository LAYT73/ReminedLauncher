//! Recipes tab backend: indexes recipes/items/tags/names/icons of an installed pack from its jars.
//! Contract: `docs/RECIPES_INDEX.md`.

mod cache;
mod classorder;
mod conditions;
mod icons;
mod ingredients;
mod normalize;
mod scan;
mod tags;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use icons::{IconCtx, IconRef};
use normalize::Recipe;

static INDEX_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSource {
    pub pack_id: String,
    pub name: String,
    pub mc_version: String,
    pub mod_count: usize,
    pub kind: String,
}

pub struct PackInfo {
    pub pack_id: String,
    pub name: String,
    pub mc_version: String,
    pub kind: String,
    pub client_jar: PathBuf,
    pub dir: PathBuf,
}

fn read_zip_text(jar: &Path, entry: &str) -> Option<String> {
    let mut ar = zip::ZipArchive::new(fs::File::open(jar).ok()?).ok()?;
    let mut f = ar.by_name(entry).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

pub fn pack_info(pack_id: &str, dir: &Path) -> Option<PackInfo> {
    let vj_path = crate::instance::find_version_json(dir, None).ok()?;
    let vj: Value = serde_json::from_str(&fs::read_to_string(&vj_path).ok()?).ok()?;
    let client_jar = crate::instance::find_client_jar(dir, &vj, None).ok()?;
    let meta = crate::instance::read_meta(dir);
    let mc_version = vj
        .get("inheritsFrom")
        .and_then(|x| x.as_str())
        .map(String::from)
        .or_else(|| {
            read_zip_text(&client_jar, "version.json")
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| v.get("id").and_then(|x| x.as_str()).map(String::from))
        })
        .or_else(|| vj.get("id").and_then(|x| x.as_str()).map(String::from))?;
    let name = meta
        .as_ref()
        .map(|m| m.name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| pack_id.to_string());
    let kind = meta
        .and_then(|m| m.kind)
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| "pack".into());
    Some(PackInfo {
        pack_id: pack_id.to_string(),
        name,
        mc_version,
        kind,
        client_jar,
        dir: dir.to_path_buf(),
    })
}

/// Enabled top-level mods (`mods/*.jar`, never `*.disabled`), sorted by name.
fn mod_jars(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir.join("mods"))
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.extension().map(|e| e.eq_ignore_ascii_case("jar")).unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

fn sources(root: &Path) -> Vec<RecipeSource> {
    let mut out = Vec::new();
    for st in crate::pack_sync::list_installed(root) {
        if !st.installed || !cache::safe_name(&st.id) {
            continue;
        }
        let dir = PathBuf::from(&st.path);
        if let Some(info) = pack_info(&st.id, &dir) {
            out.push(RecipeSource {
                pack_id: info.pack_id,
                name: info.name,
                mc_version: info.mc_version,
                mod_count: mod_jars(&dir).len(),
                kind: info.kind,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

// ---------- output shape ----------

#[derive(Serialize)]
struct SourceOut<'a> {
    #[serde(rename = "packId")]
    pack_id: &'a str,
    name: &'a str,
    #[serde(rename = "mcVersion")]
    mc_version: &'a str,
}

#[derive(Serialize)]
struct ModOut {
    id: String,
    name: String,
    namespaces: Vec<String>,
}

#[derive(Serialize)]
struct ItemOut {
    id: String,
    name: String,
    #[serde(rename = "mod")]
    mod_id: String,
    icon: Option<IconRef>,
}

#[derive(Serialize)]
struct IndexOut<'a> {
    format: u8,
    source: SourceOut<'a>,
    locale: &'a str,
    mods: Vec<ModOut>,
    items: Vec<ItemOut>,
    tags: BTreeMap<String, Vec<String>>,
    textures: BTreeMap<String, String>,
    recipes: Vec<Recipe>,
}

#[derive(Debug, Default, Clone)]
#[allow(dead_code)]
pub struct Stats {
    pub mods: usize,
    pub items: usize,
    pub recipes: usize,
    pub tags: usize,
    pub textures: usize,
    pub icons_null: usize,
    pub bytes: usize,
    pub jars: usize,
    pub units: usize,
}

fn prettify(path: &str) -> String {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.split('_')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn item_name(id: &str, ru: bool, en: &HashMap<String, String>, ruv: &HashMap<String, String>) -> String {
    let (ns, path) = id.split_once(':').unwrap_or(("minecraft", id));
    let dotted = path.replace('/', ".");
    let keys = [format!("item.{ns}.{dotted}"), format!("block.{ns}.{dotted}")];
    if ru {
        if let Some(s) = keys.iter().find_map(|k| ruv.get(k)) {
            return s.clone();
        }
    }
    keys.iter().find_map(|k| en.get(k)).cloned().unwrap_or_else(|| prettify(path))
}

/// Build the whole index JSON. `ru_mc` = Minecraft's own ru_ru.json (from the asset index) if available.
pub fn build_index(
    info: &PackInfo,
    jars: &[PathBuf],
    locale: &str,
    ru_mc: Option<&Value>,
) -> Result<(Vec<u8>, Stats), String> {
    let ru = locale == "ru";
    let units = scan::scan_all(jars);
    if units.is_empty() {
        return Err("No readable jars".into());
    }

    // loaded mods + namespace owners (first jar with assets, then data)
    let mut loaded: HashSet<String> = HashSet::new();
    loaded.insert("minecraft".into());
    let mut ns_owner: HashMap<String, String> = HashMap::new();
    for u in &units {
        if u.has_meta {
            loaded.insert(u.mod_id.clone());
            loaded.extend(u.provides.iter().cloned());
        }
        for ns in &u.ns_assets {
            ns_owner.entry(ns.clone()).or_insert_with(|| u.mod_id.clone());
        }
    }
    for u in &units {
        for ns in &u.ns_data {
            ns_owner.entry(ns.clone()).or_insert_with(|| u.mod_id.clone());
        }
    }

    // merge resources (first unit wins; recipes: last wins)
    let mut defs: HashMap<String, String> = HashMap::new();
    let mut models: HashMap<String, String> = HashMap::new();
    let mut tex_loc: HashMap<String, (usize, String)> = HashMap::new();
    let mut lang_en: HashMap<String, String> = HashMap::new();
    let mut lang_ru: HashMap<String, String> = HashMap::new();
    let mut lang_order: Vec<String> = Vec::new();
    let mut tagset = tags::TagSet::default();
    let mut recipe_slot: HashMap<String, usize> = HashMap::new();
    let mut raw_recipes: Vec<(String, String, String)> = Vec::new(); // (id, json, fallback mod)
    for (ui, u) in units.iter().enumerate() {
        for (k, v) in &u.items {
            defs.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (k, v) in &u.models {
            models.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (k, e) in &u.textures {
            tex_loc.entry(k.clone()).or_insert_with(|| (ui, e.clone()));
        }
        for (k, v) in &u.lang_en {
            lang_en.entry(k.clone()).or_insert_with(|| v.clone());
        }
        lang_order.extend(u.lang_order.iter().cloned());
        for (k, v) in &u.lang_ru {
            lang_ru.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (id, j) in &u.tags {
            tagset.add(id, j);
        }
        for (id, j) in &u.recipes {
            let entry = (id.clone(), j.clone(), u.mod_id.clone());
            match recipe_slot.get(id) {
                Some(&i) => raw_recipes[i] = entry,
                None => {
                    recipe_slot.insert(id.clone(), raw_recipes.len());
                    raw_recipes.push(entry);
                }
            }
        }
    }
    if let Some(Value::Object(o)) = ru_mc {
        for (k, v) in o {
            if k.starts_with("item.") || k.starts_with("block.") {
                if let Value::String(s) = v {
                    lang_ru.entry(k.clone()).or_insert_with(|| s.clone());
                }
            }
        }
    }

    // recipes
    let resolve = |t: &str| tagset.resolve(t);
    let mut recipes: Vec<(Recipe, String)> = Vec::new();
    let mut skipped: BTreeMap<String, usize> = BTreeMap::new();
    for (id, json, fb) in &raw_recipes {
        let Ok(v) = serde_json::from_str::<Value>(json.trim_start_matches('\u{feff}')) else { continue };
        if !conditions::load_conditions_ok(&v, &loaded) {
            continue;
        }
        match normalize::normalize(id, &v, &resolve) {
            Some(r) => recipes.push((r, fb.clone())),
            None => {
                let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("?").to_string();
                *skipped.entry(ty).or_default() += 1;
            }
        }
    }
    drop(raw_recipes);
    if std::env::var_os("REMINED_RECIPES_DEBUG").is_some() {
        for (t, n) in &skipped {
            eprintln!("skipped-recipe-type {t} x{n}");
        }
    }

    // items: definitions + recipe outputs; owner = namespace owner
    let mut items: BTreeMap<String, String> = BTreeMap::new();
    let owner_of = |id: &str, fb: &str| -> String {
        id.split_once(':')
            .and_then(|(ns, _)| ns_owner.get(ns).cloned())
            .unwrap_or_else(|| fb.to_string())
    };
    for id in defs.keys() {
        items.insert(id.clone(), owner_of(id, "minecraft"));
    }
    for (r, fb) in &recipes {
        for o in &r.outputs {
            items.entry(o.id.clone()).or_insert_with(|| owner_of(&o.id, fb));
        }
    }
    items.remove("minecraft:air");
    let item_set: HashSet<String> = items.keys().cloned().collect();

    // finalize recipes: tag filtering, owning mod, station
    let filter_ing = |ing: &mut ingredients::Ingredient| {
        if ing.tag.is_some() && !item_set.is_empty() {
            ing.items.retain(|i| item_set.contains(i));
        }
    };
    let mut recipes_out: Vec<Recipe> = Vec::with_capacity(recipes.len());
    for (mut r, fb) in recipes {
        for i in r.inputs.iter_mut().flatten() {
            filter_ing(i);
        }
        if let Some(e) = r.extras.as_mut() {
            e.container.as_mut().map(&filter_ing);
            e.tool.as_mut().map(&filter_ing);
        }
        r.mod_id = r
            .ty
            .split_once(':')
            .and_then(|(ns, _)| ns_owner.get(ns).cloned())
            .unwrap_or(fb);
        r.station = normalize::station_for(&r.ty, &item_set);
        recipes_out.push(r);
    }
    recipes_out.sort_by(|a, b| a.id.cmp(&b.id));

    // tags
    let mut tags_out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for id in tagset.ids() {
        let mut list = tagset.resolve(id);
        if !item_set.is_empty() {
            list.retain(|i| item_set.contains(i));
        }
        if !list.is_empty() {
            tags_out.insert(id.clone(), list);
        }
    }

    // icons
    let has_tex = |t: &str| tex_loc.contains_key(t);
    let ctx = IconCtx::new(&defs, &models, &has_tex);
    let mut used_tex: BTreeSet<String> = BTreeSet::new();
    let mut icons_null = 0usize;
    let mut items_out: Vec<ItemOut> = Vec::with_capacity(items.len());
    for (id, mod_id) in &items {
        let icon = ctx.resolve(id);
        match &icon {
            Some(i) => used_tex.extend(i.textures().into_iter().map(String::from)),
            None => icons_null += 1,
        }
        items_out.push(ItemOut {
            id: id.clone(),
            name: item_name(id, ru, &lang_en, &lang_ru),
            mod_id: mod_id.clone(),
            icon,
        });
    }

    if std::env::var_os("REMINED_RECIPES_DEBUG").is_some() {
        for (k, n) in ctx.missing.borrow().iter() {
            eprintln!("missing-face-texture {k} x{n}");
        }
    }
    // texture bytes, grouped per container
    let mut by_unit: BTreeMap<usize, Vec<(String, String)>> = BTreeMap::new();
    for key in &used_tex {
        if let Some((ui, entry)) = tex_loc.get(key) {
            by_unit.entry(*ui).or_default().push((key.clone(), entry.clone()));
        }
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let mut textures: BTreeMap<String, String> = BTreeMap::new();
    for (ui, list) in by_unit {
        let u = &units[ui];
        let entries: Vec<String> = list.iter().map(|(_, e)| e.clone()).collect();
        let got: HashMap<String, Vec<u8>> = scan::read_entries(&jars[u.root], &u.chain, &entries).into_iter().collect();
        for (key, entry) in list {
            if let Some(b) = got.get(&entry) {
                textures.insert(key, b64.encode(b));
            }
        }
    }

    if std::env::var_os("REMINED_RECIPES_DEBUG").is_some() {
        for k in &used_tex {
            if !textures.contains_key(k) {
                eprintln!("used-but-unread-texture {k}");
            }
        }
    }
    // mods
    let mut mod_order: Vec<String> = Vec::new();
    let mut mod_meta: HashMap<String, (String, BTreeSet<String>)> = HashMap::new();
    let referenced: HashSet<&str> = recipes_out.iter().map(|r| r.mod_id.as_str()).collect();
    for u in &units {
        let e = mod_meta.entry(u.mod_id.clone()).or_insert_with(|| {
            mod_order.push(u.mod_id.clone());
            (u.mod_id.clone(), BTreeSet::new())
        });
        if let Some(n) = &u.mod_name {
            e.0 = n.clone();
        }
        if u.mod_id != "minecraft" {
            e.1.extend(u.ns_assets.iter().chain(u.ns_data.iter()).cloned());
        }
    }
    let mut mods_out: Vec<ModOut> = Vec::new();
    for id in mod_order {
        let (name, ns) = mod_meta.remove(&id).unwrap();
        if id == "minecraft" {
            mods_out.insert(0, ModOut { id, name: "Minecraft".into(), namespaces: vec!["minecraft".into()] });
        } else if !ns.is_empty() || referenced.contains(id.as_str()) {
            mods_out.push(ModOut { id, name, namespaces: ns.into_iter().collect() });
        }
    }
    if !mods_out.iter().any(|m| m.id == "minecraft") {
        mods_out.insert(0, ModOut { id: "minecraft".into(), name: "Minecraft".into(), namespaces: vec!["minecraft".into()] });
    }
    // items must point at an existing mod entry
    let mod_ids: HashSet<&str> = mods_out.iter().map(|m| m.id.as_str()).collect();
    for it in items_out.iter_mut() {
        if !mod_ids.contains(it.mod_id.as_str()) {
            it.mod_id = "minecraft".into();
        }
    }

    // JEI-like order: minecraft first (registry order from Items.<clinit>), then mods by name,
    // within a mod by first appearance of its item./block. lang key, then alphabetically.
    {
        let names: HashMap<&str, String> = mods_out.iter().map(|m| (m.id.as_str(), m.name.to_lowercase())).collect();
        let mc_rank: HashMap<String, usize> = classorder::items_order(&jars[0]).into_iter().enumerate().map(|(i, n)| (n, i)).collect();
        // "ns.path.with.dots" -> rank of first lang key mentioning it
        let mut lang_rank: HashMap<&str, usize> = HashMap::new();
        for (i, k) in lang_order.iter().enumerate() {
            let rest = k.strip_prefix("item.").or_else(|| k.strip_prefix("block."));
            if let Some(r) = rest {
                lang_rank.entry(r).or_insert(i);
            }
        }
        items_out.sort_by_cached_key(|it| {
            let (ns, path) = it.id.split_once(':').unwrap_or(("minecraft", &it.id));
            let is_mc = it.mod_id == "minecraft";
            let rank = if is_mc && ns == "minecraft" {
                mc_rank.get(path).copied()
            } else {
                lang_rank.get(format!("{ns}.{}", path.replace('/', ".")).as_str()).copied()
            };
            let mn = names.get(it.mod_id.as_str()).cloned().unwrap_or_default();
            (!is_mc, mn, rank.unwrap_or(usize::MAX), path.to_string(), it.id.clone())
        });
    }

    let stats = Stats {
        mods: mods_out.len(),
        items: items_out.len(),
        recipes: recipes_out.len(),
        tags: tags_out.len(),
        textures: textures.len(),
        icons_null,
        bytes: 0,
        jars: jars.len(),
        units: units.len(),
    };
    let out = IndexOut {
        format: 1,
        source: SourceOut { pack_id: &info.pack_id, name: &info.name, mc_version: &info.mc_version },
        locale,
        mods: mods_out,
        items: items_out,
        tags: tags_out,
        textures,
        recipes: recipes_out,
    };
    let bytes = serde_json::to_vec(&out).map_err(|e| e.to_string())?;
    let n = bytes.len();
    Ok((bytes, Stats { bytes: n, ..stats }))
}

fn jar_list(info: &PackInfo) -> Vec<PathBuf> {
    let mut jars = vec![info.client_jar.clone()];
    jars.extend(mod_jars(&info.dir));
    jars
}

fn index_blocking(root: PathBuf, pack_id: String, locale: &'static str, force: bool) -> Result<PathBuf, String> {
    if !cache::safe_name(&pack_id) {
        return Err("Bad pack id".into());
    }
    let dir = crate::paths::pack_dir(&root, &pack_id);
    let info = pack_info(&pack_id, &dir).ok_or_else(|| format!("Pack {pack_id} is not installed"))?;
    let jars = jar_list(&info);
    let hash = cache::fingerprint(&jars);
    let file = cache::cache_file(&root, &pack_id, &hash, locale);
    let partial = cache::partial_file(&root, &pack_id, &hash, locale);
    if !force {
        if file.is_file() {
            return Ok(file);
        }
        let fresh = fs::metadata(&partial)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|e| e.as_secs() < cache::PARTIAL_TTL_SECS)
            .unwrap_or(false);
        if fresh {
            return Ok(partial);
        }
    }
    fs::create_dir_all(cache::recipes_dir(&root)).map_err(|e| e.to_string())?;
    let mut ru_failed = false;
    let ru_mc = if locale == "ru" {
        let cd = crate::schematic::assets::cache_dir(&root);
        let _ = fs::create_dir_all(&cd);
        let r = crate::schematic::assets::fetch_ru_lang(&cd, &info.mc_version, Some(&info.dir)).ok();
        ru_failed = r.is_none();
        r
    } else {
        None
    };
    let (bytes, _) = build_index(&info, &jars, locale, ru_mc.as_ref())?;
    if ru_failed {
        // Offline: serve en-fallback names, but retry the fetch on a later call.
        crate::paths::write_atomic(&partial, bytes).map_err(|e| e.to_string())?;
        return Ok(partial);
    }
    crate::paths::write_atomic(&file, bytes).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&partial);
    cache::prune_old(&root, &pack_id, locale, &file);
    Ok(file)
}

#[tauri::command]
pub async fn recipe_sources(app: AppHandle) -> Result<Vec<RecipeSource>, String> {
    let root = crate::paths::remined_root(&app)?;
    tokio::task::spawn_blocking(move || sources(&root)).await.map_err(|e| e.to_string())
}

/// Builds (or reuses) the recipe index and returns the path of the cached JSON. Single-flight.
#[tauri::command]
pub async fn recipe_index(
    app: AppHandle,
    pack_id: String,
    locale: String,
    force: Option<bool>,
) -> Result<String, String> {
    let locale = if locale.to_lowercase().starts_with("ru") { "ru" } else { "en" };
    let root = crate::paths::remined_root(&app)?;
    let _guard = INDEX_LOCK.lock().await;
    let p = tokio::task::spawn_blocking(move || index_blocking(root, pack_id, locale, force.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())??;
    Ok(p.to_string_lossy().into_owned())
}

/// Reads an index produced by `recipe_index` (path must be inside the recipe cache dir).
#[tauri::command]
pub async fn recipe_read_index(app: AppHandle, path: String) -> Result<String, String> {
    let root = crate::paths::remined_root(&app)?;
    tokio::task::spawn_blocking(move || {
        let dir = cache::recipes_dir(&root).canonicalize().map_err(|e| e.to_string())?;
        let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
        if !p.starts_with(&dir) {
            return Err("Path is outside the recipe cache".to_string());
        }
        fs::read_to_string(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty() {
        assert_eq!(prettify("block/oak_planks"), "Oak Planks");
        assert_eq!(prettify("stick"), "Stick");
    }

    /// `cargo test --lib recipes::tests::real_pack -- --ignored --nocapture`
    /// Override the pack dir with REMINED_RECIPES_PACK, locale with REMINED_RECIPES_LOCALE.
    #[test]
    #[ignore]
    fn real_pack() {
        let dir = PathBuf::from(
            std::env::var("REMINED_RECIPES_PACK")
                .unwrap_or_else(|_| "/Users/macbook/Desktop/Fun/Remined Launcher/packs/vanillapro".into()),
        );
        let locale = std::env::var("REMINED_RECIPES_LOCALE").unwrap_or_else(|_| "en".into());
        let info = pack_info("vanillapro", &dir).expect("pack info");
        let jars = jar_list(&info);
        let t = std::time::Instant::now();
        let ru_mc = (locale == "ru").then(|| {
            let cd = std::env::temp_dir().join("remined-recipes-test-cache");
            let _ = fs::create_dir_all(&cd);
            let r = crate::schematic::assets::fetch_ru_lang(&cd, &info.mc_version, Some(&info.dir));
            println!("fetch_ru_lang ok = {}", r.is_ok());
            r.ok()
        }).flatten();
        let (bytes, st) = build_index(&info, &jars, &locale, ru_mc.as_ref()).expect("index");
        let out = std::env::temp_dir().join(format!("remined-recipes-real-pack-{locale}.json"));
        fs::write(&out, &bytes).unwrap();
        println!("mc={} jars={} units={} secs={:.1}", info.mc_version, st.jars, st.units, t.elapsed().as_secs_f32());
        println!("{st:?}");
        println!("json size = {:.1} MB -> {}", bytes.len() as f64 / 1048576.0, out.display());
        assert!(st.recipes > 1000);
    }
}
