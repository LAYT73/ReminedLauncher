package dev.remined.companion;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Performance tab model: the pack profile, the player state file, pending edits and Apply. Live items (shaders,
 * Distant Horizons, video options, resource packs) take effect at once, mods after a restart. Client thread only.
 */
final class Perf {
    private final Hub hub;
    private final Companion log;
    private final PerfBackend backend;
    private final PerfMods mods;
    private final PerfConfig config;
    private final Path stateFile;
    private final Path shaderpacks;
    final PerfProfile profile;
    private PerfState state;
    private Map<String, Path> disabledJars = new HashMap<>();
    private final Map<String, Object> actual = new HashMap<>();
    private final Map<String, Object> pending = new HashMap<>();
    private boolean reapplied;
    private boolean packsChanged;

    private Perf(Hub hub, Companion log, PerfBackend backend, PerfProfile profile, Path configDir) {
        this.hub = hub;
        this.log = log;
        this.backend = backend;
        this.profile = profile;
        this.stateFile = configDir.resolve("remined-performance.json");
        Path game = FabricLoader.getInstance().getGameDir();
        this.shaderpacks = game.resolve("shaderpacks");
        this.mods = new PerfMods(game.resolve("mods"), log);
        this.config = new PerfConfig(configDir, log);
        this.state = PerfState.load(stateFile);
    }

    /** The Performance tab model, or null when the pack ships no valid profile or the backend has no support. */
    static Perf create(Hub hub, Companion log, PerfBackend backend, Path configDir) {
        if (backend == null) return null;
        PerfProfile profile = PerfProfile.load(configDir.resolve("remined-performance-profile.json"));
        if (profile == null) return null;
        return new Perf(hub, log, backend, profile, configDir);
    }

    /** Runs the startup re-apply once, after the title screen first shows. */
    void tick() {
        if (reapplied) return;
        try {
            if (!backend.ready()) return;
            reapplied = true;
            reapply();
        } catch (Throwable e) {
            reapplied = true;
            log.log("performance re-apply failed", e);
        }
    }

    /** Version of the installed pack (.remined-pack.json written by the launcher), or "". */
    private static String packVersion() {
        try {
            Path f = FabricLoader.getInstance().getGameDir().resolve(".remined-pack.json");
            if (!java.nio.file.Files.isRegularFile(f)) return "";
            Object v = Bridge.Json.parse(new String(java.nio.file.Files.readAllBytes(f),
                java.nio.charset.StandardCharsets.UTF_8)).get("version");
            return v == null ? "" : String.valueOf(v);
        } catch (Throwable e) {
            return "";
        }
    }

    /** Only after a pack update (the launcher replaced options.txt): the player's own later changes stay. */
    private void reapply() {
        String version = packVersion();
        if (state == null || state.packVersion.equals(version)) return;
        refresh();
        Map<String, Object> want = new LinkedHashMap<>();
        for (PerfProfile.Item it : profile.items()) {
            if (it.restart() || !state.values.containsKey(it.id)) continue;
            Object a = actual.get(it.id);
            Object v = state.values.get(it.id);
            if (a != null && !PerfProfile.same(a, v) && accepts(it, v)) want.put(it.id, v);
        }
        if (!want.isEmpty()) run(want, true);
        state.packVersion = version;
        try {
            state.save(stateFile);
        } catch (Throwable e) {
            log.log("performance state save failed", e);
        }
    }

    private static boolean accepts(PerfProfile.Item it, Object v) {
        if (it.toggle()) return v instanceof Boolean;
        for (Object o : it.values) {
            if (PerfProfile.same(o, v)) return true;
        }
        return false;
    }

    /** Re-reads the game state and drops pending edits. Call when the tab opens. */
    void open() {
        refresh();
        revert();
    }

    private void refresh() {
        disabledJars = mods.disabled();
        actual.clear();
        for (PerfProfile.Item it : profile.items()) {
            Object v = null;
            try {
                v = read(it);
            } catch (Throwable e) {
                log.log("performance read failed for " + it.id, e);
            }
            if (v != null) actual.put(it.id, v);
        }
    }

