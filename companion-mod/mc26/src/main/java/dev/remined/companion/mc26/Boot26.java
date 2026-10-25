package dev.remined.companion.mc26;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import dev.remined.companion.Gfx;
import dev.remined.companion.Platform;
import dev.remined.companion.Surface;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.GameType;

/**
 * Minecraft 26.x backend (official Mojang names, no mappings). Compiled against 26.1. The direct members used
 * here (font, options, getTextureManager, the GuiGraphicsExtractor/Screen/KeyMapping calls) were checked
 * against the 26.1, 26.2 and 26.3 jars. Screen access and HUD visibility go through reflection because 26.2
 * moved them to Gui (Gui.screen(), Gui.hud.isHidden()).
 */
public final class Boot26 implements Platform {
    private static final String NS = "remined_companion";

    private final Map<String, KeyMapping> keys = new HashMap<>();
    private KeyMapping.Category category;
    private Field screenField;
    private Field guiField;
    private boolean hudResolved;
    private Field hideGuiField;
    private Field hudGuiField;
    private Field hudField;
    private Method isHiddenMethod;

    public Boot26() {
        TitleScapeTweak.register();
        CrosshairHints.register();
    }

    @Override
    public void registerKey(String id, String translationKey, String defaultKey) {
        if (category == null) {
            category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("remined", "main"));
            GuideKey.register(category);
        }
        int code = defaultKey == null ? -1 : constant("KEY_" + defaultKey, -1);
        keys.put(id, KeyMappingHelper.registerKeyMapping(new KeyMapping(translationKey, code, category)));
    }

    @Override
    public boolean consumeClick(String id) {
        KeyMapping km = keys.get(id);
        return km != null && km.consumeClick();
    }

    @Override
    public String keyName(String id) {
        KeyMapping km = keys.get(id);
        return km == null ? "" : km.getTranslatedKeyMessage().getString();
    }

    @Override
    public int keyCode(String name) {
        return constant("KEY_" + name, Integer.MIN_VALUE);
    }

    @Override
    public int mouseLeft() {
        return constant("MOUSE_BUTTON_LEFT", 0);
    }

    @Override
    public void onTick(Runnable tick) {
        ClientTickEvents.END_CLIENT_TICK.register(mc -> tick.run());
    }

    @Override
    public void onHud(Hud hud) {
        HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(NS, "hud"),
            (GuiGraphicsExtractor g, DeltaTracker dt) -> hud.render(new Gfx26(g)));
    }

    @Override
    public void onContainerScreen(Hud hud) {
        ScreenEvents.AFTER_INIT.register((mc, screen, w, h) -> {
            if (screen instanceof AbstractContainerScreen<?>) {
                ScreenEvents.afterExtract(screen).register((s, g, mx, my, delta) -> hud.render(new Gfx26(g)));
            }
        });
    }

    /** Options.hideGui on 26.1; Minecraft.gui.hud.isHidden() on 26.2+. Unknown layout: not hidden. */
    @Override
    public boolean hudHidden() {
        try {
            Minecraft mc = Minecraft.getInstance();
            if (!hudResolved) resolveHudHidden(mc);
            if (hideGuiField != null) return hideGuiField.getBoolean(mc.options);
            if (hudGuiField != null) {
                Object hud = hudField.get(hudGuiField.get(mc));
                return hud != null && Boolean.TRUE.equals(isHiddenMethod.invoke(hud));
            }
        } catch (Throwable e) {
            // no hud visibility API we know: treat the HUD as shown
        }
        return false;
    }

    private void resolveHudHidden(Minecraft mc) {
        hudResolved = true;
        try {
            Field f = mc.options.getClass().getField("hideGui");
            if (f.getType() == boolean.class) {
                hideGuiField = f;
                return;
            }
        } catch (ReflectiveOperationException e) {
            // 26.2+ has no Options.hideGui
        }
        try {
            Field gui = Minecraft.class.getField("gui");
            Field hud = gui.getType().getField("hud");
            isHiddenMethod = hud.getType().getMethod("isHidden");
            hudField = hud;
            hudGuiField = gui;
        } catch (ReflectiveOperationException e) {
            // neither layout found
        }
    }

    @Override
    public boolean screenOpen() {
        try {
            return currentScreen(Minecraft.getInstance()) != null;
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }

    @Override
    public void openSettings(Surface surface) {
        setScreen(new SettingsScreen(surface));
    }

    @Override
    public void closeSettings() {
        try {
            if (currentScreen(Minecraft.getInstance()) instanceof SettingsScreen) setScreen(null);
        } catch (ReflectiveOperationException e) {
            // no screen API we know: nothing to close
        }
    }

    @Override
    public void uploadHead(String key, int[] argb) {
        Minecraft mc = Minecraft.getInstance();
        Identifier id = head(key);
        NativeImage img = new NativeImage(8, 8, false);
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                img.setPixel(x, y, argb[y * 8 + x]);
            }
        }
        DynamicTexture tex = new DynamicTexture(() -> "remined_head", img);
        mc.getTextureManager().release(id);
        mc.getTextureManager().register(id, tex);
        tex.upload();
    }

    @Override
    public void releaseHead(String key) {
        Minecraft.getInstance().getTextureManager().release(head(key));
    }

    @Override
    public int lanPort() {
        IntegratedServer server = Minecraft.getInstance().getSingleplayerServer();
        if (server == null) return -1;
        return server.isPublished() ? server.getPort() : 0;
    }

    @Override
    public boolean publishLan(int port, boolean cheats) {
        Minecraft mc = Minecraft.getInstance();
        IntegratedServer server = mc.getSingleplayerServer();
        if (server == null || server.isPublished() || mc.gameMode == null) return false;
        try {
            if (!publishServer(server, mc.gameMode.getPlayerMode(), cheats, port)) return false;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("publishServer not found", e);
        }
        // publishServer only logs, so post the line the LAN screen shows.
        mc.gui.getChat().addClientSystemMessage(Component.translatable("commands.publish.started", port));
        return true;
    }

    /**
     * publishServer changed per 26.x release: (GameType, cheats, port) through 26.1.2, (scope, GameType, cheats, port)
     * in 26.2, (scope, cheats, port) in 26.3, where the game mode is not an argument. The scope type does not exist
     * before 26.2, so the overload is picked by reflection; the game mode is passed when the overload takes it.
     */
    private static boolean publishServer(IntegratedServer server, GameType mode, boolean cheats, int port)
            throws ReflectiveOperationException {
        for (Method m : server.getClass().getMethods()) {
            if (!"publishServer".equals(m.getName())) continue;
            Class<?>[] p = m.getParameterTypes();
            Object[] args;
            if (p.length == 3 && p[0] == GameType.class) {
                args = new Object[] {mode, cheats, port};
            } else if (p.length == 4 && p[1] == GameType.class) {
                args = new Object[] {lanScope(p[0]), mode, cheats, port};
            } else if (p.length == 3 && p[1] == boolean.class) {
                args = new Object[] {lanScope(p[0]), cheats, port};
            } else {
                continue;
            }
            return Boolean.TRUE.equals(m.invoke(server, args));
        }
        throw new NoSuchMethodException("IntegratedServer.publishServer");
    }

    private static Object lanScope(Class<?> scope) {
        for (Object c : scope.getEnumConstants()) {
            if ("LAN".equals(((Enum<?>) c).name())) return c;
        }
        throw new IllegalStateException("no LAN scope");
    }

    @Override
    public String translate(String key) {
        return Component.translatable(key).getString();
    }

    private static Identifier head(String key) {
        return Identifier.fromNamespaceAndPath(NS, "head/" + key);
    }

    private static int constant(String field, int fallback) {
        try {
            return InputConstants.class.getField(field).getInt(null);
        } catch (Throwable e) {
            return fallback;
        }
    }

    /** Current screen: Minecraft.screen on 26.1, Minecraft.gui.screen() on later versions. */
    private Object currentScreen(Minecraft mc) throws ReflectiveOperationException {
        if (screenField == null && guiField == null) {
            try {
                screenField = Minecraft.class.getField("screen");
            } catch (NoSuchFieldException e) {
                guiField = Minecraft.class.getField("gui");
            }
        }
        if (screenField != null) return screenField.get(mc);
        Object gui = guiField.get(mc);
        Method m = gui.getClass().getMethod("screen");
        return m.invoke(gui);
    }

    /** Minecraft.setScreen on 26.1, Gui.setScreen on later versions. */
    private static void setScreen(Screen screen) {
        Minecraft mc = Minecraft.getInstance();
        try {
            Minecraft.class.getMethod("setScreen", Screen.class).invoke(mc, screen);
        } catch (ReflectiveOperationException e) {
            try {
                Object gui = Minecraft.class.getField("gui").get(mc);
                gui.getClass().getMethod("setScreen", Screen.class).invoke(gui, screen);
            } catch (ReflectiveOperationException inner) {
                throw new IllegalStateException("no setScreen", inner);
            }
        }
    }

    /** Drawing adapter over GuiGraphicsExtractor. */
    private static final class Gfx26 implements Gfx {
        private final GuiGraphicsExtractor g;

        Gfx26(GuiGraphicsExtractor g) {
            this.g = g;
        }

        private static Font font() {
            return Minecraft.getInstance().font;
        }

        @Override
        public int width() {
            return g.guiWidth();
        }

        @Override
        public int height() {
            return g.guiHeight();
        }

        @Override
        public int textWidth(String s) {
            return font().width(s);
        }

        @Override
        public void text(String s, int x, int y, int argb, boolean shadow) {
            g.text(font(), s, x, y, argb, shadow);
        }

        @Override
        public void fill(int x1, int y1, int x2, int y2, int argb) {
            g.fill(x1, y1, x2, y2, argb);
        }

        @Override
        public void push() {
            g.pose().pushMatrix();
        }

        @Override
        public void pop() {
            g.pose().popMatrix();
        }

        @Override
        public void translate(float x, float y) {
            g.pose().translate(x, y);
        }

        @Override
        public void scale(float s) {
            g.pose().scale(s, s);
        }

        @Override
        public void head(String key, int x, int y, int size) {
            g.blit(Boot26.head(key), x, y, x + size, y + size, 0f, 1f, 0f, 1f);
        }

        @Override
        public void scissor(int x1, int y1, int x2, int y2) {
            g.enableScissor(x1, y1, x2, y2);
        }

        @Override
        public void unscissor() {
            g.disableScissor();
        }
    }

    /** Our settings screen. The surface draws after the vanilla background; input goes to the surface first. */
    private static final class SettingsScreen extends Screen {
        private final Surface surface;

        SettingsScreen(Surface surface) {
            super(Component.literal("Remined"));
            this.surface = surface;
        }

        @Override
        public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partial) {
            super.extractRenderState(g, mouseX, mouseY, partial);
            surface.render(new Gfx26(g), mouseX, mouseY, partial);
        }

        @Override
        public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
            return surface.mouseDown(event.x(), event.y(), event.button()) || super.mouseClicked(event, doubleClick);
        }

        @Override
        public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
            surface.mouseDrag(event.x(), event.y(), event.button());
            return true;
        }

        @Override
        public boolean mouseReleased(MouseButtonEvent event) {
            surface.mouseUp(event.x(), event.y(), event.button());
            return true;
        }

        @Override
        public boolean mouseScrolled(double x, double y, double horizontal, double vertical) {
            return surface.scroll(x, y, vertical) || super.mouseScrolled(x, y, horizontal, vertical);
        }

        @Override
        public boolean keyPressed(KeyEvent event) {
            return surface.key(event.key()) || super.keyPressed(event);
        }

        @Override
        public void onClose() {
            surface.closed();
            super.onClose();
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }
}
