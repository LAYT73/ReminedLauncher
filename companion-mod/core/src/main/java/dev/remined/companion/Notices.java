package dev.remined.companion;

import java.util.ArrayList;
import java.util.List;

/** Notification cards in a screen corner: slide in and out, auto-dismiss, optional join chip with a timer bar. */
final class Notices {
    static final int W = 170;
    static final int MAX_ACTIVE = 3;
    static final long ENTER_MS = 220L;
    static final long LEAVE_MS = 180L;
    static final int GAP = 4;
    private static final int BG = 0xE8121212;
    private static final int BORDER = 0xFF2F2F2F;
    private static final int CHIP = 0xFF2E7D32;
    private static final int BODY = 0xFFB8B8B8;

    private static final class Card {
        final String kind;
        final String title;
        final String body;
        final String headKey;
        final boolean joinable;
        final long bornNs;
        final long lifeMs;
        long leaveNs = -1;
        List<String> lines;

        Card(String kind, String title, String body, String headKey, boolean joinable, long bornNs, long lifeMs) {
            this.kind = kind;
            this.title = title;
            this.body = body;
            this.headKey = headKey;
            this.joinable = joinable;
            this.bornNs = bornNs;
            this.lifeMs = lifeMs;
        }
    }

    private final List<Card> cards = new ArrayList<>();

    void add(String kind, String title, String body, String headKey, long lifeMs, boolean joinable) {
        long now = System.nanoTime();
        int active = 0;
        for (Card c : cards) {
            if (c.leaveNs < 0) active++;
        }
        for (Card c : cards) {
            if (active < MAX_ACTIVE) break;
            if (c.leaveNs < 0) {
                c.leaveNs = now;
                active--;
            }
        }
        cards.add(new Card(kind, title, body, headKey, joinable, now, lifeMs));
    }

    void render(Gfx g, Hub hub, int corner) {
        long now = System.nanoTime();
        for (Card c : cards) {
            if (c.leaveNs < 0 && (now - c.bornNs) / 1_000_000L >= c.lifeMs) c.leaveNs = now;
        }
        for (int i = cards.size() - 1; i >= 0; i--) {
            Card c = cards.get(i);
            if (c.leaveNs >= 0 && (now - c.leaveNs) / 1_000_000L >= LEAVE_MS) cards.remove(i);
        }
        if (cards.isEmpty()) return;

        int sw = g.width();
        int sh = g.height();
        boolean right = Anchor.right(corner);
        boolean bottom = Anchor.bottom(corner);
        int target = right ? sw - Anchor.MARGIN - W : Anchor.MARGIN;
        int start = right ? sw + 4 : -W - 4;
        int offset = 0;
        for (int i = cards.size() - 1; i >= 0; i--) {
            Card c = cards.get(i);
            if (c.lines == null) c.lines = wrap(g, c.body, textWidth(c), 2);
            int h = height(c);
            int y = bottom ? sh - Anchor.MARGIN - offset - h : Anchor.MARGIN + offset;
            offset += h + GAP;
            float ease;
            if (c.leaveNs >= 0) {
                float q = clamp((now - c.leaveNs) / 1_000_000f / LEAVE_MS);
                ease = q * q * q;
            } else {
                float p = clamp((now - c.bornNs) / 1_000_000f / ENTER_MS);
                float inv = 1 - p;
                ease = 1 - inv * inv * inv;
            }
            int x = c.leaveNs >= 0 ? Math.round(target + (start - target) * ease)
                : Math.round(target + (start - target) * (1 - ease));
            draw(g, hub, c, x, y, h, now);
        }
    }

    private static int textWidth(Card c) {
        return W - (c.headKey != null ? 33 : 11) - 8;
    }

    private static int height(Card c) {
        int lines = c.lines == null ? 0 : c.lines.size();
        int h = 7 + 11 + lines * 9 + (c.joinable ? 3 + 11 : 0) + 6;
        if (c.headKey != null) h = Math.max(h, 8 + 16 + 6);
        return c.joinable ? h + 2 : h;
    }

    private void draw(Gfx g, Hub hub, Card c, int x, int y, int h, long now) {
        g.fill(x, y, x + W, y + h, BG);
        g.fill(x, y, x + W, y + 1, BORDER);
        g.fill(x, y + h - 1, x + W, y + h, BORDER);
        g.fill(x + W - 1, y, x + W, y + h, BORDER);
        g.fill(x, y, x + 3, y + h, accent(c.kind));
        int tx = x + (c.headKey != null ? 33 : 11);
        if (c.headKey != null) g.head(c.headKey, x + 11, y + (h - 16) / 2, 16);
        g.text(c.title, tx, y + 7, 0xFFFFFFFF, true);
        int ly = y + 18;
        if (c.lines != null) {
            for (String line : c.lines) {
                g.text(line, tx, ly, BODY, false);
                ly += 9;
            }
        }
        if (c.joinable) {
            String label = "[" + hub.keyName("join") + "] " + hub.translate("remined.notice.join");
            int cw = g.textWidth(label) + 8;
            int cy = ly + 3;
            g.fill(tx, cy, tx + cw, cy + 11, CHIP);
            g.text(label, tx + 4, cy + 2, 0xFFFFFFFF, false);
            float left = 1 - (now - c.bornNs) / 1_000_000f / c.lifeMs;
            int bar = Math.round((W - 3) * clamp(left));
            g.fill(x + 3, y + h - 2, x + 3 + bar, y + h, accent(c.kind));
        }
    }

    static int accent(String kind) {
        if ("friend".equals(kind)) return 0xFF55FF55;
        if ("request".equals(kind)) return 0xFFFFC857;
        if ("chat".equals(kind)) return 0xFF7AB7FF;
        if ("invite".equals(kind)) return 0xFF55FF55;
        return 0xFFAAAAAA;
    }

    /** Word-wraps text into at most maxLines lines; the last line ends with "..." when cut. */
    static List<String> wrap(Gfx g, String text, int maxW, int maxLines) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        String rest = text.trim();
        while (!rest.isEmpty()) {
            if (out.size() == maxLines - 1) {
                out.add(VoiceHud.trimTo(g, rest, maxW));
                break;
            }
            int end = rest.length();
            while (end > 1 && g.textWidth(rest.substring(0, end)) > maxW) end--;
            if (end < rest.length()) {
                int sp = rest.lastIndexOf(' ', end);
                if (sp > 0) end = sp;
            }
            out.add(rest.substring(0, end).trim());
            rest = rest.substring(end).trim();
        }
        return out;
    }

    private static float clamp(float v) {
        return Math.max(0f, Math.min(1f, v));
    }
}
