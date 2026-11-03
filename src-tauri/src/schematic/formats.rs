//! Schematic format decoders -> flat block grid.

use super::nbt::{self, Tag};
use std::collections::HashMap;

pub const MAX_VOLUME: i64 = 16_000_000;
pub const MAX_PALETTE: usize = 65_535;

const AIR: &str = "minecraft:air";

#[derive(Debug, Clone)]
pub struct Decoded {
    /// x, y, z
    pub size: [i32; 3],
    pub palette: Vec<String>,
    /// index = x + z*sx + y*sx*sz
    pub blocks: Vec<u32>,
}

const LEGACY_ERR: &str = "Старый формат .schematic (до 1.13) не поддерживается — пересохраните в .schem или .litematic / Legacy .schematic is not supported";

fn too_big_err() -> String {
    format!(
        "Схематика слишком большая (максимум {} блоков) / Schematic is too large (max {} cells)",
        MAX_VOLUME, MAX_VOLUME
    )
}

fn palette_err() -> String {
    format!(
        "Слишком много типов блоков (максимум {}) / Too many block states (max {})",
        MAX_PALETTE, MAX_PALETTE
    )
}

fn check_size(size: [i64; 3]) -> Result<[i32; 3], String> {
    if size.iter().any(|&v| v <= 0) {
        return Err("Пустая схематика / Schematic is empty".into());
    }
    if size.iter().any(|&v| v > i32::MAX as i64) {
        return Err(too_big_err());
    }
    let vol = size[0]
        .checked_mul(size[1])
        .and_then(|v| v.checked_mul(size[2]))
        .ok_or_else(too_big_err)?;
    if vol > MAX_VOLUME {
        return Err(too_big_err());
    }
    Ok([size[0] as i32, size[1] as i32, size[2] as i32])
}

/// Canonicalise `name[a=b,c=d]` -> namespaced, props sorted.
pub fn canonical(raw: &str) -> String {
    let raw = raw.trim();
    let (name, props) = match raw.find('[') {
        Some(i) => (&raw[..i], raw[i + 1..].trim_end_matches(']')),
        None => (raw, ""),
    };
    let mut pairs: Vec<(String, String)> = props
        .split(',')
        .filter_map(|p| {
            let p = p.trim();
            if p.is_empty() {
                return None;
            }
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect();
    build_state(name, &mut pairs)
}

fn build_state(name: &str, pairs: &mut Vec<(String, String)>) -> String {
    let name = name.trim();
    let mut out = if name.contains(':') {
        name.to_string()
    } else {
        format!("minecraft:{name}")
    };
    if !pairs.is_empty() {
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        out.push('[');
        for (i, (k, v)) in pairs.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(k);
            out.push('=');
            out.push_str(v);
        }
        out.push(']');
    }
    out
}

fn tag_to_string(t: &Tag) -> String {
    match t {
        Tag::String(s) => s.clone(),
        other => other.as_i64().map(|v| v.to_string()).unwrap_or_default(),
    }
}

/// `{Name, Properties{..}}` compound -> canonical state.
fn state_from_compound(t: &Tag) -> Result<String, String> {
    let name = t
        .get("Name")
        .and_then(|n| n.as_str())
        .ok_or("Palette entry without Name")?;
    let mut pairs: Vec<(String, String)> = match t.get("Properties").and_then(|p| p.as_compound()) {
        Some(m) => m.iter().map(|(k, v)| (k.clone(), tag_to_string(v))).collect(),
        None => Vec::new(),
    };
    Ok(build_state(name, &mut pairs))
}

struct Builder {
    palette: Vec<String>,
    map: HashMap<String, u32>,
}

impl Builder {
    fn new() -> Self {
        let mut b = Builder { palette: Vec::new(), map: HashMap::new() };
        b.intern(AIR.to_string());
        b
    }
    fn intern(&mut self, s: String) -> u32 {
        if let Some(&i) = self.map.get(&s) {
            return i;
        }
        let i = self.palette.len() as u32;
        self.map.insert(s.clone(), i);
        self.palette.push(s);
        i
    }
    fn finish(self, size: [i32; 3], blocks: Vec<u32>) -> Result<Decoded, String> {
        if self.palette.len() > MAX_PALETTE {
            return Err(palette_err());
        }
        Ok(Decoded { size, palette: self.palette, blocks })
    }
}

// ---------- Sponge ----------

fn read_varints(data: &[u8], count: usize) -> Result<Vec<u32>, String> {
    let mut out = Vec::with_capacity(count.min(data.len()));
    let mut i = 0usize;
    while i < data.len() && out.len() < count {
        let mut v: u64 = 0;
        let mut shift = 0u32;
        loop {
            let b = *data.get(i).ok_or("Truncated BlockData")?;
            i += 1;
            v |= ((b & 0x7F) as u64) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return Err("Bad varint in BlockData".into());
            }
        }
        out.push(u32::try_from(v).map_err(|_| "Bad varint in BlockData")?);
    }
    if out.len() < count {
        return Err("BlockData is shorter than the schematic size".into());
    }
    Ok(out)
}

