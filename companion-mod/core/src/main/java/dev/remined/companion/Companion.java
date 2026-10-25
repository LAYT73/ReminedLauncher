package dev.remined.companion;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

/** Entrypoint. Never throws, never crashes the game. */
public final class Companion implements ClientModInitializer {
    private static final String TAG = "[remined-companion] ";
    private final Set<String> logged = new HashSet<>();
    private final Reflect reflect = new Reflect();
    private volatile int failures;
    private StateWriter writer;

    @Override
    public void onInitializeClient() {
        daemonizeStrayExecutors();
        startExitGuard();
        Path dir = null;
        try {
            dir = FabricLoader.getInstance().getGameDir().resolve(".remined");
            writer = new StateWriter(dir.resolve("state.json"));
            Thread t = new Thread(this::loop, "remined-companion");
            t.setDaemon(true);
            t.start();
        } catch (Throwable e) {
            log("init failed", e);
        }
        if (dir == null) return;
        Hub hub = startHub();
        try {
            new Bridge(this, reflect, dir, hub).start();
        } catch (Throwable e) {
            log("bridge failed", e);
        }
    }

    /**
     * Some mods create a scheduled executor with the default (non-daemon) thread factory and never shut it
     * down, so the JVM can't exit after the game closes and the shutdown watchdog writes a crash report.
     * Swap in a daemon factory before their first task spawns a thread.
     */
    private void daemonizeStrayExecutors() {
        String[][] targets = {
            {"mousewheelie", "de.siphalor.mousewheelie.client.network.InteractionManager", "scheduledExecutor"},
        };
        for (String[] t : targets) {
            if (!FabricLoader.getInstance().isModLoaded(t[0])) continue;
            try {
                java.lang.reflect.Field f = Class.forName(t[1], true, Companion.class.getClassLoader()).getDeclaredField(t[2]);
                f.setAccessible(true);
                final String name = t[0] + "-scheduler";
                ((java.util.concurrent.ThreadPoolExecutor) f.get(null)).setThreadFactory(r -> {
                    Thread th = new Thread(r, name);
                    th.setDaemon(true);
                    return th;
                });
            } catch (Throwable e) {
                log("could not daemonize " + t[0] + " executor", e);
            }
        }
    }

    /**
     * NightConfig's FileWatcher (shaded by LambDynamicLights, nested in Forge Config API Port) starts a
     * default-factory debounce executor on the first config change and only shuts it down in stop(), which
     * nobody calls on exit. Once the game thread ends, stop the watchers so the JVM can exit cleanly.
     */
    private void startExitGuard() {
        final Thread game = Thread.currentThread();
        Thread t = new Thread(() -> {
            try {
                game.join();
            } catch (InterruptedException e) {
                return;
            }
            String[] watchers = {
                "com.electronwill.nightconfig.core.file.FileWatcher",
                "dev.lambdaurora.lambdynlights.shadow.nightconfig.core.file.FileWatcher",
            };
            for (String name : watchers) {
                try {
                    Class<?> c = Class.forName(name, false, Companion.class.getClassLoader());
                    java.lang.reflect.Field f = c.getDeclaredField("DEFAULT_INSTANCE");
                    f.setAccessible(true);
                    Object watcher = f.get(null);
                    if (watcher != null) {
                        c.getMethod("stop").invoke(watcher);
                        log("stopped " + name + " on exit", null);
                    }
                } catch (ClassNotFoundException ignored) {
                } catch (Throwable e) {
                    log("could not stop " + name, e);
                }
            }
        }, "remined-exit-guard");
        t.setDaemon(true);
        t.start();
    }

    /** Starts the in-game UI for this Minecraft version, or returns null (bridge and state still work). */
    private Hub startHub() {
        try {
            String backend = backendClass(minecraftVersion());
            if (backend == null) {
                log("no in-game UI for Minecraft " + minecraftVersion(), null);
                return null;
            }
            Platform platform = (Platform) Class.forName(backend, true, Companion.class.getClassLoader())
                .getDeclaredConstructor().newInstance();
            Hub hub = new Hub(platform, FabricLoader.getInstance().getConfigDir().resolve("remined-companion.json"), this);
            hub.init();
            return hub;
        } catch (Throwable e) {
            log("in-game UI disabled", e);
            return null;
        }
    }

    private static String minecraftVersion() {
        return FabricLoader.getInstance().getModContainer("minecraft")
            .map(c -> c.getMetadata().getVersion().getFriendlyString())
            .orElse("");
    }

    /**
     * UI backend family for an exact Minecraft version string, or null (bridge and state only). Every listed version
     * is checked against its family (README, Verify). Unlisted versions get no UI rather than a guessed family.
     */
    static String backendClass(String version) {
        switch (version) {
            case "1.20": case "1.20.1": case "1.20.2": case "1.20.3": case "1.20.4": case "1.20.5": case "1.20.6":
                return "dev.remined.companion.mc1201.Boot1201";
            case "1.21": case "1.21.1":
                return "dev.remined.companion.mc121.Boot121";
            case "1.21.2": case "1.21.3": case "1.21.4": case "1.21.5":
                return "dev.remined.companion.mc1212.Boot1212";
            case "1.21.6": case "1.21.7": case "1.21.8":
                return "dev.remined.companion.mc1216.Boot1216";
            case "1.21.9": case "1.21.10":
                return "dev.remined.companion.mc1219.Boot1219";
            case "1.21.11":
                return "dev.remined.companion.mc12111.Boot12111";
            case "26.1": case "26.1.1": case "26.1.2": case "26.2": case "26.3":
                return "dev.remined.companion.mc26.Boot26";
            default:
                return null;
        }
    }

    private void loop() {
        // Resolve can race early class init; retry for ~1 min before giving up.
        boolean ok = false;
        for (int attempt = 0; attempt < 12 && !ok; attempt++) {
            try {
                ok = reflect.resolve(Companion.class.getClassLoader());
            } catch (Throwable e) {
                log("resolve failed", e);
            }
            if (!ok) {
                try {
                    Thread.sleep(5_000L);
                } catch (InterruptedException e) {
                    return;
                }
            }
        }
        if (!ok) {
            log("no mapping strategy resolved; disabled (" + reflect.lastError() + ")", null);
            return;
        }
        log("started (" + reflect.strategy() + ")", null);
        while (true) {
            long sleep = failures >= 5 ? 10_000L : 1_000L;
            try {
                Thread.sleep(sleep);
            } catch (InterruptedException e) {
                return;
            }
            try {
                reflect.execute(this::tick);
            } catch (Throwable e) {
                failures++;
                log("schedule failed", e);
            }
        }
    }

    /** Runs on the client thread. */
    private void tick() {
        try {
            Snapshot s = reflect.snapshot();
            if (s == null) return;
            failures = 0;
            writer.maybeWrite(s, System.currentTimeMillis());
        } catch (Throwable e) {
            failures++;
            log("snapshot failed", e);
        }
    }

    void log(String msg, Throwable e) {
        String key = msg + (e == null ? "" : e.getClass().getName() + e.getMessage());
        synchronized (logged) {
            if (!logged.add(key)) return;
        }
        try {
            System.out.println(TAG + msg + (e == null ? "" : ": " + e));
        } catch (Throwable ignored) { }
    }
}
