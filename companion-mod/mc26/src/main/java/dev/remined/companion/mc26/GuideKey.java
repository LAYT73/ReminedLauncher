package dev.remined.companion.mc26;

import java.lang.reflect.Method;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.KeyMapping;
import net.minecraft.resources.Identifier;

/**
 * Opens the VanillaPro guidebook without the item (lost or thrown away). Modonomicon is called reflectively
 * so the companion has no compile-time dependency on it; only active when the guidebook mod is present.
 */
final class GuideKey {
    private static final Identifier BOOK = Identifier.fromNamespaceAndPath("vanillapro", "guide");

    private GuideKey() {
    }

    static void register(KeyMapping.Category category) {
        if (!FabricLoader.getInstance().isModLoaded("vp_guidebook")
            || !FabricLoader.getInstance().isModLoaded("modonomicon")) return;
        KeyMapping key = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.remined.guide", -1, category));
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            while (key.consumeClick()) open();
        });
    }

    private static void open() {
        try {
            ClassLoader cl = GuideKey.class.getClassLoader();
            Class<?> address = Class.forName("com.klikli_dev.modonomicon.client.gui.book.BookAddress", true, cl);
            Class<?> manager = Class.forName("com.klikli_dev.modonomicon.client.gui.BookGuiManager", true, cl);
            Object addr = address.getMethod("defaultFor", Identifier.class).invoke(null, BOOK);
            Object gui = manager.getMethod("get").invoke(null);
            Method openBook = manager.getMethod("openBook", address);
            openBook.invoke(gui, addr);
        } catch (Throwable e) {
            System.out.println("[remined-companion] could not open guidebook: " + e);
        }
    }
}