fn decode_sponge(root: &Tag) -> Result<Decoded, String> {
    // v3: everything under "Schematic".
    let (base, pal_tag, data_tag) = if let Some(s) = root.get("Schematic") {
        let blocks = s.get("Blocks").ok_or("Sponge v3: missing Blocks")?;
        (s, blocks.get("Palette"), blocks.get("Data"))
    } else {
        (root, root.get("Palette"), root.get("BlockData"))
    };
    let dim = |k: &str| -> Result<i64, String> {
        let t = base.get(k).ok_or_else(|| format!("Missing {k}"))?;
        Ok(match t {
            Tag::Short(v) => *v as u16 as i64,
            other => other.as_i64().ok_or_else(|| format!("Bad {k}"))? & 0xFFFF,
        })
    };
    let size = check_size([dim("Width")?, dim("Height")?, dim("Length")?])?;
    let pal = pal_tag
        .and_then(|p| p.as_compound())
        .ok_or("Sponge: missing Palette")?;
    if pal.len() > MAX_PALETTE {
        return Err(palette_err());
    }
    let data = data_tag
        .and_then(|d| d.as_byte_array())
        .ok_or("Sponge: missing block data")?;
    let count = size[0] as usize * size[1] as usize * size[2] as usize;
    let raw = read_varints(data, count)?;

    let mut b = Builder::new();
    let mut remap: HashMap<u32, u32> = HashMap::new();
    let mut entries: Vec<(u32, &String)> = Vec::with_capacity(pal.len());
    for (name, v) in pal {
        entries.push((v.as_i64().ok_or("Bad palette value")? as u32, name));
    }
    entries.sort();
    for (id, name) in entries {
        remap.insert(id, b.intern(canonical(name)));
    }
    let mut blocks = Vec::with_capacity(count);
    for v in raw {
        blocks.push(*remap.get(&v).ok_or("BlockData references unknown palette index")?);
    }
    b.finish(size, blocks)
}

// ---------- Litematica ----------

fn xyz(t: &Tag) -> Result<[i64; 3], String> {
    let g = |k: &str| {
        t.get(k)
            .and_then(|v| v.as_i64())
            .ok_or_else(|| format!("Litematic: missing {k}"))
    };
    Ok([g("x")?, g("y")?, g("z")?])
}

fn unpack(longs: &[i64], bits: u32, idx: usize) -> Result<u32, String> {
    let start = idx as u64 * bits as u64;
    let w = (start >> 6) as usize;
    let off = (start & 63) as u32;
    let lo = *longs.get(w).ok_or("Litematic: BlockStates too short")? as u64;
    let mut v = lo >> off;
    if off + bits > 64 {
        let hi = *longs.get(w + 1).ok_or("Litematic: BlockStates too short")? as u64;
        v |= hi << (64 - off);
    }
    Ok((v & ((1u64 << bits) - 1)) as u32)
}

