package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class PerfConfigTest {
    enum Mode { disabled, player_only, ALL }

    public static class Inner {
        public boolean enabled = true;
        public Mode mode = Mode.disabled;
        public double volume = 1.0;
        public int count;
        public String name = "";
        int calls;

        public void bump(boolean up, Mode m) {
            calls += up ? 1 : -1;
            mode = m;
        }
    }

    public static class Holder {
        public static Inner CONFIG = new Inner();

        public static Inner config() {
            return CONFIG;
        }

        public static class Nested {
            public static Inner CONFIG = new Inner();
        }
    }

    private static final String HOLDER = "dev.remined.companion.PerfConfigTest.Holder";

    @Test
    void parsesPaths() {
        List<PerfReflect.Seg> s = PerfReflect.parsePath("a.b.C.getConfig().x.get(\"k.v, \\\"q\\\"\", 3, true).y");
        assertEquals(7, s.size());
        assertNull(s.get(0).args);
        assertEquals("getConfig", s.get(3).name);
        assertTrue(s.get(3).args.isEmpty());
        assertEquals("get", s.get(5).name);
        assertEquals(3, s.get(5).args.size());
        assertEquals("y", s.get(6).name);
        PerfReflect.Seg call = PerfReflect.parsePath("m.get(\"k.v, \\\"q\\\"\", 3, 1.5, true, null)").get(1);
        assertEquals(5, call.args.size());
        assertEquals("k.v, \"q\"", call.args.get(0));
        assertEquals(3L, call.args.get(1));
        assertEquals(1.5, call.args.get(2));
        assertEquals(Boolean.TRUE, call.args.get(3));
        assertNull(call.args.get(4));
        assertThrows(IllegalArgumentException.class, () -> PerfReflect.parsePath("a.b("));
        assertThrows(IllegalArgumentException.class, () -> PerfReflect.parsePath("a..b"));
    }

    @Test
    void convertsValues() {
        assertEquals(3, PerfReflect.convert(3L, int.class));
        assertEquals(2.0, PerfReflect.convert(2L, double.class));
        assertEquals(1.5f, PerfReflect.convert(1.5, float.class));
        assertEquals(7L, PerfReflect.convert(7, Long.class));
        assertEquals("true", PerfReflect.convert(Boolean.TRUE, String.class));
        assertEquals(Boolean.FALSE, PerfReflect.convert("false", boolean.class));
        assertEquals(Mode.ALL, PerfReflect.convert("ALL", Mode.class));
        assertEquals(Mode.player_only, PerfReflect.convert("PLAYER_ONLY", Mode.class));
        assertNull(PerfReflect.convert(null, String.class));
        assertThrows(IllegalArgumentException.class, () -> PerfReflect.convert("nope", Mode.class));
        assertThrows(IllegalArgumentException.class, () -> PerfReflect.convert(null, int.class));
        assertThrows(IllegalArgumentException.class, () -> PerfReflect.convert("x", int.class));
    }

    @Test
    void setsAndCallsThroughPaths() throws Exception {
        Holder.CONFIG = new Inner();
        PerfReflect.set(HOLDER + ".CONFIG.enabled", false);
        assertFalse(Holder.CONFIG.enabled);
        PerfReflect.set(HOLDER + ".config().mode", "ALL");
        assertEquals(Mode.ALL, Holder.CONFIG.mode);
        PerfReflect.set(HOLDER + ".CONFIG.volume", 0L);
        assertEquals(0.0, Holder.CONFIG.volume);
        PerfReflect.set(HOLDER + ".CONFIG.count", 4L);
        assertEquals(4, Holder.CONFIG.count);
        PerfReflect.set(HOLDER + ".CONFIG.name", true);
        assertEquals("true", Holder.CONFIG.name);
        PerfReflect.call(HOLDER + ".config().bump(true, \"player_only\")");
        assertEquals(1, Holder.CONFIG.calls);
        assertEquals(Mode.player_only, Holder.CONFIG.mode);
        PerfReflect.set(HOLDER + ".Nested.CONFIG.enabled", false);
        assertFalse(Holder.Nested.CONFIG.enabled);
        assertEquals(Boolean.FALSE, PerfReflect.get(HOLDER + ".CONFIG.enabled"));
        assertThrows(Exception.class, () -> PerfReflect.set(HOLDER + ".CONFIG.missing", 1L));
        assertThrows(Exception.class, () -> PerfReflect.call(HOLDER + ".config().bump(true)"));
        assertThrows(Exception.class, () -> PerfReflect.set("no.such.Clazz.f", 1L));
    }

    @Test
    void editsJson5PreservingTheRest() {
        String text = "{\n  // keep me\n  \"other\": 1,\n  enablePlacementAnimation: true, // note\n  'x': \"y\"\n}\n";
        String out = PerfFiles.editText(text, "json5", "enablePlacementAnimation", false);
        assertEquals("{\n  // keep me\n  \"other\": 1,\n  enablePlacementAnimation: false, // note\n  'x': \"y\"\n}\n", out);
        assertEquals(Boolean.TRUE, PerfFiles.readText(text, "json5", "enablePlacementAnimation"));
        assertEquals("y", PerfFiles.readText(text, "json5", "x"));
        assertEquals(1L, PerfFiles.readText(text, "json5", "other"));
        String q = PerfFiles.editText(text, "json5", "x", "a\"b");
        assertTrue(q.contains("'x': \"a\\\"b\""));
        assertNull(PerfFiles.editText(text, "json5", "enable", true));
        assertNull(PerfFiles.readText(text, "json5", "nope"));
    }

    @Test
    void editsToml() {
        String text = "[general]\n# mode = \"off\"\nmode = \"fast\"  # comment\nloudness = 1.00\r\nenabledFoo = 1\n";
        String out = PerfFiles.editText(text, "toml", "mode", "off");
        assertEquals("[general]\n# mode = \"off\"\nmode = \"off\"  # comment\nloudness = 1.00\r\nenabledFoo = 1\n", out);
        assertEquals("fast", PerfFiles.readText(text, "toml", "mode"));
        assertEquals(1.0, ((Number) PerfFiles.readText(text, "toml", "loudness")).doubleValue());
        String d = PerfFiles.editText(text, "toml", "loudness", 0.0);
        assertTrue(d.contains("loudness = 0.0\r\n"));
        assertNull(PerfFiles.editText(text, "toml", "enabled", true));
        assertEquals("[general]\nsection.mode = 1\n", PerfFiles.editText("[general]\nsection.mode = 2\n", "toml", "section.mode", 1L));
    }

    @Test
    void editsProperties() {
        String text = "#enabled=false\nenabled = true\nvolume=0.5\nname=a b\n";
        assertEquals("#enabled=false\nenabled = false\nvolume=0.5\nname=a b\n",
            PerfFiles.editText(text, "properties", "enabled", false));
        assertEquals("#enabled=false\nenabled = true\nvolume=0.5\nname=raw text\n",
            PerfFiles.editText(text, "properties", "name", "raw text"));
        assertEquals(Boolean.TRUE, PerfFiles.readText(text, "properties", "enabled"));
        assertEquals(0.5, PerfFiles.readText(text, "properties", "volume"));
        assertEquals("a b", PerfFiles.readText(text, "properties", "name"));
    }

    @Test
    void editsJsonNested() {
        String text = "{\"a\":{\"b\":true,\"c\":[1,2]},\"x.y\":1,\"top\":\"v\"}";
        String out = PerfFiles.editText(text, "json", "a.b", false);
        assertEquals(Boolean.FALSE, PerfFiles.readText(out, "json", "a.b"));
        assertEquals(1L, PerfFiles.readText(out, "json", "x.y"));
        assertTrue(out.indexOf("\"a\"") < out.indexOf("\"top\""));
        assertTrue(PerfFiles.editText(text, "json", "x.y", 2L).contains("\"x.y\": 2"));
        assertNull(PerfFiles.editText(text, "json", "a.zz", true));
        assertNull(PerfFiles.readText(text, "json", "q.b"));
    }

    @Test
    void parsesConfigItems() {
        String json = "{\"version\":1,\"sections\":[{\"name\":{\"en\":\"S\"},\"items\":["
            + "{\"id\":\"c\",\"kind\":\"config\",\"name\":{\"en\":\"C\"},\"impact\":2,"
            + "\"on\":[{\"file\":\"a.json\",\"format\":\"json\",\"key\":\"k\",\"value\":true},{\"set\":\"x.Y.z\",\"value\":1},{\"call\":\"x.Y.m()\"},{\"reload\":\"resources\"},{\"bad\":1}],"
            + "\"off\":[{\"file\":\"a.json\",\"format\":\"json\",\"key\":\"k\",\"value\":false}],"
            + "\"probe\":{\"get\":\"x.Y.z\",\"equals\":1}},"
            + "{\"id\":\"d\",\"kind\":\"config\",\"name\":{\"en\":\"D\"},\"on\":[],\"off\":[]}]}]}";
        PerfProfile p = PerfProfile.parse(json);
        PerfProfile.Item c = p.item("c");
        assertNotNull(c);
        assertNull(p.item("d"));
        assertTrue(c.toggle());
        assertEquals(4, c.on.size());
        assertEquals(PerfProfile.Op.RELOAD, c.on.get(3).type);
        assertEquals(1, c.off.size());
        assertEquals(PerfProfile.Op.GET, c.probe.type);
        assertEquals(1L, c.probe.value);
    }

    @Test
    void parsesPackOpsAndFileProbe() {
        String json = "{\"version\":1,\"sections\":[{\"name\":{\"en\":\"S\"},\"items\":["
            + "{\"id\":\"a\",\"kind\":\"config\",\"name\":{\"en\":\"A\"},"
            + "\"on\":[{\"packs\":[\"file/X%2BY.zip\",\"file/Z.zip\"],\"value\":true}],"
            + "\"off\":[{\"packs\":[\"file/X%2BY.zip\"],\"value\":false},{\"packs\":[],\"value\":false}],"
            + "\"probe\":{\"file\":\"n.json\",\"format\":\"json\",\"key\":\"k\",\"value\":true}}]}]}";
        PerfProfile.Item a = PerfProfile.parse(json).item("a");
        assertEquals(PerfProfile.Op.PACKS, a.on.get(0).type);
        assertEquals(java.util.Arrays.asList("file/X%2BY.zip", "file/Z.zip"), a.on.get(0).ids);
        assertEquals(Boolean.TRUE, a.on.get(0).value);
        assertEquals(1, a.off.size());
        assertEquals(PerfProfile.Op.FILE, a.probe.type);
        assertEquals("k", a.probe.key);
        assertEquals(Boolean.TRUE, a.probe.value);
    }

    @Test
    void probeReadsFileValue() throws Exception {
        java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("cfg");
        java.nio.file.Path f = dir.resolve("n.json");
        try {
            java.nio.file.Files.write(f, "{\"k\":false}".getBytes("UTF-8"));
            String json = "{\"version\":1,\"sections\":[{\"name\":{\"en\":\"S\"},\"items\":["
                + "{\"id\":\"a\",\"kind\":\"config\",\"name\":{\"en\":\"A\"},\"on\":[{\"reload\":\"resources\"}],"
                + "\"probe\":{\"file\":\"n.json\",\"format\":\"json\",\"key\":\"k\",\"value\":true}}]}]}";
            PerfProfile.Item a = PerfProfile.parse(json).item("a");
            PerfConfig c = new PerfConfig(dir, null);
            assertEquals(Boolean.FALSE, c.actual(a));
            java.nio.file.Files.write(f, "{\"k\":true}".getBytes("UTF-8"));
            assertEquals(Boolean.TRUE, c.actual(a));
            java.nio.file.Files.delete(f);
            assertEquals(Boolean.TRUE, c.actual(a));
        } finally {
            java.nio.file.Files.deleteIfExists(f);
            java.nio.file.Files.deleteIfExists(dir);
        }
    }

    @Test
    void realProfileLoadsEveryItem() throws Exception {
        java.nio.file.Path f = java.nio.file.Paths.get("../../../packs/vanillapro/config/remined-performance-profile.json");
        org.junit.jupiter.api.Assumptions.assumeTrue(java.nio.file.Files.isRegularFile(f));
        String text = new String(java.nio.file.Files.readAllBytes(f), "UTF-8");
        PerfProfile p = PerfProfile.parse(text);
        int raw = 0;
        for (Object sec : (List<?>) Bridge.Json.parse(text).get("sections")) {
            raw += ((List<?>) Protocol.asMap(sec).get("items")).size();
        }
        assertEquals(raw, p.items().size());
        assertNotNull(p.item("anim_player"));
        assertEquals(PerfProfile.Op.PACKS, p.item("anim_player").on.get(0).type);
        assertNotNull(p.item("anim_player").probe);
    }
}
