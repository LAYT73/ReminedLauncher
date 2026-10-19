//! Static Fabric mod audit: reads `fabric.mod.json` from every jar (incl. jar-in-jar)
//! and checks `depends` / `breaks` against the installed set + Minecraft / loader / Java.
//! Used by Remined Vanilla installs (`mods-manifest.json`) and the `smoke-rv` harness.

use serde_json::Value;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone, Default)]
pub struct ModMeta {
    pub id: String,
    pub version: String,
    pub file: String,
    pub depends: Vec<(String, Vec<String>)>,
    pub breaks: Vec<(String, Vec<String>)>,
    pub provides: Vec<String>,
    pub nested: Vec<ModMeta>,
}

fn preds(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect(),
        _ => vec!["*".into()],
    }
}

fn pred_map(v: Option<&Value>) -> Vec<(String, Vec<String>)> {
    v.and_then(|x| x.as_object())
        .map(|o| o.iter().map(|(k, v)| (k.clone(), preds(v))).collect())
        .unwrap_or_default()
}

fn parse_meta<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    file: &str,
    depth: u8,
) -> Option<ModMeta> {
    let mut json = String::new();
    archive
        .by_name("fabric.mod.json")
        .ok()?
        .read_to_string(&mut json)
        .ok()?;
    // Some mods ship JSON with trailing junk / control chars; be lenient.
    let v: Value = serde_json::from_str(json.trim_start_matches('\u{feff}')).ok()?;
    let mut meta = ModMeta {
        id: v.get("id")?.as_str()?.to_string(),
        version: v
            .get("version")
            .and_then(|x| x.as_str())
            .unwrap_or("0")
            .to_string(),
        file: file.to_string(),
        depends: pred_map(v.get("depends")),
        breaks: pred_map(v.get("breaks")),
        provides: v
            .get("provides")
            .and_then(|p| p.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| match x {
                        Value::String(s) => Some(s.clone()),
                        Value::Object(o) => o.get("id").and_then(|i| i.as_str()).map(String::from),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        nested: Vec::new(),
    };
    if depth < 3 {
        let nested_files: Vec<String> = v
            .get("jars")
            .and_then(|j| j.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|e| e.get("file").and_then(|f| f.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        for nf in nested_files {
            let mut data = Vec::new();
            if let Ok(mut f) = archive.by_name(&nf) {
                if f.read_to_end(&mut data).is_err() {
                    continue;
                }
            } else {
                continue;
            }
            if let Ok(mut inner) = ZipArchive::new(Cursor::new(data)) {
                if let Some(m) = parse_meta(&mut inner, &nf, depth + 1) {
                    meta.nested.push(m);
                }
            }
        }
    }
    Some(meta)
}

pub fn read_jar_meta(jar: &Path) -> Option<ModMeta> {
    let f = File::open(jar).ok()?;
    let mut archive = ZipArchive::new(f).ok()?;
    let name = jar.file_name()?.to_string_lossy().to_string();
    parse_meta(&mut archive, &name, 0)
}

pub fn read_mods_dir(mods_dir: &Path) -> Vec<ModMeta> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return out;
    };
    let mut paths: Vec<_> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "jar").unwrap_or(false))
        .collect();
    paths.sort();
    for p in paths {
        if let Some(m) = read_jar_meta(&p) {
            out.push(m);
        }
    }
    out
}

// ---------- Fabric-style version matching ----------

#[derive(Debug, Clone)]
struct Ver {
    nums: Vec<Option<u64>>, // None = wildcard
    pre: Option<String>,    // Some("") = lowest prerelease marker
}

fn parse_ver(s: &str) -> Ver {
    let s = s.trim();
    let s = s.split('+').next().unwrap_or(s);
    let (core, pre) = match s.find('-') {
        Some(i) => (&s[..i], Some(s[i + 1..].to_string())),
        None => (s, None),
    };
    let nums = core
        .split('.')
        .filter(|p| !p.is_empty())
        .map(|p| p.parse::<u64>().ok())
        .collect();
    Ver { nums, pre }
}

fn cmp_pre(a: &Option<String>, b: &Option<String>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater, // release > prerelease
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            if x.is_empty() && y.is_empty() {
                return Ordering::Equal;
            }
            if x.is_empty() {
                return Ordering::Less;
            }
            if y.is_empty() {
                return Ordering::Greater;
            }
            let xs: Vec<&str> = x.split('.').collect();
            let ys: Vec<&str> = y.split('.').collect();
            for i in 0..xs.len().max(ys.len()) {
                match (xs.get(i), ys.get(i)) {
                    (Some(p), Some(q)) => {
                        let o = match (p.parse::<u64>(), q.parse::<u64>()) {
                            (Ok(a), Ok(b)) => a.cmp(&b),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            _ => p.cmp(q),
                        };
                        if o != Ordering::Equal {
                            return o;
                        }
                    }
                    (None, Some(_)) => return Ordering::Less,
                    (Some(_), None) => return Ordering::Greater,
                    _ => {}
                }
            }
            Ordering::Equal
        }
    }
}

