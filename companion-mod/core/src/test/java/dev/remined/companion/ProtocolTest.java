package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ProtocolTest {
    @Test
    void parsesVoiceSnapshotWithNestedMembers() {
        Map<String, Object> m = Bridge.Json.parse("{\"t\":\"voice\",\"active\":true,\"room\":\"Lobby\",\"self\":\"u1\","
            + "\"selfMuted\":true,\"selfDeafened\":false,\"members\":["
            + "{\"id\":\"u1\",\"name\":\"Me\",\"speaking\":false,\"muted\":true,\"deafened\":false},"
            + "{\"id\":\"u2\",\"name\":\"Bob\",\"speaking\":true,\"muted\":false,\"deafened\":true}]}");
        Protocol.Voice v = Protocol.voice(m);
        assertTrue(v.active);
        assertEquals("Lobby", v.room);
        assertEquals("u1", v.self);
        assertTrue(v.selfMuted);
        assertFalse(v.selfDeafened);
        assertEquals(2, v.members.size());
        assertEquals("Bob", v.members.get(1).name);
        assertTrue(v.members.get(1).speaking);
        assertTrue(v.members.get(1).deafened);
        assertTrue(v.members.get(0).muted);
    }

    @Test
    void inactiveVoiceIsOff() {
        Protocol.Voice v = Protocol.voice(Bridge.Json.parse("{\"t\":\"voice\",\"active\":false}"));
        assertFalse(v.active);
        assertTrue(v.members.isEmpty());
    }

    @Test
    void memberWithoutNameUsesId_andBadEntriesAreSkipped() {
        Protocol.Voice v = Protocol.voice(Bridge.Json.parse("{\"active\":true,\"members\":[5,{\"name\":\"x\"},"
            + "{\"id\":\"abc\"}]}"));
        assertEquals(1, v.members.size());
        assertEquals("abc", v.members.get(0).id);
        assertEquals("abc", v.members.get(0).name);
        assertFalse(v.members.get(0).speaking);
    }

    @Test
    void decodesHeadRgbaToArgb() {
        byte[] rgba = new byte[8 * 8 * 4];
        for (int i = 0; i < 64; i++) {
            rgba[i * 4] = (byte) 0x11;      // r
            rgba[i * 4 + 1] = (byte) 0x22;  // g
            rgba[i * 4 + 2] = (byte) 0x33;  // b
            rgba[i * 4 + 3] = (byte) 0xFF;  // a
        }
        String b64 = Base64.getEncoder().encodeToString(rgba);
        int[] px = Protocol.head(Bridge.Json.parse("{\"t\":\"head\",\"id\":\"u\",\"rgba\":\"" + b64 + "\"}"));
        assertNotNull(px);
        assertEquals(64, px.length);
        assertEquals(0xFF112233, px[0]);
    }

    @Test
    void rejectsMalformedHead() {
        assertNull(Protocol.head(Bridge.Json.parse("{\"rgba\":\"AAAA\"}")));
        assertNull(Protocol.head(Bridge.Json.parse("{\"rgba\":\"!!!\"}")));
        assertNull(Protocol.head(Bridge.Json.parse("{}")));
    }

    @Test
    void parsesNotifyWithJoinAction() {
        Protocol.Notice n = Protocol.notice(Bridge.Json.parse("{\"t\":\"notify\",\"kind\":\"invite\",\"title\":\"Ann\","
            + "\"body\":\"Invites you\",\"head\":\"u9\",\"action\":{\"type\":\"join\",\"id\":\"w1\",\"ttl\":20000}}"));
        assertEquals("invite", n.kind);
        assertEquals("Ann", n.title);
        assertEquals("u9", n.head);
        assertEquals("join", n.actionType);
        assertEquals("w1", n.actionId);
        assertEquals(20000L, n.ttl);
    }

    @Test
    void notifyDefaultsAndClamps() {
        Protocol.Notice n = Protocol.notice(Bridge.Json.parse("{\"kind\":\"weird\",\"action\":{\"type\":\"join\",\"id\":\"w\",\"ttl\":999999}}"));
        assertEquals("info", n.kind);
        assertEquals("", n.title);
        assertEquals(Protocol.MAX_TTL_MS, n.ttl);
        Protocol.Notice plain = Protocol.notice(Bridge.Json.parse("{\"kind\":\"chat\",\"title\":\"t\"}"));
        assertNull(plain.actionType);
        assertEquals(Protocol.DEFAULT_TTL_MS, plain.ttl);
    }

    @Test
    void jsonHandlesEscapesAndNesting() {
        Map<String, Object> m = Bridge.Json.parse("{\"a\":[1,2.5,\"x\\n\\u0041\",null,true,{\"b\":false}]}");
        assertEquals(6, ((java.util.List<?>) m.get("a")).size());
        assertEquals("x\nA", ((java.util.List<?>) m.get("a")).get(2));
    }

    @Test
    void jsonRejectsGarbage() {
        assertThrows(IllegalArgumentException.class, () -> Bridge.Json.parse("{\"a\":}"));
        assertThrows(IllegalArgumentException.class, () -> Bridge.Json.parse("{\"a\":1} x"));
    }

    @Test
    void parsesOpenLan() {
        Protocol.OpenLan o = Protocol.openLan(Bridge.Json.parse("{\"t\":\"open_lan\",\"port\":25565,\"cheats\":true}"));
        assertEquals(25565, o.port);
        assertTrue(o.cheats);
    }

    @Test
    void openLanDefaultsToFreePortWithoutCheats() {
        Protocol.OpenLan o = Protocol.openLan(Bridge.Json.parse("{\"t\":\"open_lan\"}"));
        assertEquals(0, o.port);
        assertFalse(o.cheats);
    }

    @Test
    void openLanRejectsOutOfRangePort() {
        assertEquals(-1, Protocol.openLan(Bridge.Json.parse("{\"t\":\"open_lan\",\"port\":70000}")).port);
        assertEquals(-1, Protocol.openLan(Bridge.Json.parse("{\"t\":\"open_lan\",\"port\":-5}")).port);
    }

    @Test
    void parsesBattery() {
        Protocol.Battery b = Protocol.battery(Bridge.Json.parse("{\"t\":\"battery\",\"present\":true,\"level\":87,\"charging\":true}"));
        assertTrue(b.present);
        assertEquals(87, b.level);
        assertTrue(b.charging);
    }

    @Test
    void batteryClampsLevelAndHidesWithoutPresent() {
        assertEquals(100, Protocol.battery(Bridge.Json.parse("{\"present\":true,\"level\":250}")).level);
        Protocol.Battery none = Protocol.battery(Bridge.Json.parse("{\"t\":\"battery\",\"present\":false,\"charging\":true}"));
        assertFalse(none.present);
        assertFalse(none.charging);
    }
}
