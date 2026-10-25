package dev.remined.companion;

/** Laptop battery badge for container screens, drawn top-left in the Overgrown palette. */
final class BatteryHud {
    static final int X = 6;
    static final int Y = 6;
    static final int H = 12;
    static final int BG = 0xE63E2B28;
    static final int OUTLINE = 0xFF4A3230;
    static final int RING = 0xB0E9D7C1;
    static final int CREAM = 0xFFE9D7C1;
    static final int TEXT = 0xFFF2E6D4;
    static final int GREEN = 0xFFA7C136;
    static final int AMBER = 0xFFE0B84A;
    static final int RED = 0xFFD9534F;

    private static final String[] BOLT = {"  #", " ##", "###", " ##", "##", "#"};
    private static final int BOLT_W = 3;

    void render(Gfx g, Protocol.Battery b) {
        String label = b.level + "%";
        int textX = 18 + (b.charging ? BOLT_W + 3 : 0);
        int w = textX + g.textWidth(label) + 4;
        g.push();
        g.translate(X, Y);
        g.fill(0, 0, w, H, OUTLINE);
        g.fill(1, 1, w - 1, H - 1, BG);
        // inner cream ring, 1px inside the outline
        g.fill(1, 1, w - 1, 2, RING);
        g.fill(1, H - 2, w - 1, H - 1, RING);
        g.fill(1, 2, 2, H - 2, RING);
        g.fill(w - 2, 2, w - 1, H - 2, RING);
        g.fill(2, 2, w - 2, H - 2, BG);
        // battery body 10x6 with a 1x2 nub
        g.fill(4, 3, 14, 9, CREAM);
        g.fill(14, 4, 15, 8, CREAM);
        g.fill(5, 4, 13, 8, BG);
        int fill = b.level <= 0 ? 0 : Math.max(1, Math.round(8f * b.level / 100f));
        g.fill(5, 4, 5 + fill, 8, b.level > 50 ? GREEN : b.level >= 20 ? AMBER : RED);
        if (b.charging) {
            for (int r = 0; r < BOLT.length; r++) {
                for (int c = 0; c < BOLT[r].length(); c++) {
                    if (BOLT[r].charAt(c) == '#') g.fill(17 + c, 3 + r, 18 + c, 4 + r, AMBER);
                }
            }
        }
        g.text(label, textX, 2, TEXT, false);
        g.pop();
    }
}
