package dev.remined.companion;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.Executor;

/**
 * Reflection layer over Minecraft. Resolved once; strategy A = intermediary via Fabric
 * MappingResolver, strategy B = official Mojang names (unobfuscated 26.x).
 *
 * Verified intermediary names (see README): class_310 MinecraftClient, method_1551 getInstance,
 * field_1687 world, field_1724 player, method_1493 isPaused, method_1542 isInSingleplayer,
 * method_1558 getCurrentServerEntry, method_1576 getServer, field_1755 currentScreen,
 * class_1937.method_27983 getRegistryKey, class_5321.method_29177 getValue,
 * net.minecraft.server.MinecraftServer.method_3860 isRemote (LAN published).
 */
final class Reflect {
    private Class<?> clientCls;
    private Method getInstance, isPaused, isSingle, getServerEntry, getServer;
    private Field worldF, playerF, screenF, guiF;
    private Method guiScreen;
    private Method dimMethod, keyValueMethod;   // resolved lazily on first world (class known then)
    private Method published;                    // lazily on first integrated server
    private String strategy;

    // Mojmap-only: names tried for lazy members
    private boolean mojmap;

    private String lastError = "";

    String strategy() { return strategy; }

    /** Why the last resolve() failed, per strategy — for the one-line log. */
    String lastError() { return lastError; }

    /** Returns true when resolved. Throws nothing the caller must handle except for logging. */
    boolean resolve(ClassLoader cl) {
        String a, b;
        try {
            if (resolveIntermediary(cl)) { strategy = "intermediary"; mojmap = false; return true; }
            a = "false";
        } catch (Throwable e) { a = String.valueOf(e); }
        try {
            if (resolveMojmap(cl)) { strategy = "mojmap"; mojmap = true; return true; }
            b = "false";
        } catch (Throwable e) { b = String.valueOf(e); }
        lastError = "intermediary: " + a + " | mojmap: " + b;
        return false;
    }

    private boolean resolveIntermediary(ClassLoader cl) throws Exception {
        net.fabricmc.loader.api.MappingResolver r =
            net.fabricmc.loader.api.FabricLoader.getInstance().getMappingResolver();
        String cn = r.mapClassName("intermediary", "net.minecraft.class_310");
        clientCls = Class.forName(cn, false, cl);
        String I = "net.minecraft.class_310";
        getInstance = clientCls.getMethod(r.mapMethodName("intermediary", I, "method_1551", "()Lnet/minecraft/class_310;"));
        isPaused = clientCls.getMethod(r.mapMethodName("intermediary", I, "method_1493", "()Z"));
        isSingle = clientCls.getMethod(r.mapMethodName("intermediary", I, "method_1542", "()Z"));
        getServerEntry = clientCls.getMethod(r.mapMethodName("intermediary", I, "method_1558", "()Lnet/minecraft/class_642;"));
        getServer = clientCls.getMethod(r.mapMethodName("intermediary", I, "method_1576", "()Lnet/minecraft/class_1132;"));
        worldF = field(clientCls, r.mapFieldName("intermediary", I, "field_1687", "Lnet/minecraft/class_638;"));
        playerF = field(clientCls, r.mapFieldName("intermediary", I, "field_1724", "Lnet/minecraft/class_746;"));
        screenF = field(clientCls, r.mapFieldName("intermediary", I, "field_1755", "Lnet/minecraft/class_437;"));

        Class<?> worldCls = Class.forName(r.mapClassName("intermediary", "net.minecraft.class_1937"), false, cl);
        dimMethod = worldCls.getMethod(r.mapMethodName("intermediary", "net.minecraft.class_1937", "method_27983", "()Lnet/minecraft/class_5321;"));
        Class<?> keyCls = Class.forName(r.mapClassName("intermediary", "net.minecraft.class_5321"), false, cl);
        keyValueMethod = keyCls.getMethod(r.mapMethodName("intermediary", "net.minecraft.class_5321", "method_29177", "()Lnet/minecraft/class_2960;"));
        // IntegratedServer extends MinecraftServer (server class names are not obfuscated)
        Class<?> srvCls = Class.forName(r.mapClassName("intermediary", "net.minecraft.server.MinecraftServer"), false, cl);
        published = srvCls.getMethod(r.mapMethodName("intermediary", "net.minecraft.server.MinecraftServer", "method_3860", "()Z"));
        return true;
    }

