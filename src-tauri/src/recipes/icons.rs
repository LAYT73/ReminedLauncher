//! Item icon resolution: item definition -> model chain -> flat / cube / cross.

use serde::Serialize;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

use super::ingredients::norm_id;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Gui {
    pub rotation: [f64; 3],
    pub translation: [f64; 3],
    pub scale: [f64; 3],
}

impl Default for Gui {
    /// vanilla block/block.json
    fn default() -> Self {
        Gui { rotation: [30.0, 225.0, 0.0], translation: [0.0; 3], scale: [0.625; 3] }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Face {
    pub t: String,
    pub uv: [f64; 4],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ElRot {
    pub origin: [f64; 3],
    pub axis: String,
    pub angle: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rescale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Element {
    pub from: [f64; 3],
    pub to: [f64; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<ElRot>,
    pub faces: BTreeMap<String, Face>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Layer {
    pub t: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum IconRef {
    Flat {
        t: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tint: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        layers: Option<Vec<Layer>>,
    },
    Model {
        gui: Gui,
        elements: Vec<Element>,
    },
    Cross {
        t: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tint: Option<u32>,
    },
}

impl IconRef {
    pub fn textures(&self) -> Vec<&str> {
        match self {
            IconRef::Flat { t, layers: Some(l), .. } => {
                let mut v: Vec<&str> = vec![t];
                v.extend(l.iter().map(|x| x.t.as_str()));
                v
            }
            IconRef::Flat { t, .. } | IconRef::Cross { t, .. } => vec![t],
            IconRef::Model { elements, .. } => {
                let mut v: Vec<&str> = elements.iter().flat_map(|e| e.faces.values().map(|f| f.t.as_str())).collect();
                v.sort_unstable();
                v.dedup();
                v
            }
        }
    }
}

const FLAT_PARENTS: &[&str] = &[
    "item/generated",
    "item/handheld",
    "item/handheld_rod",
    "item/handheld_mace",
    "builtin/generated",
];
const CROSS_PARENTS: &[&str] = &[
    "block/cross",
    "block/tinted_cross",
    "block/flower_pot_cross",
    "block/tinted_flower_pot_cross",
    "block/crop",
];
const MAX_ELEMENTS: usize = 64;
/// Entity textures are 64x64 in vanilla.
const ENTITY_TEX: f64 = 64.0;

const GRASS: u32 = 0x91BD59;
const FOLIAGE: u32 = 0x77AB2F;

fn strip_mc(s: &str) -> &str {
    s.strip_prefix("minecraft:").unwrap_or(s)
}

fn name_tint(path: &str) -> u32 {
    let last = path.rsplit('/').next().unwrap_or(path);
    if last.contains("leaves") {
        if last.starts_with("spruce") {
            0x619961
        } else if last.starts_with("birch") {
            0x80A755
        } else {
            FOLIAGE
        }
    } else if last.contains("lily_pad") {
        0x208030
    } else {
        GRASS
    }
}

/// Vanilla default face uv from element bounds.
fn default_uv(dir: &str, f: [f64; 3], t: [f64; 3]) -> [f64; 4] {
    let (x1, y1, z1, x2, y2, z2) = (f[0], f[1], f[2], t[0], t[1], t[2]);
    match dir {
        "down" => [x1, 16.0 - z2, x2, 16.0 - z1],
        "up" => [x1, z1, x2, z2],
        "north" => [16.0 - x2, 16.0 - y2, 16.0 - x1, 16.0 - y1],
        "south" => [x1, 16.0 - y2, x2, 16.0 - y1],
        "west" => [z1, 16.0 - y2, z2, 16.0 - y1],
        _ => [16.0 - z2, 16.0 - y2, 16.0 - z1, 16.0 - y1],
    }
}

/// Box using a 64x64 entity texture layout (texOffs u,v; size w,h,d). The entity is shown rotated
/// 180 degrees about Y (front toward +z), so entity north/south and west/east are swapped.
fn entity_box(tex: &str, uv: (f64, f64), pos: [f64; 3], size: [f64; 3], tint: Option<u32>, top_left: bool) -> Element {
    let (u, v) = uv;
    let (w, h, d) = (size[0], size[1], size[2]);
    let k = 16.0 / ENTITY_TEX;
    let face = |x1: f64, y1: f64, x2: f64, y2: f64| Face {
        t: tex.to_string(),
        uv: [x1 * k, y1 * k, x2 * k, y2 * k],
        rotation: None,
        tint,
    };
    let mut faces = BTreeMap::new();
    // physical top = right-hand region of the top row (flipped vertically), bottom = left-hand region
    if top_left {
        // shulker: outer top = left region of the top row, bottom = right region (flipped)
        faces.insert("up".into(), face(u + d, v, u + d + w, v + d));
        faces.insert("down".into(), face(u + d + w, v + d, u + d + 2.0 * w, v));
    } else {
        // chest: outer top = right region (flipped vertically), bottom = left region
        faces.insert("up".into(), face(u + d + w, v + d, u + d + 2.0 * w, v));
        faces.insert("down".into(), face(u + d, v, u + d + w, v + d));
    }
    faces.insert("south".into(), face(u + d, v + d, u + d + w, v + d + h));
    faces.insert("north".into(), face(u + 2.0 * d + w, v + d, u + 2.0 * d + 2.0 * w, v + d + h));
    faces.insert("east".into(), face(u, v + d, u + d, v + d + h));
    faces.insert("west".into(), face(u + d + w, v + d, u + 2.0 * d + w, v + d + h));
    Element {
        from: pos,
        to: [pos[0] + w, pos[1] + h, pos[2] + d],
        rotation: None,
        faces,
    }
}

/// Translation (px) and scale of a `minecraft:special` node's `transformation` (rotations other than
/// the entity 180-degree flip implied by negative scales are ignored).
fn special_transform(node: &Value) -> ([f64; 3], [f64; 3]) {
    let t = node.get("transformation");
    let arr = |k: &str, d: f64| -> [f64; 3] {
        t.and_then(|t| t.get(k)).and_then(|t| t.as_array()).map(|a| [0, 1, 2].map(|i| a.get(i).and_then(|x| x.as_f64()).unwrap_or(d))).unwrap_or([d; 3])
    };
    (arr("translation", 0.0).map(|x| x * 16.0), arr("scale", 1.0))
}

/// Entity-space box (px, y down, 64x64 texture, vanilla cuboid uv layout) baked through `p' = tr + sc * p/16*16`.
/// A negative scale axis mirrors that axis: min/max sides (and thus face labels) swap.
fn entity_box_t(tex: &str, uv: (f64, f64), pos: [f64; 3], size: [f64; 3], tint: Option<u32>, tr: [f64; 3], sc: [f64; 3]) -> Element {
    let (u, v) = uv;
    let (w, h, d) = (size[0], size[1], size[2]);
    let k = 16.0 / ENTITY_TEX;
    let face = |x1: f64, y1: f64, x2: f64, y2: f64| Face { t: tex.to_string(), uv: [x1 * k, y1 * k, x2 * k, y2 * k], rotation: None, tint };
    // raw faces by (axis, side): side 0 = min, 1 = max
    let raw = [
        (0, 0, face(u, v + d, u + d, v + d + h)),
        (0, 1, face(u + d + w, v + d, u + 2.0 * d + w, v + d + h)),
        (1, 0, face(u + d + w, v + d, u + d + 2.0 * w, v)),
        (1, 1, face(u + d, v, u + d + w, v + d)),
        (2, 0, face(u + d, v + d, u + d + w, v + d + h)),
        (2, 1, face(u + 2.0 * d + w, v + d, u + 2.0 * d + 2.0 * w, v + d + h)),
    ];
    let name = |axis: usize, side: usize| match (axis, side) {
        (0, 0) => "west",
        (0, _) => "east",
        (1, 0) => "down",
        (1, _) => "up",
        (2, 0) => "north",
        _ => "south",
    };
    let mut faces = BTreeMap::new();
    for (axis, side, f) in raw {
        let final_side = if sc[axis] < 0.0 { 1 - side } else { side };
        faces.insert(name(axis, final_side).to_string(), f);
    }
    let mut from = [0.0; 3];
    let mut to = [0.0; 3];
    for a in 0..3 {
        let p1 = tr[a] + sc[a] * pos[a];
        let p2 = tr[a] + sc[a] * (pos[a] + size[a]);
        from[a] = p1.min(p2);
        to[a] = p1.max(p2);
    }
    Element { from, to, rotation: None, faces }
}

fn dye_color(name: &str) -> u32 {
    match name {
        "orange" => 0xF9801D,
        "magenta" => 0xC74EBD,
        "light_blue" => 0x3AB3DA,
        "yellow" => 0xFED83D,
        "lime" => 0x80C71F,
        "pink" => 0xF38BAA,
        "gray" => 0x474F52,
        "light_gray" => 0x9D9D97,
        "cyan" => 0x169C9C,
        "purple" => 0x8932B8,
        "blue" => 0x3C44AA,
        "brown" => 0x835432,
        "green" => 0x5E7C16,
        "red" => 0xB02E26,
        "black" => 0x1D1D21,
        _ => 0xF9FFFE,
    }
}

/// `minecraft:composite` item model: every sub-model with its translation (in 1/16 blocks).
/// (model name, translation in 1/16 blocks, scale)
pub type Part = (String, [f64; 3], [f64; 3]);

fn transform_of(m: &Value) -> ([f64; 3], [f64; 3]) {
    let t = m.get("transformation");
    let arr = |k: &str, d: f64| -> [f64; 3] {
        t.and_then(|t| t.get(k)).and_then(|t| t.as_array()).map(|a| [0, 1, 2].map(|i| a.get(i).and_then(|x| x.as_f64()).unwrap_or(d))).unwrap_or([d; 3])
    };
    let tr = arr("translation", 0.0).map(|x| x * 16.0);
    let sc = arr("scale", 1.0);
    // negative scales (mirrors) are not baked for plain models
    (tr, if sc.iter().all(|x| *x > 0.0) { sc } else { [1.0; 3] })
}

/// Translation/scale of the first plain `minecraft:model` node that carries a `transformation`.
pub fn find_node_transform(v: &Value) -> Option<([f64; 3], [f64; 3])> {
    match v {
        Value::Object(o) => {
            if o.get("type").and_then(|t| t.as_str()).map(strip_mc) == Some("model") && o.contains_key("transformation") {
                return Some(transform_of(v));
            }
            o.iter().filter(|(k, _)| k.as_str() != "tints").find_map(|(_, x)| find_node_transform(x))
        }
        Value::Array(a) => a.iter().find_map(find_node_transform),
        _ => None,
    }
}

pub fn find_parts(v: &Value) -> Vec<Part> {
    match v {
        Value::Object(o) => {
            if o.get("type").and_then(|t| t.as_str()).map(strip_mc) == Some("composite") {
                if let Some(a) = o.get("models").and_then(|m| m.as_array()) {
                    return a
                        .iter()
                        .filter_map(|m| {
                            let name = find_model(m)?;
                            let (t, sc) = transform_of(m);
                            Some((name, t, sc))
                        })
                        .collect();
                }
            }
            o.iter().filter(|(k, _)| k.as_str() != "tints").map(|(_, x)| find_parts(x)).find(|l| !l.is_empty()).unwrap_or_default()
        }
        Value::Array(a) => a.iter().map(find_parts).find(|l| !l.is_empty()).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// The first `minecraft:special` node (fallback branches first).
pub fn find_special(v: &Value) -> Option<Value> {
    match v {
        Value::Object(o) => {
            if o.get("type").and_then(|t| t.as_str()).map(strip_mc) == Some("special") {
                if let Some(Value::Object(_)) = o.get("model") {
                    return Some(v.clone());
                }
            }
            for k in ["fallback", "on_false", "model", "models", "entries", "cases", "on_true"] {
                if let Some(r) = o.get(k).and_then(find_special) {
                    return Some(r);
                }
            }
            None
        }
        Value::Array(a) => a.iter().find_map(find_special),
        _ => None,
    }
}

/// First `"model"` string in an item definition (handles select / condition / range_dispatch / composite).
pub fn find_model(v: &Value) -> Option<String> {
    match v {
        Value::Object(o) => {
            if let Some(m) = o.get("model") {
                if let Value::String(s) = m {
                    return Some(s.clone());
                }
                if let Some(r) = find_model(m) {
                    return Some(r);
                }
            }
            if let Some(Value::String(b)) = o.get("base") {
                return Some(b.clone());
            }
            for k in ["on_false", "fallback", "base", "models", "entries", "cases", "on_true"] {
                if let Some(r) = o.get(k).and_then(find_model) {
                    return Some(r);
                }
            }
            o.iter().filter(|(k, _)| k.as_str() != "tints").find_map(|(_, x)| find_model(x))
        }
        Value::Array(a) => a.iter().find_map(find_model),
        _ => None,
    }
}

fn tint_from(t: &Value) -> Option<u32> {
    let ty = strip_mc(t.get("type")?.as_str()?);
    match ty {
        "constant" => match t.get("value")? {
            Value::Number(n) => Some((n.as_i64()? & 0xFFFFFF) as u32),
            Value::Array(a) if a.len() >= 3 => {
                let c = |i: usize| (a[i].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 255.0).round() as u32;
                Some(c(0) << 16 | c(1) << 8 | c(2))
            }
            _ => None,
        },
        "grass" => Some(GRASS),
        "foliage" => Some(FOLIAGE),
        "dry_foliage" => Some(0x7C5E37),
        // potion / dye / firework / map_color ...: use the declared default colour
        _ => t.get("default").and_then(|d| d.as_i64()).map(|n| (n & 0xFFFFFF) as u32),
    }
}

pub fn find_tint(v: &Value) -> Option<u32> {
    match v {
        Value::Object(o) => {
            if let Some(a) = o.get("tints").and_then(|t| t.as_array()) {
                if let Some(c) = a.first().and_then(tint_from) {
                    return Some(c);
                }
            }
            o.values().find_map(find_tint)
        }
        Value::Array(a) => a.iter().find_map(find_tint),
        _ => None,
    }
}

/// Per-tint-index colours of the first `tints` list in an item definition.
pub fn find_tints(v: &Value) -> Vec<Option<u32>> {
    match v {
        Value::Object(o) => {
            if let Some(a) = o.get("tints").and_then(|t| t.as_array()) {
                return a.iter().map(tint_from).collect();
            }
            o.values().map(find_tints).find(|l| !l.is_empty()).unwrap_or_default()
        }
        Value::Array(a) => a.iter().map(find_tints).find(|l| !l.is_empty()).unwrap_or_default(),
        _ => Vec::new(),
    }
}

pub struct IconCtx<'a> {
    pub defs: &'a HashMap<String, String>,
    pub models: &'a HashMap<String, String>,
    pub has_tex: &'a dyn Fn(&str) -> bool,
    cache: RefCell<HashMap<String, Option<Rc<Value>>>>,
    /// Face textures that could not be resolved/found (key or `#var` -> count); diagnostics only.
    pub missing: RefCell<BTreeMap<String, usize>>,
}

struct Resolved {
    keys: Vec<String>,
    models: Vec<Rc<Value>>,
    textures: BTreeMap<String, String>,
}

impl Resolved {
    fn tex(&self, var: &str) -> Option<String> {
        let mut cur = self.textures.get(var)?.clone();
        for _ in 0..12 {
            match cur.strip_prefix('#') {
                Some(r) => cur = self.textures.get(r)?.clone(),
                None => return Some(norm_id(&cur)),
            }
        }
        None
    }

    fn has_parent(&self, set: &[&str]) -> bool {
        self.keys.iter().any(|k| set.contains(&k.as_str()))
    }

    /// Resolved textures of faces that carry a `tintindex`.
    fn tinted_textures(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        for m in &self.models {
            let Some(els) = m.get("elements").and_then(|e| e.as_array()) else { continue };
            for e in els {
                let Some(faces) = e.get("faces").and_then(|f| f.as_object()) else { continue };
                for f in faces.values() {
                    if f.get("tintindex").is_some() {
                        if let Some(t) = f.get("texture").and_then(|t| t.as_str()) {
                            let t = match t.strip_prefix('#') {
                                Some(var) => self.tex(var),
                                None => Some(norm_id(t)),
                            };
                            out.extend(t);
                        }
                    }
                }
            }
        }
        out
    }
}

impl<'a> IconCtx<'a> {
    pub fn new(
        defs: &'a HashMap<String, String>,
        models: &'a HashMap<String, String>,
        has_tex: &'a dyn Fn(&str) -> bool,
    ) -> Self {
        Self { defs, models, has_tex, cache: RefCell::new(HashMap::new()), missing: RefCell::new(BTreeMap::new()) }
    }

    fn model(&self, key: &str) -> Option<Rc<Value>> {
        if let Some(c) = self.cache.borrow().get(key) {
            return c.clone();
        }
        let parsed = self
            .models
            .get(key)
            .and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok())
            .map(Rc::new);
        self.cache.borrow_mut().insert(key.to_string(), parsed.clone());
        parsed
    }

    fn chain(&self, name: &str) -> Option<Resolved> {
        let mut cur = norm_id(name);
        let mut keys = Vec::new();
        let mut models = Vec::new();
        for _ in 0..24 {
            keys.push(strip_mc(&cur).to_string());
            match self.model(&cur) {
                Some(m) => {
                    let parent = m.get("parent").and_then(|p| p.as_str()).map(norm_id);
                    models.push(m);
                    match parent {
                        Some(p) => cur = p,
                        None => break,
                    }
                }
                None => break,
            }
        }
        if models.is_empty() && !keys.iter().any(|k| k.starts_with("builtin/")) {
            return None;
        }
        let mut textures = BTreeMap::new();
        for m in models.iter().rev() {
            if let Some(t) = m.get("textures").and_then(|t| t.as_object()) {
                for (k, v) in t {
                    // 26.x: a texture may be {"sprite": "...", "force_translucent": true}
                    let s = v.as_str().or_else(|| v.get("sprite").and_then(|x| x.as_str()));
                    if let Some(s) = s {
                        textures.insert(k.clone(), s.to_string());
                    }
                }
            }
        }
        Some(Resolved { keys, models, textures })
    }

    fn first_tex(&self, r: &Resolved, vars: &[&str]) -> Option<String> {
        vars.iter().filter_map(|v| r.tex(v)).find(|t| (self.has_tex)(t))
    }

    fn any_tex(&self, r: &Resolved) -> Option<String> {
        r.textures.keys().filter_map(|k| r.tex(k)).find(|t| (self.has_tex)(t))
    }

    fn from_model(&self, model: &str, path: &str, def_tint: Option<u32>, tints: &[Option<u32>]) -> Option<IconRef> {
        let r = self.chain(model)?;
        if r.has_parent(FLAT_PARENTS) {
            let t = self.first_tex(&r, &["layer0"])?;
            let mut layers = Vec::new();
            for i in 0..8 {
                let Some(lt) = r.tex(&format!("layer{i}")).filter(|x| (self.has_tex)(x)) else {
                    if i == 0 {
                        continue;
                    }
                    break;
                };
                layers.push(Layer { t: lt, tint: tints.get(i).copied().flatten() });
            }
            let layers = (layers.len() > 1).then_some(layers);
            return Some(IconRef::Flat { t, tint: tints.first().copied().flatten().or(def_tint), layers });
        }
        let tinted = r.tinted_textures();
        let base_tint = def_tint.unwrap_or_else(|| name_tint(path));
        if r.has_parent(CROSS_PARENTS) {
            let t = self
                .first_tex(&r, &["cross", "plant", "crop", "texture"])
                .or_else(|| self.any_tex(&r))?;
            let tinted_any = !tinted.is_empty() || def_tint.is_some();
            return Some(IconRef::Cross { t, tint: tinted_any.then_some(base_tint) });
        }
        if r.keys.iter().any(|k| k == "builtin/entity") {
            return None;
        }
        self.model_icon(&[(model.to_string(), [0.0; 3], [1.0; 3])], path, def_tint, tints)
    }

    fn gui_of(&self, r: &Resolved) -> Gui {
        let mut g = Gui::default();
        let arr = |v: Option<&Value>| -> Option<[f64; 3]> {
            let a = v?.as_array()?;
            Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
        };
        for m in r.models.iter().rev() {
            if let Some(gui) = m.get("display").and_then(|d| d.get("gui")) {
                if let Some(x) = arr(gui.get("rotation")) {
                    g.rotation = x;
                }
                if let Some(x) = arr(gui.get("translation")) {
                    g.translation = x;
                }
                if let Some(x) = arr(gui.get("scale")) {
                    g.scale = x;
                }
            }
        }
        g
    }

    /// Real geometry: elements of the first model in each part's chain that defines them.
    fn model_icon(&self, parts: &[Part], path: &str, def_tint: Option<u32>, tints: &[Option<u32>]) -> Option<IconRef> {
        let base_tint = def_tint.unwrap_or_else(|| name_tint(path));
        let mut elements: Vec<Element> = Vec::new();
        let mut gui: Option<Gui> = None;
        for (name, off, sc) in parts {
            let Some(r) = self.chain(name) else { continue };
            let Some(els) = r.models.iter().find_map(|m| m.get("elements").and_then(|e| e.as_array())) else { continue };
            if gui.is_none() {
                gui = Some(self.gui_of(&r));
            }
            for e in els {
                if elements.len() >= MAX_ELEMENTS {
                    break;
                }
                if let Some(el) = self.element(e, &r, *off, *sc, base_tint, tints) {
                    elements.push(el);
                }
            }
        }
        if elements.is_empty() {
            return None;
        }
        Some(IconRef::Model { gui: gui.unwrap_or_default(), elements })
    }

    fn element(&self, e: &Value, r: &Resolved, off: [f64; 3], sc: [f64; 3], base_tint: u32, tints: &[Option<u32>]) -> Option<Element> {
        let v3 = |v: Option<&Value>| -> Option<[f64; 3]> {
            let a = v?.as_array()?;
            Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
        };
        let from = v3(e.get("from"))?;
        let to = v3(e.get("to"))?;
        let add = |a: [f64; 3]| [a[0] * sc[0] + off[0], a[1] * sc[1] + off[1], a[2] * sc[2] + off[2]];
        let mut faces = BTreeMap::new();
        for (dir, f) in e.get("faces")?.as_object()? {
            let Some(tex) = f.get("texture").and_then(|t| t.as_str()) else { continue };
            let key = match tex.strip_prefix('#') {
                Some(var) => r.tex(var),
                None => Some(norm_id(tex)),
            };
            let key = key.filter(|k| (self.has_tex)(k));
            let key = match key {
                Some(k) => Some(k),
                None => {
                    let why = match tex.strip_prefix('#') {
                        Some(var) => r.tex(var).unwrap_or_else(|| format!("#{var} (unresolved ref)")),
                        None => norm_id(tex),
                    };
                    *self.missing.borrow_mut().entry(why).or_default() += 1;
                    // avoid holes: fall back to the model's particle texture
                    r.tex("particle").filter(|k| (self.has_tex)(k))
                }
            };
            let Some(key) = key else { continue };
            let uv = f
                .get("uv")
                .and_then(|u| u.as_array())
                .filter(|a| a.len() == 4)
                .map(|a| [0, 1, 2, 3].map(|i| a[i].as_f64().unwrap_or(0.0)))
                .unwrap_or_else(|| default_uv(dir, from, to));
            let rotation = f.get("rotation").and_then(|x| x.as_i64()).map(|x| x.rem_euclid(360) as u16).filter(|x| *x != 0);
            let tint = f.get("tintindex").and_then(|x| x.as_i64()).and_then(|i| {
                tints.get(i.max(0) as usize).copied().flatten().or_else(|| (i == 0).then_some(base_tint))
            });
            faces.insert(dir.clone(), Face { t: key, uv, rotation, tint });
        }
        if faces.is_empty() {
            return None;
        }
        let rotation = e.get("rotation").and_then(|r| {
            Some(ElRot {
                origin: add(v3(r.get("origin"))?),
                axis: r.get("axis")?.as_str()?.to_string(),
                angle: r.get("angle")?.as_f64()?,
                rescale: r.get("rescale").and_then(|b| b.as_bool()).filter(|b| *b),
            })
        });
        Some(Element { from: add(from), to: add(to), rotation, faces })
    }

    fn entity_tex(&self, ns_path: &str, dir: &str, fallback: &[&str]) -> Option<String> {
        let (ns, p) = norm_id(ns_path).split_once(':').map(|(a, b)| (a.to_string(), b.to_string()))?;
        let cand = format!("{ns}:entity/{dir}/{p}");
        if (self.has_tex)(&cand) {
            return Some(cand);
        }
        fallback.iter().map(|f| format!("{ns}:entity/{dir}/{f}")).find(|c| (self.has_tex)(c))
    }

    fn template_gui(&self, model: &str) -> Gui {
        self.chain(model).map(|r| self.gui_of(&r)).unwrap_or_default()
    }

    /// Entity-rendered items (chests, shulker boxes, banners): synthesize boxes with the entity UV layout.
    fn special_icon(&self, sp: &Value, item_sp: &Value) -> Option<IconRef> {
        let ty = strip_mc(sp.get("type")?.as_str()?);
        let tex_name = sp.get("texture").and_then(|t| t.as_str());
        match ty {
            "chest" => {
                let t = self.entity_tex(tex_name.unwrap_or("normal"), "chest", &["normal"])?;
                let els = vec![
                    entity_box(&t, (0.0, 19.0), [1.0, 0.0, 1.0], [14.0, 10.0, 14.0], None, false),
                    entity_box(&t, (0.0, 0.0), [1.0, 9.0, 1.0], [14.0, 5.0, 14.0], None, false),
                    entity_box(&t, (0.0, 0.0), [7.0, 7.0, 15.0], [2.0, 4.0, 1.0], None, false),
                ];
                Some(IconRef::Model { gui: self.template_gui("minecraft:item/template_chest"), elements: els })
            }
            "shulker_box" => {
                let t = self.entity_tex(tex_name.unwrap_or("shulker"), "shulker", &["shulker"])?;
                let els = vec![
                    entity_box(&t, (0.0, 28.0), [0.0, 0.0, 0.0], [16.0, 8.0, 16.0], None, true),
                    entity_box(&t, (0.0, 0.0), [0.0, 4.0, 0.0], [16.0, 12.0, 16.0], None, true),
                ];
                Some(IconRef::Model { gui: self.template_gui("minecraft:item/template_shulker_box"), elements: els })
            }
            "banner" => {
                let color = sp.get("color").and_then(|c| c.as_str()).unwrap_or("white");
                let t = ["minecraft:entity/banner/base", "minecraft:entity/banner_base", "minecraft:entity/banner/banner_base"]
                    .iter()
                    .find(|c| (self.has_tex)(c))
                    .map(|s| s.to_string())?;
                let dye = dye_color(strip_mc(color));
                // Entity space (px, y down) + the item's `transformation` (scale [.667,-.667,-.667], translation [.5,0,.5]).
                let (tr, sc) = special_transform(item_sp);
                let els = vec![
                    entity_box_t(&t, (44.0, 0.0), [-1.0, -30.0, -1.0], [2.0, 42.0, 2.0], None, tr, sc),
                    entity_box_t(&t, (0.0, 42.0), [-10.0, -32.0, -1.0], [20.0, 2.0, 2.0], None, tr, sc),
                    entity_box_t(&t, (0.0, 0.0), [-10.0, -32.0, -2.0], [20.0, 40.0, 1.0], Some(dye), tr, sc),
                ];
                Some(IconRef::Model { gui: self.template_gui("minecraft:item/template_banner"), elements: els })
            }
            _ => None,
        }
    }

    /// builtin/entity & special models: try the block model, then a particle texture.
    fn block_fallback(&self, ns: &str, path: &str, item_model: &str) -> Option<IconRef> {
        let block = format!("{ns}:block/{path}");
        if let Some(i) = self.from_model(&block, path, None, &[]) {
            return Some(i);
        }
        for m in [block.as_str(), item_model] {
            if let Some(r) = self.chain(m) {
                if let Some(t) = self.first_tex(&r, &["particle"]) {
                    return Some(IconRef::Flat { t, tint: None, layers: None });
                }
            }
        }
        None
    }

    pub fn resolve(&self, id: &str) -> Option<IconRef> {
        let (ns, path) = id.split_once(':')?;
        let flat = || {
            let t = format!("{ns}:item/{path}");
            (self.has_tex)(&t).then_some(IconRef::Flat { t, tint: None, layers: None })
        };
        let Some(def) = self.defs.get(id) else { return flat() };
        let Ok(dv) = serde_json::from_str::<Value>(def.trim_start_matches('\u{feff}')) else {
            return flat();
        };
        let tints = find_tints(&dv);
        if let Some(sp) = find_special(&dv) {
            if let Some(i) = self.special_icon(sp.get("model").unwrap_or(&sp), &sp) {
                return Some(i);
            }
        }
        let parts = find_parts(&dv);
        if parts.len() <= 1 {
            if let (Some((off, sc)), Some(m)) = (find_node_transform(&dv), find_model(&dv)) {
                if off != [0.0; 3] || sc != [1.0; 3] {
                    if let Some(i) = self.model_icon(&[(m, off, sc)], path, find_tint(&dv), &tints) {
                        return Some(i);
                    }
                }
            }
        }
        if parts.len() > 1 {
            if let Some(i) = self.model_icon(&parts, path, find_tint(&dv), &tints) {
                return Some(i);
            }
        }
        let Some(model) = find_model(&dv) else { return flat() };
        self.from_model(&model, path, find_tint(&dv), &tints)
            .or_else(flat)
            .or_else(|| self.block_fallback(ns, path, &model))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn icon_kinds() {
        let defs = m(&[
            ("minecraft:stick", r#"{"model":{"type":"minecraft:model","model":"minecraft:item/stick"}}"#),
            ("minecraft:oak_planks", r#"{"model":{"type":"minecraft:model","model":"minecraft:block/oak_planks"}}"#),
            ("minecraft:oak_leaves", r#"{"model":{"type":"minecraft:model","model":"minecraft:block/oak_leaves","tints":[{"type":"minecraft:constant","value":-12012264}]}}"#),
            ("minecraft:grass_block", r#"{"model":{"type":"minecraft:model","model":"minecraft:block/grass_block","tints":[{"type":"minecraft:grass","downfall":1.0,"temperature":0.5}]}}"#),
            ("minecraft:poppy", r#"{"model":{"type":"minecraft:select","property":"x","cases":[{"when":"a","model":{"type":"minecraft:model","model":"minecraft:item/poppy"}}],"fallback":{"type":"minecraft:model","model":"minecraft:item/poppy"}}}"#),
            ("minecraft:chest", r#"{"model":{"type":"minecraft:special","base":"minecraft:item/chest","model":{"type":"minecraft:chest"}}}"#),
            ("minecraft:potion", r#"{"model":{"type":"minecraft:model","model":"minecraft:item/potion","tints":[{"type":"minecraft:potion","default":-13083194}]}}"#),
            ("x:slab", r#"{"model":{"type":"minecraft:model","model":"x:block/slab"}}"#),
            ("x:bed", r#"{"model":{"type":"minecraft:composite","models":[{"type":"minecraft:model","model":"x:block/bed_head"},{"type":"minecraft:model","model":"x:block/bed_foot","transformation":{"translation":[0.0,0.0,1.0]}}]}}"#),
            ("x:chest", r#"{"model":{"type":"minecraft:special","base":"minecraft:item/chest","model":{"type":"minecraft:chest","texture":"minecraft:normal"}}}"#),
            ("x:log", r#"{"model":{"type":"minecraft:model","model":"x:block/log"}}"#),
        ]);
        let models = m(&[
            ("minecraft:item/generated", r#"{"parent":"builtin/generated"}"#),
            ("minecraft:item/stick", r#"{"parent":"minecraft:item/handheld","textures":{"layer0":"minecraft:item/stick"}}"#),
            ("minecraft:item/handheld", r#"{"parent":"minecraft:item/generated"}"#),
            ("minecraft:block/cube_all", r##"{"parent":"minecraft:block/cube","textures":{"particle":"#all","down":"#all","up":"#all","north":"#all","east":"#all","south":"#all","west":"#all"}}"##),
            ("minecraft:block/cube", r##"{"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"up":{"texture":"#up"},"north":{"texture":"#north"}}}]}"##),
            ("minecraft:block/oak_planks", r#"{"parent":"minecraft:block/cube_all","textures":{"all":"minecraft:block/oak_planks"}}"#),
            ("minecraft:block/leaves", r##"{"parent":"block/block","textures":{"particle":"#all"},"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"up":{"texture":"#all","tintindex":0},"north":{"texture":"#all","tintindex":0}}}]}"##),
            ("minecraft:block/oak_leaves", r#"{"parent":"minecraft:block/leaves","textures":{"all":"minecraft:block/oak_leaves"}}"#),
            ("minecraft:block/grass_block", r##"{"parent":"minecraft:block/block","textures":{"particle":"minecraft:block/dirt","bottom":"minecraft:block/dirt","top":"minecraft:block/grass_block_top","side":"minecraft:block/grass_block_side"},"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"up":{"texture":"#top","tintindex":0},"north":{"texture":"#side"}}}]}"##),
            ("minecraft:item/potion", r#"{"parent":"minecraft:item/generated","textures":{"layer0":"minecraft:item/potion_overlay","layer1":"minecraft:item/potion"}}"#),
            ("minecraft:item/poppy", r#"{"parent":"minecraft:item/generated","textures":{"layer0":"minecraft:block/poppy"}}"#),
            ("minecraft:item/chest", r#"{"parent":"builtin/entity","textures":{"particle":"minecraft:block/oak_planks"}}"#),
            ("x:block/slab", r##"{"parent":"minecraft:block/block","textures":{"all":"x:block/log"},"elements":[{"from":[0,0,0],"to":[16,8,16],"faces":{"up":{"texture":"#all"}}}]}"##),
            ("x:block/bed_head", r##"{"parent":"minecraft:block/block","textures":{"t":"x:block/log"},"elements":[{"from":[0,3,0],"to":[16,9,16],"faces":{"up":{"texture":"#t"}}}]}"##),
            ("x:block/bed_foot", r##"{"parent":"minecraft:block/block","textures":{"t":"x:block/log"},"elements":[{"from":[0,3,0],"to":[16,9,16],"faces":{"up":{"texture":"#t"}}}]}"##),
            ("minecraft:block/block", r#"{"display":{"gui":{"rotation":[30,225,0],"translation":[0,0,0],"scale":[0.7,0.7,0.7]}}}"#),
            ("minecraft:item/template_chest", r#"{"display":{"gui":{"rotation":[30,45,0],"translation":[0,0,0],"scale":[0.625,0.625,0.625]}}}"#),
            ("x:block/log", r##"{"parent":"minecraft:block/cube_column","textures":{"end":"x:block/log_top","side":"x:block/log"}}"##),
            ("minecraft:block/cube_column", r##"{"parent":"minecraft:block/cube","textures":{"particle":"#side","down":"#end","up":"#end","north":"#side"}}"##),
        ]);
        let tex: HashSet<&str> = [
            "minecraft:item/stick", "minecraft:block/oak_planks", "minecraft:block/oak_leaves", "minecraft:block/dirt",
            "minecraft:block/grass_block_top", "minecraft:block/grass_block_side", "minecraft:block/poppy",
            "x:block/log_top", "x:block/log", "minecraft:entity/chest/normal", "minecraft:item/potion_overlay", "minecraft:item/potion",
        ].into_iter().collect();
        let has = |t: &str| tex.contains(t);
        let ctx = IconCtx::new(&defs, &models, &has);

        assert_eq!(ctx.resolve("minecraft:stick"), Some(IconRef::Flat { t: "minecraft:item/stick".into(), tint: None, layers: None }));
        let faces_of = |id: &str| match ctx.resolve(id).unwrap() {
            IconRef::Model { gui, elements } => (gui, elements),
            o => panic!("{o:?}"),
        };
        let (_, el) = faces_of("minecraft:oak_planks");
        assert_eq!(el.len(), 1);
        assert_eq!(el[0].faces["up"].t, "minecraft:block/oak_planks");
        let (_, el) = faces_of("minecraft:oak_leaves");
        assert_eq!(el[0].faces["up"].tint, Some(0x48B518));
        let (gui, el) = faces_of("minecraft:grass_block");
        assert_eq!(gui.rotation, [30.0, 225.0, 0.0]);
        assert_eq!(el[0].faces["up"].t, "minecraft:block/grass_block_top");
        assert_eq!(el[0].faces["up"].tint, Some(0x91BD59));
        assert_eq!(el[0].faces["north"].tint, None);
        assert_eq!(el[0].faces["north"].uv, [0.0, 0.0, 16.0, 16.0]); // default uv
        // slab: element to [16,8,16], gui from the parent chain
        let (gui, el) = faces_of("x:slab");
        assert_eq!((el[0].from, el[0].to), ([0.0; 3], [16.0, 8.0, 16.0]));
        assert_eq!(gui.rotation, [30.0, 225.0, 0.0]);
        assert_eq!(gui.scale, [0.7; 3]);
        // composite bed: two parts, foot translated by 16 along z -> spans z 0..32
        let (_, el) = faces_of("x:bed");
        assert_eq!(el.len(), 2);
        let (zmin, zmax) = el.iter().fold((99.0f64, 0.0f64), |(a, b), e| (a.min(e.from[2]), b.max(e.to[2])));
        assert_eq!((zmin, zmax), (0.0, 32.0));
        // special chest: base + lid + latch from entity texture
        let (gui, el) = faces_of("x:chest");
        assert_eq!(el.len(), 3);
        assert_eq!(gui.rotation, [30.0, 45.0, 0.0]);
        assert_eq!(el[0].faces["south"].uv, [1.0 * 14.0 * 0.25 + 0.0, (19.0 + 14.0) * 0.25, 28.0 * 0.25, (19.0 + 24.0) * 0.25]);
        assert_eq!(ctx.resolve("minecraft:poppy"), Some(IconRef::Flat { t: "minecraft:block/poppy".into(), tint: None, layers: None }));
        assert!(matches!(ctx.resolve("minecraft:chest"), Some(IconRef::Model { .. })));
        match ctx.resolve("x:log").unwrap() {
            IconRef::Model { elements, .. } => assert!(elements.iter().any(|e| e.faces.values().any(|f| f.t == "x:block/log_top"))),
            o => panic!("{o:?}"),
        }
        match ctx.resolve("minecraft:potion").unwrap() {
            IconRef::Flat { t, tint, layers: Some(l) } => {
                assert_eq!((t.as_str(), tint, l.len()), ("minecraft:item/potion_overlay", Some(0x385DC6), 2));
                assert_eq!((l[0].tint, l[1].tint), (Some(0x385DC6), None));
            }
            o => panic!("{o:?}"),
        }
        assert_eq!(ctx.resolve("zzz:nothing"), None);
    }
}