fn decode_litematic(root: &Tag) -> Result<Decoded, String> {
    let regions = root
        .get("Regions")
        .and_then(|r| r.as_compound())
        .ok_or("Litematic: missing Regions")?;
    struct Reg<'a> {
        min: [i64; 3],
        abs: [i64; 3],
        tag: &'a Tag,
    }
    let mut regs: Vec<Reg> = Vec::new();
    for r in regions.values() {
        let pos = xyz(r.get("Position").ok_or("Litematic: region without Position")?)?;
        let sz = xyz(r.get("Size").ok_or("Litematic: region without Size")?)?;
        let mut min = [0i64; 3];
        let mut abs = [0i64; 3];
        for i in 0..3 {
            abs[i] = sz[i].checked_abs().ok_or_else(too_big_err)?;
            min[i] = if sz[i] < 0 {
                pos[i]
                    .checked_add(sz[i])
                    .and_then(|v| v.checked_add(1))
                    .ok_or_else(too_big_err)?
            } else {
                pos[i]
            };
            min[i].checked_add(abs[i]).ok_or_else(too_big_err)?;
        }
        if abs.iter().all(|&a| a > 0) {
            let vol = abs[0]
                .checked_mul(abs[1])
                .and_then(|v| v.checked_mul(abs[2]))
                .ok_or_else(too_big_err)?;
            if vol > MAX_VOLUME {
                return Err(too_big_err());
            }
        }
        if abs.iter().any(|&a| a == 0) {
            continue;
        }
        regs.push(Reg { min, abs, tag: r });
    }
    if regs.is_empty() {
        return Err("Пустая схематика / Schematic is empty".into());
    }
    let mut lo = [i64::MAX; 3];
    let mut hi = [i64::MIN; 3];
    for r in &regs {
        for i in 0..3 {
            lo[i] = lo[i].min(r.min[i]);
            hi[i] = hi[i].max(r.min[i] + r.abs[i]);
        }
    }
    let mut ext = [0i64; 3];
    for i in 0..3 {
        ext[i] = hi[i].checked_sub(lo[i]).ok_or_else(too_big_err)?;
    }
    let size = check_size(ext)?;
    let (sx, sz_) = (size[0] as usize, size[2] as usize);
    let mut b = Builder::new();
    let mut blocks = vec![0u32; sx * size[1] as usize * sz_];

    for r in &regs {
        let pal_list = r
            .tag
            .get("BlockStatePalette")
            .and_then(|p| p.as_list())
            .ok_or("Litematic: missing BlockStatePalette")?;
        if pal_list.len() > MAX_PALETTE {
            return Err(palette_err());
        }
        let mut remap = Vec::with_capacity(pal_list.len());
        for e in pal_list {
            remap.push(b.intern(state_from_compound(e)?));
        }
        if b.palette.len() > MAX_PALETTE {
            return Err(palette_err());
        }
        let longs = r
            .tag
            .get("BlockStates")
            .and_then(|l| l.as_long_array())
            .ok_or("Litematic: missing BlockStates")?;
        let n = pal_list.len().max(1);
        let bits = if n > 1 { 64 - ((n - 1) as u64).leading_zeros() } else { 0 }.max(2);
        let (ax, ay, az) = (r.abs[0] as usize, r.abs[1] as usize, r.abs[2] as usize);
        let off = [
            (r.min[0] - lo[0]) as usize,
            (r.min[1] - lo[1]) as usize,
            (r.min[2] - lo[2]) as usize,
        ];
        for y in 0..ay {
            for z in 0..az {
                for x in 0..ax {
                    let idx = x + z * ax + y * ax * az;
                    let v = unpack(longs, bits, idx)? as usize;
                    let g = *remap.get(v).ok_or("Litematic: palette index out of range")?;
                    if g != 0 {
                        let o = (x + off[0]) + (z + off[2]) * sx + (y + off[1]) * sx * sz_;
                        *blocks
                            .get_mut(o)
                            .ok_or("Litematic: region out of bounds")? = g;
                    }
                }
            }
        }
    }
    b.finish(size, blocks)
}

// ---------- Vanilla structure .nbt ----------

