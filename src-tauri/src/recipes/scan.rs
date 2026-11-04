//! One-pass jar scan (recursing into jar-in-jar, in memory) collecting everything the indexer needs.

use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{Cursor, Read, Seek};
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use zip::ZipArchive;

const MAX_JSON: u64 = 8 * 1024 * 1024;
const MAX_NEST_BYTES: u64 = 64 * 1024 * 1024;
/// Max nested-jar bytes held in memory at once across all scan threads.
const NEST_BUDGET: u64 = 512 * 1024 * 1024;
const MAX_TEXTURE: u64 = 1024 * 1024;
const MAX_DEPTH: u8 = 4;

#[derive(Default)]
pub struct Unit {
    /// Index of the top-level jar this unit lives in, plus the nested jar names leading to it.
    pub root: usize,
    pub chain: Vec<String>,
    pub mod_id: String,
    pub mod_name: Option<String>,
    pub has_meta: bool,
    pub provides: Vec<String>,
    pub ns_assets: BTreeSet<String>,
    pub ns_data: BTreeSet<String>,
    pub items: Vec<(String, String)>,
    pub models: Vec<(String, String)>,
    /// (texture key `ns:path`, jar entry name)
    pub textures: Vec<(String, String)>,
    pub lang_en: HashMap<String, String>,
    pub lang_ru: HashMap<String, String>,
    /// item./block. keys of en_us.json in file order
    pub lang_order: Vec<String>,
    pub tags: Vec<(String, String)>,
    pub recipes: Vec<(String, String)>,
}

#[derive(Debug, PartialEq)]
pub enum Kind<'a> {
    Item(&'a str, &'a str),
    Model(&'a str, &'a str),
    Texture(&'a str, &'a str),
    Lang(&'a str, bool),
    Tag(&'a str, &'a str),
    Recipe(&'a str, &'a str),
    Other,
}

fn valid_ns(ns: &str) -> bool {
    !ns.is_empty() && ns.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.'))
}

pub fn classify(name: &str) -> (Option<(bool, &str)>, Kind<'_>) {
    // returns (namespace seen: (is_assets, ns), kind)
    let (is_assets, rest) = if let Some(r) = name.strip_prefix("assets/") {
        (true, r)
    } else if let Some(r) = name.strip_prefix("data/") {
        (false, r)
    } else {
        return (None, Kind::Other);
    };
    let Some((ns, rel)) = rest.split_once('/') else {
        return (None, Kind::Other);
    };
    if !valid_ns(ns) || rel.is_empty() {
        return (None, Kind::Other);
    }
    let seen = Some((is_assets, ns));
    let json = rel.strip_suffix(".json");
    let kind = if is_assets {
        if let Some(p) = rel.strip_prefix("items/").and_then(|r| r.strip_suffix(".json")) {
            Kind::Item(ns, p)
        } else if let Some(p) = rel.strip_prefix("models/").and_then(|r| r.strip_suffix(".json")) {
            Kind::Model(ns, p)
        } else if let Some(p) = rel.strip_prefix("textures/").and_then(|r| r.strip_suffix(".png")) {
            Kind::Texture(ns, p)
        } else if rel == "lang/en_us.json" {
            Kind::Lang(ns, false)
        } else if rel == "lang/ru_ru.json" {
            Kind::Lang(ns, true)
        } else {
            Kind::Other
        }
    } else if let Some(p) = json
        .and_then(|j| j.strip_prefix("tags/item/").or_else(|| j.strip_prefix("tags/items/")))
    {
        Kind::Tag(ns, p)
    } else if let Some(p) = json.and_then(|j| j.strip_prefix("recipe/").or_else(|| j.strip_prefix("recipes/"))) {
        Kind::Recipe(ns, p)
    } else {
        Kind::Other
    };
    (seen, kind)
}

fn read_text(f: &mut dyn Read, size: u64) -> Option<String> {
    if size > MAX_JSON {
        return None;
    }
    let mut b = Vec::with_capacity(size as usize);
    f.take(MAX_JSON + 1).read_to_end(&mut b).ok()?;
    if b.len() as u64 > MAX_JSON {
        return None;
    }
    Some(String::from_utf8_lossy(&b).into_owned())
}

/// Object entries in file order (serde_json's Map would sort them).
struct Pairs(Vec<(String, Value)>);

impl<'de> serde::Deserialize<'de> for Pairs {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = Pairs;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Pairs, A::Error> {
                let mut v = Vec::new();
                while let Some(kv) = m.next_entry::<String, Value>()? {
                    v.push(kv);
                }
                Ok(Pairs(v))
            }
        }
        d.deserialize_map(V)
    }
}

