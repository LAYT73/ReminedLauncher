package dev.remined.companion.mc26.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyArg;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Optional: widens the row spacing of Pick Up Notifier entries. No-op when that mod is absent. */
@Pseudo
@Mixin(targets = "fuzs.pickupnotifier.common.client.handler.DrawEntriesHandler", remap = false)
public abstract class PickUpNotifierSpacingMixin {
    private static final int GAP = 14;

    @Unique
    private int remined$row;

    @Inject(method = "renderPickUpEntries", at = @At("HEAD"), remap = false, require = 0)
    private void remined$resetRow(CallbackInfo ci) {
        remined$row = 0;
    }

    // Rows advance with `iinc y, 18`, which @ModifyConstant cannot reach: shift each entry's y instead.
    @ModifyArg(method = "renderPickUpEntries",
        at = @At(value = "INVOKE", target = "Lfuzs/pickupnotifier/common/client/gui/entry/DisplayEntry;render(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/gui/Font;IIF)V"),
        index = 3, remap = false, require = 0)
    private int remined$shiftRow(int y) {
        return y + GAP * remined$row++;
    }

    // Total height (rows * 18) used to anchor the stack, so it grows with the gaps.
    @ModifyConstant(method = "renderPickUpEntries", constant = @Constant(intValue = 18), remap = false, require = 0)
    private int remined$rowHeight(int original) {
        return original + GAP;
    }

    @ModifyConstant(method = "getMoveOffset", constant = @Constant(doubleValue = 18.0D), remap = false, require = 0)
    private static double remined$rowHeightD(double original) {
        return original + GAP;
    }
}
