package dev.remined.companion;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * Connect helper: opens a multiplayer connection through the game's own ConnectScreen, by reflection.
 * Members are resolved on first use; a failed resolve is logged once and retried at most once a minute.
 * Must run on the client thread.
 */
final class Ui {
    private static final long RETRY_MS = 60_000L;

    private static final class Connect {
        Class<?> screen, addr, data;
        Constructor<?> addrCtor, dataCtor, titleCtor;
        Object flag;
        Method start;
    }

    private final Companion log;
    private final Reflect r;
    private final Map<String, Object> members = new HashMap<>();
    private final Map<String, Long> failedAt = new HashMap<>();

    Ui(Companion log, Reflect r) {
        this.log = log;
        this.r = r;
    }

    /** Opens a connection like the multiplayer menu does. ConnectScreen disconnects the current world itself. */
    void connect(String host, int port, String name) throws Exception {
        Connect k = member("connect", this::resolveConnect);
        Object mc = r.client();
        Object cur = r.screen(mc);
        if (cur != null && k.screen.isInstance(cur)) throw new IllegalStateException("already connecting");
        Object addr = k.addrCtor.newInstance(host, port);
        Object data = k.dataCtor.newInstance(name == null || name.isEmpty() ? host : name, host + ":" + port, k.flag);
        Object parent = k.titleCtor.newInstance();
        Class<?>[] p = k.start.getParameterTypes();
        Object[] args = new Object[p.length];
        for (int i = 0; i < p.length; i++) {
            if (p[i] == boolean.class) args[i] = Boolean.FALSE;
            else if (p[i].isInstance(parent)) args[i] = parent;
            else if (p[i].isInstance(mc)) args[i] = mc;
            else if (p[i] == k.addr) args[i] = addr;
            else if (p[i] == k.data) args[i] = data;
            else args[i] = null;
        }
        k.start.invoke(null, args);
    }

    @SuppressWarnings("unchecked")
    private <T> T member(String key, Callable<T> resolve) throws Exception {
        Object v = members.get(key);
        if (v != null) return (T) v;
        long now = System.currentTimeMillis();
        Long f = failedAt.get(key);
        if (f != null && now - f < RETRY_MS) throw new IllegalStateException(key + " unavailable");
        try {
            T t = resolve.call();
            if (t == null) throw new IllegalStateException(key + " not found");
            members.put(key, t);
            return t;
        } catch (Throwable e) {
            failedAt.put(key, now);
            log.log(key + " unavailable", e);
            throw new IllegalStateException(key + " unavailable", e);
        }
    }

    private boolean mj() {
        return r.isMojmap();
    }

    private Connect resolveConnect() throws Exception {
        ClassLoader cl = Companion.class.getClassLoader();
        Connect k = new Connect();
        k.screen = Class.forName(mj() ? "net.minecraft.client.gui.screens.ConnectScreen" : "net.minecraft.class_412", false, cl);
        k.addr = Class.forName(mj() ? "net.minecraft.client.multiplayer.resolver.ServerAddress" : "net.minecraft.class_639", false, cl);
        k.data = Class.forName(mj() ? "net.minecraft.client.multiplayer.ServerData" : "net.minecraft.class_642", false, cl);
        Class<?> title = Class.forName(mj() ? "net.minecraft.client.gui.screens.TitleScreen" : "net.minecraft.class_442", false, cl);
        k.addrCtor = k.addr.getConstructor(String.class, int.class);
        k.titleCtor = title.getConstructor();
        for (Constructor<?> c : k.data.getConstructors()) {
            Class<?>[] p = c.getParameterTypes();
            if (p.length == 3 && p[0] == String.class && p[1] == String.class) {
                k.dataCtor = c;
                break;
            }
        }
        if (k.dataCtor == null) throw new NoSuchMethodException("ServerData(String,String,?)");
        Class<?> flag = k.dataCtor.getParameterTypes()[2];
        if (flag == boolean.class) {
            k.flag = Boolean.FALSE;
        } else if (flag.isEnum()) {
            Object[] consts = flag.getEnumConstants();
            k.flag = consts[Math.min(2, consts.length - 1)];   // OTHER
        } else {
            throw new NoSuchMethodException("ServerData flag type " + flag.getName());
        }
        for (Method m : k.screen.getDeclaredMethods()) {
            Class<?>[] p = m.getParameterTypes();
            if (Modifier.isStatic(m.getModifiers()) && m.getReturnType() == void.class && p.length >= 5 && p[2] == k.addr) {
                m.setAccessible(true);
                k.start = m;
                break;
            }
        }
        if (k.start == null) throw new NoSuchMethodException("ConnectScreen.startConnecting");
        return k;
    }
}
