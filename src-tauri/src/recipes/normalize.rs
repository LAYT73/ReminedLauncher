//! Recipe JSON -> contract `Recipe` (layouts, extras, workstation mapping).

use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::collections::HashSet;

use super::ingredients::{norm_id, parse_ingredient, parse_stack, Ingredient, Stack};

#[derive(Debug, Clone, Serialize, Default)]
pub struct Fluid {
    pub id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Extras {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<Number>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xp: Option<Number>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<Ingredient>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<Ingredient>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fluid: Option<Fluid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Extras {
    fn is_empty(&self) -> bool {
        self.time.is_none()
            && self.xp.is_none()
            && self.container.is_none()
            && self.tool.is_none()
            && self.fluid.is_none()
            && self.note.is_none()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Recipe {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(rename = "mod")]
    pub mod_id: String,
    pub station: Option<String>,
    pub layout: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<usize>,
    pub inputs: Vec<Option<Ingredient>>,
    pub outputs: Vec<Stack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extras: Option<Extras>,
}

type Resolve<'a> = &'a dyn Fn(&str) -> Vec<String>;

fn num(f: f64) -> Number {
    if f.fract() == 0.0 && f >= 0.0 && f < 1e15 {
        Number::from(f as u64)
    } else {
        Number::from_f64(f).unwrap_or_else(|| Number::from(0))
    }
}

fn num_of(v: Option<&Value>) -> Option<Number> {
    v.and_then(|x| x.as_f64()).map(num)
}

fn first_num(o: &Map<String, Value>, keys: &[&str]) -> Option<Number> {
    keys.iter().find_map(|k| num_of(o.get(*k)))
}

fn ing(o: &Map<String, Value>, key: &str, r: Resolve) -> Option<Ingredient> {
    o.get(key).and_then(|v| parse_ingredient(v, r))
}

fn outputs(o: &Map<String, Value>, keys: &[&str]) -> Vec<Stack> {
    for k in keys {
        if let Some(v) = o.get(*k) {
            let mut st = parse_stack(v);
            if !st.is_empty() {
                // legacy: `{"result": "id", "count": n}`
                if st.len() == 1 && v.is_string() {
                    if let Some(c) = o.get("count").and_then(|c| c.as_u64()) {
                        st[0].count = (c as u32).max(1);
                    }
                }
                return st;
            }
        }
    }
    Vec::new()
}

fn push_flat(out: &mut Vec<Option<Ingredient>>, v: &Value, plural: bool, r: Resolve) {
    if plural {
        match v {
            Value::Array(a) => {
                for e in a {
                    if let Some(i) = parse_ingredient(e, r) {
                        out.push(Some(i));
                    }
                }
            }
            other => {
                if let Some(i) = parse_ingredient(other, r) {
                    out.push(Some(i));
                }
            }
        }
    } else if let Some(i) = parse_ingredient(v, r) {
        out.push(Some(i));
    }
}

fn shaped(o: &Map<String, Value>, r: Resolve) -> Option<(usize, usize, Vec<Option<Ingredient>>)> {
    let pattern: Vec<&str> = o.get("pattern")?.as_array()?.iter().filter_map(|x| x.as_str()).collect();
    let key = o.get("key")?.as_object()?;
    let h = pattern.len();
    let w = pattern.iter().map(|r| r.chars().count()).max().unwrap_or(0);
    if h == 0 || w == 0 {
        return None;
    }
    let mut inputs = Vec::with_capacity(w * h);
    for row in &pattern {
        let chars: Vec<char> = row.chars().collect();
        for x in 0..w {
            let c = chars.get(x).copied().unwrap_or(' ');
            inputs.push(if c == ' ' {
                None
            } else {
                key.get(&c.to_string()).and_then(|v| parse_ingredient(v, r))
            });
        }
    }
    Some((w, h, inputs))
}

fn fluid(o: &Map<String, Value>, r: Resolve) -> Option<Fluid> {
    for k in ["base_fluid", "fluid", "tea_fluid"] {
        let Some(v) = o.get(k) else { continue };
        match v {
            Value::String(s) => return Some(Fluid { id: norm_id(s), amount: 1.0 }),
            Value::Object(f) => {
                let amount = f.get("amount").and_then(|a| a.as_f64()).unwrap_or(1.0);
                let id = f
                    .get("id")
                    .or_else(|| f.get("fluid"))
                    .and_then(|x| x.as_str())
                    .map(norm_id)
                    .or_else(|| {
                        f.get("ingredient")
                            .and_then(|i| parse_ingredient(i, r))
                            .and_then(|i| i.items.first().cloned())
                    });
                if let Some(id) = id {
                    return Some(Fluid { id, amount });
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse one recipe. `mod_id`/`station` are filled in later by the caller.
pub fn normalize(id: &str, v: &Value, resolve: Resolve) -> Option<Recipe> {
    let o = v.as_object()?;
    let ty = norm_id(o.get("type")?.as_str()?);
    let path = ty.split_once(':').map(|x| x.1).unwrap_or("").to_string();
    let is_mc = ty.starts_with("minecraft:");
    let mut layout = "process";
    let (mut w, mut h) = (None, None);
    let mut inputs: Vec<Option<Ingredient>> = Vec::new();
    let mut extras = Extras::default();
    let outs;

    if path == "smithing_trim" && is_mc {
        return None;
    }
    if let Some((rw, rh, inp)) = shaped(o, resolve) {
        layout = "shaped";
        w = Some(rw);
        h = Some(rh);
        inputs = inp;
        outs = outputs(o, &["result", "results", "output"]);
    } else if is_mc && path == "crafting_shapeless" {
        layout = "shapeless";
        if let Some(v) = o.get("ingredients") {
            push_flat(&mut inputs, v, true, resolve);
        }
        outs = outputs(o, &["result"]);
    } else if is_mc && path == "crafting_transmute" {
        layout = "shapeless";
        for k in ["input", "material"] {
            if let Some(i) = ing(o, k, resolve) {
                inputs.push(Some(i));
            }
        }
        outs = outputs(o, &["result"]);
    } else if is_mc && matches!(path.as_str(), "smelting" | "blasting" | "smoking" | "campfire_cooking") {
        layout = "cooking";
        inputs.push(ing(o, "ingredient", resolve));
        let default_time = match path.as_str() {
            "smelting" => 200.0,
            "campfire_cooking" => 600.0,
            _ => 100.0,
        };
        extras.time = Some(first_num(o, &["cookingtime"]).unwrap_or_else(|| num(default_time)));
        extras.xp = num_of(o.get("experience"));
        outs = outputs(o, &["result"]);
    } else if is_mc && path == "crafting_dye" {
        // special recipe with data: [target, dye] -> result
        layout = "shapeless";
        for k in ["target", "dye"] {
            if let Some(i) = ing(o, k, resolve) {
                inputs.push(Some(i));
            }
        }
        outs = outputs(o, &["result"]);
    } else if is_mc && path == "stonecutting" {
        layout = "stonecutting";
        inputs.push(ing(o, "ingredient", resolve));
        outs = outputs(o, &["result"]);
    } else if is_mc && path == "smithing_transform" {
        layout = "smithing";
        for k in ["template", "base", "addition"] {
            inputs.push(ing(o, k, resolve));
        }
        outs = outputs(o, &["result"]);
    } else {
        for (k, plural) in [
            ("ingredient", false),
            ("ingredients", true),
            ("input", false),
            ("inputs", true),
            ("base", false),
            ("addition", false),
            ("sherd", false),
            ("material", false),
        ] {
            if let Some(v) = o.get(k) {
                push_flat(&mut inputs, v, plural, resolve);
            }
        }
        outs = outputs(o, &["result", "results", "output", "outputs"]);
        extras.time = first_num(o, &["cookingtime", "time", "duration", "processing_time"]);
        extras.xp = num_of(o.get("experience"));
        extras.container = ing(o, "container", resolve).or_else(|| ing(o, "carrier", resolve));
        extras.tool = ing(o, "tool", resolve);
        extras.fluid = fluid(o, resolve);
        if let Some(c) = o.get("cut_count").and_then(|c| c.as_u64()) {
            extras.note = Some(format!("x{c}"));
        }
    }
    if outs.is_empty() || inputs.iter().all(|i| i.is_none()) {
        return None;
    }
    Some(Recipe {
        id: id.to_string(),
        ty,
        mod_id: String::new(),
        station: None,
        layout,
        w,
        h,
        inputs,
        outputs: outs,
        extras: if extras.is_empty() { None } else { Some(extras) },
    })
}

/// Workstation item for a recipe type (only if the item exists).
pub fn station_for(ty: &str, items: &HashSet<String>) -> Option<String> {
    let (ns, path) = ty.split_once(':')?;
    let has = |s: &str| items.contains(s).then(|| s.to_string());
    let direct = match (ns, path) {
        ("minecraft", p) if p.starts_with("crafting_") => Some("minecraft:crafting_table"),
        ("minecraft", "smelting") => Some("minecraft:furnace"),
        ("minecraft", "blasting") => Some("minecraft:blast_furnace"),
        ("minecraft", "smoking") => Some("minecraft:smoker"),
        ("minecraft", "campfire_cooking") => Some("minecraft:campfire"),
        ("minecraft", "stonecutting") => Some("minecraft:stonecutter"),
        ("minecraft", p) if p.starts_with("smithing_") => Some("minecraft:smithing_table"),
        ("farmersdelight", "cooking") => Some("farmersdelight:cooking_pot"),
        ("farmersdelight", "cutting") => Some("farmersdelight:cutting_board"),
        ("brewinandchewin", "fermenting") => Some("brewinandchewin:keg"),
        _ => None,
    };
    if let Some(d) = direct {
        return has(d);
    }
    if ns == "kaleidoscope_cookery" {
        if let Some(s) = has(ty) {
            return Some(s);
        }
        let alias = match path {
            "flex_pot" => "pot",
            "flex_stockpot" => "stockpot",
            p => p,
        };
        if let Some(s) = has(&format!("{ns}:{alias}")) {
            return Some(s);
        }
        for k in ["pot", "stockpot", "chopping_board", "steamer", "millstone", "teapot", "bamboo_tray"] {
            if path.contains(k) {
                if let Some(s) = has(&format!("{ns}:{k}")) {
                    return Some(s);
                }
            }
        }
        return None;
    }
    has(ty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn res(t: &str) -> Vec<String> {
        if t == "minecraft:planks" { vec!["minecraft:oak_planks".into()] } else { vec![] }
    }

    #[test]
    fn shaped_normalised() {
        let v = json!({
            "type": "minecraft:crafting_shaped",
            "pattern": ["# #", " # "],
            "key": {"#": "#minecraft:planks"},
            "result": {"id": "minecraft:bowl", "count": 4}
        });
        let r = normalize("minecraft:bowl", &v, &res).unwrap();
        assert_eq!((r.layout, r.w, r.h), ("shaped", Some(3), Some(2)));
        assert_eq!(r.inputs.len(), 6);
        assert!(r.inputs[0].is_some() && r.inputs[1].is_none() && r.inputs[2].is_some());
        assert!(r.inputs[3].is_none() && r.inputs[4].is_some());
        assert_eq!(r.outputs[0].count, 4);
        // foreign type with pattern+key is also shaped
        let v2 = json!({"type": "xercapaint:crafting_tagless_shaped", "pattern": ["a"], "key": {"a": "x:y"}, "result": "x:z"});
        assert_eq!(normalize("x:r", &v2, &res).unwrap().layout, "shaped");
    }

    #[test]
    fn other_layouts() {
        let v = json!({"type": "minecraft:smelting", "ingredient": "a:b", "result": {"id": "a:c"}, "experience": 0.7});
        let r = normalize("a:r", &v, &res).unwrap();
        let e = r.extras.unwrap();
        assert_eq!((r.layout, e.time.unwrap().as_u64()), ("cooking", Some(200)));
        assert!(normalize("a:r", &json!({"type": "minecraft:crafting_special_x"}), &res).is_none());
        assert!(normalize("a:r", &json!({"type": "minecraft:smithing_trim", "result": "a:b"}), &res).is_none());
        let v = json!({"type": "farmersdelight:cutting", "ingredients": [{"item": "a:x"}], "tool": {"tag": "c:knives"},
            "result": [{"item": {"item": "a:y", "count": 2}}]});
        let r = normalize("a:r", &v, &res).unwrap();
        assert_eq!((r.layout, r.inputs.len(), r.outputs[0].count), ("process", 1, 2));
        assert!(r.extras.unwrap().tool.is_some());
        let v = json!({"type": "minecraft:crafting_transmute", "input": "a:i", "material": "a:m", "result": "a:o"});
        let r = normalize("a:r", &v, &res).unwrap();
        assert_eq!((r.layout, r.inputs.len()), ("shapeless", 2));
    }

    #[test]
    fn stations() {
        let items: HashSet<String> = ["minecraft:crafting_table", "kaleidoscope_cookery:pot", "x:machine"].iter().map(|s| s.to_string()).collect();
        assert_eq!(station_for("minecraft:crafting_shaped", &items).as_deref(), Some("minecraft:crafting_table"));
        assert_eq!(station_for("minecraft:smelting", &items), None);
        assert_eq!(station_for("kaleidoscope_cookery:flex_pot", &items).as_deref(), Some("kaleidoscope_cookery:pot"));
        assert_eq!(station_for("x:machine", &items).as_deref(), Some("x:machine"));
        assert_eq!(station_for("x:none", &items), None);
    }
}
