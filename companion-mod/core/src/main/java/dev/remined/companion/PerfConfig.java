package dev.remined.companion;

import java.nio.file.Path;
import java.util.List;

/** Runs the ops of a "config" item (file edits, reflection set and call) and probes its current state. Never throws. */
final class PerfConfig {
    /** What one run did. */
    static final class Outcome {
        boolean reload;
        int fileOk;
        boolean fileFailed;
        boolean liveFailed;
    }

    private final Path configDir;
    private final Companion log;

    PerfConfig(Path configDir, Companion log) {
        this.configDir = configDir.toAbsolutePath().normalize();
        this.log = log;
    }

    private Path resolve(String file) {
        Path p = configDir.resolve(file).normalize();
        return p.startsWith(configDir) ? p : null;
    }

    Outcome run(List<PerfProfile.Op> ops) {
        Outcome o = new Outcome();
        for (PerfProfile.Op op : ops) {
            try {
                switch (op.type) {
                    case PerfProfile.Op.FILE: {
                        Path p = resolve(op.file);
                        if (p == null) throw new IllegalArgumentException("path outside config: " + op.file);
                        if (PerfFiles.edit(p, op.format, op.key, op.value)) o.fileOk++;
                        else log.log("config file or key missing: " + op.file + " " + op.key, null);
                        break;
                    }
                    case PerfProfile.Op.SET:
                        PerfReflect.set(op.path, op.value);
                        break;
                    case PerfProfile.Op.CALL:
                        PerfReflect.call(op.path);
                        break;
                    case PerfProfile.Op.RELOAD:
                        o.reload = true;
                        break;
                    default:
                        break;
                }
            } catch (Throwable e) {
                log.log("config op failed: " + (op.file != null ? op.file + " " + op.key : op.path), e);
                if (PerfProfile.Op.FILE.equals(op.type)) o.fileFailed = true;
                else o.liveFailed = true;
            }
        }
        return o;
    }

    /** True (on) or false for a config item, or null when it cannot be told. A missing file or key counts as on. */
    Boolean actual(PerfProfile.Item it) {
        try {
            PerfProfile.Op p = it.probe;
            if (p == null) {
                for (PerfProfile.Op op : it.on) {
                    if (PerfProfile.Op.FILE.equals(op.type)) {
                        p = op;
                        break;
                    }
                }
            }
            if (p == null) return null;
            Object v;
            if (PerfProfile.Op.GET.equals(p.type)) {
                v = PerfReflect.get(p.path);
                if (v instanceof Enum) v = ((Enum<?>) v).name();
            } else {
                Path path = resolve(p.file);
                if (path == null) return null;
                v = PerfFiles.read(path, p.format, p.key);
                if (v == null) return Boolean.TRUE;
            }
            return Boolean.valueOf(same(v, p.value));
        } catch (Throwable e) {
            return null;
        }
    }

    static boolean same(Object a, Object b) {
        if (a instanceof String && b instanceof String) return ((String) a).equalsIgnoreCase((String) b);
        return PerfProfile.same(PerfProfile.norm(a), PerfProfile.norm(b));
    }
}
