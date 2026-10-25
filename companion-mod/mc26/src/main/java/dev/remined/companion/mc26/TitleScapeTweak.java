package dev.remined.companion.mc26;

import java.lang.reflect.Field;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * TitleScape squeezes its background-picker button into the title screen's icon row, which already overflows
 * with modded buttons. The modpack ships the background in config, so drop the button after init.
 */
final class TitleScapeTweak {
    private static boolean logged;

    private TitleScapeTweak() {
    }

    static void register() {
        if (!FabricLoader.getInstance().isModLoaded("titlescape")) return;
        ScreenEvents.AFTER_INIT.register((mc, screen, w, h) -> {
            if (!(screen instanceof TitleScreen)) return;
            try {
                Field f = TitleScreen.class.getDeclaredField("titlescape$menuButton");
                f.setAccessible(true);
                Object button = f.get(screen);
                if (button != null && Screens.getWidgets(screen).remove(button) && !logged) {
                    logged = true;
                    System.out.println("[remined-companion] hid TitleScape title-screen button");
                }
            } catch (Throwable e) {
                if (!logged) {
                    logged = true;
                    System.out.println("[remined-companion] could not hide TitleScape button: " + e);
                }
            }
        });
    }
}
