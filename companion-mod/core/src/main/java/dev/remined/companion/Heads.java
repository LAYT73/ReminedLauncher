package dev.remined.companion;

import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/** Head textures keyed by user id. Unknown ids draw a generated fallback head. Client thread only. */
final class Heads {
    static final String DEFAULT = "_default";
    private static final int MAX = 128;

    private final Platform platform;
    private final Set<String> uploaded = new LinkedHashSet<>();
    private boolean hasDefault;

    Heads(Platform platform) {
        this.platform = platform;
    }

    void ensureDefault() {
        if (hasDefault) return;
        platform.uploadHead(DEFAULT, steve());
        hasDefault = true;
    }

    /** Texture key to draw for id, or DEFAULT while that head has not arrived. */
    String keyFor(String id) {
        String k = key(id);
        return k != null && uploaded.contains(k) ? k : DEFAULT;
    }

    /** Stores 64 ARGB pixels for id. */
    void put(String id, int[] argb) {
        String k = key(id);
        if (k == null || argb == null || argb.length != 64) return;
        platform.uploadHead(k, argb);
        uploaded.remove(k);
        uploaded.add(k);
        while (uploaded.size() > MAX) {
            Iterator<String> it = uploaded.iterator();
            String old = it.next();
            it.remove();
            platform.releaseHead(old);
        }
    }

    static String key(String id) {
        if (id == null) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < id.length() && sb.length() < 40; i++) {
            char c = Character.toLowerCase(id.charAt(i));
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
            sb.append(ok ? c : '_');
        }
        return sb.length() == 0 ? null : "h_" + sb;
    }

    /** Generated Steve-like face: brown hair, skin, blue eyes, mouth. */
    static int[] steve() {
        int hair = 0xFF5A3B22;
        int skin = 0xFFE0AC7E;
        int eye = 0xFF2F4F8F;
        int mouth = 0xFF9A5A44;
        int[] p = new int[64];
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                int c = y < 2 ? hair : skin;
                if (y == 2 && (x == 0 || x == 7)) c = hair;
                if (y == 3 && (x == 2 || x == 5)) c = eye;
                if (y == 6 && x >= 2 && x <= 5) c = mouth;
                p[y * 8 + x] = c;
            }
        }
        return p;
    }
}
