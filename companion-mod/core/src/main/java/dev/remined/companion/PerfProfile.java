package dev.remined.companion;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pack-owned config/remined-performance-profile.json: presets and the toggles of the Performance tab. */
final class PerfProfile {
    static final String SHADERS = "shaders";
    static final String DH = "dh";
    static final String DH_RADIUS = "dh_radius";
    static final String OPTION = "option";
    static final String PACKS = "packs";
    static final String MODS = "mods";
    static final String CONFIG = "config";

    /** One step of a config item: a file edit, a reflection set or call, a resource reload, or (probe) a get. */
    static final class Op {
        static final String FILE = "file";
        static final String SET = "set";
        static final String CALL = "call";
        static final String GET = "get";
        static final String RELOAD = "reload";
        static final String PACKS = "packs";

        String type;
        String file;
        String format;
        String key;
        String path;
        Object value;
        List<String> ids = new ArrayList<>();
    }

    static final class Item {
        String id;
        String kind;
        Map<String, String> name;
        Map<String, String> hint;
        int impact = 1;
        String pack;
        String option;
        List<Object> values = new ArrayList<>();
        List<Map<String, String>> labels = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        List<Op> on = new ArrayList<>();
        List<Op> off = new ArrayList<>();
        Op probe;

        /** True when the control is an on/off switch, false for a choice of values. */
        boolean toggle() {
            return SHADERS.equals(kind) || DH.equals(kind) || PACKS.equals(kind) || MODS.equals(kind)
                || CONFIG.equals(kind) || (OPTION.equals(kind) && values.isEmpty());
        }

        boolean restart() {
            return MODS.equals(kind);
        }
    }

    static final class Preset {
        String id;
        Map<String, String> name;
        Map<String, Object> values = new LinkedHashMap<>();
    }

    static final class Section {
        Map<String, String> name;
        List<Item> items = new ArrayList<>();
    }

    String defaultPreset;
    final List<Preset> presets = new ArrayList<>();
    final List<Section> sections = new ArrayList<>();

