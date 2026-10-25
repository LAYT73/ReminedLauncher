package dev.remined.companion.mc26;

import dev.remined.companion.HudToggle;
import java.nio.file.Files;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

/**
 * Minimal pixel icons under the crosshair: the tool the targeted block wants (head coloured by the tier it
 * needs, red outline when the held item can't harvest it) and the shield state (green when raised, pink
 * cooldown bar when disabled). Opt-in per modpack: enabled when config/remined-crosshair-hints exists.
 */
final class CrosshairHints {
    private static final int SIZE = 11;          // sprite size, drawn 1:1 in GUI px
    private static final int GAP = 2;
    private static final int TOP = 7;            // distance below the crosshair centre
    private static final int OUTLINE = 0xDC3E2B28;
    private static final int OUTLINE_BAD = 0xFFD66868;
    private static final int CREAM = 0xFFE9D7C1;
    private static final int GREEN = 0xFFA7C136;
    private static final int PINK = 0xFFE4B1D3;
    // wooden, stone, iron, diamond
    private static final int[] TIER = {0xFFB98A52, 0xFF9C9C9C, 0xFFE9E2D6, 0xFF6FD6CF};
    /** Hints are drawn at this share of full opacity. */
    private static final float OPACITY = 0.6f;
    private static final String[] TOOL = {"pickaxe", "axe", "shovel", "hoe"};

    private CrosshairHints() {
    }

    static void register() {
        if (!Files.exists(FabricLoader.getInstance().getConfigDir().resolve("remined-crosshair-hints"))) return;
        HudElementRegistry.attachElementAfter(VanillaHudElements.CROSSHAIR,
            Identifier.fromNamespaceAndPath("remined", "crosshair_hints"), CrosshairHints::render);
    }

    private static void render(GuiGraphicsExtractor g, DeltaTracker dt) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer p = mc.player;
        if (HudToggle.HINTS.hidden()) return;
        if (p == null || mc.level == null || !mc.options.getCameraType().isFirstPerson()) return;

        ItemStack shield = shieldInHand(p);
        int tool = -1;
        int tier = 0;
        boolean wrongTool = false;
        if (mc.hitResult instanceof BlockHitResult hit && hit.getType() == HitResult.Type.BLOCK) {
            BlockPos pos = hit.getBlockPos();
            BlockState st = mc.level.getBlockState(pos);
            if (st.getDestroySpeed(mc.level, pos) > 0) {
                tool = toolFor(st);
                tier = tierFor(st);
                wrongTool = tool >= 0 && st.requiresCorrectToolForDrops()
                    && !p.getMainHandItem().isCorrectToolForDrops(st);
            }
        }
        int count = (shield != null ? 1 : 0) + (tool >= 0 ? 1 : 0);
        if (count == 0) return;

        int x = g.guiWidth() / 2 - (count * SIZE + (count - 1) * GAP) / 2;
        int y = g.guiHeight() / 2 + TOP;
        if (shield != null) {
            icon(g, "shield", x, y, OUTLINE, p.isBlocking() ? GREEN : CREAM);
            float cd = p.getCooldowns().getCooldownPercent(shield, dt.getGameTimeDeltaPartialTick(true));
            if (cd > 0) g.fill(x + 1, y + SIZE, x + 1 + Math.round((SIZE - 2) * cd), y + SIZE + 1, fade(PINK));
            x += SIZE + GAP;
        }
        if (tool >= 0) icon(g, TOOL[tool], x, y, wrongTool ? OUTLINE_BAD : OUTLINE, TIER[tier]);
    }

    private static void icon(GuiGraphicsExtractor g, String name, int x, int y, int outline, int tint) {
        g.blitSprite(RenderPipelines.GUI_TEXTURED, sprite(name + "_outline"), x, y, SIZE, SIZE, fade(outline));
        g.blitSprite(RenderPipelines.GUI_TEXTURED, sprite(name + "_fixed"), x, y, SIZE, SIZE, fade(0xFFFFFFFF));
        g.blitSprite(RenderPipelines.GUI_TEXTURED, sprite(name + "_tint"), x, y, SIZE, SIZE, fade(tint));
    }

    private static int fade(int argb) {
        return Math.round((argb >>> 24) * OPACITY) << 24 | (argb & 0xFFFFFF);
    }

    private static Identifier sprite(String name) {
        return Identifier.fromNamespaceAndPath("remined_companion", "hints/" + name);
    }

    private static ItemStack shieldInHand(LocalPlayer p) {
        if (p.getOffhandItem().has(DataComponents.BLOCKS_ATTACKS)) return p.getOffhandItem();
        if (p.getMainHandItem().has(DataComponents.BLOCKS_ATTACKS)) return p.getMainHandItem();
        return null;
    }

    private static int toolFor(BlockState st) {
        if (st.is(BlockTags.MINEABLE_WITH_PICKAXE)) return 0;
        if (st.is(BlockTags.MINEABLE_WITH_AXE)) return 1;
        if (st.is(BlockTags.MINEABLE_WITH_SHOVEL)) return 2;
        if (st.is(BlockTags.MINEABLE_WITH_HOE)) return 3;
        return -1;
    }

    private static int tierFor(BlockState st) {
        if (st.is(BlockTags.NEEDS_DIAMOND_TOOL)) return 3;
        if (st.is(BlockTags.NEEDS_IRON_TOOL)) return 2;
        if (st.is(BlockTags.NEEDS_STONE_TOOL)) return 1;
        return 0;
    }
}