fn cmp_ver(a: &Ver, b: &Ver) -> Ordering {
    let n = a.nums.len().max(b.nums.len());
    for i in 0..n {
        let x = a.nums.get(i).copied().flatten().unwrap_or(0);
        let y = b.nums.get(i).copied().flatten().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => {}
            o => return o,
        }
    }
    cmp_pre(&a.pre, &b.pre)
}

fn clause_matches(clause: &str, version: &Ver) -> bool {
    let c = clause.trim();
    if c.is_empty() || c == "*" {
        return true;
    }
    let (op, rest) = if let Some(r) = c.strip_prefix(">=") {
        (">=", r)
    } else if let Some(r) = c.strip_prefix("<=") {
        ("<=", r)
    } else if let Some(r) = c.strip_prefix('>') {
        (">", r)
    } else if let Some(r) = c.strip_prefix('<') {
        ("<", r)
    } else if let Some(r) = c.strip_prefix('=') {
        ("=", r)
    } else if let Some(r) = c.strip_prefix('^') {
        ("^", r)
    } else if let Some(r) = c.strip_prefix('~') {
        ("~", r)
    } else {
        ("=", c)
    };
    let want = parse_ver(rest);
    match op {
        ">=" => cmp_ver(version, &want) != Ordering::Less,
        "<=" => cmp_ver(version, &want) != Ordering::Greater,
        ">" => cmp_ver(version, &want) == Ordering::Greater,
        "<" => cmp_ver(version, &want) == Ordering::Less,
        "^" => {
            let mut hi = want.clone();
            let major = hi.nums.first().copied().flatten().unwrap_or(0);
            hi.nums = vec![Some(major + 1)];
            hi.pre = Some(String::new());
            cmp_ver(version, &want) != Ordering::Less && cmp_ver(version, &hi) == Ordering::Less
        }
        "~" => {
            let mut hi = want.clone();
            let major = hi.nums.first().copied().flatten().unwrap_or(0);
            let minor = hi.nums.get(1).copied().flatten().unwrap_or(0);
            hi.nums = vec![Some(major), Some(minor + 1)];
            hi.pre = Some(String::new());
            cmp_ver(version, &want) != Ordering::Less && cmp_ver(version, &hi) == Ordering::Less
        }
        _ => {
            // "=" with optional wildcards: 1.20.x
            if want.nums.iter().any(|n| n.is_none()) {
                for (i, n) in want.nums.iter().enumerate() {
                    if let Some(n) = n {
                        if version.nums.get(i).copied().flatten().unwrap_or(0) != *n {
                            return false;
                        }
                    }
                }
                true
            } else {
                cmp_ver(version, &want) == Ordering::Equal
            }
        }
    }
}

/// OR over `preds`, AND over space-separated clauses inside each predicate.
pub fn version_matches(preds: &[String], version: &str) -> bool {
    let v = parse_ver(version);
    preds.iter().any(|p| {
        p.split_whitespace()
            .all(|clause| clause_matches(clause, &v))
    })
}

// ---------- Audit ----------

pub struct AuditEnv<'a> {
    pub minecraft: &'a str,
    pub loader: Option<&'a str>,
    pub java_major: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueKind {
    Missing,
    WrongVersion,
    Breaks,
    Duplicate,
}

#[derive(Debug, Clone)]
pub struct Issue {
    pub kind: IssueKind,
    /// Mod id that declared the dependency.
    pub owner_id: String,
    /// Top-level jar file containing the owner (jar-in-jar resolved to its host).
    pub owner_top_file: String,
    /// The other mod id involved.
    pub dep: String,
    pub text: String,
}

fn collect(
    m: &ModMeta,
    top: &str,
    ids: &mut HashMap<String, String>,
    all: &mut Vec<(ModMeta, String)>,
) {
    ids.insert(m.id.clone(), m.version.clone());
    for p in &m.provides {
        ids.entry(p.clone()).or_insert_with(|| m.version.clone());
    }
    all.push((m.clone(), top.to_string()));
    for n in &m.nested {
        collect(n, top, ids, all);
    }
}

