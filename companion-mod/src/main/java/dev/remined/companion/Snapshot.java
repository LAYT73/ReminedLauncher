package dev.remined.companion;

/** Immutable game-state snapshot plus hand-rolled JSON serialisation. */
final class Snapshot {
    static final int SCHEMA = 1;

    final boolean inWorld;
    final String dim;     // nullable
    final boolean paused;
    final String mode;    // sp | lan | mp | menu
    final String screen;  // nullable simple class name

    Snapshot(boolean inWorld, String dim, boolean paused, String mode, String screen) {
        this.inWorld = inWorld;
        this.dim = dim;
        this.paused = paused;
        this.mode = mode;
        this.screen = screen;
    }

    /** JSON of everything except the timestamp; used for change detection. */
    String contentJson() {
        StringBuilder sb = new StringBuilder(128);
        sb.append("\"v\":").append(SCHEMA)
          .append(",\"inWorld\":").append(inWorld)
          .append(",\"dim\":").append(str(dim))
          .append(",\"paused\":").append(paused)
          .append(",\"mode\":").append(str(mode))
          .append(",\"screen\":").append(str(screen));
        return sb.toString();
    }

    String toJson(long ts) {
        return "{" + contentJson() + ",\"ts\":" + ts + "}\n";
    }

    static String str(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }
}
