package dev.remined.companion;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class AnchorTest {
    @Test
    void cornerPlacement() {
        assertEquals(344, Anchor.x(Anchor.BR, 6, 50, 400));
        assertEquals(6, Anchor.x(Anchor.TL, 6, 50, 400));
        assertEquals(6, Anchor.y(Anchor.TL, 6, 20, 300));
        assertEquals(274, Anchor.y(Anchor.BL, 6, 20, 300));
    }

    @Test
    void roundTripFromPosition() {
        for (int c = 0; c < 4; c++) {
            int x = Anchor.x(c, 30, 60, 500);
            int y = Anchor.y(c, 12, 40, 300);
            int[] p = Anchor.fromPosition(x, y, 60, 40, 500, 300);
            assertEquals(c, p[0], "corner " + c);
            assertEquals(30, p[1], "dx " + c);
            assertEquals(12, p[2], "dy " + c);
        }
    }

    @Test
    void snapsToMarginsAndCenterWithinEightPixels() {
        Anchor.Snap s = Anchor.snap(10, 100, 40, 20, 400, 300);
        assertEquals(Anchor.MARGIN, s.x);
        assertEquals(Anchor.MARGIN, s.guideX);
        assertEquals(-1, s.guideY);

        s = Anchor.snap(400 - 6 - 40 - 5, 300 - 6 - 20 + 3, 40, 20, 400, 300);
        assertEquals(400 - 6 - 40, s.x);
        assertEquals(400 - 6, s.guideX);
        assertEquals(300 - 6, s.guideY);

        s = Anchor.snap(180, 140, 40, 20, 400, 300);
        assertEquals(200 - 20, s.x);
        assertEquals(200, s.guideX);
        assertEquals(150 - 10, s.y);
        assertEquals(150, s.guideY);
    }

    @Test
    void noSnapBeyondThreshold() {
        Anchor.Snap s = Anchor.snap(20, 50, 40, 20, 400, 300);
        assertEquals(20, s.x);
        assertEquals(50, s.y);
        assertEquals(-1, s.guideX);
        assertEquals(-1, s.guideY);
    }

    @Test
    void parseAndNames() {
        assertEquals(Anchor.TR, Anchor.parse("tr", Anchor.BR));
        assertEquals(Anchor.BR, Anchor.parse("junk", Anchor.BR));
        assertEquals("bl", Anchor.name(Anchor.BL));
    }
}
