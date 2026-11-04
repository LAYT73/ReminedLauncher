//! Ingredient / item-stack JSON parsing (all the shapes seen across vanilla + mods).

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Ingredient {
    pub items: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Stack {
    pub id: String,
    pub count: u32,
}

pub fn norm_id(s: &str) -> String {
    let s = s.trim();
    if s.contains(':') {
        s.to_string()
    } else {
        format!("minecraft:{s}")
    }
}

type Resolve<'a> = &'a dyn Fn(&str) -> Vec<String>;

fn from_str(s: &str, resolve: Resolve) -> Option<Ingredient> {
    let s = s.trim();
    if s.is_empty() || s == "minecraft:air" {
        return None;
    }
    if let Some(t) = s.strip_prefix('#') {
        let tag = norm_id(t);
        return Some(Ingredient { items: resolve(&tag), tag: Some(tag), count: None });
    }
    Some(Ingredient { items: vec![norm_id(s)], tag: None, count: None })
}

fn num_u32(v: Option<&Value>) -> Option<u32> {
    v.and_then(|x| x.as_u64().or_else(|| x.as_f64().map(|f| f as u64))).map(|n| n.min(u32::MAX as u64) as u32)
}

pub fn parse_ingredient(v: &Value, resolve: Resolve) -> Option<Ingredient> {
    match v {
        Value::String(s) => from_str(s, resolve),
        Value::Array(a) => {
            let parts: Vec<Ingredient> = a.iter().filter_map(|e| parse_ingredient(e, resolve)).collect();
            if parts.is_empty() {
                return None;
            }
            let mut items: Vec<String> = Vec::new();
            for p in &parts {
                for i in &p.items {
                    if !items.contains(i) {
                        items.push(i.clone());
                    }
                }
            }
            Some(Ingredient {
                items,
                tag: if parts.len() == 1 { parts[0].tag.clone() } else { None },
                count: parts.iter().find_map(|p| p.count),
            })
        }
        Value::Object(o) => {
            let count = num_u32(o.get("count").or_else(|| o.get("Count")));
            for key in ["item", "tag", "id", "items", "ingredient"] {
                let Some(inner) = o.get(key) else { continue };
                let mut r = match (key, inner) {
                    ("tag", Value::String(s)) => {
                        let tag = norm_id(s.trim_start_matches('#'));
                        Some(Ingredient { items: resolve(&tag), tag: Some(tag), count: None })
                    }
                    ("tag", _) => None,
                    (_, inner) => parse_ingredient(inner, resolve),
                };
                if let Some(ing) = r.as_mut() {
                    if count.is_some() {
                        ing.count = count;
                    }
                    return r;
                }
            }
            None
        }
        _ => None,
    }
}

pub fn parse_stack(v: &Value) -> Vec<Stack> {
    match v {
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() || s.starts_with('#') || s == "minecraft:air" {
                Vec::new()
            } else {
                vec![Stack { id: norm_id(s), count: 1 }]
            }
        }
        Value::Array(a) => a.iter().flat_map(parse_stack).collect(),
        Value::Object(o) => {
            let outer = num_u32(o.get("count").or_else(|| o.get("Count")).or_else(|| o.get("amount")));
            for key in ["id", "item"] {
                let Some(inner) = o.get(key) else { continue };
                let mut st = parse_stack(inner);
                if !st.is_empty() {
                    if let (Some(c), 1) = (outer, st.len()) {
                        st[0].count = c.max(1);
                    }
                    return st;
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn res(t: &str) -> Vec<String> {
        if t == "minecraft:planks" {
            vec!["minecraft:oak_planks".into(), "minecraft:birch_planks".into()]
        } else {
            vec![]
        }
    }

    #[test]
    fn ingredient_forms() {
        let r: Resolve = &res;
        let i = parse_ingredient(&json!("minecraft:stick"), r).unwrap();
        assert_eq!(i.items, vec!["minecraft:stick"]);
        let i = parse_ingredient(&json!("#minecraft:planks"), r).unwrap();
        assert_eq!(i.tag.as_deref(), Some("minecraft:planks"));
        assert_eq!(i.items.len(), 2);
        let i = parse_ingredient(&json!(["a:x", "#minecraft:planks", "a:y"]), r).unwrap();
        assert_eq!(i.items.len(), 4);
        assert!(i.tag.is_none());
        let i = parse_ingredient(&json!({"item": "a:x", "count": 3}), r).unwrap();
        assert_eq!((i.items, i.count), (vec!["a:x".to_string()], Some(3)));
        let i = parse_ingredient(&json!({"tag": "minecraft:planks"}), r).unwrap();
        assert_eq!(i.tag.as_deref(), Some("minecraft:planks"));
        let i = parse_ingredient(&json!({"id": "a:z"}), r).unwrap();
        assert_eq!(i.items, vec!["a:z"]);
        let i = parse_ingredient(&json!({"items": ["a:p", "a:q"]}), r).unwrap();
        assert_eq!(i.items, vec!["a:p", "a:q"]);
        let i = parse_ingredient(&json!({"item": {"item": "a:nested"}}), r).unwrap();
        assert_eq!(i.items, vec!["a:nested"]);
        assert!(parse_ingredient(&json!({"fluid": "x"}), r).is_none());
    }

    #[test]
    fn stack_forms() {
        assert_eq!(parse_stack(&json!("a:b")), vec![Stack { id: "a:b".into(), count: 1 }]);
        assert_eq!(parse_stack(&json!({"id": "a:b", "count": 4})), vec![Stack { id: "a:b".into(), count: 4 }]);
        assert_eq!(parse_stack(&json!({"item": "a:b", "count": 2})), vec![Stack { id: "a:b".into(), count: 2 }]);
        assert_eq!(parse_stack(&json!({"item": "a:b", "Count": 5})), vec![Stack { id: "a:b".into(), count: 5 }]);
        let multi = parse_stack(&json!([{"item": {"item": "a:c", "count": 3}}, "a:d"]));
        assert_eq!(multi, vec![Stack { id: "a:c".into(), count: 3 }, Stack { id: "a:d".into(), count: 1 }]);
        assert!(parse_stack(&json!({"tag": "a:t"})).is_empty());
    }
}
