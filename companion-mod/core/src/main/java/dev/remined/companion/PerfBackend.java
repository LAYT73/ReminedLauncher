package dev.remined.companion;

import java.util.List;
import java.util.Set;

/**
 * Version services of the Performance tab implemented by a UI backend (mc26). Iris, Distant Horizons and mods are
 * reached from core. Everything runs on the client thread.
 */
public interface PerfBackend {
    /** True once the title screen (or a world) is up and no loading overlay is showing. */
    boolean ready();

    /** Current value of a vanilla video option (Long/Double/Boolean/String), or null when it is not supported. */
    Object option(String name);

    /** Sets a vanilla video option. Returns true when a resource reload is needed to show it. */
    boolean setOption(String name, Object value);

    void saveOptions();

    /** Selected resource pack ids, lowest priority first. */
    List<String> selectedPacks();

    Set<String> availablePacks();

    /** Selects exactly these packs and records them in the options, without reloading. */
    void setSelectedPacks(List<String> ids);

    void reloadPacks();

    /** Asks the game to quit. */
    void quit();
}