    private boolean resolveMojmap(ClassLoader cl) throws Exception {
        clientCls = Class.forName("net.minecraft.client.Minecraft", false, cl);
        getInstance = clientCls.getMethod("getInstance");
        isPaused = clientCls.getMethod("isPaused");
        isSingle = firstMethod(clientCls, "isSingleplayer", "hasSingleplayerServer");
        getServer = firstMethod(clientCls, "getSingleplayerServer");
        worldF = field(clientCls, "level");
        playerF = field(clientCls, "player");
        // Screen is optional: pre-26 keeps Minecraft.screen; 26.x moved it to Minecraft.gui.screen().
        try {
            screenF = field(clientCls, "screen");
        } catch (NoSuchFieldException e) {
            try {
                guiF = field(clientCls, "gui");
                guiScreen = guiF.getType().getMethod("screen");
            } catch (Throwable ignored) { guiF = null; guiScreen = null; }
        }
        try {
            Class<?> srv = Class.forName("net.minecraft.client.server.IntegratedServer", false, cl);
            published = srv.getMethod("isPublished");
        } catch (Throwable ignored) { published = null; }
        return true;
    }

    private static Method firstMethod(Class<?> c, String... names) throws NoSuchMethodException {
        for (String n : names) {
            try { return c.getMethod(n); } catch (NoSuchMethodException ignored) { }
        }
        throw new NoSuchMethodException(c.getName() + " " + java.util.Arrays.toString(names));
    }

    static Field field(Class<?> c, String name) throws NoSuchFieldException {
        Field f;
        try { f = c.getField(name); } catch (NoSuchFieldException e) { f = c.getDeclaredField(name); }
        f.setAccessible(true);
        return f;
    }

    boolean isMojmap() { return mojmap; }

    Class<?> clientClass() { return clientCls; }

    /** Current MinecraftClient instance (client thread only). */
    Object client() throws Exception { return getInstance.invoke(null); }

    /** Current screen object or null (client thread only). */
    Object screen(Object mc) throws Exception {
        Object scr = null;
        if (screenF != null) {
            scr = screenF.get(mc);
        } else if (guiF != null && guiScreen != null) {
            Object gui = guiF.get(mc);
            if (gui != null) scr = guiScreen.invoke(gui);
        }
        return scr;
    }

    /** Schedules r on the Minecraft client thread. */
    void execute(Runnable r) throws Exception {
        tryExecute(r);
    }

    /** Like execute, but returns false (schedules nothing) while the client instance is not ready. */
    boolean tryExecute(Runnable r) throws Exception {
        Object mc = getInstance.invoke(null);
        if (mc == null) return false;
        ((Executor) mc).execute(r);
        return true;
    }

    /** Must run on the client thread. Returns null when the client instance is not ready. */
    Snapshot snapshot() throws Exception {
        Object mc = getInstance.invoke(null);
        if (mc == null) return null;
        Object world = worldF.get(mc);
        Object player = playerF.get(mc);
        boolean inWorld = world != null && player != null;
        boolean paused = Boolean.TRUE.equals(isPaused.invoke(mc));

        String screen = null;
        Object scr = null;
        if (screenF != null) {
            scr = screenF.get(mc);
        } else if (guiF != null && guiScreen != null) {
            Object gui = guiF.get(mc);
            if (gui != null) scr = guiScreen.invoke(gui);
        }
        if (scr != null) screen = scr.getClass().getSimpleName();

        String mode = "menu";
        String dim = null;
        if (inWorld) {
            dim = dimension(world);
            Object server = getServer.invoke(mc);
            if (server != null) {
                mode = published != null && Boolean.TRUE.equals(published.invoke(server)) ? "lan" : "sp";
            } else if (Boolean.TRUE.equals(isSingle.invoke(mc))) {
                mode = "sp";
            } else {
                mode = "mp";
            }
        }
        return new Snapshot(inWorld, dim, paused, mode, screen);
    }

    private String dimension(Object world) throws Exception {
        if (mojmap && dimMethod == null) {
            dimMethod = world.getClass().getMethod("dimension");
        }
        Object key = dimMethod.invoke(world);
        if (key == null) return null;
        if (keyValueMethod == null) {
            Method m;
            try { m = key.getClass().getMethod("location"); }
            catch (NoSuchMethodException e) { m = key.getClass().getMethod("identifier"); }
            keyValueMethod = m;
        }
        Object id = keyValueMethod.invoke(key);
        return id == null ? null : id.toString();
    }
}
