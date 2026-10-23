package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class SnapshotTest {
    @Test
    void escapes() {
        assertEquals("\"a\\\"b\\\\c\\n\\u0001\"", Snapshot.str("a\"b\\c\n\u0001"));
        assertEquals("null", Snapshot.str(null));
    }

    @Test
    void json() {
        Snapshot s = new Snapshot(true, "minecraft:the_nether", false, "sp", null);
        assertEquals("{\"v\":1,\"inWorld\":true,\"dim\":\"minecraft:the_nether\",\"paused\":false,"
            + "\"mode\":\"sp\",\"screen\":null,\"ts\":5}\n", s.toJson(5));
    }

    @Test
    void changeDetection() throws Exception {
        Path f = Files.createTempDirectory("rc").resolve(".remined").resolve("state.json");
        StateWriter w = new StateWriter(f);
        Snapshot a = new Snapshot(true, "minecraft:overworld", false, "sp", null);
        Snapshot b = new Snapshot(true, "minecraft:overworld", true, "sp", "class_433");
        assertTrue(w.maybeWrite(a, 1000));
        assertFalse(w.maybeWrite(a, 2000));
        assertTrue(w.maybeWrite(b, 3000));
        assertFalse(w.maybeWrite(b, 12999));
        assertTrue(w.maybeWrite(b, 13000)); // heartbeat
        assertTrue(new String(Files.readAllBytes(f), java.nio.charset.StandardCharsets.UTF_8).contains("\"paused\":true"));
    }
}
