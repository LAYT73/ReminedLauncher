package dev.remined.companion;

/** Content of a Remined screen. Backends forward the Minecraft screen callbacks here. */
public interface Surface {
    void render(Gfx g, int mouseX, int mouseY, float partial);

    boolean mouseDown(double x, double y, int button);

    void mouseDrag(double x, double y, int button);

    void mouseUp(double x, double y, int button);

    boolean scroll(double x, double y, double delta);

    boolean key(int keyCode);

    /** Called once when the Remined screen goes away. */
    void closed();
}