fn decode_structure(root: &Tag) -> Result<Decoded, String> {
    let sz = root
        .get("size")
        .and_then(|s| s.as_list())
        .filter(|l| l.len() == 3)
        .ok_or("Structure: missing size")?;
    let mut d = [0i64; 3];
    for i in 0..3 {
        d[i] = sz[i].as_i64().ok_or("Structure: bad size")?;
    }
    let size = check_size(d)?;
    let pal_list = root
        .get("palette")
        .or_else(|| {
            root.get("palettes")
                .and_then(|p| p.as_list())
                .and_then(|l| l.first())
        })
        .and_then(|p| p.as_list())
        .ok_or("Structure: missing palette")?;
    if pal_list.len() > MAX_PALETTE {
        return Err(palette_err());
    }
    let mut b = Builder::new();
    let mut remap = Vec::with_capacity(pal_list.len());
    for e in pal_list {
        remap.push(b.intern(state_from_compound(e)?));
    }
    let (sx, sy, sz_) = (size[0] as usize, size[1] as usize, size[2] as usize);
    let mut blocks = vec![0u32; sx * sy * sz_];
    let list = root
        .get("blocks")
        .and_then(|l| l.as_list())
        .ok_or("Structure: missing blocks")?;
    for e in list {
        let pos = e
            .get("pos")
            .and_then(|p| p.as_list())
            .filter(|l| l.len() == 3)
            .ok_or("Structure: bad block pos")?;
        let p: Vec<i64> = pos.iter().map(|t| t.as_i64().unwrap_or(-1)).collect();
        if p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= sx as i64 || p[1] >= sy as i64 || p[2] >= sz_ as i64 {
            continue;
        }
        let st = e.get("state").and_then(|s| s.as_i64()).ok_or("Structure: bad state")?;
        let g = *remap
            .get(st as usize)
            .ok_or("Structure: state index out of range")?;
        blocks[p[0] as usize + p[2] as usize * sx + p[1] as usize * sx * sz_] = g;
    }
    b.finish(size, blocks)
}

// ---------- dispatch ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Litematic,
    Sponge,
    Structure,
}

fn sniff(root: &Tag) -> Option<Kind> {
    if root.get("Regions").is_some() {
        Some(Kind::Litematic)
    } else if root.get("Schematic").is_some() || root.get("BlockData").is_some() {
        Some(Kind::Sponge)
    } else if root.get("blocks").is_some() && root.get("size").is_some() {
        Some(Kind::Structure)
    } else {
        None
    }
}

/// Decode a schematic file. `ext` is the lowercase extension (no dot).
/// Returns the decoded grid and the format id ("litematic"|"schem"|"nbt").
pub fn decode(ext: &str, data: &[u8]) -> Result<(Decoded, &'static str), String> {
    let (_, root) = nbt::parse(data)?;
    if matches!(root.get("Blocks"), Some(Tag::ByteArray(_))) && root.get("Materials").is_some() {
        return Err(LEGACY_ERR.into());
    }
    let by_ext = match ext {
        "litematic" => Some(Kind::Litematic),
        "schem" => Some(Kind::Sponge),
        "nbt" => Some(Kind::Structure),
        _ => None,
    };
    let kind = sniff(&root)
        .or(by_ext)
        .ok_or("Неизвестный формат схематики / Unknown schematic format")?;
    match kind {
        Kind::Litematic => decode_litematic(&root).map(|d| (d, "litematic")),
        Kind::Sponge => decode_sponge(&root).map(|d| (d, "schem")),
        Kind::Structure => decode_structure(&root).map(|d| (d, "nbt")),
    }
}

#[cfg(test)]
mod tests {
    use super::super::nbt::testutil::*;
    use super::*;

    fn pal_entry(out: &mut Vec<u8>, name_: &str, props: &[(&str, &str)]) {
        string(out, "Name", name_);
        if !props.is_empty() {
            compound(out, "Properties");
            for (k, v) in props {
                string(out, k, v);
            }
            end(out);
        }
        end(out);
    }

    #[test]
    fn canonical_sorts_and_namespaces() {
        assert_eq!(canonical("stone"), "minecraft:stone");
        assert_eq!(
            canonical("minecraft:oak_stairs[half=bottom,facing=north]"),
            "minecraft:oak_stairs[facing=north,half=bottom]"
        );
        assert_eq!(canonical("minecraft:stone[]"), "minecraft:stone");
    }

