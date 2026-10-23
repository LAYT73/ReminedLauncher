package dev.remined.companion;

/**
 * Drawing adapter implemented by the version backends. Coordinates are GUI pixels after the current
 * transform, colors are ARGB with explicit alpha.
 */
public interface Gfx {
    int width();

    int height();

    int textWidth(String s);

    void text(String s, int x, int y, int argb, boolean shadow);

    void fill(int x1, int y1, int x2, int y2, int argb);

    void push();

    void pop();

    void translate(float x, float y);

    void scale(float s);

    /** Draws the 8x8 head texture registered under key, scaled to size x size. */
    void head(String key, int x, int y, int size);

    void scissor(int x1, int y1, int x2, int y2);

    void unscissor();
}
