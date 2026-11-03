//! Minimal big-endian NBT reader (tags 0-12).

use flate2::read::{GzDecoder, ZlibDecoder};
use std::collections::HashMap;
use std::io::Read;

const MAX_DEPTH: usize = 512;
/// Safety cap for decompressed payload (bytes).
const MAX_DECOMPRESSED: u64 = 256 << 20;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    String(String),
    List(Vec<Tag>),
    Compound(HashMap<String, Tag>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

#[allow(dead_code)]
impl Tag {
    pub fn get(&self, key: &str) -> Option<&Tag> {
        match self {
            Tag::Compound(m) => m.get(key),
            _ => None,
        }
    }
    pub fn as_compound(&self) -> Option<&HashMap<String, Tag>> {
        match self {
            Tag::Compound(m) => Some(m),
            _ => None,
        }
    }
    pub fn as_list(&self) -> Option<&[Tag]> {
        match self {
            Tag::List(l) => Some(l),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Tag::String(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Tag::Byte(v) => Some(*v as i64),
            Tag::Short(v) => Some(*v as i64),
            Tag::Int(v) => Some(*v as i64),
            Tag::Long(v) => Some(*v),
            Tag::Float(v) => Some(*v as i64),
            Tag::Double(v) => Some(*v as i64),
            _ => None,
        }
    }
    pub fn as_i32(&self) -> Option<i32> {
        self.as_i64().map(|v| v as i32)
    }
    pub fn as_byte_array(&self) -> Option<&[u8]> {
        match self {
            Tag::ByteArray(b) => Some(b),
            _ => None,
        }
    }
    pub fn as_long_array(&self) -> Option<&[i64]> {
        match self {
            Tag::LongArray(b) => Some(b),
            _ => None,
        }
    }
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).ok_or("NBT: overflow")?;
        if end > self.buf.len() {
            return Err("NBT: unexpected end of data".into());
        }
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn i16(&mut self) -> Result<i16, String> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn len(&mut self) -> Result<usize, String> {
        let n = self.i32()?;
        if n < 0 {
            return Ok(0);
        }
        Ok(n as usize)
    }
    fn string(&mut self) -> Result<String, String> {
        let n = self.i16()? as u16 as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }

    fn payload(&mut self, ty: u8, depth: usize) -> Result<Tag, String> {
        if depth > MAX_DEPTH {
            return Err("NBT: nesting too deep".into());
        }
        Ok(match ty {
            1 => Tag::Byte(self.u8()? as i8),
            2 => Tag::Short(self.i16()?),
            3 => Tag::Int(self.i32()?),
            4 => Tag::Long(self.i64()?),
            5 => Tag::Float(f32::from_bits(self.i32()? as u32)),
            6 => Tag::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len()?;
                Tag::ByteArray(self.take(n)?.to_vec())
            }
            8 => Tag::String(self.string()?),
            9 => {
                let et = self.u8()?;
                let n = self.len()?;
                if et == 0 && n > 0 {
                    return Err("NBT: list of End tags".into());
                }
                // Each element needs at least 1 byte (except empty lists), bound allocation.
                if n > self.buf.len().saturating_sub(self.pos) && et != 0 {
                    return Err("NBT: list length exceeds data".into());
                }
                let mut v = Vec::with_capacity(n.min(1 << 16));
                for _ in 0..n {
                    v.push(self.payload(et, depth + 1)?);
                }
                Tag::List(v)
            }
            10 => {
                let mut m = HashMap::new();
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.string()?;
                    let v = self.payload(t, depth + 1)?;
                    m.insert(name, v);
                }
                Tag::Compound(m)
            }
            11 => {
                let n = self.len()?;
                let raw = self.take(n.checked_mul(4).ok_or("NBT: overflow")?)?;
                Tag::IntArray(
                    raw.chunks_exact(4)
                        .map(|c| i32::from_be_bytes(c.try_into().unwrap()))
                        .collect(),
                )
            }
            12 => {
                let n = self.len()?;
                let raw = self.take(n.checked_mul(8).ok_or("NBT: overflow")?)?;
                Tag::LongArray(
                    raw.chunks_exact(8)
                        .map(|c| i64::from_be_bytes(c.try_into().unwrap()))
                        .collect(),
                )
            }
            other => return Err(format!("NBT: unknown tag type {other}")),
        })
    }
}

