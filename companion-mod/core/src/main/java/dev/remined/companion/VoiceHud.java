package dev.remined.companion;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Voice HUD: skin-head rows with a speaking glow, mute and deafen badges and optional name pills. */
final class VoiceHud {
    static final int HEAD = 16;
    static final int PAD = 3;
    static final int ROW_GAP = 2;
    static final int COL_GAP = 4;
    static final int PILL_H = 11;
    static final int PILL_TEXT_MAX = 72;
    static final int MAX_ROWS = 8;
    static final int GREEN = 0xFF55FF55;
    static final int RED = 0xFFFF5555;
    static final int BADGE = 9;
    static final String PREVIEW_SELF = "preview-self";

    private static final String[] MIC = {" ### ", "#   #", "#   #", " ### ", "  #  ", " ### "};
    private static final String[] PHONES = {" ### ", "#   #", "#   #", "##.##", "##.##", "#...#"};

    private final Hub hub;
    private final Map<String, Float> glow = new HashMap<>();
    private long lastNs;

    /** One drawn entry: a member row, or the "+N" overflow pill when member is null. */
    private static final class Row {
        Protocol.Member member;
        String name;
        boolean self;
        int pillW;
        int width;
        int height;
    }

    VoiceHud(Hub hub) {
        this.hub = hub;
    }

    /** Draws the HUD, or the settings preview with sample members. Returns {x, y, w, h} in GUI pixels, or null. */
    int[] render(Gfx g, boolean preview) {
        Config cfg = hub.cfg();
        long now = System.nanoTime();
        float dt = lastNs == 0 ? 0.016f : Math.min(0.2f, (now - lastNs) / 1e9f);
        lastNs = now;
        float t = (float) (now / 1e9);

        List<Protocol.Member> all = members(preview, t);
        if (all.isEmpty()) {
            glow.clear();
            return null;
        }
        Set<String> seen = new HashSet<>();
        for (Protocol.Member m : all) {
            seen.add(m.id);
            float cur = glowOf(m.id);
            float target = m.speaking ? 1f : 0f;
            glow.put(m.id, cur + (target - cur) * Math.min(1f, dt * 9f));
        }
        glow.keySet().retainAll(seen);

        String self = hub.voice().active ? hub.voice().self : PREVIEW_SELF;
        List<Row> rows = rows(g, cfg, all, self);
        int cw = 0;
        int ch = 0;
        if (cfg.hudRow) {
            for (Row r : rows) {
                cw += r.width;
                ch = Math.max(ch, r.height);
            }
            cw += COL_GAP * Math.max(0, rows.size() - 1);
        } else {
            for (Row r : rows) {
                cw = Math.max(cw, r.width);
                ch += r.height;
            }
            ch += ROW_GAP * Math.max(0, rows.size() - 1);
        }
        double s = cfg.scale;
        int bw = (int) Math.round((cw + PAD * 2) * s);
        int bh = (int) Math.round((ch + PAD * 2) * s);
        int x = Anchor.x(cfg.hudCorner, cfg.hudDx, bw, g.width());
        int y = Anchor.y(cfg.hudCorner, cfg.hudDy, bh, g.height());

        int pillBg = alpha(cfg.opacity / 100f);
        boolean right = Anchor.right(cfg.hudCorner);
        g.push();
        g.translate(x, y);
        g.scale((float) s);
        int cx = PAD;
        int cy = PAD;
        for (Row r : rows) {
            if (cfg.hudRow) {
                drawRow(g, r, cx, PAD + (ch - r.height) / 2, right, pillBg, t);
                cx += r.width + COL_GAP;
            } else {
                drawRow(g, r, right ? PAD + cw - r.width : PAD, cy, right, pillBg, t);
                cy += r.height + ROW_GAP;
            }
        }
        g.pop();
        return new int[] {x, y, bw, bh};
    }

    private List<Protocol.Member> members(boolean preview, float t) {
        List<Protocol.Member> out = new ArrayList<>();
        Protocol.Voice v = hub.voice();
        if (v.active) {
            out.addAll(v.members);
            return out;
        }
        if (!preview) return out;
        out.add(new Protocol.Member(PREVIEW_SELF, "You", (t % 4f) < 1.6f, false, false));
        out.add(new Protocol.Member("preview-mira", "Mira", false, true, false));
        out.add(new Protocol.Member("preview-dan", "Dan", Math.sin(t * 1.4 + 1.0) > 0.0, false, false));
        return out;
    }

