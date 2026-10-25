package dev.remined.companion;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Parses launcher to mod messages (protocol v3) into plain values. Pure Java, no Minecraft. */
final class Protocol {
    static final int MAX_MEMBERS = 64;
    static final long DEFAULT_TTL_MS = 15_000L;
    static final long MIN_TTL_MS = 1_000L;
    static final long MAX_TTL_MS = 60_000L;
    private static final int HEAD_PIXELS = 8 * 8;

    private Protocol() {
    }

    static final class Member {
        final String id;
        final String name;
        final boolean speaking;
        final boolean muted;
        final boolean deafened;

        Member(String id, String name, boolean speaking, boolean muted, boolean deafened) {
            this.id = id;
            this.name = name;
            this.speaking = speaking;
            this.muted = muted;
            this.deafened = deafened;
        }
    }

    static final class Voice {
        final boolean active;
        final String room;
        final String self;
        final boolean selfMuted;
        final boolean selfDeafened;
        final List<Member> members;

        Voice(boolean active, String room, String self, boolean selfMuted, boolean selfDeafened, List<Member> members) {
            this.active = active;
            this.room = room;
            this.self = self;
            this.selfMuted = selfMuted;
            this.selfDeafened = selfDeafened;
            this.members = members;
        }

        static Voice off() {
            return new Voice(false, null, null, false, false, Collections.<Member>emptyList());
        }
    }

    static final class Notice {
        final String kind;
        final String title;
        final String body;
        final String head;
        final String actionType;
        final String actionId;
        final long ttl;

        Notice(String kind, String title, String body, String head, String actionType, String actionId, long ttl) {
            this.kind = kind;
            this.title = title;
            this.body = body;
            this.head = head;
            this.actionType = actionType;
            this.actionId = actionId;
            this.ttl = ttl;
        }
    }

    static Voice voice(Map<String, Object> m) {
        if (!bool(m, "active")) return Voice.off();
        List<Member> out = new ArrayList<>();
        Object raw = m.get("members");
        if (raw instanceof List) {
            for (Object o : (List<?>) raw) {
                if (out.size() >= MAX_MEMBERS) break;
                if (!(o instanceof Map)) continue;
                Map<String, Object> mm = asMap(o);
                String id = clip(str(mm, "id"), 64);
                if (id == null || id.isEmpty()) continue;
                String name = clip(str(mm, "name"), 32);
                out.add(new Member(id, name == null || name.isEmpty() ? id : name,
                    bool(mm, "speaking"), bool(mm, "muted"), bool(mm, "deafened")));
            }
        }
        return new Voice(true, clip(str(m, "room"), 64), clip(str(m, "self"), 64),
            bool(m, "selfMuted"), bool(m, "selfDeafened"), out);
    }

    /** Decodes the 8x8 RGBA head into ARGB pixels, or returns null when the payload is malformed. */
    static int[] head(Map<String, Object> m) {
        String s = str(m, "rgba");
        if (s == null) return null;
        byte[] b;
        try {
            b = Base64.getDecoder().decode(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (b.length != HEAD_PIXELS * 4) return null;
        int[] argb = new int[HEAD_PIXELS];
        for (int i = 0; i < HEAD_PIXELS; i++) {
            int r = b[i * 4] & 0xff;
            int g = b[i * 4 + 1] & 0xff;
            int bl = b[i * 4 + 2] & 0xff;
            int a = b[i * 4 + 3] & 0xff;
            argb[i] = (a << 24) | (r << 16) | (g << 8) | bl;
        }
        return argb;
    }

    static Notice notice(Map<String, Object> m) {
        String kind = str(m, "kind");
        if (!"friend".equals(kind) && !"request".equals(kind) && !"chat".equals(kind) && !"invite".equals(kind)) {
            kind = "info";
        }
        String title = clip(str(m, "title"), 80);
        String body = clip(str(m, "body"), 240);
        String head = clip(str(m, "head"), 64);
        String actionType = null;
        String actionId = null;
        long ttl = DEFAULT_TTL_MS;
        Map<String, Object> a = m.get("action") instanceof Map ? asMap(m.get("action")) : null;
        if (a != null) {
            actionType = str(a, "type");
            actionId = clip(str(a, "id"), 128);
            ttl = Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, num(a, "ttl", DEFAULT_TTL_MS)));
        }
        return new Notice(kind, title == null ? "" : title, body == null ? "" : body, head, actionType, actionId, ttl);
    }

    /** open_lan request. port 0 picks a free port; port -1 means the requested port is out of range. */
    static final class OpenLan {
        final int port;
        final boolean cheats;

        OpenLan(int port, boolean cheats) {
            this.port = port;
            this.cheats = cheats;
        }
    }

    static OpenLan openLan(Map<String, Object> m) {
        long p = num(m, "port", 0L);
        return new OpenLan(p < 0 || p > 65_535 ? -1 : (int) p, bool(m, "cheats"));
    }

    /** Laptop battery state. present=false hides the indicator; level is clamped to 0..100. */
    static final class Battery {
        final boolean present;
        final int level;
        final boolean charging;

        Battery(boolean present, int level, boolean charging) {
            this.present = present;
            this.level = level;
            this.charging = charging;
        }
    }

    static Battery battery(Map<String, Object> m) {
        boolean present = bool(m, "present");
        return new Battery(present, (int) Math.max(0L, Math.min(100L, num(m, "level", 0L))), present && bool(m, "charging"));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asMap(Object o) {
        return (Map<String, Object>) o;
    }

    static String str(Map<String, Object> m, String key) {
        Object v = m == null ? null : m.get(key);
        return v instanceof String ? (String) v : null;
    }

    static boolean bool(Map<String, Object> m, String key) {
        return m != null && Boolean.TRUE.equals(m.get(key));
    }

    static long num(Map<String, Object> m, String key, long def) {
        Object v = m == null ? null : m.get(key);
        return v instanceof Number ? ((Number) v).longValue() : def;
    }

    static String clip(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