/// Decompress (gzip / zlib / raw) a buffer.
pub fn decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let kind = if data.len() >= 2 && data[0] == 0x1F && data[1] == 0x8B {
        "gzip"
    } else if data.len() >= 2 && data[0] == 0x78 && matches!(data[1], 0x01 | 0x5E | 0x9C | 0xDA) {
        "zlib"
    } else {
        return Ok(data.to_vec());
    };
    let limit = MAX_DECOMPRESSED + 1;
    let res = if kind == "gzip" {
        GzDecoder::new(data).take(limit).read_to_end(&mut out)
    } else {
        ZlibDecoder::new(data).take(limit).read_to_end(&mut out)
    };
    res.map_err(|e| format!("{kind}: {e}"))?;
    if out.len() as u64 > MAX_DECOMPRESSED {
        return Err("Файл слишком большой / File too large".into());
    }
    Ok(out)
}

/// Parse NBT (optionally compressed). Returns (root name, root tag).
pub fn parse(data: &[u8]) -> Result<(String, Tag), String> {
    let raw = decompress(data)?;
    let mut r = Reader { buf: &raw, pos: 0 };
    let ty = r.u8()?;
    if ty != 10 {
        return Err("NBT: root is not a compound".into());
    }
    let name = r.string()?;
    let tag = r.payload(10, 0)?;
    Ok((name, tag))
}

#[cfg(test)]
pub mod testutil {
    //! Tiny NBT writer for tests.
    pub fn name(out: &mut Vec<u8>, s: &str) {
        out.extend_from_slice(&(s.len() as u16).to_be_bytes());
        out.extend_from_slice(s.as_bytes());
    }
    pub fn head(out: &mut Vec<u8>, ty: u8, n: &str) {
        out.push(ty);
        name(out, n);
    }
    pub fn short(out: &mut Vec<u8>, n: &str, v: i16) {
        head(out, 2, n);
        out.extend_from_slice(&v.to_be_bytes());
    }
    pub fn int(out: &mut Vec<u8>, n: &str, v: i32) {
        head(out, 3, n);
        out.extend_from_slice(&v.to_be_bytes());
    }
    pub fn string(out: &mut Vec<u8>, n: &str, v: &str) {
        head(out, 8, n);
        name(out, v);
    }
    pub fn bytes(out: &mut Vec<u8>, n: &str, v: &[u8]) {
        head(out, 7, n);
        out.extend_from_slice(&(v.len() as i32).to_be_bytes());
        out.extend_from_slice(v);
    }
    pub fn longs(out: &mut Vec<u8>, n: &str, v: &[i64]) {
        head(out, 12, n);
        out.extend_from_slice(&(v.len() as i32).to_be_bytes());
        for x in v {
            out.extend_from_slice(&x.to_be_bytes());
        }
    }
    /// Start a compound (named); caller must push 0 to end.
    pub fn compound(out: &mut Vec<u8>, n: &str) {
        head(out, 10, n);
    }
    pub fn list_head(out: &mut Vec<u8>, n: &str, elem: u8, len: i32) {
        head(out, 9, n);
        out.push(elem);
        out.extend_from_slice(&len.to_be_bytes());
    }
    pub fn end(out: &mut Vec<u8>) {
        out.push(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use testutil::*;

    #[test]
    fn parses_basic_compound_and_depth_limit() {
        let mut b = Vec::new();
        compound(&mut b, "root");
        int(&mut b, "a", 5);
        short(&mut b, "b", -2);
        end(&mut b);
        let (n, t) = parse(&b).unwrap();
        assert_eq!(n, "root");
        assert_eq!(t.get("a").unwrap().as_i32(), Some(5));
        assert_eq!(t.get("b").unwrap().as_i32(), Some(-2));

        // deep nesting of lists
        let mut d = vec![10, 0, 0, 9, 0, 1, b'x'];
        for _ in 0..600 {
            d.push(9);
            d.extend_from_slice(&1i32.to_be_bytes());
        }
        let e = parse(&d).unwrap_err();
        assert!(e.contains("too deep"), "{e}");
    }
}