    /** Current game state of an item, or null when it cannot be controlled (not installed). */
    private Object read(PerfProfile.Item it) {
        switch (it.kind) {
            case PerfProfile.SHADERS:
                return PerfLive.shadersEnabled();
            case PerfProfile.DH:
                return PerfLive.dhGet("renderingEnabled");
            case PerfProfile.DH_RADIUS:
                return PerfLive.dhGet("chunkRenderDistance");
            case PerfProfile.OPTION:
                return PerfProfile.norm(backend.option(it.option));
            case PerfProfile.PACKS: {
                Set<String> avail = backend.availablePacks();
                List<String> sel = backend.selectedPacks();
                boolean any = false;
                for (String id : it.ids) {
                    if (!avail.contains(id)) continue;
                    any = true;
                    if (!sel.contains(id)) return Boolean.FALSE;
                }
                return any ? Boolean.TRUE : null;
            }
            case PerfProfile.CONFIG:
                return config.actual(it);
            case PerfProfile.MODS: {
                boolean any = false;
                for (String id : it.ids) {
                    if (!known(id)) continue;
                    any = true;
                    if (!enabled(id)) return Boolean.FALSE;
                }
                return any ? Boolean.TRUE : null;
            }
            default:
                return null;
        }
    }

    private boolean known(String id) {
        return PerfMods.loaded(id) || disabledJars.containsKey(id) || (state != null && state.mods.containsKey(id));
    }

    private boolean enabled(String id) {
        if (state != null && state.mods.containsKey(id)) return state.mods.get(id);
        return PerfMods.loaded(id);
    }

    boolean available(PerfProfile.Item it) {
        return actual.containsKey(it.id);
    }

    Object value(PerfProfile.Item it) {
        return pending.get(it.id);
    }

    void set(PerfProfile.Item it, Object v) {
        if (available(it)) pending.put(it.id, v);
    }

    void revert() {
        pending.clear();
        pending.putAll(actual);
    }

    boolean dirty() {
        for (Map.Entry<String, Object> e : actual.entrySet()) {
            if (!PerfProfile.same(e.getValue(), pending.get(e.getKey()))) return true;
        }
        return false;
    }

    /** Selects a preset: the items it lists take its values, the others stay as they are. */
    void select(PerfProfile.Preset p) {
        for (Map.Entry<String, Object> e : p.values.entrySet()) {
            PerfProfile.Item it = profile.item(e.getKey());
            if (it != null) set(it, e.getValue());
        }
    }

    /** Id of the preset the pending values match, or null for custom. */
    String presetId() {
        return profile.matchPreset(pending, unavailable());
    }

    private Set<String> unavailable() {
        Set<String> out = new HashSet<>();
        for (PerfProfile.Item it : profile.items()) {
            if (!available(it)) out.add(it.id);
        }
        return out;
    }

    /** True when a mod change needs a restart: the saved state and the loaded mods disagree. */
    boolean restartPending() {
        if (state == null) return false;
        for (PerfProfile.Item it : profile.items()) {
            if (!it.restart()) continue;
            for (String id : it.ids) {
                Boolean want = state.mods.get(id);
                if (want == null) continue;
                boolean loaded = PerfMods.loaded(id);
                if (want != loaded && (loaded || disabledJars.containsKey(id))) return true;
            }
        }
        return false;
    }

    void quit() {
        try {
            backend.quit();
        } catch (Throwable e) {
            log.log("quit failed", e);
        }
    }

    /** Applies the pending edits and reports the result in notices. */
    void apply() {
        Map<String, Object> want = new LinkedHashMap<>();
        for (PerfProfile.Item it : profile.items()) {
            Object a = actual.get(it.id);
            Object p = pending.get(it.id);
            if (a != null && p != null && !PerfProfile.same(a, p) && accepts(it, p)) want.put(it.id, p);
        }
        if (want.isEmpty()) return;
        run(want, false);
    }

