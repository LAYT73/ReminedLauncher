package dev.remined.companion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** Writes state.json only when content changed or the heartbeat interval elapsed. */
final class StateWriter {
    static final long HEARTBEAT_MS = 10_000L;

    private final Path file;
    private String lastContent;
    private long lastWriteMs;

    StateWriter(Path file) {
        this.file = file;
    }

    /** Returns true if a write was attempted. */
    boolean maybeWrite(Snapshot s, long nowMs) throws IOException {
        String content = s.contentJson();
        if (content.equals(lastContent) && nowMs - lastWriteMs < HEARTBEAT_MS) return false;
        write(s.toJson(nowMs));
        lastContent = content;
        lastWriteMs = nowMs;
        return true;
    }

    private void write(String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        try {
            Files.write(tmp, bytes);
            try {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) { }
            Files.write(file, bytes); // fallback: direct write
        }
    }
}
