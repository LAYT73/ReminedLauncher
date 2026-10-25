package dev.remined.companion.mc26.mixin;

import dev.remined.companion.HudToggle;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Optional: hides Echo Compass HUD while toggled off (key.remined.compass). */
@Pseudo
@Mixin(targets = "ua.lazydev418.echo_compass_hud.gui.CompassHud", remap = false)
public abstract class EchoCompassToggleMixin {
    @Inject(method = "render", at = @At("HEAD"), cancellable = true, remap = false, require = 0)
    private static void remined$hide(CallbackInfo ci) {
        if (HudToggle.COMPASS.hidden()) ci.cancel();
    }
}
