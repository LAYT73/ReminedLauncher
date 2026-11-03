package dev.remined.companion;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModDependency;
import net.fabricmc.loader.api.metadata.ModOrigin;

/**
 * Decides which mods may be enabled or disabled. It never touches the files: the running game lazily loads classes
 * from its jars, so the launcher renames x.jar and x.jar.disabled before the next launch from the state file.
 * Never throws.
 */
final class PerfMods {
    private static final String SELF = "remined-companion";
    private static final String SUFFIX = ".disabled";

    private final Path modsDir;
    private final Companion log;

    PerfMods(Path modsDir, Companion log) {
        this.modsDir = modsDir;
        this.log = log;
    }

    static boolean loaded(String id) {
        return !SELF.equals(id) && FabricLoader.getInstance().isModLoaded(id);
    }

    /** Mod id to jar.disabled path for every disabled jar in the mods folder. */
    Map<String, Path> disabled() {
        Map<String, Path> out = new HashMap<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(modsDir, "*.jar" + SUFFIX)) {
            for (Path p : ds) {
                String id = modId(p);
                if (id != null) out.put(id, p);
            }
        } catch (Throwable e) {
            log.log("mods scan failed", e);
        }
        return out;
    }

    private static String modId(Path jar) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            ZipEntry e = zip.getEntry("fabric.mod.json");
            if (e == null) return null;
            try (InputStream in = zip.getInputStream(e)) {
                return Protocol.str(Bridge.Json.parse(new String(readAll(in), StandardCharsets.UTF_8)), "id");
            }
        } catch (Throwable e) {
            return null;
        }
    }

    /** Top-level jar in mods/ that holds the loaded mod, or null (nested, folder, dev environment). */
    private Path jarOf(String id) {
        try {
            ModContainer c = FabricLoader.getInstance().getModContainer(id).orElse(null);
            if (c == null || c.getOrigin().getKind() != ModOrigin.Kind.PATH) return null;
            for (Path p : c.getOrigin().getPaths()) {
                Path abs = p.toAbsolutePath().normalize();
                if (abs.getParent() != null && abs.getParent().equals(modsDir.toAbsolutePath().normalize())
                    && abs.getFileName().toString().endsWith(".jar") && Files.isRegularFile(abs)) {
                    return abs;
                }
            }
        } catch (Throwable e) {
            log.log("mod origin unavailable for " + id, e);
        }
        return null;
    }

    /** Outcome of apply: what to record in the state, and what was refused. */
    static final class Result {
        /** Mod id to the enabled flag the state should record. */
        final Map<String, Boolean> record = new LinkedHashMap<>();
        /** Mod id not disabled to the still-enabled mod that needs it. */
        final Map<String, String> blockedOff = new LinkedHashMap<>();
        /** Mod id not enabled to the dependency that is (or will be) disabled. */
        final Map<String, String> blockedOn = new LinkedHashMap<>();
        /** Mods that could not be disabled because no top-level jar holds them. */
        final List<String> cannot = new ArrayList<>();
    }

    /**
     * Checks wanted (id to enabled) and returns what to record in the state. enabledNow says which mods count as
     * enabled before this call. A mod is not disabled while another still-enabled mod (loaded, or being enabled now)
     * depends on it or on one of its provides aliases, and a disabled mod is not enabled while a dependency of it is
     * (or stays) disabled. A mod without a top-level jar in mods/ cannot be disabled. No file is renamed.
     */
    Result apply(Map<String, Boolean> wanted, Map<String, Boolean> enabledNow) {
        Result r = new Result();
        Map<String, Path> disabled = disabled();
        Set<String> off = new HashSet<>();
        Map<String, Set<String>> enableDeps = new HashMap<>();
        for (Map.Entry<String, Boolean> e : wanted.entrySet()) {
            String id = e.getKey();
            if (SELF.equals(id)) continue;
            if (!e.getValue()) {
                if (loaded(id)) off.add(id);
                else if (disabled.containsKey(id)) r.record.put(id, Boolean.FALSE);
            } else if (disabled.containsKey(id) && !loaded(id)) {
                enableDeps.put(id, depends(disabled.get(id)));
            } else if (loaded(id)) {
                r.record.put(id, Boolean.TRUE);
            }
        }
        boolean changed = true;
        while (changed) {
            changed = false;
            for (String id : new HashSet<>(off)) {
                String blocker = blocker(id, off, enableDeps, enabledNow);
                if (blocker != null) {
                    off.remove(id);
                    r.blockedOff.put(id, blocker);
                    changed = true;
                }
            }
            for (String id : new HashSet<>(enableDeps.keySet())) {
                String missing = missing(enableDeps.get(id), off, enableDeps.keySet(), disabled);
                if (missing != null) {
                    enableDeps.remove(id);
                    r.blockedOn.put(id, missing);
                    changed = true;
                }
            }
        }
        for (String id : off) {
            if (jarOf(id) == null) r.cannot.add(id);
            else r.record.put(id, Boolean.FALSE);
        }
        for (String id : enableDeps.keySet()) r.record.put(id, Boolean.TRUE);
        return r;
    }

    private static Set<String> aliases(String id) {
        Set<String> out = new HashSet<>();
        out.add(id);
        try {
            ModContainer c = FabricLoader.getInstance().getModContainer(id).orElse(null);
            if (c != null) out.addAll(c.getMetadata().getProvides());
        } catch (Throwable e) {
            // no alias data: the id alone
        }
        return out;
    }

    /** Still-enabled mod that depends on id (or an alias of it), or null. enableDeps are the mods being enabled. */
    private static String blocker(String id, Set<String> off, Map<String, Set<String>> enableDeps,
                                  Map<String, Boolean> enabledNow) {
        Set<String> names = aliases(id);
        try {
            for (Map.Entry<String, Set<String>> e : enableDeps.entrySet()) {
                for (String d : e.getValue()) {
                    if (names.contains(d)) return e.getKey();
                }
            }
            for (ModContainer other : FabricLoader.getInstance().getAllMods()) {
                String oid = other.getMetadata().getId();
                if (oid.equals(id) || off.contains(oid) || Boolean.FALSE.equals(enabledNow.get(oid))) continue;
                for (ModDependency d : other.getMetadata().getDependencies()) {
                    if (d.getKind() == ModDependency.Kind.DEPENDS && names.contains(d.getModId())) return oid;
                }
            }
        } catch (Throwable e) {
            return "?";
        }
        return null;
    }

    /** First dependency of a mod being enabled that is (or stays) disabled, or null. */
    private static String missing(Set<String> deps, Set<String> off, Set<String> enabling, Map<String, Path> disabled) {
        for (String d : deps) {
            for (String o : off) {
                if (aliases(o).contains(d)) return d;
            }
            if (!loaded(d) && disabled.containsKey(d) && !enabling.contains(d)) return d;
        }
        return null;
    }

    /** Ids a disabled jar requires ("depends" of its fabric.mod.json), without the platform entries. */
    private static Set<String> depends(Path jar) {
        Set<String> out = new HashSet<>();
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            ZipEntry e = zip.getEntry("fabric.mod.json");
            if (e == null) return out;
            try (InputStream in = zip.getInputStream(e)) {
                Map<String, Object> root = Bridge.Json.parse(new String(readAll(in), StandardCharsets.UTF_8));
                if (root.get("depends") instanceof Map) out.addAll(Protocol.asMap(root.get("depends")).keySet());
            }
        } catch (Throwable e) {
            // unreadable metadata: no known dependencies
        }
        out.remove("minecraft");
        out.remove("fabricloader");
        out.remove("java");
        return out;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }
}
