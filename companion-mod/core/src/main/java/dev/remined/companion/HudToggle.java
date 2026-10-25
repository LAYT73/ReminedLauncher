package dev.remined.companion;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** A HUD element the player can hide with a keybind (Radial binds to it). Remembered across sessions. */
public final class HudToggle {
    public static final HudToggle COMPASS = new HudToggle("remined-compass-hidden");
    public static final HudToggle HINTS = new HudToggle("remined-hints-hidden");

    private final String markerName;
    private volatile boolean hidden;
    private Path marker;

    private HudToggle(String markerName) {
        this.markerName = markerName;
    }

    void init(Path configDir) {
        marker = configDir.resolve(markerName);
        hidden = Files.exists(marker);
    }

    public boolean hidden() {
        return hidden;
    }

    void toggle() {
        hidden = !hidden;
        if (marker == null) return;
        try {
            if (hidden) Files.write(marker, new byte[0]);
            else Files.deleteIfExists(marker);
        } catch (IOException ignored) {
        }
    }
}
