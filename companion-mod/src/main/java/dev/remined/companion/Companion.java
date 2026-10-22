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
        try {
            Path dir = FabricLoader.getInstance().getGameDir().resolve(".remined");
            writer = new StateWriter(dir.resolve("state.json"));
            Thread t = new Thread(this::loop, "remined-companion");
            t.setDaemon(true);
            t.start();
        } catch (Throwable e) {
            log("init failed", e);
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

    private void log(String msg, Throwable e) {
        String key = msg + (e == null ? "" : e.getClass().getName() + e.getMessage());
        synchronized (logged) {
            if (!logged.add(key)) return;
        }
        try {
            System.out.println(TAG + msg + (e == null ? "" : ": " + e));
        } catch (Throwable ignored) { }
    }
}
