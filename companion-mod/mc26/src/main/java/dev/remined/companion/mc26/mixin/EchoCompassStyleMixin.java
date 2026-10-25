package dev.remined.companion.mc26.mixin;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyArg;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Optional: Echo Compass HUD as a single strip (no coordinates row), recoloured to the Overgrown palette. */
@Pseudo
@Mixin(targets = "ua.lazydev418.echo_compass_hud.gui.ThemeRenderer", remap = false)
public abstract class EchoCompassStyleMixin {
    private static final int CREAM = 0xE9D7C1;
    private static final int PINK = 0x809C4C; // north: leaf green (dark-wood GUI)
    /** Whole compass is drawn at this share of its normal opacity. */
    private static final float OPACITY = 0.65f;

    @Inject(method = "renderInfoText", at = @At("HEAD"), cancellable = true, remap = false, require = 0)
    private static void remined$noInfoRow(CallbackInfo ci) {
        ci.cancel();
    }

    // First fill in renderBackground is the dark plate behind the coordinates row.
    @Redirect(method = "renderBackground",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;fill(IIIII)V", ordinal = 0),
        remap = false, require = 0)
    private static void remined$noInfoPlate(GuiGraphicsExtractor g, int x0, int y0, int x1, int y1, int color) {
    }

    @Redirect(method = "renderBackground",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;fill(IIIII)V", ordinal = 1),
        remap = false, require = 0)
    private static void remined$fadedStripPlate(GuiGraphicsExtractor g, int x0, int y0, int x1, int y1, int color) {
        g.fill(x0, y0, x1, y1, fade(color));
    }

    @ModifyArg(method = "renderCompassStrip",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;fill(IIIII)V"),
        index = 4, remap = false, require = 0)
    private static int remined$tickColor(int argb) {
        return recolor(argb);
    }

    @ModifyArg(method = "renderCompassStrip",
        at = @At(value = "INVOKE", target = "Lua/lazydev418/echo_compass_hud/gui/ThemeRenderer;drawCenteredString(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/gui/Font;Ljava/lang/String;FI)V"),
        index = 4, remap = false, require = 0)
    private static int remined$labelColor(int argb) {
        return recolor(argb);
    }

    // Cardinal labels (N, NE, ...) are drawn with GuiGraphicsExtractor.text, not drawCenteredString.
    @ModifyArg(method = "renderCompassStrip",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;text(Lnet/minecraft/client/gui/Font;Ljava/lang/String;IIIZ)V"),
        index = 4, remap = false, require = 0)
    private static int remined$cardinalColor(int argb) {
        return recolor(argb);
    }

    /** White -> cream, red (north) -> pink; the mod's own edge fade is kept, then scaled by OPACITY. */
    private static int recolor(int argb) {
        int rgb = argb & 0xFFFFFF;
        int r = rgb >> 16 & 0xFF, gr = rgb >> 8 & 0xFF, b = rgb & 0xFF;
        int to = rgb;
        if (r > 230 && gr > 230 && b > 230) to = CREAM;
        else if (r > 180 && gr < 110 && b < 110) to = PINK;
        return fade((argb & 0xFF000000) | to);
    }

    private static int fade(int argb) {
        int a = Math.round((argb >>> 24) * OPACITY);
        return a << 24 | (argb & 0xFFFFFF);
    }
}