    #[test]
    fn sponge_v2_2x2x2() {
        let mut b = Vec::new();
        compound(&mut b, "Schematic");
        short(&mut b, "Width", 2);
        short(&mut b, "Height", 2);
        short(&mut b, "Length", 2);
        compound(&mut b, "Palette");
        int(&mut b, "minecraft:air", 0);
        int(&mut b, "minecraft:stone", 1);
        int(&mut b, "minecraft:oak_stairs[half=bottom,facing=north]", 2);
        end(&mut b);
        bytes(&mut b, "BlockData", &[1, 0, 0, 2, 0, 1, 0, 1]);
        end(&mut b);
        let (d, f) = decode("schem", &b).unwrap();
        assert_eq!(f, "schem");
        assert_eq!(d.size, [2, 2, 2]);
        assert_eq!(
            d.palette,
            vec![
                "minecraft:air".to_string(),
                "minecraft:stone".into(),
                "minecraft:oak_stairs[facing=north,half=bottom]".into()
            ]
        );
        let s = |n: &str| d.palette.iter().position(|p| p == n).unwrap() as u32;
        let (st, stairs) = (s("minecraft:stone"), 2u32);
        assert_eq!(d.blocks, vec![st, 0, 0, stairs, 0, st, 0, st]);
    }

    #[test]
    fn sponge_v3() {
        let mut b = Vec::new();
        compound(&mut b, "");
        compound(&mut b, "Schematic");
        short(&mut b, "Width", 1);
        short(&mut b, "Height", 1);
        short(&mut b, "Length", 2);
        compound(&mut b, "Blocks");
        compound(&mut b, "Palette");
        int(&mut b, "minecraft:dirt", 0);
        end(&mut b);
        bytes(&mut b, "Data", &[0, 0]);
        end(&mut b);
        end(&mut b);
        end(&mut b);
        let (d, _) = decode("schem", &b).unwrap();
        assert_eq!(d.size, [1, 1, 2]);
        assert_eq!(d.palette, vec!["minecraft:air", "minecraft:dirt"]);
        assert_eq!(d.blocks, vec![1, 1]);
    }

    fn pack(vals: &[u32], bits: u32) -> Vec<i64> {
        let total = vals.len() as u64 * bits as u64;
        let mut longs = vec![0u64; ((total + 63) / 64) as usize];
        for (i, &v) in vals.iter().enumerate() {
            let start = i as u64 * bits as u64;
            let (w, off) = ((start >> 6) as usize, (start & 63) as u32);
            longs[w] |= (v as u64) << off;
            if off + bits > 64 {
                longs[w + 1] |= (v as u64) >> (64 - off);
            }
        }
        longs.into_iter().map(|v| v as i64).collect()
    }

    fn region(out: &mut Vec<u8>, name_: &str, pos: [i32; 3], size: [i32; 3], pal: &[&str], vals: &[u32], bits: u32) {
        compound(out, name_);
        compound(out, "Position");
        int(out, "x", pos[0]);
        int(out, "y", pos[1]);
        int(out, "z", pos[2]);
        end(out);
        compound(out, "Size");
        int(out, "x", size[0]);
        int(out, "y", size[1]);
        int(out, "z", size[2]);
        end(out);
        list_head(out, "BlockStatePalette", 10, pal.len() as i32);
        for p in pal {
            pal_entry(out, p, &[]);
        }
        longs(out, "BlockStates", &pack(vals, bits));
        end(out);
    }

    #[test]
    fn litematic_spanning_long_boundary() {
        // 5 palette entries -> bits 3; 27 cells -> entry 21 spans longs 0/1.
        let pal = ["minecraft:air", "minecraft:stone", "minecraft:dirt", "minecraft:glass", "minecraft:sand"];
        let vals: Vec<u32> = (0..27).map(|i| (i % 5) as u32).collect();
        let mut b = Vec::new();
        compound(&mut b, "");
        compound(&mut b, "Regions");
        region(&mut b, "main", [0, 0, 0], [3, 3, 3], &pal, &vals, 3);
        end(&mut b);
        end(&mut b);
        let (d, f) = decode("litematic", &b).unwrap();
        assert_eq!(f, "litematic");
        assert_eq!(d.size, [3, 3, 3]);
        assert_eq!(d.palette.len(), 5);
        let got: Vec<u32> = d.blocks.clone();
        assert_eq!(got, vals);
    }

