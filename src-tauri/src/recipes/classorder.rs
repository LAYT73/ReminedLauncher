//! Minimal Java class-file reader: registration order of `net.minecraft.world.item.Items` fields
//! (the order of `putstatic` in `<clinit>`), i.e. the vanilla item registry order, without launching the game.

use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

const ITEMS_CLASS: &str = "net/minecraft/world/item/Items";

struct R<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> R<'a> {
    fn u1(&mut self) -> Option<u32> {
        let v = *self.b.get(self.p)?;
        self.p += 1;
        Some(v as u32)
    }
    fn u2(&mut self) -> Option<u32> {
        Some(self.u1()? << 8 | self.u1()?)
    }
    fn u4(&mut self) -> Option<u32> {
        Some(self.u2()? << 16 | self.u2()?)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        self.p = self.p.checked_add(n)?;
        (self.p <= self.b.len()).then_some(())
    }
}

#[derive(Clone)]
enum Cp {
    None,
    Utf8(String),
    Class(u32),
    Ref(u32, u32), // field/method ref: class idx, name&type idx
    Nat(u32), // name idx
}

/// Operand length of an opcode (excluding the opcode byte); `None` for variable-length ones.
fn operand_len(op: u8) -> Option<usize> {
    Some(match op {
        0x10 | 0x12 | 0x15..=0x19 | 0x36..=0x3a | 0xa9 | 0xbc => 1,
        0x11 | 0x13 | 0x14 | 0x84 | 0x99..=0xa8 | 0xb2..=0xb8 | 0xbb | 0xbd | 0xc0 | 0xc1 | 0xc6 | 0xc7 => 2,
        0xc5 => 3,
        0xb9 | 0xba | 0xc8 | 0xc9 => 4,
        0xaa | 0xab | 0xc4 => return None,
        _ => 0,
    })
}

/// Field names (lower-cased) in `putstatic` order within `<clinit>` of the Items class.
pub fn items_order_from_class(bytes: &[u8]) -> Option<Vec<String>> {
    let mut r = R { b: bytes, p: 0 };
    if r.u4()? != 0xCAFEBABE {
        return None;
    }
    r.skip(4)?;
    let n = r.u2()? as usize;
    let mut cp: Vec<Cp> = vec![Cp::None; n];
    let mut i = 1;
    while i < n {
        let tag = r.u1()?;
        match tag {
            1 => {
                let len = r.u2()? as usize;
                let s = bytes.get(r.p..r.p + len)?;
                cp[i] = Cp::Utf8(String::from_utf8_lossy(s).into_owned());
                r.skip(len)?;
            }
            3 | 4 => r.skip(4)?,
            5 | 6 => {
                r.skip(8)?;
                i += 1;
            }
            7 => cp[i] = Cp::Class(r.u2()?),
            8 | 16 | 19 | 20 => r.skip(2)?,
            9..=11 => {
                let (a, b) = (r.u2()?, r.u2()?);
                cp[i] = Cp::Ref(a, b);
            }
            12 => {
                let (a, _) = (r.u2()?, r.u2()?);
                cp[i] = Cp::Nat(a);
            }
            15 => r.skip(3)?,
            17 | 18 => r.skip(4)?,
            _ => return None,
        }
        i += 1;
    }
    let utf = |idx: u32| match cp.get(idx as usize) {
        Some(Cp::Utf8(s)) => Some(s.as_str()),
        _ => None,
    };
    r.skip(6)?; // access, this, super
    let ni = r.u2()? as usize;
    r.skip(ni * 2)?;
    // fields
    let nf = r.u2()? as usize;
    for _ in 0..nf {
        r.skip(6)?;
        let na = r.u2()?;
        for _ in 0..na {
            r.skip(2)?;
            let l = r.u4()? as usize;
            r.skip(l)?;
        }
    }
    let nm = r.u2()? as usize;
    for _ in 0..nm {
        r.skip(2)?;
        let name = utf(r.u2()?)?.to_string();
        r.skip(2)?;
        let na = r.u2()?;
        for _ in 0..na {
            let an = utf(r.u2()?)?.to_string();
            let len = r.u4()? as usize;
            let end = r.p + len;
            if name == "<clinit>" && an == "Code" {
                r.skip(4)?; // max_stack, max_locals
                let clen = r.u4()? as usize;
                let code = bytes.get(r.p..r.p + clen)?;
                return walk(code, &cp);
            }
            r.p = end;
        }
    }
    None
}

fn walk(code: &[u8], cp: &[Cp]) -> Option<Vec<String>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut pc = 0usize;
    let be2 = |at: usize| -> Option<usize> { Some((*code.get(at)? as usize) << 8 | *code.get(at + 1)? as usize) };
    let be4 = |at: usize| -> Option<i64> {
        let mut v: i64 = 0;
        for k in 0..4 {
            v = v << 8 | *code.get(at + k)? as i64;
        }
        Some(v as i32 as i64)
    };
    while pc < code.len() {
        let op = code[pc];
        if op == 0xb3 {
            let idx = be2(pc + 1)?;
            if let Some(Cp::Ref(ci, nt)) = cp.get(idx) {
                let cls = match cp.get(*ci as usize) {
                    Some(Cp::Class(n)) => match cp.get(*n as usize) {
                        Some(Cp::Utf8(s)) => s.as_str(),
                        _ => "",
                    },
                    _ => "",
                };
                if cls == ITEMS_CLASS {
                    if let Some(Cp::Nat(n)) = cp.get(*nt as usize) {
                        if let Some(Cp::Utf8(name)) = cp.get(*n as usize) {
                            let l = name.to_lowercase();
                            if seen.insert(l.clone()) {
                                out.push(l);
                            }
                        }
                    }
                }
            }
        }
        pc += 1 + match operand_len(op) {
            Some(n) => n,
            None => match op {
                0xc4 => {
                    if *code.get(pc + 1)? == 0x84 { 5 } else { 3 }
                }
                0xaa => {
                    let base = (pc + 4) & !3;
                    let lo = be4(base + 4)?;
                    let hi = be4(base + 8)?;
                    let n = (hi - lo + 1).max(0) as usize;
                    base + 12 + n * 4 - (pc + 1)
                }
                _ => {
                    let base = (pc + 4) & !3;
                    let n = be4(base + 4)?.max(0) as usize;
                    base + 8 + n * 8 - (pc + 1)
                }
            },
        };
    }
    Some(out)
}

pub fn items_order(client_jar: &Path) -> Vec<String> {
    let Ok(f) = std::fs::File::open(client_jar) else { return Vec::new() };
    let Ok(mut ar) = zip::ZipArchive::new(f) else { return Vec::new() };
    let Ok(mut e) = ar.by_name(&format!("{ITEMS_CLASS}.class")) else { return Vec::new() };
    let mut b = Vec::new();
    if e.read_to_end(&mut b).is_err() {
        return Vec::new();
    }
    items_order_from_class(&b).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn real_jar_order() {
        let jar = std::path::PathBuf::from(
            "/Users/macbook/Desktop/Fun/Remined Launcher/packs/vanillapro/VanillaPro.jar",
        );
        let o = items_order(&jar);
        println!("{} items; first: {:?}", o.len(), &o[..12.min(o.len())]);
        let pos = |n: &str| o.iter().position(|x| x == n).unwrap();
        assert!(pos("stone") < pos("granite") && pos("granite") < pos("polished_granite") && pos("polished_granite") < pos("diorite"));
        assert!(o.len() > 1000);
    }
}
