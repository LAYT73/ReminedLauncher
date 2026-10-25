package dev.remined.companion.mc26.mixin;

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.CactusFlowerBlock;
import net.minecraft.world.level.block.FlowerBedBlock;
import net.minecraft.world.level.block.FlowerBlock;
import net.minecraft.world.level.block.TallFlowerBlock;
import net.minecraft.world.level.block.state.BlockBehaviour;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Optional: flowers give off a soft block light (the shader pack tints the petals themselves). */
@Mixin(value = BlockBehaviour.BlockStateBase.class, remap = false)
public abstract class FlowerLightMixin {
    @Unique
    private static final int FLOWER_LIGHT = 8;

    @Unique
    private int remined$emission = -1;

    @Shadow
    public abstract Block getBlock();

    @Inject(method = "getLightEmission", at = @At("RETURN"), cancellable = true, remap = false, require = 0)
    private void remined$flowerLight(CallbackInfoReturnable<Integer> cir) {
        int e = remined$emission;
        if (e < 0) {
            Block b = getBlock();
            boolean flower = b instanceof FlowerBlock || b instanceof TallFlowerBlock
                || b instanceof FlowerBedBlock || b instanceof CactusFlowerBlock;
            e = flower ? Math.max(cir.getReturnValueI(), FLOWER_LIGHT) : cir.getReturnValueI();
            remined$emission = e;
        }
        if (e != cir.getReturnValueI()) cir.setReturnValue(e);
    }
}