    private List<Row> rows(Gfx g, Config cfg, List<Protocol.Member> all, String self) {
        List<Protocol.Member> ordered = new ArrayList<>();
        for (Protocol.Member m : all) {
            if (m.id.equals(self)) ordered.add(m);
        }
        for (Protocol.Member m : all) {
            if (!m.id.equals(self)) ordered.add(m);
        }
        List<Protocol.Member> visible = new ArrayList<>();
        for (Protocol.Member m : ordered) {
            if (!cfg.onlySpeaking || m.speaking) visible.add(m);
        }
        int limit = visible.size() > MAX_ROWS ? MAX_ROWS - 1 : visible.size();
        List<Row> out = new ArrayList<>();
        for (int i = 0; i < limit; i++) {
            Protocol.Member m = visible.get(i);
            Row r = new Row();
            r.member = m;
            r.self = m.id.equals(self);
            boolean showName = cfg.names == Config.NAMES_ALWAYS
                || (cfg.names == Config.NAMES_SPEAKING && m.speaking);
            if (showName) {
                r.name = trimTo(g, m.name, PILL_TEXT_MAX);
                r.pillW = g.textWidth(r.name) + 6;
            }
            r.width = HEAD + (r.pillW > 0 ? COL_GAP + r.pillW : 0);
            r.height = HEAD;
            out.add(r);
        }
        if (visible.size() > limit) {
            Row r = new Row();
            r.name = "+" + (visible.size() - limit);
            r.pillW = g.textWidth(r.name) + 6;
            r.width = r.pillW;
            r.height = PILL_H;
            out.add(r);
        }
        return out;
    }

    /** Draws one row at (x, y) in HUD-local base units. Member rows put the name on the inner side. */
    private void drawRow(Gfx g, Row r, int x, int y, boolean right, int pillBg, float t) {
        if (r.member == null) {
            g.fill(x, y, x + r.width, y + PILL_H, pillBg);
            g.text(r.name, x + 3, y + 2, 0xFFE0E0E0, false);
            return;
        }
        Protocol.Member m = r.member;
        int hx = right ? x + (r.pillW > 0 ? r.pillW + COL_GAP : 0) : x;
        int px = right ? x : hx + HEAD + COL_GAP;
        int py = y + (HEAD - PILL_H) / 2;
        if (r.pillW > 0) {
            g.fill(px, py, px + r.pillW, py + PILL_H, pillBg | (r.self ? 0x001E3A5F : 0));
            g.text(r.name, px + 3, py + 2, m.speaking ? GREEN : 0xFFF0F0F0, false);
        }
        float gv = glowOf(m.id);
        if (gv > 0.01f) {
            float pulse = 0.7f + 0.3f * (float) Math.sin(t * 5.0);
            int glowArgb = alpha(Math.min(1f, gv * pulse * 0.6f)) | (GREEN & 0x00FFFFFF);
            g.fill(hx - 3, y - 3, hx + HEAD + 3, y + HEAD + 3, glowArgb);
        }
        g.fill(hx - 1, y - 1, hx + HEAD + 1, y + HEAD + 1, mix(0xFF000000, GREEN, gv));
        g.head(hub.heads.keyFor(m.id), hx, y, HEAD);
        if (m.muted || m.deafened) {
            drawBadge(g, hx + HEAD - BADGE + 2, y + HEAD - BADGE + 2, m.deafened);
        }
    }

    private static void drawBadge(Gfx g, int bx, int by, boolean deaf) {
        g.fill(bx - 1, by - 1, bx + BADGE + 1, by + BADGE + 1, 0xFF000000);
        g.fill(bx, by, bx + BADGE, by + BADGE, 0xFF1E1E1E);
        drawGlyph(g, deaf ? PHONES : MIC, bx + 2, by + 1, 0xFFFFFFFF);
        for (int i = 0; i < BADGE - 2; i++) {
            g.fill(bx + 1 + i, by + 1 + i, bx + 2 + i, by + 2 + i, RED);
        }
    }

    private static void drawGlyph(Gfx g, String[] rows, int x, int y, int color) {
        for (int r = 0; r < rows.length; r++) {
            for (int c = 0; c < rows[r].length(); c++) {
                if (rows[r].charAt(c) == '#') g.fill(x + c, y + r, x + c + 1, y + r + 1, color);
            }
        }
    }

    private float glowOf(String id) {
        Float f = glow.get(id);
        return f == null ? 0f : f;
    }

    /** Shortens s with "..." so it fits maxW. */
    static String trimTo(Gfx g, String s, int maxW) {
        if (g.textWidth(s) <= maxW) return s;
        String t = s;
        while (t.length() > 1 && g.textWidth(t + "...") > maxW) t = t.substring(0, t.length() - 1);
        return t + "...";
    }

    static int alpha(float f) {
        return (int) (Math.max(0f, Math.min(1f, f)) * 255f) << 24;
    }

    static int mix(int a, int b, float t) {
        int out = 0;
        for (int shift = 0; shift <= 24; shift += 8) {
            int ca = (a >>> shift) & 0xFF;
            int cb = (b >>> shift) & 0xFF;
            out |= ((int) (ca + (cb - ca) * t) & 0xFF) << shift;
        }
        return out;
    }
}
