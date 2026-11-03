package dev.remined.companion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Player state in config/remined-performance.json. The launcher reads only "mods" (it renames jars before launch).
 * packOrder is the resource pack order as it was before packs were removed, so re-enabling restores the position.
 */
final class PerfState {
    String preset = "custom";
    String packVersion = "";
    final Map<String, Object> values = new LinkedHashMap<>();
    final Map<String, Boolean> mods = new LinkedHashMap<>();
    final List<String> packOrder = new ArrayList<>();

    /** The saved state, or null when the file is absent or invalid. */
    static PerfState load(Path file) {
        try {
            if (!Files.isRegularFile(file)) return null;
            Map<String, Object> root = Bridge.Json.parse(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
            PerfState s = new PerfState();
            String preset = Protocol.str(root, "preset");
            if (preset != null) s.preset = preset;
            String pv = Protocol.str(root, "packVersion");
            if (pv != null) s.packVersion = pv;
            if (root.get("values") instanceof Map) {
                for (Map.Entry<String, Object> e : Protocol.asMap(root.get("values")).entrySet()) {
                    Object v = e.getValue();
                    if (v instanceof Boolean || v instanceof Number || v instanceof String) {
                        s.values.put(e.getKey(), PerfProfile.norm(v));
                    }
                }
            }
            if (root.get("mods") instanceof Map) {
                for (Map.Entry<String, Object> e : Protocol.asMap(root.get("mods")).entrySet()) {
                    if (e.getValue() instanceof Boolean) s.mods.put(e.getKey(), (Boolean) e.getValue());
                }
            }
            if (root.get("packOrder") instanceof List) {
                for (Object o : (List<?>) root.get("packOrder")) {
                    if (o instanceof String) s.packOrder.add((String) o);
                }
            }
            return s;
        } catch (Throwable e) {
            return null;
        }
    }

    String toJson() {
        StringBuilder sb = new StringBuilder("{\"version\":1,\"preset\":").append(Snapshot.str(preset));
        sb.append(",\"packVersion\":").append(Snapshot.str(packVersion));
        sb.append(",\"values\":{");
        boolean first = true;
        for (Map.Entry<String, Object> e : values.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(Snapshot.str(e.getKey())).append(':').append(value(e.getValue()));
        }
        sb.append("},\"mods\":{");
        first = true;
        for (Map.Entry<String, Boolean> e : mods.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(Snapshot.str(e.getKey())).append(':').append(e.getValue());
        }
        sb.append("},\"packOrder\":[");
        for (int i = 0; i < packOrder.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(Snapshot.str(packOrder.get(i)));
        }
        return sb.append("]}\n").toString();
    }

    private static String value(Object v) {
        if (v instanceof String) return Snapshot.str((String) v);
        if (v instanceof Number) {
            Object n = PerfProfile.norm(v);
            return n instanceof Long ? n.toString() : String.format(java.util.Locale.ROOT, "%s", n);
        }
        return String.valueOf(v);
    }

    void save(Path file) throws IOException {
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, toJson().getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * Baseline order refreshed against the current selection: selected as is, with every id in removed that the
     * baseline knows put back at its baseline position.
     */
    static List<String> mergeOrder(List<String> baseline, List<String> selected, Collection<String> removed) {
        List<String> out = new ArrayList<>(selected);
        for (String id : baseline) {
            if (removed.contains(id) && !out.contains(id)) insertAfterPredecessor(out, baseline, id);
        }
        return out;
    }

    /**
     * Inserts id into list right after the last pack that precedes it in the baseline and is currently in the
     * list, or at the start when none is (appended when the baseline does not know id). No-op when id is already there.
     */
    static void insertAfterPredecessor(List<String> list, List<String> baseline, String id) {
        if (list.contains(id)) return;
        int pos = baseline.indexOf(id);
        if (pos < 0) {
            list.add(id);
            return;
        }
        int at = 0;
        for (int i = pos - 1; i >= 0; i--) {
            int idx = list.indexOf(baseline.get(i));
            if (idx >= 0) {
                at = idx + 1;
                break;
            }
        }
        list.add(at, id);
    }
}