    private void run(Map<String, Object> want, boolean silent) {
        List<String> failed = new ArrayList<>();
        boolean reload = false;
        for (PerfProfile.Item it : profile.items()) {
            if (!want.containsKey(it.id) || !PerfProfile.OPTION.equals(it.kind)) continue;
            try {
                reload |= backend.setOption(it.option, want.get(it.id));
            } catch (Throwable e) {
                fail(failed, it, e);
            }
        }
        List<String> later = new ArrayList<>();
        for (PerfProfile.Item it : profile.items()) {
            if (!want.containsKey(it.id) || !PerfProfile.CONFIG.equals(it.kind)) continue;
            PerfConfig.Outcome o = config.run(Boolean.TRUE.equals(want.get(it.id)) ? it.on : it.off);
            reload |= o.reload;
            if (o.fileFailed || (o.liveFailed && o.fileOk == 0)) fail(failed, it, new IllegalStateException("config"));
            else if (o.liveFailed) later.add(PerfProfile.text(it.name, hub.lang()));
        }
        try {
            backend.saveOptions();
        } catch (Throwable e) {
            log.log("options save failed", e);
        }

        List<String> packOrder = null;
        packsChanged = false;
        try {
            packOrder = applyPacks(want);
            if (packsChanged) reload = true;
        } catch (Throwable e) {
            log.log("resource pack apply failed", e);
            failed.add(hub.translate("remined.perf.packs"));
        }
        if (reload) {
            try {
                backend.reloadPacks();
            } catch (Throwable e) {
                log.log("resource reload failed", e);
                failed.add(hub.translate("remined.perf.reload"));
            }
        }

        for (PerfProfile.Item it : profile.items()) {
            if (!want.containsKey(it.id)) continue;
            Object v = want.get(it.id);
            try {
                if (PerfProfile.SHADERS.equals(it.kind)) {
                    PerfLive.setShaders(Boolean.TRUE.equals(v), it.pack, shaderpacks);
                } else if (PerfProfile.DH.equals(it.kind)) {
                    PerfLive.dhSet("renderingEnabled", v);
                } else if (PerfProfile.DH_RADIUS.equals(it.kind)) {
                    PerfLive.dhSet("chunkRenderDistance", v);
                }
            } catch (Throwable e) {
                fail(failed, it, e);
            }
        }

        if (silent) {
            if (!later.isEmpty()) log.log("performance items apply after a restart: " + later, null);
            if (!failed.isEmpty()) log.log("performance re-apply failed for " + failed, null);
            return;
        }

        PerfMods.Result mr = applyMods(want);
        refresh();
        revert();
        save(packOrder);

        if (!failed.isEmpty()) {
            hub.notice("request", hub.translate("remined.perf.failed") + ": " + join(failed));
        } else {
            hub.notice("friend", hub.translate("remined.perf.applied"));
        }
        for (String name : later) {
            hub.notice("request", String.format(hub.translate("remined.perf.later"), name));
        }
        if (mr != null) {
            for (Map.Entry<String, String> e : mr.blockedOff.entrySet()) {
                hub.notice("request", String.format(hub.translate("remined.perf.blocked"), e.getKey(), e.getValue()));
            }
            for (Map.Entry<String, String> e : mr.blockedOn.entrySet()) {
                hub.notice("request", String.format(hub.translate("remined.perf.blocked_on"), e.getKey(), e.getValue()));
            }
            for (String id : mr.cannot) {
                hub.notice("request", String.format(hub.translate("remined.perf.cannot"), id));
            }
        }
    }

    private void fail(List<String> failed, PerfProfile.Item it, Throwable e) {
        log.log("performance item " + it.id + " failed", e);
        failed.add(PerfProfile.text(it.name, hub.lang()));
    }

