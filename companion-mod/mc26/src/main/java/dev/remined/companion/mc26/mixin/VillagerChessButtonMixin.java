package dev.remined.companion.mc26.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/** Optional: moves Villager Chess's "Play Chess" button from the right of the trade window to its left. */
@Pseudo
@Mixin(targets = "com.foldpaper.villagerchess.client.VillagerChessClient", remap = false)
public abstract class VillagerChessButtonMixin {
    // The mod places the 70px button at width/2 + 138 + 4 (right edge of the 276px merchant window).
    private static final int MIRROR = 2 * (138 + 4) + 70;

    @ModifyArg(method = "lambda$onInitializeClient$2",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/components/Button$Builder;bounds(IIII)Lnet/minecraft/client/gui/components/Button$Builder;"),
        index = 0, remap = false, require = 0)
    private static int remined$leftOfWindow(int x) {
        return x - MIRROR;
    }
}
