package dev.remined.companion.mc26.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/** Optional: Skill Proficiencies' "Skills" tab is drawn with hard-coded greys; repaint it in dark wood. */
@Pseudo
@Mixin(targets = "com.specialities.client.BookmarkTab", remap = false)
public abstract class SkillsTabStyleMixin {
    @ModifyArg(method = "extractWidgetRenderState",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;fill(IIIII)V"),
        index = 4, remap = false, require = 0)
    private int remined$woodFill(int argb) {
        switch (argb) {
            case 0xFFC6C6C6: return 0xFF34241B; // tab face
            case 0xFFD7D7D7: return 0xFF4A3628; // hovered face
            case 0xFF555555: return 0xFF22170F; // inner shadow
            case 0xFF000000: return 0xFF0A0706; // outline
            default: return argb;
        }
    }

    @ModifyArg(method = "extractWidgetRenderState",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;text(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;IIIZ)V"),
        index = 4, remap = false, require = 0)
    private int remined$creamLabel(int argb) {
        return argb == 0xFF404040 ? 0xFFE9D7C1 : argb;
    }
}
