//! Fabric `fabric:load_conditions` evaluation against the set of loaded mod ids.

use serde_json::Value;
use std::collections::HashSet;

fn str_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn eval_one(c: &Value, loaded: &HashSet<String>) -> bool {
    let Some(kind) = c.get("condition").and_then(|x| x.as_str()) else {
        return true;
    };
    match kind {
        "fabric:all_mods_loaded" => str_list(c.get("values")).iter().all(|m| loaded.contains(m)),
        "fabric:any_mods_loaded" => str_list(c.get("values")).iter().any(|m| loaded.contains(m)),
        "fabric:not" => c.get("value").map(|v| !eval_one(v, loaded)).unwrap_or(true),
        "fabric:and" => c
            .get("values")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().all(|x| eval_one(x, loaded)))
            .unwrap_or(true),
        "fabric:or" => c
            .get("values")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().any(|x| eval_one(x, loaded)))
            .unwrap_or(true),
        // fabric:true, fabric:tags_populated, fabric:registry_contains, unknown -> true
        _ => true,
    }
}

/// True when the recipe/tag JSON has no `fabric:load_conditions` or all of them hold.
pub fn load_conditions_ok(v: &Value, loaded: &HashSet<String>) -> bool {
    match v.get("fabric:load_conditions") {
        Some(Value::Array(a)) => a.iter().all(|c| eval_one(c, loaded)),
        Some(o @ Value::Object(_)) => eval_one(o, loaded),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn conditions() {
        let l = set(&["a", "b"]);
        assert!(load_conditions_ok(&json!({}), &l));
        assert!(load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:all_mods_loaded","values":["a","b"]}]}), &l));
        assert!(!load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:all_mods_loaded","values":["a","c"]}]}), &l));
        assert!(load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:any_mods_loaded","values":["c","b"]}]}), &l));
        assert!(!load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:not","value":{"condition":"fabric:all_mods_loaded","values":["a"]}}]}), &l));
        assert!(load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:or","values":[{"condition":"fabric:all_mods_loaded","values":["z"]},{"condition":"fabric:true"}]}]}), &l));
        assert!(!load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:and","values":[{"condition":"fabric:true"},{"condition":"fabric:all_mods_loaded","values":["z"]}]}]}), &l));
        assert!(load_conditions_ok(&json!({"fabric:load_conditions":[{"condition":"fabric:tags_populated"},{"condition":"weird:x"}]}), &l));
        assert!(load_conditions_ok(&json!({"neoforge:conditions":[{"type":"neoforge:false"}]}), &l));
    }
}
