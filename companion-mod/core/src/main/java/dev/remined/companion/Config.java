package dev.remined.companion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Settings in config/remined-companion.json. A missing or corrupt file yields defaults. */
final class Config {
    static final int NAMES_ALWAYS = 0;
    static final int NAMES_SPEAKING = 1;
    static final int NAMES_NEVER = 2;

    boolean hudEnabled = true;
    boolean hudRow;
    int names = NAMES_ALWAYS;
    boolean onlySpeaking;
    double scale = 1.0;
    int opacity = 56;
    boolean hideInMenus = true;
    int hudCorner = Anchor.BR;
    int hudDx = 6;
    int hudDy = 6;
    boolean noticesEnabled = true;
    int noticeCorner = Anchor.TR;
    int noticeSeconds = 5;

    static Config load(Path file) {
        Config c = new Config();
        try {
            if (!Files.exists(file)) return c;
            String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            Map<String, Object> root = Bridge.Json.parse(text);
            Map<String, Object> hud = section(root, "hud");
            c.hudEnabled = bool(hud, "enabled", c.hudEnabled);
            c.hudRow = "row".equals(Protocol.str(hud, "layout"));
            String names = Protocol.str(hud, "names");
            c.names = "speaking".equals(names) ? NAMES_SPEAKING : "never".equals(names) ? NAMES_NEVER : NAMES_ALWAYS;
            c.onlySpeaking = bool(hud, "onlySpeaking", c.onlySpeaking);
            if (hud.get("scale") instanceof Number) c.scale = ((Number) hud.get("scale")).doubleValue();
            c.opacity = (int) Protocol.num(hud, "opacity", c.opacity);
            c.hideInMenus = bool(hud, "hideInMenus", c.hideInMenus);
            c.hudCorner = Anchor.parse(Protocol.str(hud, "corner"), c.hudCorner);
            c.hudDx = (int) Protocol.num(hud, "dx", c.hudDx);
            c.hudDy = (int) Protocol.num(hud, "dy", c.hudDy);
            Map<String, Object> notices = section(root, "notices");
            c.noticesEnabled = bool(notices, "enabled", c.noticesEnabled);
            c.noticeCorner = Anchor.parse(Protocol.str(notices, "corner"), c.noticeCorner);
            c.noticeSeconds = (int) Protocol.num(notices, "seconds", c.noticeSeconds);
        } catch (Throwable e) {
            return new Config();
        }
        c.clamp();
        return c;
    }

    void clamp() {
        scale = Math.max(0.5, Math.min(2.0, scale));
        opacity = Math.max(0, Math.min(100, opacity));
        hudDx = Math.max(0, Math.min(4000, hudDx));
        hudDy = Math.max(0, Math.min(4000, hudDy));
        noticeSeconds = Math.max(3, Math.min(10, noticeSeconds));
        names = Math.max(NAMES_ALWAYS, Math.min(NAMES_NEVER, names));
    }

    String toJson() {
        String names = this.names == NAMES_SPEAKING ? "speaking" : this.names == NAMES_NEVER ? "never" : "always";
        return "{\"hud\":{\"enabled\":" + hudEnabled
            + ",\"layout\":\"" + (hudRow ? "row" : "column") + "\""
            + ",\"names\":\"" + names + "\""
            + ",\"onlySpeaking\":" + onlySpeaking
            + ",\"scale\":" + String.format(Locale.ROOT, "%.2f", scale)
            + ",\"opacity\":" + opacity
            + ",\"hideInMenus\":" + hideInMenus
            + ",\"corner\":\"" + Anchor.name(hudCorner) + "\""
            + ",\"dx\":" + hudDx + ",\"dy\":" + hudDy + "},"
            + "\"notices\":{\"enabled\":" + noticesEnabled
            + ",\"corner\":\"" + Anchor.name(noticeCorner) + "\""
            + ",\"seconds\":" + noticeSeconds + "}}\n";
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

    private static Map<String, Object> section(Map<String, Object> root, String key) {
        Object v = root.get(key);
        return v instanceof Map ? Protocol.asMap(v) : new HashMap<String, Object>();
    }

    private static boolean bool(Map<String, Object> m, String key, boolean def) {
        Object v = m.get(key);
        return v instanceof Boolean ? (Boolean) v : def;
    }
}
