package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PerfTest {
    private static final String SAMPLE = "{\"version\":1,\"defaultPreset\":\"high\","
        + "\"presets\":[{\"id\":\"ultra\",\"name\":{\"ru\":\"Ультра\",\"en\":\"Ultra\"},\"values\":{\"shaders\":true,\"rd\":24,\"fa\":true,\"nope\":true}},"
        + "{\"id\":\"low\",\"name\":{\"en\":\"Low\"},\"values\":{\"shaders\":false,\"rd\":8,\"fa\":false,\"clouds\":\"off\"}}],"
        + "\"sections\":[{\"name\":{\"ru\":\"Графика\",\"en\":\"Graphics\"},\"items\":["
        + "{\"id\":\"shaders\",\"kind\":\"shaders\",\"pack\":\"Mellow.zip\",\"name\":{\"en\":\"Shaders\"},\"hint\":{\"en\":\"Heavy\"},\"impact\":3},"
        + "{\"id\":\"rd\",\"kind\":\"option\",\"option\":\"renderDistance\",\"values\":[8,16,24],\"name\":{\"en\":\"Distance\"},\"impact\":2},"
        + "{\"id\":\"clouds\",\"kind\":\"option\",\"option\":\"clouds\",\"values\":[\"off\",\"fast\"],\"labels\":[{\"en\":\"Off\"},{\"en\":\"Fast\"}],\"name\":{\"en\":\"Clouds\"}},"
        + "{\"id\":\"ao\",\"kind\":\"option\",\"option\":\"ambientOcclusion\",\"name\":{\"en\":\"AO\"},\"impact\":9},"
        + "{\"id\":\"weird\",\"kind\":\"teleport\",\"name\":{\"en\":\"?\"}}]},"
        + "{\"name\":{\"en\":\"Packs\"},\"items\":["
        + "{\"id\":\"fa\",\"kind\":\"packs\",\"packs\":[\"file/A.zip\",\"file/B.zip\"],\"name\":{\"en\":\"Animations\"}},"
        + "{\"id\":\"m\",\"kind\":\"mods\",\"mods\":[\"sodium\"],\"name\":{\"en\":\"Mods\"}},"
        + "{\"id\":\"empty\",\"kind\":\"mods\",\"mods\":[],\"name\":{\"en\":\"Empty\"}}]}]}";

    @Test
    void parsesProfile() {
        PerfProfile p = PerfProfile.parse(SAMPLE);
        assertEquals("high", p.defaultPreset);
        assertEquals(2, p.sections.size());
        assertEquals(Arrays.asList("shaders", "rd", "clouds", "ao", "fa", "m"), ids(p));
        PerfProfile.Item shaders = p.item("shaders");
        assertEquals("Mellow.zip", shaders.pack);
        assertEquals(3, shaders.impact);
        assertTrue(shaders.toggle());
        PerfProfile.Item rd = p.item("rd");
        assertFalse(rd.toggle());
        assertEquals(3, rd.values.size());
        assertTrue(p.item("ao").toggle());
        assertEquals(3, p.item("ao").impact);
        assertTrue(p.item("m").restart());
        assertEquals(2, p.item("fa").ids.size());
        assertEquals(2, p.item("clouds").labels.size());
        assertEquals("Ультра", PerfProfile.text(p.presets.get(0).name, "ru"));
        assertEquals("Low", PerfProfile.text(p.presets.get(1).name, "ru"));
        assertFalse(p.presets.get(0).values.containsKey("nope"));
    }

    @Test
    void rejectsInvalid() {
        assertThrows(RuntimeException.class, () -> PerfProfile.parse("{\"version\":2,\"sections\":[]}"));
        assertThrows(RuntimeException.class, () -> PerfProfile.parse("{\"version\":1,\"sections\":[]}"));
        assertThrows(RuntimeException.class, () -> PerfProfile.parse("not json"));
        assertNull(PerfProfile.load(java.nio.file.Paths.get("does-not-exist.json")));
    }

    @Test
    void loadsFromDisk() throws Exception {
        Path f = Files.createTempFile("profile", ".json");
        try {
            Files.write(f, SAMPLE.getBytes("UTF-8"));
            assertNotNull(PerfProfile.load(f));
            Files.write(f, "{".getBytes("UTF-8"));
            assertNull(PerfProfile.load(f));
        } finally {
            Files.deleteIfExists(f);
        }
    }

    @Test
    void matchesPresets() {
        PerfProfile p = PerfProfile.parse(SAMPLE);
        Map<String, Object> v = new HashMap<>();
        v.put("shaders", Boolean.TRUE);
        v.put("rd", 24.0);
        v.put("fa", Boolean.TRUE);
        assertEquals("ultra", p.matchPreset(v, Collections.<String>emptySet()));
        v.put("rd", 16L);
        assertNull(p.matchPreset(v, Collections.<String>emptySet()));
        v.put("shaders", Boolean.FALSE);
        v.put("rd", 8L);
        v.put("fa", Boolean.FALSE);
        v.put("clouds", "off");
        assertEquals("low", p.matchPreset(v, Collections.<String>emptySet()));
        v.put("clouds", "fast");
        assertNull(p.matchPreset(v, Collections.<String>emptySet()));
        assertEquals("low", p.matchPreset(v, new HashSet<>(Arrays.asList("clouds"))));
    }

    @Test
    void stateRoundTrips() throws Exception {
        PerfState s = new PerfState();
        s.preset = "custom";
        s.values.put("shaders", Boolean.TRUE);
        s.values.put("rd", PerfProfile.norm(16));
        s.values.put("scale", PerfProfile.norm(0.75));
        s.values.put("clouds", "fast \"x\"");
        s.mods.put("sodium", Boolean.FALSE);
        s.packOrder.addAll(Arrays.asList("vanilla", "file/A.zip"));
        Path f = Files.createTempDirectory("perf").resolve("remined-performance.json");
        try {
            s.save(f);
            PerfState r = PerfState.load(f);
            assertNotNull(r);
            assertEquals("custom", r.preset);
            assertEquals(Boolean.TRUE, r.values.get("shaders"));
            assertTrue(PerfProfile.same(16, r.values.get("rd")));
            assertTrue(PerfProfile.same(0.75, r.values.get("scale")));
            assertEquals("fast \"x\"", r.values.get("clouds"));
            assertEquals(Boolean.FALSE, r.mods.get("sodium"));
            assertEquals(s.packOrder, r.packOrder);
            assertFalse(Files.exists(f.resolveSibling("remined-performance.json.tmp")));
        } finally {
            Files.deleteIfExists(f);
            Files.deleteIfExists(f.getParent());
        }
        assertNull(PerfState.load(java.nio.file.Paths.get("missing.json")));
    }

    @Test
    void reinsertsAfterLastPresentPredecessor() {
        List<String> base = Arrays.asList("vanilla", "A", "B", "C", "D");
        List<String> cur = new ArrayList<>(Arrays.asList("vanilla", "D"));
        PerfState.insertAfterPredecessor(cur, base, "B");
        assertEquals(Arrays.asList("vanilla", "B", "D"), cur);
        PerfState.insertAfterPredecessor(cur, base, "C");
        assertEquals(Arrays.asList("vanilla", "B", "C", "D"), cur);
        PerfState.insertAfterPredecessor(cur, base, "A");
        assertEquals(Arrays.asList("vanilla", "A", "B", "C", "D"), cur);
        PerfState.insertAfterPredecessor(cur, base, "A");
        assertEquals(5, cur.size());
    }

    @Test
    void insertsAtStartWithoutPredecessor() {
        List<String> base = Arrays.asList("A", "B", "C");
        List<String> cur = new ArrayList<>(Arrays.asList("C"));
        PerfState.insertAfterPredecessor(cur, base, "A");
        assertEquals(Arrays.asList("A", "C"), cur);
        PerfState.insertAfterPredecessor(cur, base, "Z");
        assertEquals(Arrays.asList("A", "C", "Z"), cur);
    }

    @Test
    void usesNearestPredecessorInBaselineOrder() {
        List<String> base = Arrays.asList("A", "B", "C");
        List<String> cur = new ArrayList<>(Arrays.asList("B", "A"));
        PerfState.insertAfterPredecessor(cur, base, "C");
        assertEquals(Arrays.asList("B", "C", "A"), cur);
    }

    @Test
    void mergeKeepsRemovedAtBaselinePositions() {
        List<String> base = Arrays.asList("vanilla", "A", "B", "C");
        List<String> merged = PerfState.mergeOrder(base, Arrays.asList("vanilla", "C"), new HashSet<>(Arrays.asList("A", "B")));
        assertEquals(base, merged);
        List<String> forgotten = PerfState.mergeOrder(base, Arrays.asList("vanilla", "C"), new HashSet<>(Arrays.asList("B")));
        assertEquals(Arrays.asList("vanilla", "B", "C"), forgotten);
        assertEquals(Arrays.asList("x", "y"), PerfState.mergeOrder(Collections.<String>emptyList(), Arrays.asList("x", "y"),
            new HashSet<>(Arrays.asList("A"))));
    }

    @Test
    void disableThenEnableRestoresOrder() {
        List<String> selected = new ArrayList<>(Arrays.asList("vanilla", "A", "B", "C", "D"));
        List<String> baseline = PerfState.mergeOrder(Collections.<String>emptyList(), selected, new HashSet<String>());
        selected.remove("B");
        selected.remove("C");
        List<String> refreshed = PerfState.mergeOrder(baseline, selected, new HashSet<>(Arrays.asList("B", "C")));
        assertEquals(baseline, refreshed);
        PerfState.insertAfterPredecessor(selected, refreshed, "B");
        PerfState.insertAfterPredecessor(selected, refreshed, "C");
        assertEquals(baseline, selected);
    }

    private static List<String> ids(PerfProfile p) {
        List<String> out = new ArrayList<>();
        for (PerfProfile.Item it : p.items()) out.add(it.id);
        return out;
    }
}