/// (filtered key -> text, keys in file order)
fn lang_filtered(text: &str) -> (HashMap<String, String>, Vec<String>) {
    let mut out = HashMap::new();
    let mut order = Vec::new();
    if let Ok(Pairs(p)) = serde_json::from_str::<Pairs>(text.trim_start_matches('\u{feff}')) {
        for (k, v) in p {
            if k.starts_with("item.") || k.starts_with("block.") {
                if let Value::String(s) = v {
                    if out.insert(k.clone(), s).is_none() {
                        order.push(k);
                    }
                }
            }
        }
    }
    (out, order)
}

fn parse_fabric(text: &str, unit: &mut Unit) {
    let Ok(v) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else { return };
    let Some(id) = v.get("id").and_then(|x| x.as_str()) else { return };
    unit.mod_id = id.to_string();
    unit.has_meta = true;
    unit.mod_name = v.get("name").and_then(|x| x.as_str()).map(String::from);
    if let Some(a) = v.get("provides").and_then(|p| p.as_array()) {
        for x in a {
            match x {
                Value::String(s) => unit.provides.push(s.clone()),
                Value::Object(o) => {
                    if let Some(s) = o.get("id").and_then(|i| i.as_str()) {
                        unit.provides.push(s.to_string());
                    }
                }
                _ => {}
            }
        }
    }
}

fn scan_archive<R: Read + Seek>(
    ar: &mut ZipArchive<R>,
    root: usize,
    chain: Vec<String>,
    default_mod: &str,
    is_client: bool,
    depth: u8,
    budget: &AtomicU64,
    out: &mut Vec<Unit>,
) {
    let mut u = Unit { root, chain: chain.clone(), mod_id: default_mod.to_string(), ..Default::default() };
    let mut nested: Vec<String> = Vec::new();
    for i in 0..ar.len() {
        let Ok(mut f) = ar.by_index(i) else { continue };
        if !f.is_file() {
            continue;
        }
        let Ok(name) = f.name().map(|n| n.into_owned()) else { continue };
        let size = f.size();
        let (seen, kind) = classify(&name);
        if let Some((is_assets, ns)) = seen {
            if is_assets {
                u.ns_assets.insert(ns.to_string());
            } else {
                u.ns_data.insert(ns.to_string());
            }
        }
        let read = |f: &mut dyn Read| read_text(f, size);
        match kind {
            Kind::Item(ns, p) => {
                if let Some(t) = read(&mut f) {
                    u.items.push((format!("{ns}:{p}"), t));
                }
            }
            Kind::Model(ns, p) => {
                if let Some(t) = read(&mut f) {
                    u.models.push((format!("{ns}:{p}"), t));
                }
            }
            Kind::Texture(ns, p) => u.textures.push((format!("{ns}:{p}"), name.clone())),
            Kind::Lang(_, ru) => {
                if let Some(t) = read(&mut f) {
                    let (m, order) = lang_filtered(&t);
                    if !ru {
                        u.lang_order.extend(order);
                    }
                    let dst = if ru { &mut u.lang_ru } else { &mut u.lang_en };
                    for (k, v) in m {
                        dst.entry(k).or_insert(v);
                    }
                }
            }
            Kind::Tag(ns, p) => {
                if let Some(t) = read(&mut f) {
                    u.tags.push((format!("{ns}:{p}"), t));
                }
            }
            Kind::Recipe(ns, p) => {
                if let Some(t) = read(&mut f) {
                    u.recipes.push((format!("{ns}:{p}"), t));
                }
            }
            Kind::Other => {
                if name == "fabric.mod.json" && !is_client {
                    if let Some(t) = read(&mut f) {
                        parse_fabric(&t, &mut u);
                    }
                } else if name.starts_with("META-INF/jars/") && name.ends_with(".jar") {
                    nested.push(name);
                }
            }
        }
    }
    let my_mod = u.mod_id.clone();
    out.push(u);
    if depth >= MAX_DEPTH {
        return;
    }
    for nf in nested {
        let Ok(f) = ar.by_name(&nf) else { continue };
        let size = f.size();
        if size > MAX_NEST_BYTES {
            continue;
        }
        if budget.fetch_add(size, Ordering::SeqCst) + size > NEST_BUDGET {
            budget.fetch_sub(size, Ordering::SeqCst);
            continue;
        }
        let mut data = Vec::with_capacity(size as usize);
        let mut f = f;
        let ok = (&mut f).take(MAX_NEST_BYTES + 1).read_to_end(&mut data).is_ok() && data.len() as u64 <= MAX_NEST_BYTES;
        drop(f);
        if ok {
            if let Ok(mut inner) = ZipArchive::new(Cursor::new(data)) {
                let mut c = chain.clone();
                c.push(nf);
                scan_archive(&mut inner, root, c, &my_mod, false, depth + 1, budget, out);
            }
        }
        budget.fetch_sub(size, Ordering::SeqCst);
    }
}