/// Returns structured problems; empty = Fabric loader would accept the set.
pub fn audit_issues(mods: &[ModMeta], env: &AuditEnv) -> Vec<Issue> {
    let mut ids: HashMap<String, String> = HashMap::new();
    ids.insert("minecraft".into(), env.minecraft.to_string());
    if let Some(l) = env.loader {
        ids.insert("fabricloader".into(), l.to_string());
        ids.insert("fabric-loader".into(), l.to_string());
    }
    // Fabric Loader bundles MixinExtras (no standalone jar needed for `depends`).
    ids.insert("mixinextras".into(), "0.5.0".into());
    if let Some(j) = env.java_major {
        ids.insert("java".into(), j.to_string());
    }
    let mut all: Vec<(ModMeta, String)> = Vec::new();
    for m in mods {
        collect(m, &m.file, &mut ids, &mut all);
    }
    let mut problems: Vec<Issue> = Vec::new();

    let mut seen: HashMap<&str, &str> = HashMap::new();
    for m in mods {
        if let Some(prev) = seen.insert(m.id.as_str(), m.file.as_str()) {
            problems.push(Issue {
                kind: IssueKind::Duplicate,
                owner_id: m.id.clone(),
                owner_top_file: m.file.clone(),
                dep: m.id.clone(),
                text: format!("duplicate mod id '{}' in {} and {}", m.id, prev, m.file),
            });
        }
    }

    for (m, top) in &all {
        for (dep, p) in &m.depends {
            match ids.get(dep) {
                None => problems.push(Issue {
                    kind: IssueKind::Missing,
                    owner_id: m.id.clone(),
                    owner_top_file: top.clone(),
                    dep: dep.clone(),
                    text: format!("{} ({}) requires '{}' {:?} - not installed", m.id, top, dep, p),
                }),
                Some(have) => {
                    if !version_matches(p, have) {
                        problems.push(Issue {
                            kind: IssueKind::WrongVersion,
                            owner_id: m.id.clone(),
                            owner_top_file: top.clone(),
                            dep: dep.clone(),
                            text: format!(
                                "{} ({}) requires {} {:?} but {} is present",
                                m.id, top, dep, p, have
                            ),
                        });
                    }
                }
            }
        }
        for (brk, p) in &m.breaks {
            if let Some(have) = ids.get(brk) {
                if version_matches(p, have) {
                    problems.push(Issue {
                        kind: IssueKind::Breaks,
                        owner_id: m.id.clone(),
                        owner_top_file: top.clone(),
                        dep: brk.clone(),
                        text: format!(
                            "{} ({}) breaks with {} {} ({:?})",
                            m.id, top, brk, have, p
                        ),
                    });
                }
            }
        }
    }
    problems.sort_by(|a, b| a.text.cmp(&b.text));
    problems.dedup_by(|a, b| a.text == b.text);
    problems
}

/// Human-readable problems.
pub fn audit(mods: &[ModMeta], env: &AuditEnv) -> Vec<String> {
    audit_issues(mods, env).into_iter().map(|i| i.text).collect()
}

pub fn manifest_json(mods: &[ModMeta], mods_dir: &Path) -> Value {
    let list: Vec<Value> = mods
        .iter()
        .map(|m| {
            let size = fs::metadata(mods_dir.join(&m.file)).map(|x| x.len()).unwrap_or(0);
            serde_json::json!({
                "file": m.file,
                "id": m.id,
                "version": m.version,
                "size": size,
            })
        })
        .collect();
    Value::Array(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Vec<String> {
        vec![s.to_string()]
    }

    #[test]
    fn predicates() {
        assert!(version_matches(&p(">=1.20"), "1.20.1"));
        assert!(!version_matches(&p(">=1.21"), "1.20.6"));
        assert!(version_matches(&p("1.20.x"), "1.20.4"));
        assert!(!version_matches(&p("1.20.x"), "1.21"));
        assert!(version_matches(&p("~1.20.1"), "1.20.4"));
        assert!(!version_matches(&p("~1.20.1"), "1.21"));
        assert!(version_matches(&p("^0.9.0"), "0.9.5"));
        assert!(version_matches(&p(">=1.20 <1.21"), "1.20.6"));
        assert!(!version_matches(&p(">=1.20 <1.21"), "1.21"));
        assert!(version_matches(&["1.19".into(), "1.20.1".into()], "1.20.1"));
        assert!(version_matches(&p("*"), "anything"));
        assert!(version_matches(&p(">=1.21-"), "1.21"));
        assert!(version_matches(&p("<1.21.2-"), "1.21.1"));
        assert!(version_matches(&p(">=0.8.0-beta.1"), "0.8.0"));
    }
}
