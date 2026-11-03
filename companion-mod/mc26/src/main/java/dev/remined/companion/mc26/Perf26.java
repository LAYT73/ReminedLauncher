package dev.remined.companion.mc26;

import dev.remined.companion.PerfBackend;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Supplier;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.server.level.ParticleStatus;
import net.minecraft.server.packs.repository.PackRepository;

/**
 * Performance tab backend for 26.x: video options through Options, resource packs through the PackRepository. The
 * members used are the same in 26.1, 26.2 and 26.3; the screen and overlay moved to Gui in 26.2 and are reached by
 * reflection.
 */
final class Perf26 implements PerfBackend {
    private final Supplier<Object> screen;
    private boolean resolved;
    private Method overlayMethod;
    private Field guiField;

    Perf26(Supplier<Object> screen) {
        this.screen = screen;
    }

    @Override
    public boolean ready() {
        Minecraft mc = Minecraft.getInstance();
        if (mc == null || overlay(mc) != null) return false;
        return screen.get() instanceof TitleScreen || mc.level != null;
    }

    /** Minecraft.getOverlay() on 26.1, Gui.overlay() on 26.2+. Resolved once. */
    private Object overlay(Minecraft mc) {
        try {
            if (!resolved) {
                resolved = true;
                try {
                    overlayMethod = Minecraft.class.getMethod("getOverlay");
                } catch (NoSuchMethodException e) {
                    guiField = Minecraft.class.getField("gui");
                    overlayMethod = guiField.getType().getMethod("overlay");
                }
            }
            if (overlayMethod == null) return null;
            return overlayMethod.invoke(guiField == null ? mc : guiField.get(mc));
        } catch (ReflectiveOperationException e) {
            overlayMethod = null;
            return null;
        }
    }

    @Override
    public Object option(String name) {
        Options o = Minecraft.getInstance().options;
        switch (name) {
            case "renderDistance": return o.renderDistance().get();
            case "simulationDistance": return o.simulationDistance().get();
            case "entityDistanceScaling": return o.entityDistanceScaling().get();
            case "particles": return o.particles().get().name().toLowerCase(Locale.ROOT);
            case "clouds": return o.cloudStatus().get().name().toLowerCase(Locale.ROOT);
            case "entityShadows": return o.entityShadows().get();
            case "ambientOcclusion": return o.ambientOcclusion().get();
            case "biomeBlendRadius": return o.biomeBlendRadius().get();
            case "mipmapLevels": return o.mipmapLevels().get();
            default: return null;
        }
    }

    @Override
    public boolean setOption(String name, Object v) {
        Minecraft mc = Minecraft.getInstance();
        Options o = mc.options;
        switch (name) {
            case "renderDistance": o.renderDistance().set(((Number) v).intValue()); return false;
            case "simulationDistance": o.simulationDistance().set(((Number) v).intValue()); return false;
            case "entityDistanceScaling": o.entityDistanceScaling().set(((Number) v).doubleValue()); return false;
            case "particles": o.particles().set(ParticleStatus.valueOf(((String) v).toUpperCase(Locale.ROOT))); return false;
            case "clouds": o.cloudStatus().set(CloudStatus.valueOf(((String) v).toUpperCase(Locale.ROOT))); return false;
            case "entityShadows": o.entityShadows().set((Boolean) v); return false;
            case "ambientOcclusion": o.ambientOcclusion().set((Boolean) v); return false;
            case "biomeBlendRadius": o.biomeBlendRadius().set(((Number) v).intValue()); return false;
            case "mipmapLevels": {
                int level = ((Number) v).intValue();
                o.mipmapLevels().set(level);
                mc.updateMaxMipLevel(level);
                return true;
            }
            default: throw new IllegalArgumentException("unsupported option " + name);
        }
    }

    @Override
    public void saveOptions() {
        Minecraft.getInstance().options.save();
    }

    @Override
    public List<String> selectedPacks() {
        return new ArrayList<>(repo().getSelectedIds());
    }

    @Override
    public Set<String> availablePacks() {
        return new LinkedHashSet<>(repo().getAvailableIds());
    }

    @Override
    public void setSelectedPacks(List<String> ids) {
        Minecraft mc = Minecraft.getInstance();
        PackRepository repo = repo();
        repo.setSelected(ids);
        mc.options.updateResourcePacks(repo);
    }

    @Override
    public void reloadPacks() {
        Minecraft.getInstance().reloadResourcePacks();
    }

    @Override
    public void quit() {
        Minecraft.getInstance().stop();
    }

    private static PackRepository repo() {
        return Minecraft.getInstance().getResourcePackRepository();
    }
}