    #[test]
    fn litematic_negative_size_and_merge() {
        let mut b = Vec::new();
        compound(&mut b, "");
        compound(&mut b, "Regions");
        // spans x 4..=5 (pos 5, size -2)
        region(&mut b, "a", [5, 0, 0], [-2, 1, 1], &["minecraft:air", "minecraft:stone"], &[1, 0], 2);
        // x = 7
        region(&mut b, "b", [7, 0, 0], [1, 1, 1], &["minecraft:air", "minecraft:dirt"], &[1], 2);
        end(&mut b);
        end(&mut b);
        let (d, _) = decode("litematic", &b).unwrap();
        assert_eq!(d.size, [4, 1, 1]);
        let name = |i: usize| d.palette[d.blocks[i] as usize].clone();
        assert_eq!(name(0), "minecraft:stone");
        assert_eq!(name(1), "minecraft:air");
        assert_eq!(name(2), "minecraft:air");
        assert_eq!(name(3), "minecraft:dirt");
    }

    #[test]
    fn varint_overflow_rejected() {
        assert_eq!(read_varints(&[0xAC, 0x02], 1).unwrap(), vec![300]);
        assert_eq!(
            read_varints(&[0xFF, 0xFF, 0xFF, 0xFF, 0x0F], 1).unwrap(),
            vec![u32::MAX]
        );
        // 35-bit value does not fit u32.
        assert!(read_varints(&[0xFF, 0xFF, 0xFF, 0xFF, 0x7F], 1).is_err());
        // Too many continuation bytes.
        assert!(read_varints(&[0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01], 1).is_err());
    }

    #[test]
    fn litematic_overflow_guard() {
        let pal = ["minecraft:air", "minecraft:stone"];
        // Regions at opposite i32 extremes: extent exceeds limits.
        let mut b = Vec::new();
        compound(&mut b, "");
        compound(&mut b, "Regions");
        region(&mut b, "a", [i32::MIN, 0, 0], [1, 1, 1], &pal, &[1], 2);
        region(&mut b, "b", [i32::MAX, 0, 0], [1, 1, 1], &pal, &[1], 2);
        end(&mut b);
        end(&mut b);
        assert!(decode("litematic", &b).is_err());
        // Huge single region is rejected before any decoding.
        let mut b = Vec::new();
        compound(&mut b, "");
        compound(&mut b, "Regions");
        region(&mut b, "a", [0, 0, 0], [i32::MAX, i32::MAX, i32::MAX], &pal, &[1], 2);
        end(&mut b);
        end(&mut b);
        assert!(decode("litematic", &b).is_err());
    }

    #[test]
    fn structure_nbt() {
        let mut b = Vec::new();
        compound(&mut b, "");
        list_head(&mut b, "size", 3, 3);
        for v in [2i32, 1, 2] {
            b.extend_from_slice(&v.to_be_bytes());
        }
        list_head(&mut b, "palette", 10, 2);
        pal_entry(&mut b, "minecraft:stone", &[]);
        pal_entry(&mut b, "minecraft:lever", &[("powered", "true"), ("face", "wall")]);
        list_head(&mut b, "blocks", 10, 2);
        for (pos, st) in [([0i32, 0, 0], 0i32), ([1, 0, 1], 1)] {
            list_head(&mut b, "pos", 3, 3);
            for v in pos {
                b.extend_from_slice(&v.to_be_bytes());
            }
            int(&mut b, "state", st);
            end(&mut b);
        }
        end(&mut b);
        let (d, f) = decode("nbt", &b).unwrap();
        assert_eq!(f, "nbt");
        assert_eq!(d.size, [2, 1, 2]);
        assert_eq!(
            d.palette,
            vec!["minecraft:air", "minecraft:stone", "minecraft:lever[face=wall,powered=true]"]
        );
        assert_eq!(d.blocks, vec![1, 0, 0, 2]);
    }

    #[test]
    fn legacy_rejected() {
        let mut b = Vec::new();
        compound(&mut b, "Schematic");
        short(&mut b, "Width", 1);
        bytes(&mut b, "Blocks", &[1]);
        string(&mut b, "Materials", "Alpha");
        end(&mut b);
        let e = decode("schematic", &b).unwrap_err();
        assert!(e.contains("Legacy"));
    }
}