    private static String join(List<String> l) {
        StringBuilder sb = new StringBuilder();
        for (String s : l) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(s);
        }
        return sb.toString();
    }

    private Set<String> managedPacks() {
        Set<String> out = new LinkedHashSet<>();
        for (PerfProfile.Item it : profile.items()) {
            if (PerfProfile.PACKS.equals(it.kind)) out.addAll(it.ids);
            for (PerfProfile.Op op : it.on) {
                if (PerfProfile.Op.PACKS.equals(op.type)) out.addAll(op.ids);
            }
            for (PerfProfile.Op op : it.off) {
                if (PerfProfile.Op.PACKS.equals(op.type)) out.addAll(op.ids);
            }
        }
        return out;
    }

    /** Applies the pack items in want (sets packsChanged). Returns the refreshed baseline order, or null without pack items. */
    private List<String> applyPacks(Map<String, Object> want) {
        List<Object[]> edits = new ArrayList<>();
        for (PerfProfile.Item it : profile.items()) {
            if (!want.containsKey(it.id)) continue;
            boolean on = Boolean.TRUE.equals(want.get(it.id));
            if (PerfProfile.PACKS.equals(it.kind)) {
                edits.add(new Object[] {it.ids, on});
            } else if (PerfProfile.CONFIG.equals(it.kind)) {
                for (PerfProfile.Op op : on ? it.on : it.off) {
                    if (PerfProfile.Op.PACKS.equals(op.type)) edits.add(new Object[] {op.ids, Boolean.TRUE.equals(op.value)});
                }
            }
        }
        if (edits.isEmpty()) return null;
        List<String> before = backend.selectedPacks();
        List<String> cur = new ArrayList<>(before);
        Set<String> avail = backend.availablePacks();
        Set<String> managed = managedPacks();
        List<String> baseline = PerfState.mergeOrder(state == null ? new ArrayList<String>() : state.packOrder, cur,
            notIn(managed, cur));
        for (Object[] e : edits) {
            @SuppressWarnings("unchecked")
            List<String> ids = (List<String>) e[0];
            boolean on = (Boolean) e[1];
            for (String id : ids) {
                if (!avail.contains(id)) continue;
                if (on) {
                    PerfState.insertAfterPredecessor(cur, baseline, id);
                } else {
                    cur.remove(id);
                }
            }
        }
        if (!cur.equals(before)) {
            backend.setSelectedPacks(cur);
            packsChanged = true;
        }
        return PerfState.mergeOrder(baseline, cur, notIn(managed, cur));
    }

    private static Set<String> notIn(Set<String> ids, List<String> selected) {
        Set<String> out = new LinkedHashSet<>(ids);
        out.removeAll(selected);
        return out;
    }

    /** Renames mod jars for the mod items in want and records the result in the state. Null when nothing to do. */
    private PerfMods.Result applyMods(Map<String, Object> want) {
        Map<String, Boolean> wanted = new LinkedHashMap<>();
        for (PerfProfile.Item it : profile.items()) {
            if (!PerfProfile.MODS.equals(it.kind) || !want.containsKey(it.id)) continue;
            for (String id : it.ids) {
                if (known(id)) wanted.put(id, Boolean.TRUE.equals(want.get(it.id)));
            }
        }
        if (wanted.isEmpty()) return null;
        Map<String, Boolean> enabledNow = new HashMap<>();
        for (String id : modIds()) enabledNow.put(id, enabled(id));
        PerfMods.Result r;
        try {
            r = mods.apply(wanted, enabledNow);
        } catch (Throwable e) {
            log.log("mods apply failed", e);
            return null;
        }
        if (state == null) state = new PerfState();
        state.mods.putAll(r.record);
        return r;
    }

    private Set<String> modIds() {
        Set<String> out = new LinkedHashSet<>();
        for (PerfProfile.Item it : profile.items()) {
            if (PerfProfile.MODS.equals(it.kind)) out.addAll(it.ids);
        }
        return out;
    }

    private void save(List<String> packOrder) {
        try {
            if (state == null) state = new PerfState();
            state.packVersion = packVersion();
            for (PerfProfile.Item it : profile.items()) {
                Object a = actual.get(it.id);
                if (a != null) state.values.put(it.id, a);
            }
            for (String id : modIds()) {
                if (!state.mods.containsKey(id)) state.mods.put(id, known(id) ? enabled(id) : Boolean.TRUE);
            }
            String id = profile.matchPreset(state.values, unavailable());
            state.preset = id == null ? "custom" : id;
            if (packOrder != null) {
                state.packOrder.clear();
                state.packOrder.addAll(packOrder);
            } else if (state.packOrder.isEmpty()) {
                state.packOrder.addAll(backend.selectedPacks());
            }
            state.save(stateFile);
        } catch (Throwable e) {
            log.log("performance state save failed", e);
        }
    }
}
