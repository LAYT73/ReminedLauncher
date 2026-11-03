package dev.remined.companion;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

/**
 * Reflection paths into other mods: pkg.Class.FIELD.field, with method segments name(args) anywhere, e.g.
 * com.x.Client.getConfig().enabled. The class is the longest prefix that loads; static members are looked up first.
 * Arguments are JSON literals.
 */
final class PerfReflect {
    private PerfReflect() {
    }

    static final class Seg {
        final String name;
        /** Null for a field segment, the literal arguments for a method segment. */
        final List<Object> args;

        Seg(String name, List<Object> args) {
            this.name = name;
            this.args = args;
        }
    }

    private static final class Cursor {
        final Class<?> cls;
        final Object obj;

        Cursor(Class<?> cls, Object obj) {
            this.cls = cls;
            this.obj = obj;
        }
    }

    /** Splits a path into segments. Throws IllegalArgumentException on bad syntax. */
    static List<Seg> parsePath(String path) {
        if (path == null || path.isEmpty()) throw new IllegalArgumentException("empty path");
        List<Seg> out = new ArrayList<>();
        int depth = 0;
        boolean quoted = false;
        int start = 0;
        for (int i = 0; i <= path.length(); i++) {
            char c = i < path.length() ? path.charAt(i) : '.';
            if (quoted) {
                if (c == '\\') i++;
                else if (c == '"') quoted = false;
                continue;
            }
            if (c == '"') quoted = true;
            else if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == '.' && depth == 0) {
                out.add(segment(path.substring(start, i).trim()));
                start = i + 1;
            }
        }
        if (quoted || depth != 0) throw new IllegalArgumentException("unbalanced path: " + path);
        return out;
    }

    private static Seg segment(String s) {
        if (s.isEmpty()) throw new IllegalArgumentException("empty segment");
        int p = s.indexOf('(');
        if (p < 0) return new Seg(s, null);
        if (p == 0 || !s.endsWith(")")) throw new IllegalArgumentException("bad segment: " + s);
        List<Object> args = new ArrayList<>();
        String inner = s.substring(p + 1, s.length() - 1);
        boolean quoted = false;
        int start = 0;
        for (int i = 0; i <= inner.length(); i++) {
            char c = i < inner.length() ? inner.charAt(i) : ',';
            if (quoted) {
                if (c == '\\') i++;
                else if (c == '"') quoted = false;
                continue;
            }
            if (c == '"') quoted = true;
            else if (c == ',') {
                String tok = inner.substring(start, i).trim();
                if (!(tok.isEmpty() && args.isEmpty() && i == inner.length())) args.add(literal(tok));
                start = i + 1;
            }
        }
        return new Seg(s.substring(0, p), args);
    }

    /** true, false, null, a number or a quoted string. */
    static Object literal(String t) {
        if (t.equals("true")) return Boolean.TRUE;
        if (t.equals("false")) return Boolean.FALSE;
        if (t.equals("null")) return null;
        if (t.length() >= 2 && t.charAt(0) == '"' && t.charAt(t.length() - 1) == '"') {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < t.length() - 1; i++) {
                char c = t.charAt(i);
                if (c == '\\' && i + 1 < t.length() - 1) {
                    char n = t.charAt(++i);
                    sb.append(n == 'n' ? '\n' : n == 't' ? '\t' : n);
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }
        try {
            if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) return Double.valueOf(t);
            return Long.valueOf(t);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("bad literal: " + t);
        }
    }

    /** Converts a JSON value to a field or parameter type: boxing, numbers, String to enum (exact, then any case). */
    static Object convert(Object v, Class<?> t) {
        if (v == null) {
            if (t.isPrimitive()) throw new IllegalArgumentException("null for " + t);
            return null;
        }
        if (t == boolean.class || t == Boolean.class) {
            if (v instanceof Boolean) return v;
            if ("true".equals(v)) return Boolean.TRUE;
            if ("false".equals(v)) return Boolean.FALSE;
        } else if (v instanceof Number && (t.isPrimitive() || Number.class.isAssignableFrom(t)) && t != boolean.class) {
            Number n = (Number) v;
            if (t == int.class || t == Integer.class) return n.intValue();
            if (t == long.class || t == Long.class) return n.longValue();
            if (t == double.class || t == Double.class) return n.doubleValue();
            if (t == float.class || t == Float.class) return n.floatValue();
            if (t == short.class || t == Short.class) return n.shortValue();
            if (t == byte.class || t == Byte.class) return n.byteValue();
        } else if (t == String.class) {
            return v.toString();
        } else if (t.isEnum() && v instanceof String) {
            Object[] all = t.getEnumConstants();
            for (Object c : all) {
                if (((Enum<?>) c).name().equals(v)) return c;
            }
            for (Object c : all) {
                if (((Enum<?>) c).name().equalsIgnoreCase((String) v)) return c;
            }
            throw new IllegalArgumentException("no " + v + " in " + t.getName());
        }
        if (t.isInstance(v)) return v;
        throw new IllegalArgumentException("cannot convert " + v.getClass().getSimpleName() + " to " + t.getName());
    }

    private static Class<?> load(String name) {
        try {
            return Class.forName(name, true, PerfReflect.class.getClassLoader());
        } catch (Throwable e) {
            return null;
        }
    }

    /** Starts the walk: the longest loading class prefix (dots, then up to three nested classes with $). Returns the segment index after it. */
    private static int[] resolveClass(List<Seg> segs, Class<?>[] out) {
        int max = 0;
        while (max < segs.size() && segs.get(max).args == null) max++;
        for (int n = max; n >= 1; n--) {
            for (int nested = 0; nested <= 3 && nested < n; nested++) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < n; i++) {
                    if (i > 0) sb.append(i >= n - nested ? '$' : '.');
                    sb.append(segs.get(i).name);
                }
                Class<?> c = load(sb.toString());
                if (c != null) {
                    out[0] = c;
                    return new int[] {n};
                }
            }
        }
        throw new IllegalArgumentException("class not found for " + segs.get(0).name);
    }

    private static Field findField(Class<?> c, String name) throws NoSuchFieldException {
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            try {
                return k.getDeclaredField(name);
            } catch (NoSuchFieldException e) {
                // look up the hierarchy
            }
        }
        throw new NoSuchFieldException(c.getName() + "." + name);
    }

    private static Object invoke(Cursor c, Seg s) throws Exception {
        Class<?> cls = c.obj != null ? c.obj.getClass() : c.cls;
        List<Method> candidates = new ArrayList<>();
        for (Method m : cls.getMethods()) candidates.add(m);
        for (Class<?> k = cls; k != null; k = k.getSuperclass()) {
            for (Method m : k.getDeclaredMethods()) candidates.add(m);
        }
        Exception last = null;
        for (Method m : candidates) {
            if (!m.getName().equals(s.name) || m.getParameterCount() != s.args.size()) continue;
            if (c.obj == null && !Modifier.isStatic(m.getModifiers())) continue;
            Object[] args = new Object[s.args.size()];
            try {
                Class<?>[] types = m.getParameterTypes();
                for (int i = 0; i < args.length; i++) args[i] = convert(s.args.get(i), types[i]);
            } catch (IllegalArgumentException e) {
                last = e;
                continue;
            }
            try {
                m.setAccessible(true);
            } catch (Throwable e) {
                // a public method of an exported class still works
            }
            try {
                return m.invoke(c.obj, args);
            } catch (InvocationTargetException e) {
                Throwable cause = e.getCause();
                throw cause instanceof Exception ? (Exception) cause : e;
            } catch (IllegalAccessException e) {
                last = e;
            }
        }
        if (last != null) throw last;
        throw new NoSuchMethodException(cls.getName() + "." + s.name + "/" + s.args.size());
    }

    private static Cursor step(Cursor c, Seg s) throws Exception {
        Object v;
        if (s.args != null) {
            v = invoke(c, s);
        } else {
            Field f = findField(c.obj != null ? c.obj.getClass() : c.cls, s.name);
            if (c.obj == null && !Modifier.isStatic(f.getModifiers())) {
                throw new IllegalStateException(f.getName() + " is not static");
            }
            f.setAccessible(true);
            v = f.get(c.obj);
        }
        if (v == null) throw new IllegalStateException(s.name + " is null");
        return new Cursor(v.getClass(), v);
    }

    /** Walks segments [0, end) and returns the cursor (obj null while still on a class). */
    private static Cursor walk(List<Seg> segs, int end) throws Exception {
        Class<?>[] cls = new Class<?>[1];
        int from = resolveClass(segs, cls)[0];
        Cursor c = new Cursor(cls[0], null);
        for (int i = from; i < end; i++) c = step(c, segs.get(i));
        return c;
    }

    /** Value at the end of the path (a field, or a method result). */
    static Object get(String path) throws Exception {
        List<Seg> segs = parsePath(path);
        Cursor c = walk(segs, segs.size());
        return c.obj;
    }

    /** Sets the field at the end of the path to value, converted to the field type. */
    static void set(String path, Object value) throws Exception {
        List<Seg> segs = parsePath(path);
        Seg last = segs.get(segs.size() - 1);
        if (last.args != null) throw new IllegalArgumentException("set needs a field at the end");
        Cursor c = walk(segs, segs.size() - 1);
        Field f = findField(c.obj != null ? c.obj.getClass() : c.cls, last.name);
        if (c.obj == null && !Modifier.isStatic(f.getModifiers())) throw new IllegalStateException(f.getName() + " is not static");
        f.setAccessible(true);
        f.set(c.obj, convert(value, f.getType()));
    }

    /** Invokes the method at the end of the path. */
    static Object call(String path) throws Exception {
        List<Seg> segs = parsePath(path);
        Seg last = segs.get(segs.size() - 1);
        if (last.args == null) throw new IllegalArgumentException("call needs a method at the end");
        Cursor c = walk(segs, segs.size() - 1);
        return invoke(c, last);
    }
}
