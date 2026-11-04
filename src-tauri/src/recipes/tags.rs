//! Item tags: merge in jar order (honouring `replace`), resolve nested tags (cycle-safe).

use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use super::ingredients::norm_id;

#[derive(Debug, Clone, PartialEq)]
enum Entry {
    Id(String),
    Tag(String),
}

#[derive(Default)]
pub struct TagSet {
    raw: HashMap<String, Vec<Entry>>,
    order: Vec<String>,
    cache: RefCell<HashMap<String, Vec<String>>>,
}

impl TagSet {
    /// Add one tag file (call in jar order, client first).
    pub fn add(&mut self, id: &str, json: &str) {
        let Ok(v) = serde_json::from_str::<Value>(json.trim_start_matches('\u{feff}')) else {
            return;
        };
        if !self.raw.contains_key(id) {
            self.order.push(id.to_string());
        }
        let list = self.raw.entry(id.to_string()).or_default();
        if v.get("replace").and_then(|r| r.as_bool()).unwrap_or(false) {
            list.clear();
        }
        let Some(values) = v.get("values").and_then(|x| x.as_array()) else {
            return;
        };
        for e in values {
            let s = match e {
                Value::String(s) => Some(s.as_str()),
                Value::Object(o) => o.get("id").and_then(|x| x.as_str()),
                _ => None,
            };
            let Some(s) = s else { continue };
            list.push(match s.strip_prefix('#') {
                Some(t) => Entry::Tag(norm_id(t)),
                None => Entry::Id(norm_id(s)),
            });
        }
        self.cache.borrow_mut().clear();
    }

    pub fn ids(&self) -> &[String] {
        &self.order
    }

    fn inner(&self, id: &str, visiting: &mut HashSet<String>, out: &mut Vec<String>, seen: &mut HashSet<String>) {
        if !visiting.insert(id.to_string()) {
            return;
        }
        if let Some(list) = self.raw.get(id) {
            for e in list {
                match e {
                    Entry::Id(i) => {
                        if seen.insert(i.clone()) {
                            out.push(i.clone());
                        }
                    }
                    Entry::Tag(t) => self.inner(t, visiting, out, seen),
                }
            }
        }
        visiting.remove(id);
    }

    /// Resolved (unfiltered) item ids of a tag. `id` has no leading '#'.
    pub fn resolve(&self, id: &str) -> Vec<String> {
        if let Some(c) = self.cache.borrow().get(id) {
            return c.clone();
        }
        let mut out = Vec::new();
        self.inner(id, &mut HashSet::new(), &mut out, &mut HashSet::new());
        self.cache.borrow_mut().insert(id.to_string(), out.clone());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_nesting_cycles() {
        let mut t = TagSet::default();
        t.add("minecraft:planks", r##"{"values":["minecraft:oak_planks","minecraft:birch_planks"]}"##);
        t.add("minecraft:logs", r##"{"values":["#minecraft:planks","minecraft:log",{"id":"x:opt","required":false}]}"##);
        // later jar: extends planks
        t.add("minecraft:planks", r##"{"values":["x:plank"]}"##);
        assert_eq!(
            t.resolve("minecraft:planks"),
            vec!["minecraft:oak_planks", "minecraft:birch_planks", "x:plank"]
        );
        assert_eq!(
            t.resolve("minecraft:logs"),
            vec!["minecraft:oak_planks", "minecraft:birch_planks", "x:plank", "minecraft:log", "x:opt"]
        );
        // replace
        t.add("minecraft:planks", r##"{"replace":true,"values":["only:one"]}"##);
        assert_eq!(t.resolve("minecraft:planks"), vec!["only:one"]);
        assert_eq!(t.resolve("minecraft:logs")[0], "only:one");
        // cycle
        t.add("a:a", r##"{"values":["#a:b","i:1"]}"##);
        t.add("a:b", r##"{"values":["#a:a","i:2"]}"##);
        assert_eq!(t.resolve("a:a"), vec!["i:2", "i:1"]);
        assert!(t.resolve("missing:tag").is_empty());
    }
}