    /** Parsed profile, or null when the file is absent or invalid. */
    static PerfProfile load(Path file) {
        try {
            if (!Files.isRegularFile(file)) return null;
            return parse(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
        } catch (Throwable e) {
            return null;
        }
    }

    /** Throws on invalid input. Unknown item kinds are skipped; a profile without any item is invalid. */
    static PerfProfile parse(String text) {
        Map<String, Object> root = Bridge.Json.parse(text);
        if (Protocol.num(root, "version", 0) != 1) throw new IllegalArgumentException("version");
        PerfProfile p = new PerfProfile();
        p.defaultPreset = Protocol.str(root, "defaultPreset");
        Set<String> seen = new HashSet<>();
        for (Object o : list(root.get("sections"))) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> sm = Protocol.asMap(o);
            Section s = new Section();
            s.name = loc(sm.get("name"));
            for (Object io : list(sm.get("items"))) {
                if (!(io instanceof Map)) continue;
                Item it = item(Protocol.asMap(io));
                if (it != null && seen.add(it.id)) s.items.add(it);
            }
            if (!s.items.isEmpty()) p.sections.add(s);
        }
        if (p.sections.isEmpty()) throw new IllegalArgumentException("no items");
        for (Object o : list(root.get("presets"))) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> pm = Protocol.asMap(o);
            String id = Protocol.str(pm, "id");
            if (id == null || id.isEmpty()) continue;
            Preset pr = new Preset();
            pr.id = id;
            pr.name = loc(pm.get("name"));
            Object vals = pm.get("values");
            if (vals instanceof Map) {
                for (Map.Entry<String, Object> e : Protocol.asMap(vals).entrySet()) {
                    Item it = p.item(e.getKey());
                    if (it != null && valid(it, e.getValue())) pr.values.put(e.getKey(), norm(e.getValue()));
                }
            }
            p.presets.add(pr);
        }
        return p;
    }

    private static Item item(Map<String, Object> m) {
        String id = Protocol.str(m, "id");
        String kind = Protocol.str(m, "kind");
        String os = Protocol.str(m, "os");
        if (os != null && !os.isEmpty()
            && !System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).contains(os.toLowerCase(java.util.Locale.ROOT))) return null;
        if (id == null || id.isEmpty() || kind == null) return null;
        Item it = new Item();
        it.id = id;
        it.kind = kind;
        it.name = loc(m.get("name"));
        it.hint = loc(m.get("hint"));
        it.impact = (int) Math.max(1, Math.min(3, Protocol.num(m, "impact", 1)));
        if (SHADERS.equals(kind)) {
            it.pack = Protocol.str(m, "pack");
            if (it.pack != null && it.pack.isEmpty()) it.pack = null;
        } else if (DH.equals(kind)) {
            return it;
        } else if (DH_RADIUS.equals(kind)) {
            for (Object v : list(m.get("values"))) {
                if (v instanceof Number) it.values.add(norm(v));
            }
            if (it.values.isEmpty()) return null;
        } else if (OPTION.equals(kind)) {
            it.option = Protocol.str(m, "option");
            if (it.option == null) return null;
            for (Object v : list(m.get("values"))) {
                if (v instanceof Number || v instanceof String) it.values.add(norm(v));
            }
            for (Object l : list(m.get("labels"))) it.labels.add(loc(l));
        } else if (PACKS.equals(kind) || MODS.equals(kind)) {
            for (Object v : list(m.get(PACKS.equals(kind) ? "packs" : "mods"))) {
                if (v instanceof String) it.ids.add((String) v);
            }
            if (it.ids.isEmpty()) return null;
        } else if (CONFIG.equals(kind)) {
            for (Object o : list(m.get("on"))) addOp(it.on, o);
            for (Object o : list(m.get("off"))) addOp(it.off, o);
            if (it.on.isEmpty() && it.off.isEmpty()) return null;
            List<Op> probe = new ArrayList<>();
            addProbe(probe, m.get("probe"));
            if (!probe.isEmpty()) it.probe = probe.get(0);
        } else if (!SHADERS.equals(kind)) {
            return null;
        }
        return it;
    }

    private static void addOp(List<Op> out, Object o) {
        if (!(o instanceof Map)) return;
        Map<String, Object> m = Protocol.asMap(o);
        Op op = new Op();
        if (m.get("file") instanceof String) {
            op.type = Op.FILE;
            op.file = Protocol.str(m, "file");
            op.format = Protocol.str(m, "format");
            op.key = Protocol.str(m, "key");
            op.value = m.get("value");
            if (op.format == null || op.key == null) return;
        } else if (m.get("set") instanceof String) {
            op.type = Op.SET;
            op.path = Protocol.str(m, "set");
            op.value = m.get("value");
        } else if (m.get("call") instanceof String) {
            op.type = Op.CALL;
            op.path = Protocol.str(m, "call");
        } else if (m.get("packs") instanceof List) {
            op.type = Op.PACKS;
            for (Object id : list(m.get("packs"))) {
                if (id instanceof String) op.ids.add((String) id);
            }
            op.value = m.get("value");
            if (op.ids.isEmpty()) return;
        } else if ("resources".equals(m.get("reload"))) {
            op.type = Op.RELOAD;
        } else {
            return;
        }
        out.add(op);
    }

    private static void addProbe(List<Op> out, Object o) {
        if (!(o instanceof Map)) return;
        Map<String, Object> m = Protocol.asMap(o);
        if (m.get("get") instanceof String) {
            Op op = new Op();
            op.type = Op.GET;
            op.path = Protocol.str(m, "get");
            op.value = m.get("equals");
            out.add(op);
        } else {
            addOp(out, o);
            if (!out.isEmpty() && !Op.FILE.equals(out.get(0).type)) out.clear();
        }
    }

    private static boolean valid(Item it, Object v) {
        if (it.toggle()) return v instanceof Boolean;
        for (Object o : it.values) {
            if (same(o, v)) return true;
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : Collections.<Object>emptyList();
    }

    private static Map<String, String> loc(Object o) {
        Map<String, String> out = new HashMap<>();
        if (o instanceof Map) {
            for (Map.Entry<String, Object> e : Protocol.asMap(o).entrySet()) {
                if (e.getValue() instanceof String) out.put(e.getKey(), (String) e.getValue());
            }
        } else if (o instanceof String) {
            out.put("en", (String) o);
        }
        return out;
    }

    /** Text for lang ("ru", "en"), falling back to en, then anything. Empty when there is none. */
    static String text(Map<String, String> m, String lang) {
        if (m == null || m.isEmpty()) return "";
        String s = m.get(lang);
        if (s == null) s = m.get("en");
        if (s == null) s = m.values().iterator().next();
        return s;
    }

    /** Numbers become Long (whole) or Double so values compare predictably. */
    static Object norm(Object v) {
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return Long.valueOf((long) d);
            return Double.valueOf(d);
        }
        return v;
    }

    static boolean same(Object a, Object b) {
        if (a instanceof Number && b instanceof Number) {
            return Math.abs(((Number) a).doubleValue() - ((Number) b).doubleValue()) < 1e-6;
        }
        return a != null && a.equals(b);
    }

    Item item(String id) {
        for (Section s : sections) {
            for (Item it : s.items) {
                if (it.id.equals(id)) return it;
            }
        }
        return null;
    }

    List<Item> items() {
        List<Item> out = new ArrayList<>();
        for (Section s : sections) out.addAll(s.items);
        return out;
    }

    /** Id of the first preset whose values all equal the given ones (ignored ids skipped), or null. */
    String matchPreset(Map<String, Object> values, Set<String> ignore) {
        for (Preset p : presets) {
            boolean ok = !p.values.isEmpty();
            for (Map.Entry<String, Object> e : p.values.entrySet()) {
                if (ignore.contains(e.getKey())) continue;
                if (!same(e.getValue(), values.get(e.getKey()))) {
                    ok = false;
                    break;
                }
            }
            if (ok) return p.id;
        }
        return null;
    }
}
