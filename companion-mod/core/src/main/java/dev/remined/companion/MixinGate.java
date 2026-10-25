package dev.remined.companion;

import net.fabricmc.loader.api.FabricLoader;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;
import org.objectweb.asm.tree.ClassNode;

import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * Mixin config plugin. The optional mixins (Pick Up Notifier spacing) are compiled for Minecraft 26.x only, so they are
 * listed here instead of in the json: on older Minecraft/Java the mixin classes are never even read.
 */
public final class MixinGate implements IMixinConfigPlugin {
    private static boolean is26() {
        try {
            return FabricLoader.getInstance().getModContainer("minecraft")
                .map(c -> c.getMetadata().getVersion().getFriendlyString().startsWith("26.")).orElse(false);
        } catch (Throwable t) {
            return false;
        }
    }

    @Override public void onLoad(String mixinPackage) { }
    @Override public String getRefMapperConfig() { return null; }
    @Override public boolean shouldApplyMixin(String targetClassName, String mixinClassName) { return true; }
    @Override public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) { }
    @Override public List<String> getMixins() {
        return is26() ? java.util.Arrays.asList("PickUpNotifierSpacingMixin", "VillagerChessButtonMixin", "FlowerLightMixin", "EchoCompassToggleMixin", "EchoCompassStyleMixin", "SkillsTabStyleMixin") : null;
    }
    @Override public void preApply(String t, ClassNode c, String m, IMixinInfo i) { }
    @Override public void postApply(String t, ClassNode c, String m, IMixinInfo i) { }
}
