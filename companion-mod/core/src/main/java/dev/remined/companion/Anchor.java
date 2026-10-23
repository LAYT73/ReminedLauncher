package dev.remined.companion;

/**
 * Screen-corner anchoring for HUD placement. A position is stored as a corner plus the distance from
 * that screen corner to the same corner of the box, so it survives resolution and GUI scale changes.
 * Pure math, unit tested.
 */
final class Anchor {
    static final int TL = 0;
    static final int TR = 1;
    static final int BL = 2;
    static final int BR = 3;
    static final int MARGIN = 6;
    static final int SNAP = 8;

    private Anchor() {
    }

    static int parse(String name, int def) {
        if ("tl".equals(name)) return TL;
        if ("tr".equals(name)) return TR;
        if ("bl".equals(name)) return BL;
        if ("br".equals(name)) return BR;
        return def;
    }

    static String name(int corner) {
        switch (corner) {
            case TL: return "tl";
            case TR: return "tr";
            case BL: return "bl";
            default: return "br";
        }
    }

    static boolean right(int corner) {
        return corner == TR || corner == BR;
    }

    static boolean bottom(int corner) {
        return corner == BL || corner == BR;
    }

    /** Left edge of a box of width w anchored to corner, dx pixels in from that screen edge. */
    static int x(int corner, int dx, int w, int screenW) {
        return right(corner) ? screenW - dx - w : dx;
    }

    /** Top edge of a box of height h anchored to corner, dy pixels in from that screen edge. */
    static int y(int corner, int dy, int h, int screenH) {
        return bottom(corner) ? screenH - dy - h : dy;
    }

    /** Result of snapping a dragged box. Guide values are -1 when that axis did not snap. */
    static final class Snap {
        int x;
        int y;
        int guideX = -1;
        int guideY = -1;
    }

    /** Snaps a free top-left position to the margin lines and the center, within SNAP pixels. */
    static Snap snap(int x, int y, int w, int h, int screenW, int screenH) {
        Snap s = new Snap();
        s.x = x;
        s.y = y;
        if (Math.abs(x - MARGIN) <= SNAP) {
            s.x = MARGIN;
            s.guideX = MARGIN;
        } else if (Math.abs(x + w - (screenW - MARGIN)) <= SNAP) {
            s.x = screenW - MARGIN - w;
            s.guideX = screenW - MARGIN;
        } else if (Math.abs(x + w / 2 - screenW / 2) <= SNAP) {
            s.x = screenW / 2 - w / 2;
            s.guideX = screenW / 2;
        }
        if (Math.abs(y - MARGIN) <= SNAP) {
            s.y = MARGIN;
            s.guideY = MARGIN;
        } else if (Math.abs(y + h - (screenH - MARGIN)) <= SNAP) {
            s.y = screenH - MARGIN - h;
            s.guideY = screenH - MARGIN;
        } else if (Math.abs(y + h / 2 - screenH / 2) <= SNAP) {
            s.y = screenH / 2 - h / 2;
            s.guideY = screenH / 2;
        }
        return s;
    }

    /** Nearest screen corner and offsets for a box at (x, y): returns {corner, dx, dy}. */
    static int[] fromPosition(int x, int y, int w, int h, int screenW, int screenH) {
        boolean r = x + w / 2 > screenW / 2;
        boolean b = y + h / 2 > screenH / 2;
        int corner = r ? (b ? BR : TR) : (b ? BL : TL);
        int dx = right(corner) ? screenW - (x + w) : x;
        int dy = bottom(corner) ? screenH - (y + h) : y;
        return new int[] {corner, Math.max(0, dx), Math.max(0, dy)};
    }
}
