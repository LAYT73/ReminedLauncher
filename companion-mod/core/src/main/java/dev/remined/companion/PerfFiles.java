package dev.remined.companion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Edits one value of another mod's config file. json is parsed and rewritten pretty (key path a.b nests); json5, toml
 * and properties are edited on the first line whose key matches, everything else stays as it is.
 */
final class PerfFiles {
    private PerfFiles() {
    }

    /** Sets key in the file. False when the file or the key is missing (nothing is written). Throws on I/O or bad json. */
    static boolean edit(Path file, String format, String key, Object value) throws IOException {
        if (!Files.isRegularFile(file)) return false;
        String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
        String out = editText(text, format, key, value);
        if (out == null) return false;
        if (out.equals(text)) return true;
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, out.getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
        return true;
    }

    /** Current value of key, or null when the file or the key is missing. */
    static Object read(Path file, String format, String key) throws IOException {
        if (!Files.isRegularFile(file)) return null;
        return readText(new String(Files.readAllBytes(file), StandardCharsets.UTF_8), format, key);
    }

    /** The text with key set, or null when the key is missing. */
    static String editText(String text, String format, String key, Object value) {
        if ("json".equals(format)) {
            Map<String, Object> root = Bridge.Json.parse(text);
            Map<String, Object> holder = holder(root, key);
            if (holder == null) return null;
            holder.put(leaf(root, key), value);
            StringBuilder sb = new StringBuilder();
            write(sb, root, 0);
            return sb.append('\n').toString();
        }
        boolean props = "properties".equals(format);
        String[] lines = text.split("\n", -1);
        for (String k : candidates(key)) {
            Pattern p = linePattern(k);
            for (int i = 0; i < lines.length; i++) {
                boolean cr = lines[i].endsWith("\r");
                String line = cr ? lines[i].substring(0, lines[i].length() - 1) : lines[i];
                Matcher m = p.matcher(line);
                if (!m.matches()) continue;
                String[] split = splitValue(m.group(4), props);
                if (split == null) continue;
                lines[i] = m.group(1) + m.group(2) + k + m.group(2) + m.group(3) + format(value, props) + split[1]
                    + (cr ? "\r" : "");
                return String.join("\n", lines);
            }
        }
        return null;
    }

    /** The value of key in text, or null when missing. */
    static Object readText(String text, String format, String key) {
        if ("json".equals(format)) {
            Map<String, Object> root = Bridge.Json.parse(text);
            Map<String, Object> holder = holder(root, key);
            return holder == null ? null : PerfProfile.norm(holder.get(leaf(root, key)));
        }
        boolean props = "properties".equals(format);
        for (String k : candidates(key)) {
            Pattern p = linePattern(k);
            for (String raw : text.split("\n", -1)) {
                Matcher m = p.matcher(raw.endsWith("\r") ? raw.substring(0, raw.length() - 1) : raw);
                if (!m.matches()) continue;
                String[] split = splitValue(m.group(4), props);
                if (split != null) return parse(split[0], props);
            }
        }
        return null;
    }

    /** Whole key first, then its last dotted part. */
    private static String[] candidates(String key) {
        int dot = key.lastIndexOf('.');
        return dot < 0 ? new String[] {key} : new String[] {key, key.substring(dot + 1)};
    }

    private static Pattern linePattern(String key) {
        return Pattern.compile("^(\\s*)([\"']?)" + Pattern.quote(key) + "\\2(\\s*[:=]\\s*)(.*)$");
    }

    /** Value token and the rest of the line (trailing comma, comment), or null when the value cannot be edited in place. */
    private static String[] splitValue(String rest, boolean props) {
        if (props) return new String[] {rest.trim(), ""};
        if (rest.isEmpty()) return null;
        char c = rest.charAt(0);
        if (c == '{' || c == '[') return null;
        int end;
        if (c == '"' || c == '\'') {
            end = 1;
            while (end < rest.length() && rest.charAt(end) != c) end += rest.charAt(end) == '\\' ? 2 : 1;
            if (end >= rest.length()) return null;
            end++;
        } else {
            end = 0;
            while (end < rest.length() && ",\t /#".indexOf(rest.charAt(end)) < 0) end++;
            if (end == 0) return null;
        }
        return new String[] {rest.substring(0, end), rest.substring(end)};
    }

    private static Object parse(String token, boolean props) {
        if (!props && token.length() >= 2 && (token.charAt(0) == '"' || token.charAt(0) == '\'')) {
            return token.substring(1, token.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
        }
        if (token.equals("true")) return Boolean.TRUE;
        if (token.equals("false")) return Boolean.FALSE;
        try {
            if (token.indexOf('.') >= 0 || token.indexOf('e') >= 0 || token.indexOf('E') >= 0) return Double.valueOf(token);
            return Long.valueOf(token);
        } catch (NumberFormatException e) {
            return token;
        }
    }

    private static String format(Object v, boolean props) {
        Object n = v;
        if (n instanceof String && !props) return "\"" + ((String) n).replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        return String.valueOf(n);
    }

    /** The map that holds key (a literal top-level key wins over the a.b path), or null. */
    private static Map<String, Object> holder(Map<String, Object> root, String key) {
        if (root.containsKey(key)) return root;
        String[] parts = key.split("\\.");
        Map<String, Object> m = root;
        for (int i = 0; i < parts.length - 1; i++) {
            Object child = m.get(parts[i]);
            if (!(child instanceof Map)) return null;
            m = Protocol.asMap(child);
        }
        return m.containsKey(parts[parts.length - 1]) ? m : null;
    }

    private static String leaf(Map<String, Object> root, String key) {
        if (root.containsKey(key)) return key;
        return key.substring(key.lastIndexOf('.') + 1);
    }

    private static void write(StringBuilder sb, Object v, int depth) {
        if (v instanceof Map) {
            Map<String, Object> m = Protocol.asMap(v);
            if (m.isEmpty()) {
                sb.append("{}");
                return;
            }
            sb.append("{\n");
            int i = 0;
            for (Map.Entry<String, Object> e : m.entrySet()) {
                indent(sb, depth + 1);
                sb.append(Snapshot.str(e.getKey())).append(": ");
                write(sb, e.getValue(), depth + 1);
                sb.append(++i < m.size() ? ",\n" : "\n");
            }
            indent(sb, depth);
            sb.append('}');
        } else if (v instanceof List) {
            List<?> l = (List<?>) v;
            if (l.isEmpty()) {
                sb.append("[]");
                return;
            }
            sb.append("[\n");
            for (int i = 0; i < l.size(); i++) {
                indent(sb, depth + 1);
                write(sb, l.get(i), depth + 1);
                sb.append(i + 1 < l.size() ? ",\n" : "\n");
            }
            indent(sb, depth);
            sb.append(']');
        } else if (v instanceof String) {
            sb.append(Snapshot.str((String) v));
        } else {
            sb.append(String.valueOf(v));
        }
    }

    private static void indent(StringBuilder sb, int depth) {
        for (int i = 0; i < depth; i++) sb.append("  ");
    }
}