pub fn scan_jar(root: usize, path: &Path, is_client: bool, budget: &AtomicU64) -> Vec<Unit> {
    let mut out = Vec::new();
    let Ok(file) = File::open(path) else { return out };
    let Ok(mut ar) = ZipArchive::new(file) else { return out };
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".into());
    let default_mod = if is_client { "minecraft".to_string() } else { stem };
    scan_archive(&mut ar, root, Vec::new(), &default_mod, is_client, 0, budget, &mut out);
    if is_client {
        if let Some(u) = out.first_mut() {
            u.mod_id = "minecraft".into();
            u.mod_name = Some("Minecraft".into());
            u.has_meta = true;
        }
    }
    out
}

/// Scan all jars in parallel; result keeps jar order (client first), nested units after their parent.
pub fn scan_all(jars: &[std::path::PathBuf]) -> Vec<Unit> {
    let next = AtomicUsize::new(0);
    let budget = AtomicU64::new(0);
    let results: Mutex<Vec<Option<Vec<Unit>>>> = Mutex::new((0..jars.len()).map(|_| None).collect());
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= jars.len() {
                    break;
                }
                let units = scan_jar(i, &jars[i], i == 0, &budget);
                results.lock().unwrap()[i] = Some(units);
            });
        }
    });
    results.into_inner().unwrap().into_iter().flatten().flatten().collect()
}

/// Read raw bytes of `entries` from the (possibly nested) container.
pub fn read_entries(jar: &Path, chain: &[String], entries: &[String]) -> Vec<(String, Vec<u8>)> {
    fn go<R: Read + Seek>(
        ar: &mut ZipArchive<R>,
        chain: &[String],
        entries: &[String],
        out: &mut Vec<(String, Vec<u8>)>,
    ) {
        if let Some((first, rest)) = chain.split_first() {
            let Ok(mut f) = ar.by_name(first) else { return };
            if f.size() > MAX_NEST_BYTES {
                return;
            }
            let mut data = Vec::new();
            if (&mut f).take(MAX_NEST_BYTES + 1).read_to_end(&mut data).is_err() || data.len() as u64 > MAX_NEST_BYTES {
                return;
            }
            drop(f);
            if let Ok(mut inner) = ZipArchive::new(Cursor::new(data)) {
                go(&mut inner, rest, entries, out);
            }
        } else {
            for e in entries {
                if let Ok(mut f) = ar.by_name(e) {
                    if f.size() > MAX_TEXTURE {
                        continue;
                    }
                    let mut b = Vec::new();
                    if (&mut f).take(MAX_TEXTURE + 1).read_to_end(&mut b).is_ok() && b.len() as u64 <= MAX_TEXTURE {
                        out.push((e.clone(), b));
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    if let Ok(file) = File::open(jar) {
        if let Ok(mut ar) = ZipArchive::new(file) {
            go(&mut ar, chain, entries, &mut out);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_paths() {
        assert_eq!(classify("assets/minecraft/items/stick.json").1, Kind::Item("minecraft", "stick"));
        assert_eq!(classify("assets/a/models/block/x/y.json").1, Kind::Model("a", "block/x/y"));
        assert_eq!(classify("assets/a/textures/item/x.png").1, Kind::Texture("a", "item/x"));
        assert_eq!(classify("assets/a/lang/ru_ru.json").1, Kind::Lang("a", true));
        assert_eq!(classify("data/a/tags/items/x/y.json").1, Kind::Tag("a", "x/y"));
        assert_eq!(classify("data/a/tags/item/y.json").1, Kind::Tag("a", "y"));
        assert_eq!(classify("data/a/tags/block/y.json").1, Kind::Other);
        assert_eq!(classify("data/a/recipe/x/y.json").1, Kind::Recipe("a", "x/y"));
        assert_eq!(classify("data/a/recipes/y.json").1, Kind::Recipe("a", "y"));
        assert_eq!(classify("META-INF/x").1, Kind::Other);
    }
}

#[cfg(test)]
mod order_tests {
    use super::*;

    #[test]
    fn lang_keeps_file_order() {
        let (m, o) = lang_filtered(r#"{"item.a.z":"Z","block.a.b":"B","other":"x","item.a.a":"A"}"#);
        assert_eq!(o, vec!["item.a.z", "block.a.b", "item.a.a"]);
        assert_eq!(m.len(), 3);
    }
}
