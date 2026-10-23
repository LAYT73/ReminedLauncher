package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class HeadsTest {
    @Test
    void keysAreSanitized() {
        assertEquals("h_ab-c_1_", Heads.key("AB-c 1!"));
        assertNull(Heads.key(null));
        assertTrue(Heads.key(new String(new char[100]).replace((char) 0, 'x')).length() <= 42);
    }

    @Test
    void steveFallbackHasFullFace() {
        int[] p = Heads.steve();
        assertEquals(64, p.length);
        for (int c : p) assertEquals(0xFF000000, c & 0xFF000000);
    }

    @Test
    void mixBlendsChannels() {
        assertEquals(0xFF000000, VoiceHud.mix(0xFF000000, 0xFF000000, 0.5f));
        assertEquals(0xFF55FF55, VoiceHud.mix(0xFF000000, 0xFF55FF55, 1f));
    }
}
