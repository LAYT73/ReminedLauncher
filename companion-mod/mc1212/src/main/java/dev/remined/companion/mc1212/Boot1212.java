package dev.remined.companion.mc1212;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import dev.remined.companion.Gfx;
import dev.remined.companion.Platform;
import dev.remined.companion.Surface;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

/**
 * Minecraft 1.21.2 to 1.21.5 backend (RenderType blit, NativeImage.setPixel ARGB). Adapter only:
 * all UI logic lives in core. Instantiated reflectively by Companion.
 */
public final class Boot1212 implements Platform {
    private static final String NS = "remined_companion";
    private static final String CATEGORY = "key.categories.remined";

    private final Map<String, KeyMapping> keys = new HashMap<>();

    public Boot1212() {
    }

    @Override
    public void registerKey(String id, String translationKey, String defaultKey) {
        int code = defaultKey == null ? -1 : constant("KEY_" + defaultKey, -1);
        KeyMapping km = new KeyMapping(translationKey, InputConstants.Type.KEYSYM, code, CATEGORY);
        keys.put(id, KeyBindingHelper.registerKeyBinding(km));
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
        HudRenderCallback.EVENT.register((GuiGraphics g, DeltaTracker delta) -> hud.render(new Gfx1212(g)));
    }

    @Override
    public boolean hudHidden() {
        return Minecraft.getInstance().options.hideGui;
    }

    @Override
    public boolean screenOpen() {
        return Minecraft.getInstance().screen != null;
    }

    @Override
    public void openSettings(Surface surface) {
        Minecraft.getInstance().setScreen(new SettingsScreen(surface));
    }

    @Override
    public void closeSettings() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.screen instanceof SettingsScreen) mc.setScreen(null);
    }

    @Override
    public void uploadHead(String key, int[] argb) {
        Minecraft mc = Minecraft.getInstance();
        ResourceLocation id = head(key);
        NativeImage img = new NativeImage(NativeImage.Format.RGBA, 8, 8, false);
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                // setPixel takes ARGB from 1.21.2 on (setPixelRGBA with ABGR before that).
                img.setPixel(x, y, argb[y * 8 + x]);
            }
        }
        DynamicTexture tex = newTexture(img);
        mc.getTextureManager().release(id);
        mc.getTextureManager().register(id, tex);
        tex.upload();
    }

    @Override
    public void releaseHead(String key) {
        Minecraft.getInstance().getTextureManager().release(head(key));
    }

    @Override
    public String translate(String key) {
        return Component.translatable(key).getString();
    }

    /**
     * DynamicTexture(NativeImage) up to 1.21.4, DynamicTexture(Supplier, NativeImage) from 1.21.5. Only called on
     * upload, not per frame, so the lookup is not cached.
     */
    private static DynamicTexture newTexture(NativeImage img) {
        try {
            try {
                return DynamicTexture.class.getConstructor(Supplier.class, NativeImage.class)
                    .newInstance((Supplier<String>) () -> "remined_head", img);
            } catch (NoSuchMethodException e) {
                return DynamicTexture.class.getConstructor(NativeImage.class).newInstance(img);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("no DynamicTexture constructor", e);
        }
    }

    private static ResourceLocation head(String key) {
        return ResourceLocation.fromNamespaceAndPath(NS, "head/" + key);
    }

    private static int constant(String field, int fallback) {
        try {
            return InputConstants.class.getField(field).getInt(null);
        } catch (Throwable e) {
            return fallback;
        }
    }

    /** Drawing adapter over GuiGraphics. Creation is cheap; one per frame. */
    private static final class Gfx1212 implements Gfx {
        private final GuiGraphics g;

        Gfx1212(GuiGraphics g) {
            this.g = g;
        }

        private static Font font() {
            return Minecraft.getInstance().font;
        }

        @Override
        public int width() {
            return Minecraft.getInstance().getWindow().getGuiScaledWidth();
        }

        @Override
        public int height() {
            return Minecraft.getInstance().getWindow().getGuiScaledHeight();
        }

        @Override
        public int textWidth(String s) {
            return font().width(s);
        }

        @Override
        public void text(String s, int x, int y, int argb, boolean shadow) {
            g.drawString(font(), s, x, y, argb, shadow);
        }

        @Override
        public void fill(int x1, int y1, int x2, int y2, int argb) {
            g.fill(x1, y1, x2, y2, argb);
        }

        @Override
        public void push() {
            g.pose().pushPose();
        }

        @Override
        public void pop() {
            g.pose().popPose();
        }

        @Override
        public void translate(float x, float y) {
            g.pose().translate(x, y, 0f);
        }

        @Override
        public void scale(float s) {
            g.pose().scale(s, s, 1f);
        }

        @Override
        public void head(String key, int x, int y, int size) {
            g.blit(RenderType::guiTextured, Boot1212.head(key), x, y, 0f, 0f, size, size, 8, 8, 8, 8);
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

    /** Our settings screen: the surface draws over the vanilla background, input goes to the surface first. */
    private static final class SettingsScreen extends Screen {
        private final Surface surface;

        SettingsScreen(Surface surface) {
            super(Component.literal("Remined"));
            this.surface = surface;
        }

        @Override
        public void render(GuiGraphics g, int mouseX, int mouseY, float partial) {
            super.render(g, mouseX, mouseY, partial);
            surface.render(new Gfx1212(g), mouseX, mouseY, partial);
        }

        @Override
        public boolean mouseClicked(double x, double y, int button) {
            return surface.mouseDown(x, y, button) || super.mouseClicked(x, y, button);
        }

        @Override
        public boolean mouseDragged(double x, double y, int button, double dx, double dy) {
            surface.mouseDrag(x, y, button);
            return true;
        }

        @Override
        public boolean mouseReleased(double x, double y, int button) {
            surface.mouseUp(x, y, button);
            return true;
        }

        // 1.20.1 has the 3-argument form, 1.20.2 and later the 4-argument form. Both are declared without @Override
        // and neither calls super: this screen has no vanilla child widgets, so super returned false anyway.
        public boolean mouseScrolled(double x, double y, double delta) {
            return surface.scroll(x, y, delta);
        }

        public boolean mouseScrolled(double x, double y, double horizontal, double vertical) {
            return surface.scroll(x, y, vertical);
        }

        @Override
        public boolean keyPressed(int key, int scan, int modifiers) {
            return surface.key(key) || super.keyPressed(key, scan, modifiers);
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
